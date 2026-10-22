/**
 * jina-proxy — 通用页面读取（r.jina.ai）服务端转发（CloudBase HTTP 云函数）
 *
 * 从 supabase/functions/jina-proxy/index.ts 迁移而来。业务逻辑**原样搬**：
 * SSRF 双校验（validateInputUrl + isUrlDnsSafe fail-closed）、CORS fail-closed 白名单、
 * 上游超时 + 客户端断连取消、读取长度上限。真源仍是 supabase 侧 TS（ssrf-guard.ts /
 * video-adapters.ts），本目录的 .js 由 build-fn-assets.mjs esbuild 派生。
 *
 * 迁移差异（与 check-link 同口径）：
 * 1) 鉴权：原 Supabase getUser 校验 → v1 改 **IP 哈希限流**（consume_rate_limit，
 *    fail-closed——转发层是外呼放大器，宁可不可用也不无限放行），频次收紧到 60/min/IP。
 * 2) DNS：Deno.resolveDns → dns.promises.resolve4/resolve6（DnsResolver 契约不变）。
 * 3) 断连：req.signal → res 'close' 事件（未正常结束即 abort 上游）。
 */

const http = require('http')
const dns = require('dns').promises
const crypto = require('crypto')
const { validateInputUrl, isUrlDnsSafe } = require('./video-adapters.js')
const { isOriginAllowed, buildCorsHeaders } = require('./ssrf-guard.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
/** 每 IP 限流（次/分钟）。原版每用户 60；v1 无用户身份，按 IP 同口径 */
const RATE_LIMIT_PER_MIN = parseInt(process.env.JINA_PROXY_RATE_LIMIT_PER_MIN || '60', 10)
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.JINA_PROXY_TIMEOUT_MS || '12000', 10)
const READ_MAX_CHARS = 30000
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'ulink-jina-proxy'

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
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 100_000) {
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
  if (!ENV_ID || !API_KEY) {
    sendJson(res, 500, { error: 'not_configured' }, cors)
    return
  }

  // 客户端断连 → 取消上游抓取
  const upstreamAbort = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) upstreamAbort.abort()
  })

  try {
    // 限流 fail-closed：外呼放大器不做 fail-open（与 check-link 同口径）
    const ipHash = sha256Hex(clientIp(req) + '|' + IP_HASH_SALT)
    const db = getDb()
    const rl = await db.rpc('consume_rate_limit', {
      p_key: 'jina-proxy:ip:' + ipHash,
      p_limit: RATE_LIMIT_PER_MIN,
      p_window_secs: 60,
    })
    if (rl.error) {
      console.error('[jina-proxy] rate limit rpc failed (fail-closed):', rl.error)
      sendJson(res, 503, { error: 'Service temporarily unavailable' }, cors)
      return
    }
    if (rl.data !== true) {
      sendJson(res, 429, { error: 'Rate limit exceeded' }, { ...cors, 'Retry-After': '60' })
      return
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
