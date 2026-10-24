/**
 * share-admin — 分享访问密码的设置 / 清除（HTTP 云函数）
 *
 * 为什么必须走服务端：密码摘要要在服务端算（scrypt），客户端直连数据库只能传「摘要」，
 * 而摘要一旦落库就成了可直接复用的凭证；更关键的是——写库必须校验「这组是你的」，
 * 那需要可信的 uid，只有验过 token 的服务端才有。
 *
 * 鉴权链：Authorization: Bearer <CloudBase access_token>
 *   → cb-auth 离线 RS256 验签得 uid → RPC set_share_password(gid, uid, hash)
 *   → RPC 内再按 user_id 匹配一次，双重防越权
 *
 * 接口：POST /  { "gid": "...", "password": "明文" | null }
 *   200 { ok: true, has_password: boolean }
 *   400 参数不合法（含密码长度不合规）
 *   401 未登录 / 令牌无效
 *   403 该分享不属于当前账号
 *   429 频率超限
 *   503 服务未配置或上游故障（fail-closed）
 */

const http = require('http')
const crypto = require('crypto')
const { verifyCbToken } = require('./cb-auth.js')
const { hashPassword, validatePasswordInput } = require('./share-lock.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
const IP_HASH_SALT = process.env.IP_HASH_SALT || ''

/** 写操作限流：每用户 20 次 / 分钟（正常用户远达不到） */
const WRITE_LIMIT_PER_MIN = 20
const BODY_LIMIT = 4096

function isOriginAllowed(origin) {
  return !origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)
}

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (origin && isOriginAllowed(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

function sendJson(res, status, obj, extra) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extra,
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > BODY_LIMIT) {
        reject(new Error('too_large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('invalid_json'))
      }
    })
    req.on('error', reject)
  })
}

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '')
  return (xff.split(',')[0] || '').trim() || req.headers['x-real-ip'] || 'unknown'
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
}

function isValidShareId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{2,64}$/.test(id)
}

let _db = null
function getDb() {
  if (_db) return _db
  const cloudbase = require('@cloudbase/node-sdk')
  const app = cloudbase.init({ env: ENV_ID, accessKey: API_KEY })
  _db = app.rdb()
  return _db
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || ''
  const cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    res.writeHead(isOriginAllowed(origin) ? 200 : 403, cors)
    res.end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' }, { ...cors, Allow: 'POST' })
    return
  }
  if (!ENV_ID || !API_KEY) {
    sendJson(res, 503, { error: 'not_configured' }, cors)
    return
  }
  if (!isOriginAllowed(origin)) {
    sendJson(res, 403, { error: 'origin_not_allowed' }, cors)
    return
  }

  try {
    // 1) 鉴权：离线验签拿 uid（fail-closed）
    const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID })
    if (!auth.ok) {
      sendJson(res, 401, { error: 'unauthorized' }, cors)
      return
    }
    const uid = auth.uid

    // 2) 参数
    let body
    try {
      body = await readJsonBody(req)
    } catch (e) {
      sendJson(res, 400, { error: e.message === 'too_large' ? 'body_too_large' : 'invalid_json' }, cors)
      return
    }
    const gid = typeof body.gid === 'string' ? body.gid.trim() : ''
    if (!isValidShareId(gid)) {
      sendJson(res, 400, { error: 'invalid_gid' }, cors)
      return
    }

    // action=get：查询该分享是否已设密码（只回布尔，绝不回摘要）
    if (body.action === 'get') {
      const dbq = getDb()
      const sec = await dbq.rpc('get_share_secret', { p_gid: gid })
      if (sec.error) {
        console.error('[share-admin] get_share_secret failed:', sec.error)
        sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
        return
      }
      if (!sec.data) {
        sendJson(res, 404, { error: 'not_found' }, cors)
        return
      }
      sendJson(res, 200, { ok: true, has_password: sec.data.has_password === true }, cors)
      return
    }

    // password === null / '' / 缺失 → 清除密码
    const raw = body.password
    const clearing = raw === null || raw === '' || raw === undefined
    let hash = null
    if (!clearing) {
      const policy = validatePasswordInput(raw)
      if (!policy.ok) {
        sendJson(res, 400, { error: 'weak_password', reason: policy.reason }, cors)
        return
      }
      hash = hashPassword(raw)
    }

    // 3) 限流（fail-closed）
    const db = getDb()
    const rl = await db.rpc('consume_rate_limit', {
      p_key: `share-admin:${uid}:${sha256Hex(clientIp(req) + '|' + IP_HASH_SALT)}`,
      p_limit: WRITE_LIMIT_PER_MIN,
      p_window_secs: 60,
    })
    if (rl.error) {
      console.error('[share-admin] rate limit failed (fail-closed):', rl.error)
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }
    // 已知坑：拒绝时 data 可能是 {} 而非 false
    if (rl.data !== true) {
      sendJson(res, 429, { error: 'rate_limited' }, { ...cors, 'Retry-After': '60' })
      return
    }

    // 4) 写库：RPC 内按 (gid, user_id) 匹配，非本人返回 false
    const r = await db.rpc('set_share_password', {
      p_gid: gid,
      p_user_id: uid,
      p_hash: hash,
    })
    if (r.error) {
      console.error('[share-admin] set_share_password failed:', r.error)
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }
    if (r.data !== true) {
      // 组不存在 / 未公开 / 不属于当前账号 —— 统一 403，不泄露具体原因
      sendJson(res, 403, { error: 'forbidden' }, cors)
      return
    }

    sendJson(res, 200, { ok: true, has_password: !clearing }, cors)
  } catch (e) {
    console.error('[share-admin] unhandled:', e)
    sendJson(res, 500, { error: 'internal_error' }, cors)
  }
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log('[share-admin] listening on :' + PORT)
})
