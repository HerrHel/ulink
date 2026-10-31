/**
 * check-link — 死链检测（evidence API：只回 fetch_outcome + http_status，不回产品 verdict）
 *
 * 从 supabase/functions/check-link/index.ts 迁移而来。**业务逻辑原样搬**：
 * SSRF 三层防御、手动 redirect 链逐跳校验、HEAD→GET 降级、S11 错误信息规范化——
 * 这些是踩过坑换来的，不重写。
 * SSRF 纯逻辑唯一真源是 `supabase/functions/check-link/ssrf-guard.ts`，
 * 本目录的 `ssrf-guard.js` 由 esbuild 从真源生成（见 scripts/build-fn-assets.mjs），
 * 53 个单测覆盖的是真源，改逻辑只改一处。
 *
 * 迁移差异（刻意为之）：
 * 1) **鉴权**：原实现要求 Supabase JWT 并按 `check-link:<user_id>` 做限流；
 *    CloudBase token 的校验需要额外接口，v1 改为**按 IP 哈希限流**，user_id 落 NULL。
 *    本函数会代用户发起出站请求，是「无上限外呼放大器」的风险点，所以限流是
 *    fail-closed 的（consume_rate_limit RPC 失败直接 503，宁可不可用也不放行）。
 *    频次也比原版收紧（默认 120/min/IP vs 原 1200/min/user），等接上 token 校验再放开。
 * 2) **DNS 解析**：Deno.resolveDns → Node dns.promises.resolve4/resolve6，语义保持
 *    「解析失败 / 0 条记录 / 命中私网 全部拒绝」（H6 fail-closed）。
 *
 * 凭据：HTTP 云函数必须显式凭证（CLOUDBASE_APIKEY，等价 service_role）。
 */

const http = require('http')
const dns = require('dns').promises
const crypto = require('crypto')
const {
  SsrfRejectError,
  isPrivateReject,
  isRedirectDenied,
  isOriginAllowed,
  buildCorsHeaders,
  isTargetDnsSafeSyncResults,
  validateUrlShape,
} = require('./ssrf-guard.js')

// 可选鉴权：仅用于「带 token 的登录用户」执行 linkcheck.daily，匿名调用不要求 token
let verifyCbToken = null
try {
  verifyCbToken = require('./cb-auth.js').verifyCbToken
} catch (e) {
  console.warn('[check-link] cb-auth unavailable, daily per-user quota disabled:', e && e.message)
}

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''

/** 允许的来源：优先取环境变量，缺省仅同源；S9 未配置则 fail-closed 拒绝跨域 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
const DEFAULT_TIMEOUT_MS = parseInt(process.env.CHECK_LINK_TIMEOUT_MS || '10000', 10)
/** 每 IP 限流（次/分钟）。原版是每用户 1200/min；v1 无用户身份，收紧到 120/min/IP */
const RATE_LIMIT_PER_MIN = parseInt(process.env.CHECK_LINK_RATE_LIMIT_PER_MIN || '1200', 10)
const MAX_REDIRECTS = 5

/**
 * 登录用户的每日死链检查额度（plans.features['linkcheck.daily']）。
 * 只统计手动检查（body.mode === 'manual'）；自动巡检按 linkcheck.auto.max 另行限制，
 * 避免一次 500 条巡检把 PRO 的 50 次/日额度瞬间打满。
 * 统一走 consume_daily_feature_quota（内部处理 expired/refunded 回落 free、UTC+8 自然日）。
 * 返回 { ok: true } 或 { ok: false, limit }；鉴权/配额 RPC 失败时 fail-open（不误伤用户）。
 */
async function checkDailyQuota(req, db, mode) {
  if (!verifyCbToken || mode === 'auto') return { ok: true }
  try {
    const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID })
    if (!auth || !auth.ok || !auth.uid) return { ok: true }
    const daily = await db.rpc('consume_daily_feature_quota', {
      p_uid: auth.uid,
      p_feature: 'linkcheck.daily',
      p_key_prefix: 'link-check:uid:',
    })
    if (daily.error) {
      console.error('[check-link] daily quota rpc failed (fail-open):', daily.error)
      return { ok: true }
    }
    const d = daily.data || {}
    return d.ok === false && d.limited === true
      ? { ok: false, limit: d.limit }
      : { ok: true }
  } catch (e) {
    console.error('[check-link] daily quota check failed (fail-open):', e)
    return { ok: true }
  }
}

/** IP 哈希盐：独立于 report-error / send-feedback，防跨接口关联 */
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'ulink-check-link'

