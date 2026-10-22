/**
 * report-error — 客户端运行时错误上报（error_logs 唯一写入通道）
 *
 * 从 supabase/functions/report-error/index.ts 迁移而来。业务逻辑**原样搬**：
 * IP 哈希限流、含密丢弃、字段裁剪这些是踩过坑换来的，不重写。
 * 只换两样东西：运行时（Deno → Node 云函数）与鉴权/写库（Supabase → CloudBase PG）。
 *
 * 原实现的防护（全部保留）：
 * 1) 按 IP 哈希限流：1 分钟 30 条，**DB 计数**（error_logs.ip_hash + 索引，跨实例一致）。
 *    不能用实例内存计数——多实例无粘性路由，内存 Map 的粒度会随实例数放大
 *    （Supabase 侧首版实测 35 连发全过，证实内存限流失效）。
 * 2) H9 含密兜底：message/stack 含 JWT/API key/password 等直接丢弃。
 *    逻辑镜像自 src/lib/errorReporter.ts 的 _SECRET_RE，**保持同步**。
 * 3) 字段裁剪：与 error_logs 表 CHECK 语义和前端 slice 上限对齐。
 * 4) 028 的 DB 层全局熔断（1min/200 触发器）作为最终兜底，对 service 也生效。
 *
 * 迁移后的差异（刻意为之）：
 * - **user_id 一律落 NULL**。原实现靠 `auth.getUser(token)` 解析真实 uid 防伪造；
 *   CloudBase 的 token 校验需要额外的密钥/接口，v1 不引入「不验签就采信」的中间态
 *   （那比不填更糟：给了伪造者可乘之机）。错误日志有 ip_hash 足够定位，
 *   后续接上 CloudBase token 校验后再补归属。
 *
 * 凭据：HTTP 云函数必须显式给凭证（不能走 Event 函数的免密运行时），
 * 通过环境变量 `CLOUDBASE_APIKEY`（服务端 API Key，等价 service_role，绕过 RLS）
 * 注入。**绝不能写进代码或返回给客户端。**
 */

const http = require('http')
const crypto = require('crypto')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
/** IP 哈希盐：独立于 send-feedback 的盐，防跨接口关联 */
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'ulink-report-error'

const RATE_PER_IP = 30
const RATE_WINDOW_MS = 60_000

// 字段上限（与 errorReporter.ts 的 slice 一致 + 表 CHECK 语义）
const LIMIT = { message: 1000, stack: 5000, component: 200, url: 2048, user_agent: 1024 }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      // 防超大 body 打爆内存：1MB 封顶
      if (raw.length > 1_000_000) {
        reject(new Error('body_too_large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(new Error('invalid_json'))
      }
    })
    req.on('error', reject)
  })
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'] || ''
  const first = String(xff).split(',')[0]?.trim()
  return first || req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] || 'unknown'
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex')
}

// ── H9 含密兜底：镜像自 src/lib/errorReporter.ts 的 _SECRET_RE，请保持同步 ──
const SECRET_RE =
  /(?:Bearer\s+[A-Za-z0-9\-._~+/]+=*|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|password\s*[:=]\s*\S+|apikey\s*[:=]\s*\S+)/i
function looksLikeSecret(text) {
  return !!text && SECRET_RE.test(text)
}

const trunc = (s, n) => String(s || '').slice(0, n)

/** 懒加载 CloudBase 客户端；HTTP 云函数必须显式凭证 */
let _db = null
function getDb() {
  if (_db) return _db
  const cloudbase = require('@cloudbase/node-sdk')
  const app = cloudbase.init({ env: ENV_ID, accessKey: API_KEY })
  _db = app.rdb()
  return _db
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  // 缺凭证属部署错误，fail-closed
  if (!ENV_ID || !API_KEY) {
    console.error('[report-error] missing env CLOUDBASE_ENV_ID / CLOUDBASE_APIKEY')
    sendJson(res, 500, { error: 'not_configured' })
    return
  }

  let payload
  try {
    payload = await readJsonBody(req)
  } catch (e) {
    sendJson(res, 400, { error: e.message || 'invalid_json' })
    return
  }

  const message = trunc(payload.message, LIMIT.message).trim()
  const stack = trunc(payload.stack, LIMIT.stack)
  const component = trunc(payload.component, LIMIT.component)
  const url = trunc(payload.url, LIMIT.url)
  const userAgent = trunc(payload.user_agent || req.headers['user-agent'], LIMIT.user_agent)

  if (!message) {
    sendJson(res, 400, { error: 'message_required' })
    return
  }

  // H9：含密丢弃（服务端兜底，与前端双保险）
  if (looksLikeSecret(message) || looksLikeSecret(stack)) {
    sendJson(res, 200, { ok: true, dropped: 'secret_like' })
    return
  }

  const ipHash = sha256Hex(`${clientIp(req)}|${IP_HASH_SALT}`)
  const db = getDb()

  // DB 计数限流（跨实例一致；计数失败 fail-closed 拒收，宁可丢一条也不放行洪水）
  try {
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
    const r = await db
      .from('error_logs')
      .select('*', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', since)
    if (r.error) {
      console.error('[report-error] rate check failed:', r.error)
      sendJson(res, 500, { error: 'rate_check_failed' })
      return
    }
    if ((r.count ?? 0) >= RATE_PER_IP) {
      sendJson(res, 429, { error: 'rate_limited', retry_after_s: RATE_WINDOW_MS / 1000 })
      return
    }
  } catch (e) {
    console.error('[report-error] rate check threw:', e)
    sendJson(res, 500, { error: 'rate_check_failed' })
    return
  }

  // user_id 一律 NULL：见文件头说明（不做「不验签就采信」的中间态）
  const ins = await db.from('error_logs').insert({
    user_id: null,
    message,
    stack: stack || null,
    component: component || null,
    url: url || null,
    user_agent: userAgent || null,
    ip_hash: ipHash,
  })
  if (ins.error) {
    console.error('[report-error] insert failed:', ins.error)
    sendJson(res, 500, { error: 'store_failed' })
    return
  }
  sendJson(res, 200, { ok: true })
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log(`[report-error] listening on :${PORT}`)
})
