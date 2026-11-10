/**
 * jina-proxy — 通用页面读取（r.jina.ai）服务端转发（CloudBase HTTP 云函数）
 *
 * 从 supabase/functions/jina-proxy/index.ts 迁移而来。业务逻辑**原样搬**：
 * SSRF 双校验（validateInputUrl + isUrlDnsSafe fail-closed）、CORS fail-closed 白名单、
 * 上游超时 + 客户端断连取消、读取长度上限。真源仍是 supabase 侧 TS（ssrf-guard.ts /
 * video-adapters.ts），本目录的 .js 由 build-fn-assets.mjs esbuild 派生。
 *
 * 迁移差异（与 extract-video / share-admin 同口径）：
 * 1) 鉴权：必须带 `Authorization: Bearer <CloudBase access_token>`，cb-auth 离线验签得 uid。
 *    转发层会代用户外呼第三方，匿名开放等于免费「任意网页转 Markdown」代理。
 * 2) 限流：按 uid 60/min + 与身份无关的全局 600/min（防批量注册账号绕过）。
 * 3) DNS：Deno.resolveDns → dns.promises.resolve4/resolve6（DnsResolver 契约不变）。
 * 4) 断连：req.signal → res 'close' 事件（未正常结束即 abort 上游）。
 */

const http = require('http')
const dns = require('dns').promises
const { validateInputUrl, isUrlDnsSafe } = require('./video-adapters.js')
const { isOriginAllowed, buildCorsHeaders } = require('./ssrf-guard.js')
const { verifyCbToken } = require('./cb-auth.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
/** 每用户限流（次/分钟） */
const rlVal = parseInt(process.env.JINA_PROXY_RATE_LIMIT_PER_MIN || '60', 10)
const RATE_LIMIT_PER_MIN = Number.isFinite(rlVal) && rlVal > 0 ? rlVal : 60
/** 与用户身份无关的全局兜底（次/分钟）：防批量注册账号把转发层当免费代理 */
const glVal = parseInt(process.env.JINA_PROXY_RATE_LIMIT_GLOBAL_PER_MIN || '600', 10)
const GLOBAL_RATE_LIMIT_PER_MIN = Number.isFinite(glVal) && glVal > 0 ? glVal : 600
const toVal = parseInt(process.env.JINA_PROXY_TIMEOUT_MS || '12000', 10)
const UPSTREAM_TIMEOUT_MS = Number.isFinite(toVal) && toVal > 0 ? toVal : 12000
const READ_MAX_CHARS = 30000

/** DnsResolver 契约：resolve(hostname, 'A'|'AAAA') -> Promise<string[]> */
const nodeDnsResolver = {
  resolve: (hostname, type) => (type === 'A' ? dns.resolve4(hostname) : dns.resolve6(hostname)),
}

function sendJson(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  })
  res.end(payload)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c)
      chunks.push(buf)
      size += buf.length
      if (size > 100_000) {
        reject(new Error('body_too_large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      const raw = Buffer.concat(chunks).toString('utf8')
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

let _db = null
function getDb() {
  if (_db) return _db
  const cloudbase = require('@cloudbase/node-sdk')
  const app = cloudbase.init({ env: ENV_ID, accessKey: API_KEY })
  _db = app.rdb()
  return _db
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers['origin'] || null
  const cors = buildCorsHeaders(origin, ALLOWED_ORIGINS)

  if (req.method === 'OPTIONS') {
    res.writeHead(isOriginAllowed(origin, ALLOWED_ORIGINS) ? 200 : 403, cors)
    res.end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' }, { ...cors, Allow: 'POST, OPTIONS' })
    return
  }
  if (!ENV_ID || !API_KEY) {
    sendJson(res, 500, { error: 'not_configured' }, cors)
    return
  }
  // 带 Origin 的浏览器请求必须在白名单内（未配置白名单 = fail-closed）。
  // 无 Origin 的服务端调用仍要求下方 Bearer 鉴权，不构成匿名入口。
  if (origin && !isOriginAllowed(origin, ALLOWED_ORIGINS)) {
    sendJson(res, 403, { error: 'Origin not allowed' }, cors)
    return
  }

  // 鉴权：fail-closed。转发层会代用户外呼第三方，匿名放开即免费开放代理。
  let uid = ''
  try {
    const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID })
    if (!auth.ok) {
      sendJson(res, 401, { error: 'unauthorized' }, cors)
      return
    }
    uid = auth.uid
  } catch (e) {
    console.error('[jina-proxy] auth failed (fail-closed):', e)
    sendJson(res, 503, { error: 'Service temporarily unavailable' }, cors)
    return
  }

  // 客户端断连 → 取消上游抓取
  const upstreamAbort = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) upstreamAbort.abort()
  })

  try {
    // 限流 fail-closed（与 extract-video 同口径）：
    //  1) 按 uid 60/min —— 单用户配额；
    //  2) 全局 600/min —— 与身份无关，防批量注册账号绕过。
    const db = getDb()
    const buckets = [
      { key: 'jina-proxy:uid:' + uid, limit: RATE_LIMIT_PER_MIN },
      { key: 'jina-proxy:global', limit: GLOBAL_RATE_LIMIT_PER_MIN },
    ]
    for (const b of buckets) {
      const rl = await db.rpc('consume_rate_limit', {
        p_key: b.key,
        p_limit: b.limit,
        p_window_secs: 60,
      })
      if (rl.error) {
        console.error('[jina-proxy] rate limit rpc failed (fail-closed):', rl.error)
        sendJson(res, 503, { error: 'Service temporarily unavailable' }, cors)
        return
      }
      // 已知坑：拒绝时 data 可能是 {} 而非 false
      if (rl.data !== true) {
        sendJson(res, 429, { error: 'Rate limit exceeded' }, { ...cors, 'Retry-After': '60' })
        return
      }
    }

    let body
    try {
      body = await readJsonBody(req)
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid JSON body' }, cors)
      return
    }
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''

    let parsed
    try {
      parsed = validateInputUrl(rawUrl)
    } catch (e) {
      sendJson(res, 400, { error: (e && e.message) || 'Invalid URL' }, cors)
      return
    }
    if (!(await isUrlDnsSafe(parsed, nodeDnsResolver))) {
      sendJson(res, 400, { error: '不允许访问内网地址' }, cors)
      return
    }

    try {
      const up = await fetch('https://r.jina.ai/' + parsed.href, {
        headers: { Accept: 'text/markdown, text/plain, */*', 'X-No-Cache': 'true' },
        signal: AbortSignal.any([upstreamAbort.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      })
      if (up.ok) {
        const text = await up.text()
        if (text && text.trim()) {
          sendJson(res, 200, { url: parsed.href, text: text.slice(0, READ_MAX_CHARS) }, cors)
          return
        }
      }
      sendJson(res, 502, { error: '页面读取失败 (HTTP ' + up.status + ')' }, cors)
    } catch (e) {
      sendJson(res, 502, { error: '页面读取超时或网络异常' }, cors)
    }
  } catch (error) {
    console.error('[jina-proxy] internal error:', error)
    sendJson(res, 500, { error: 'Internal server error' }, cors)
  }
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log('[jina-proxy] listening on :' + PORT)
})