/** HEAD 常被 CDN/WAF 拒或假报；这些状态应再试 GET */
function shouldRetryAsGet(code) {
  return [400, 401, 403, 404, 405, 501].includes(code)
}

function isAbortError(error) {
  const e = error
  return e?.name === 'AbortError' || !!e?.message?.includes('abort')
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
      } catch {
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

/**
 * DNS 校验：解析 hostname 的 A/AAAA，任一记录落入私有段即拒。
 * 与 Deno 版语义一致：解析失败 / 0 条记录 / 命中私网 → 一律拒绝（fail-closed）。
 */
/**
 * DNS 解析与安全判定：区分「解析到内网（SSRF 攻击）」与「域名无解析记录（NXDOMAIN，死链）」。
 */
async function _dnsCheck(hostname) {
  if (hostname === 'localhost') return { safe: false, reason: 'private_host' }
  try {
    const [records, records6] = await Promise.all([
      dns.resolve4(hostname).catch(() => []),
      dns.resolve6(hostname).catch(() => []),
    ])
    const all = [...records, ...records6]
    if (all.length === 0) {
      // 域名在公网无任何 A/AAAA 记录（NXDOMAIN）：明确属于死链，不是内网 SSRF 攻击
      return { safe: false, reason: 'dns_not_found' }
    }
    const safe = isTargetDnsSafeSyncResults(hostname, all)
    if (!safe) return { safe: false, reason: 'private_dns' }
    return { safe: true, records: all }
  } catch {
    return { safe: false, reason: 'dns_not_found' }
  }
}

/** 完整 URL 校验：形状 + DNS 重绑定。抛特定错误 */
async function _validateUrl(raw) {
  const parsed = validateUrlShape(raw)
  const check = await _dnsCheck(parsed.hostname)
  if (!check.safe) {
    if (check.reason === 'dns_not_found') {
      const err = new Error('域名无 DNS 解析记录')
      err.code = 'DNS_NOT_FOUND'
      throw err
    }
    throw new SsrfRejectError('private_dns', '目标 DNS 解析到内网地址')
  }
  return parsed
}

const BROWSER_UA = 'Mozilla/5.0 (compatible; LinkVaultCheck/1.1; +https://ulink.ren)'

/** 手动逐跳 fetch：redirect:manual，每跳对 Location 重新走完整 _validateUrl */
async function _fetchWithRedirectGuard(url, method, timeoutMs) {
  let current = url
  let currentMethod = method
  let lastResponse = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      lastResponse = await fetch(current.href, {
        method: currentMethod,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })
    } finally {
      clearTimeout(timeout)
    }

    if (lastResponse.status >= 300 && lastResponse.status < 400) {
      const loc = lastResponse.headers.get('Location')
      if (!loc || hop === MAX_REDIRECTS) {
        return { response: lastResponse, finalUrl: current, methodUsed: currentMethod }
      }
      const nextUrl = new URL(loc, current.href)
      let validated
      try {
        validated = await _validateUrl(nextUrl.href)
      } catch {
        throw new SsrfRejectError('redirect_denied', '重定向目标不被允许')
      }
      // 303 必须改 GET；301/302 对 HEAD 多数站点期望 GET
      if ([301, 302, 303].includes(lastResponse.status) || currentMethod === 'HEAD') {
        currentMethod = 'GET'
      }
      current = validated
      continue
    }
    return { response: lastResponse, finalUrl: current, methodUsed: currentMethod }
  }
  return { response: lastResponse, finalUrl: current, methodUsed: currentMethod }
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
    // S9：白名单未命中（或未配置）的预检直接拒
    res.writeHead(isOriginAllowed(origin, ALLOWED_ORIGINS) ? 200 : 403, cors)
    res.end()
    return
  }

  if (!ENV_ID || !API_KEY) {
    sendJson(res, 500, { error: 'not_configured' }, cors)
    return
  }

  try {
    // ── 每 IP 限流（fail-closed：本函数会代用户发起出站请求，放行即外呼放大器）──
    const ipHash = sha256Hex(`${clientIp(req)}|${IP_HASH_SALT}`)
    const db = getDb()
    const rl = await db.rpc('consume_rate_limit', {
      p_key: `check-link:ip:${ipHash}`,
      p_limit: RATE_LIMIT_PER_MIN,
      p_window_secs: 60,
    })
    if (rl.error) {
      console.error('[check-link] rate limit rpc failed (fail-closed):', rl.error)
      sendJson(res, 503, { error: 'Service temporarily unavailable' }, cors)
      return
    }
    if (rl.data !== true) {
      sendJson(res, 429, { error: 'Rate limit exceeded' }, { ...cors, 'Retry-After': '60' })
      return
    }

    const body = await readJsonBody(req)
    const { url, bookmark_id, mode } = body

    // ── 登录用户每日手动检查额度（fail-open；匿名/自动巡检不消耗该额度）──
    const dailyQuota = await checkDailyQuota(req, db, mode)
    if (!dailyQuota.ok) {
      sendJson(res, 429, {
        error: 'linkcheck_daily_exceeded',
        limit: dailyQuota.limit,
        message: '今日死链检查次数已用完（免费版 3 次/日、PRO 50 次/日），请明天再试或升级。',
      }, { ...cors, 'Retry-After': '3600' })
      return
    }

    let parsedUrl
    try {
      parsedUrl = await _validateUrl(url || '')
    } catch (e) {
      if (e.code === 'DNS_NOT_FOUND') {
        const responseTime = Date.now() - startTime
        const details = { response_time: responseTime, error: '域名无 DNS 解析记录' }
        try {
          await db.from('link_check_history').insert({
            user_id: null,
            bookmark_id: bookmark_id || '',
            url: String(url || ''),
            fetch_outcome: 'dns_not_found',
            http_status: 0,
            response_time: responseTime,
            details,
          })
        } catch {}
        sendJson(res, 200, { fetch_outcome: 'dns_not_found', http_status: 0, details }, cors)
        return
      }
      sendJson(res, 400, { error: e.message || 'Invalid URL' }, cors)
      return
    }

    const startTime = Date.now()
    let fetch_outcome = 'connect_error'
    let http_status = 0
    let details = {}

    try {
      let result
      try {
        result = await _fetchWithRedirectGuard(parsedUrl, 'HEAD', DEFAULT_TIMEOUT_MS)
        if (result.methodUsed === 'HEAD' && shouldRetryAsGet(result.response.status)) {
          try {
            result = await _fetchWithRedirectGuard(result.finalUrl, 'GET', DEFAULT_TIMEOUT_MS)
          } catch (getError) {
            // E1：GET 兜底失败不丢 HEAD 已拿到的 evidence；仅安全拒绝上抛
            if (isPrivateReject(getError) || isRedirectDenied(getError)) throw getError
          }
        }
      } catch (headErr) {
        if (isAbortError(headErr) || isPrivateReject(headErr) || isRedirectDenied(headErr)) throw headErr
        result = await _fetchWithRedirectGuard(parsedUrl, 'GET', DEFAULT_TIMEOUT_MS)
      }

      http_status = result.response.status
      fetch_outcome = 'ok'
      details = { response_time: Date.now() - startTime, final_url: result.finalUrl.href }
    } catch (error) {
      const responseTime = Date.now() - startTime
      const isReset = error?.code === 'ECONNRESET' || String(error?.message).includes('ECONNRESET') || String(error?.message).includes('socket hang up')
      if (isAbortError(error)) {
        fetch_outcome = 'timeout'
        details = { response_time: responseTime, error: '请求超时或被中断' }
      } else if (isRedirectDenied(error)) {
        fetch_outcome = 'redirect_denied'
        details = { response_time: responseTime, error: '目标地址被安全策略拒绝' }
      } else if (isPrivateReject(error)) {
        fetch_outcome = 'ssrf_reject'
        details = { response_time: responseTime, error: '目标地址被安全策略拒绝' }
      } else if (isReset) {
        // 连接被对端/防火墙重置阻断（典型的 GFW 阻断标志）
        fetch_outcome = 'gfw_blocked'
        details = { response_time: responseTime, error: '连接被重置或阻断' }
      } else {
        fetch_outcome = 'connect_error'
        // S11：不回传原始 error.message，避免泄露内部主机/路径
        details = { response_time: responseTime, error: '请求失败' }
      }
    }

    // fetch_outcome 为 history 唯一契约列；user_id 暂落 NULL（见文件头）
    const ins = await db.from('link_check_history').insert({
      user_id: null,
      bookmark_id: bookmark_id || '',
      url: parsedUrl.href,
      fetch_outcome,
      http_status,
      response_time: details.response_time,
      details,
    })
    if (ins.error) console.error('[check-link] insert history failed:', ins.error)

    // E2：安全拒绝保持 400（客户端解析不变），其余 200
    const isSecurityReject = fetch_outcome === 'ssrf_reject' || fetch_outcome === 'redirect_denied'
    sendJson(res, isSecurityReject ? 400 : 200, { fetch_outcome, http_status, details }, cors)
  } catch (error) {
    console.error('[check-link] internal error:', error)
    sendJson(res, 500, { error: 'Internal server error' }, cors)
  }
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log(`[check-link] listening on :${PORT}`)
})
