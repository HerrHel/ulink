/**
 * report-error — 客户端运行时错误上报（error_logs 唯一写入通道）
 *
 * 从 supabase/functions/report-error/index.ts 迁移而来。业务逻辑**原样搬**：
 * IP 哈希限流、含密丢弃、字段裁剪这些是踩过坑换来的，不重写。
 * 只换两样东西：运行时（Deno → Node 云函数）与鉴权/写库（Supabase → CloudBase PG）。
 *
 * 原实现的防护（全部保留）：
 * 1) 全局限流键：网关不回填可信 IP、x-real-ip / X-Forwarded-For 可伪造，按 IP 限流可被
 *    任意绕过。改为所有请求共用一个固定全局键 + 更严格全局配额，仍用 DB 计数
 *    （error_logs.ip_hash + 索引，跨实例一致）。
 *    不能用实例内存计数——多实例无粘性路由，内存 Map 的粒度会随实例数放大
 *    （Supabase 侧首版实测 35 连发全过，证实内存限流失效）。
 * 2) H9 含密兜底：message/stack/url/component/user_agent 含 JWT/API key/password 等直接丢弃。
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

// 网关不回填可信 IP、x-real-ip / X-Forwarded-For 可伪造，按 IP 限流可被任意绕过；
// 改为全局固定限流键（所有请求共用一个桶）+ 更严格全局配额，DB 计数方式保持不变。
const GLOBAL_RATE_KEY = 'ulink-report-error-global'
const RATE_GLOBAL = 100          // 全局每分钟上限（低于 028 的 200/min DB 熔断，伪造 IP 无法绕过）
const RATE_WINDOW_MS = 60_000

// 字段上限（与 errorReporter.ts 的 slice 一致 + 表 CHECK 语义）
const LIMIT = { message: 1000, stack: 5000, component: 200, url: 2048, user_agent: 1024 }

/** 允许的来源：环境变量优先；未注入时回落到主站/默认域/本地 dev（不开放 *） */
const DEFAULT_ALLOWED_ORIGINS = [
  'https://ulink.ren',
  'https://ulink.pages.dev',
  'https://ulink-d1g5srvjo54b1886a-1436146693.tcloudbaseapp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
]
const ENV_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const ALLOWED_ORIGINS = ENV_ALLOWED_ORIGINS.length ? ENV_ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS

function isOriginAllowed(origin) {
  return !!origin && ALLOWED_ORIGINS.includes(origin)
}

function corsHeaders(origin) {
  const h = {
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (isOriginAllowed(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...(res._cors || {}),
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

// 不再从请求头取 IP 做限流键：x-real-ip / X-Forwarded-For 可伪造（网关不回填可信 IP），
// 限流改用上面的全局固定键 GLOBAL_RATE_KEY，避免按 IP 限流被任意绕过

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex')
}

// ── H9 含密兜底：镜像自 src/lib/errorReporter.ts 的 _SECRET_RE，请保持同步 ──
// 扩充覆盖 token=/secret=/api[_-]?key=、Google AIza、腾讯云 AKID 与 PEM 私钥头
const SECRET_RE =
  /(?:Bearer\s+[A-Za-z0-9\-._~+/]+=*|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|password\s*[:=]\s*\S+|(?:token|secret|api[_-]?key)\s*[:=]\s*\S+|AIza[0-9A-Za-z_-]{20,}|AKID[0-9A-Za-z]{10,}|-----BEGIN[A-Z ]*PRIVATE KEY)/i
function looksLikeSecret(text) {
  return !!text && SECRET_RE.test(text)
}

/** 服务端再消毒一次 URL：只保留 origin+pathname（去掉 query/hash），拒绝非 http/https */
function sanitizeUrl(raw) {
  if (typeof raw !== 'string' || !raw) return ''
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return (u.origin + u.pathname).slice(0, LIMIT.url)
  } catch {
    return ''
  }
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
  const origin = req.headers.origin || ''
  res._cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    // 白名单外的预检直接拒（不再回 ACAO: *）
    res.writeHead(isOriginAllowed(origin) ? 204 : 403, res._cors)
    res.end()
    return
  }
  // 带 Origin 的浏览器请求必须在白名单内；无 Origin 的服务端直调仍受全局限流约束
  if (origin && !isOriginAllowed(origin)) {
    sendJson(res, 403, { error: 'origin_not_allowed' })
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
  // 服务端再跑一次 URL 消毒（前端已做，但不可信入参必须服务端兜底）
  const url = sanitizeUrl(payload.url)
  const userAgent = trunc(payload.user_agent || req.headers['user-agent'], LIMIT.user_agent)

  if (!message) {
    sendJson(res, 400, { error: 'message_required' })
    return
  }

  // H9：含密丢弃（服务端兜底，与前端双保险）
  // 旧版只查 message/stack；url/component/user_agent 也一律跑 looksLikeSecret
  if (looksLikeSecret(message) || looksLikeSecret(stack) || looksLikeSecret(url) ||
      looksLikeSecret(component) || looksLikeSecret(userAgent)) {
    sendJson(res, 200, { ok: true, dropped: 'secret_like' })
    return
  }

  // 全局固定限流键：不再用可伪造的请求头 IP，所有请求共用同一哈希桶
  const ipHash = sha256Hex(`${GLOBAL_RATE_KEY}|${IP_HASH_SALT}`)
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
    if ((r.count ?? 0) >= RATE_GLOBAL) {
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
