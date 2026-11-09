/**
 * ai-api — AI 候选 / 网页元数据提取（CloudBase HTTP 云函数）
 *
 * 背景（2026-11-09）：Cloudflare Pages 部署已迁国内 CloudBase，`ulink.pages.dev`
 * 不再是本站端点，原先托在 CF Functions 的 `/api/ai-candidates`、
 * `/api/extract-metadata` 随之失效。本函数用 Node 适配层直接复用两份既有实现
 * （`functions/api/*.ts` 由 esbuild 派生到本目录），业务逻辑零重写：
 *   - Origin 白名单 / Bearer 鉴权 / 软限流仍由共享的 cf-guard 负责；
 *   - 本层只做 Node http ⇄ Web Request/Response 的转译 + action 分流。
 *
 * 路由：`/ai-api?action=candidates` / `/ai-api?action=extract`
 * 凭据：MIMO_API_KEY 由部署脚本注入；缺失时 handler 自身 503（不部署假 key）。
 */

const http = require('http')

// 派生产物（esbuild 从 functions/api/*.ts 生成，请勿手改）
const candidates = require('./ai-candidates.js')
const extract = require('./extract-metadata.js')

const PORT = 9000
/** 请求体上限：两个端点都是小 JSON（分类/标签最多各 60 条），1MB 足够且防撑爆 */
const MAX_BODY_BYTES = 1024 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body_too_large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function buildHeaders(nodeHeaders) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(nodeHeaders || {})) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(','))
  }
  // 共享的 cf-guard 用 CF-Connecting-IP 做软限流键；CloudBase 网关不回填可信 IP，
  // 这里用 X-Forwarded-For 末段兜底（可伪造，属已知技术债，仅作软闸）。
  if (!headers.has('cf-connecting-ip')) {
    const hops = String(nodeHeaders['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (hops.length) headers.set('cf-connecting-ip', hops[hops.length - 1])
  }
  return headers
}

function toWebRequest(req, bodyBuffer) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'ulink.ren'
  const url = `https://${host}${req.url || '/'}`
  const method = (req.method || 'GET').toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(url, {
    method,
    headers: buildHeaders(req.headers),
    body: hasBody ? bodyBuffer : undefined,
  })
}

async function writeWebResponse(webRes, res) {
  res.statusCode = webRes.status
  webRes.headers.forEach((value, key) => res.setHeader(key, value))
  const buffer = Buffer.from(await webRes.arrayBuffer())
  res.setHeader('content-length', String(buffer.length))
  res.end(buffer)
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(body.length),
  })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'https://ulink.ren')
    const action = (url.searchParams.get('action') || '').toLowerCase()

    // OPTIONS 预检：两个 handler 共用 cfPreflightResponse（Origin 白名单 + 允许的方法/头）
    if ((req.method || '').toUpperCase() === 'OPTIONS') {
      const webReq = toWebRequest(req)
      const preflight = extract.onRequestOptions({ request: webReq })
      await writeWebResponse(preflight, res)
      return
    }

    if (!process.env.MIMO_API_KEY) {
      sendJson(res, 503, { success: false, error: 'mimo_key_not_configured' })
      return
    }

    if (action !== 'candidates' && action !== 'extract') {
      sendJson(res, 400, { success: false, error: 'invalid_action' })
      return
    }

    const bodyBuffer = req.method === 'POST' ? await readBody(req) : undefined
    const webReq = toWebRequest(req, bodyBuffer)
    const context = {
      request: webReq,
      env: { MIMO_API_KEY: process.env.MIMO_API_KEY },
    }

    const webRes =
      action === 'candidates'
        ? await candidates.onRequestPost(context)
        : await extract.onRequest(context)

    if (!webRes) {
      sendJson(res, 500, { success: false, error: 'internal_error' })
      return
    }
    await writeWebResponse(webRes, res)
  } catch (err) {
    const message = String((err && err.message) || err)
    console.error('[ai-api] error:', message)
    if (!res.headersSent) {
      const status = message === 'body_too_large' ? 413 : 500
      sendJson(res, status, {
        success: false,
        error: status === 413 ? 'body_too_large' : 'internal_error',
      })
    }
  }
})

server.listen(PORT, () => {
  console.log('[ai-api] listening on', PORT)
})
