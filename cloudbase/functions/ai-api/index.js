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
const crypto = require('crypto')
const { verifyCbToken } = require('./cb-auth.js')

// 2026-11-14 审计 #8：ai-api 直耗 MIMO_API_KEY，原先没有任何全局配额，
// 且 cf-guard 的限流键取的是客户端可伪造的 CF-Connecting-IP（换头即绕过）。
// 这里加一层 DB 计数的全局硬闸，fail-closed（与 check-link 同口径）。
const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
let _db = null
function getDb() {
  if (_db) return _db
  const cloudbase = require('@cloudbase/node-sdk')
  _db = cloudbase.init({ env: ENV_ID || cloudbase.SYMBOL_CURRENT_ENV, accessKey: API_KEY }).rdb()
  return _db
}

/** 每 token（匿名共享桶）60s 窗口内的调用上限；DB 计数跨 isolate / 跨节点共享 */
const AIAPI_LIMIT_AUTHED = 30
const AIAPI_LIMIT_ANON = 10
// 真正的全局固定桶：checkGlobalQuota 跑在 requireAuth 之前，bucket 由**未验签**的
// Bearer 字符串派生，随机 token 会无限新建计数行。固定桶先把总量卡死，避免
// 「配额按 token 名存实亡 + rate_limit_counters 被无限灌入」。
const AIAPI_LIMIT_GLOBAL = parseInt(process.env.AIAPI_GLOBAL_PER_MIN || '600', 10)

async function checkGlobalQuota(req, action) {
  const auth = String(req.headers.authorization || '')
  const token = /^Bearer\s+(\S+)/i.exec(auth)?.[1] || ''
  const bucket = token
    ? crypto.createHash('sha256').update(token).digest('hex').slice(0, 20)
    : 'anon'
  try {
    if (AIAPI_LIMIT_GLOBAL > 0) {
      const g = await getDb().rpc('consume_rate_limit', {
        p_key: `ai-api:global:${action}`,
        p_limit: AIAPI_LIMIT_GLOBAL,
        p_window_secs: 60,
      })
      if (g.error) return { ok: false, status: 503, error: 'quota_unavailable' }
      if (g.data !== true) return { ok: false, status: 429, error: 'rate_limited' }
    }
    const r = await getDb().rpc('consume_rate_limit', {
      p_key: `ai-api:${action}:${bucket}`,
      p_limit: token ? AIAPI_LIMIT_AUTHED : AIAPI_LIMIT_ANON,
      p_window_secs: 60,
    })
    if (r.error) return { ok: false, status: 503, error: 'quota_unavailable' }
    // consume_rate_limit 拒绝时返回 {} 而非 false，判定必须是 data !== true
    if (r.data !== true) return { ok: false, status: 429, error: 'rate_limited' }
    return { ok: true }
  } catch (err) {
    console.error('[ai-api] global quota rpc failed (fail-closed):', String(err))
    return { ok: false, status: 503, error: 'quota_unavailable' }
  }
}

// AI 访问权判断与退还：见 ./ai-access.js（独立成模块以便单测）
const { checkAiAccess, refundAiAccess } = require('./ai-access.js')

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
  // 客户端可伪造的 IP 头一律剥离：CloudBase 网关不回填可信 IP，原先 buildHeaders
  // 原样复制 cf-connecting-ip / x-forwarded-for，使 cf-guard 的软限流键能被逐请求
  // 换掉而完全绕过。剥掉后键退化为「白名单 Origin + path」（非白名单 Origin 会被
  // guard 直接 403），配合上面的 DB 全局硬闸使用。
  const SPOOFABLE_IP_HEADERS = new Set([
    'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip',
    'x-client-ip', 'true-client-ip', 'forwarded',
  ])
  for (const [key, value] of Object.entries(nodeHeaders || {})) {
    if (SPOOFABLE_IP_HEADERS.has(key.toLowerCase())) continue
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(','))
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

    // 全局硬闸：先于转发到 MIMO，避免匿名/伪造 IP 无限消耗上游额度
    const quota = await checkGlobalQuota(req, action)
    if (!quota.ok) {
      sendJson(res, quota.status, { success: false, error: quota.error })
      return
    }

    // 验签取 uid（handler 内的 cf-guard 也会再验一次 token 是否有效）
    const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID }).catch(() => null)
    const uid = auth && auth.ok ? auth.uid : null
    const db = getDb()
    const access = await checkAiAccess(db, uid)

    // candidates 是纯 AI 能力：无访问权直接拒绝（402 = 需付费 / 试用用完；401 = 需登录）
    if (action === 'candidates' && !access.allowed) {
      const status = access.reason === 'login_required' ? 401
        : access.reason === 'quota_unavailable' ? 503
          : access.reason === 'daily_exhausted' ? 429 : 402
      sendJson(res, status, { success: false, error: access.reason })
      return
    }

    const bodyBuffer = req.method === 'POST' ? await readBody(req) : undefined
    const webReq = toWebRequest(req, bodyBuffer)
    const context = {
      request: webReq,
      env: { MIMO_API_KEY: process.env.MIMO_API_KEY, AI_ALLOWED: access.allowed },
    }

    const webRes =
      action === 'candidates'
        ? await candidates.onRequestPost(context)
        : await extract.onRequest(context)

    if (!webRes) {
      if (access.consumed) await refundAiAccess(db, uid, access.consumed)
      sendJson(res, 500, { success: false, error: 'internal_error' })
      return
    }

    if (action === 'extract') {
      // 读出 handler 的 JSON：按 ai 字段判断是否真正用到了 AI，并把访问权状态告诉前端
      const text = await webRes.text()
      let data = null
      try { data = JSON.parse(text) } catch { /* 非 JSON 原样透传 */ }
      if (access.consumed && (!data || data.ai !== 'used')) await refundAiAccess(db, uid, access.consumed)
      if (data && typeof data === 'object') {
        data.aiGate = access.allowed ? null : access.reason
        const headers = {}
        webRes.headers.forEach((v, k) => { if (k.toLowerCase() !== 'content-length') headers[k] = v })
        res.writeHead(webRes.status, headers)
        res.end(JSON.stringify(data))
        return
      }
      await writeWebResponse(new Response(text, { status: webRes.status, headers: webRes.headers }), res)
      return
    }

    if (access.consumed && webRes.status >= 400) await refundAiAccess(db, uid, access.consumed)
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
