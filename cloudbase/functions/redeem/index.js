/**
 * redeem — 兑换码核销（HTTP 云函数）
 *
 * 作用：在**没有支付商户号**的阶段，先把「输入码 → 核销 → 发放权益 → 额度生效」
 * 这条链路完整跑通并验证。将来接入微信/支付宝时，只需新增「渠道回调写 orders」
 * 的入口，权益发放复用同一套语义。
 *
 * 鉴权：Authorization: Bearer <CloudBase access_token>
 *   → cb-auth 离线验签取 uid → redeem_code(code, uid)（RPC 内再做原子防双兑）
 *
 * 接口：POST / { "code": "XXXXXX" }
 *   200 { ok: true, plan_id, plan_name, expires_at }
 *   400 { ok: false, reason: 'invalid_code' | 'not_found' | 'already_used' | 'plan_inactive' }
 *   401 未登录 / 令牌无效
 *   429 核销过于频繁
 *   503 上游故障（fail-closed）
 */

const http = require('http')
const crypto = require('crypto')
const { verifyCbToken } = require('./cb-auth.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'ulink-redeem'
/** 核销频率：同一用户 10 次 / 10 分钟（防暴力猜码；码本身是 8 位随机，熵足够） */
const REDEEM_LIMIT = 10
const REDEEM_WINDOW_SEC = 600
const BODY_LIMIT = 2048

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
    const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID })
    if (!auth.ok) {
      sendJson(res, 401, { error: 'unauthorized' }, cors)
      return
    }
    const uid = auth.uid

    let body
    try {
      body = await readJsonBody(req)
    } catch (e) {
      sendJson(res, 400, { error: e.message === 'too_large' ? 'body_too_large' : 'invalid_json' }, cors)
      return
    }
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!code) {
      sendJson(res, 400, { ok: false, reason: 'invalid_code' }, cors)
      return
    }

    const db = getDb()

    // 限流 fail-closed
    const rl = await db.rpc('consume_rate_limit', {
      p_key: `redeem:${uid}:${sha256Hex(clientIp(req) + '|' + IP_HASH_SALT)}`,
      p_limit: REDEEM_LIMIT,
      p_window_secs: REDEEM_WINDOW_SEC,
    })
    if (rl.error) {
      console.error('[redeem] rate limit failed (fail-closed):', rl.error)
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }
    // 已知坑：拒绝时 data 可能是 {} 而非 false —— 必须显式判 true
    if (rl.data !== true) {
      sendJson(res, 429, { error: 'rate_limited' }, { ...cors, 'Retry-After': String(REDEEM_WINDOW_SEC) })
      return
    }

    const r = await db.rpc('redeem_code', { p_code: code, p_uid: uid })
    if (r.error) {
      console.error('[redeem] redeem_code failed:', r.error)
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }
    const data = r.data || {}
    if (data.ok !== true) {
      // 业务性失败：码不存在 / 已用过 / 套餐停用
      sendJson(res, 400, { ok: false, reason: data.reason || 'invalid_code' }, cors)
      return
    }
    sendJson(res, 200, data, cors)
  } catch (e) {
    console.error('[redeem] unhandled:', e)
    sendJson(res, 500, { error: 'internal_error' }, cors)
  }
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log('[redeem] listening on :' + PORT)
})
