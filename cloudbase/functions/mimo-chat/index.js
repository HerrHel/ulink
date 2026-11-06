/**
 * mimo-chat — 小米 MiMo 大模型的服务端安全转发（CloudBase HTTP 云函数，密钥永不出后端）
 *
 * 从 supabase/functions/mimo-chat/index.ts 迁移而来。业务逻辑**原样搬**：
 * SSE 流式透传、请求体校验/token 预算/model 白名单（mimo-guard.ts 真源派生）、
 * CORS fail-closed、上游超时 + 客户端断连取消（断连后不空耗配额）、
 * 上游错误体不透传（S11，可能含 key 片段）。
 *
 * 迁移差异（与 jina-proxy/check-link 同口径）：
 * 1) 鉴权：Supabase getUser → IP 哈希限流（consume_rate_limit fail-closed），
 *    频次收紧到 30/min/IP（原 30/min/user）。转发计费通道宁可暂时不可用也不无限放行。
 * 2) SSE 透传：Deno Response(body) → Node Readable.fromWeb(upstream.body).pipe(res)。
 * 3) 断连：req.signal → res 'close' 事件。
 *
 * 计费改造（2026-11-07）：
 * - 两段式：enforce 下用 reserve_quota 预扣 ai.tokens（取代原 ai_quota_check），
 *   请求所有出口经 finalize() 幂等调 settle_quota 按实际用量冲正，堵住「发起即断连」白嫖。
 * - 结构化单行 JSON 日志 + X-Ulink-Trace-Id 全链路透传；匿名请求叠加 IP 无关的全局限流。
 * - SSE 流式透传与错误帧行为（handleStreamError/classifyStreamError）保持不变。
 */

const http = require('http')
const crypto = require('crypto')
const { Readable, Transform } = require('stream')
const { validateChatBody, isOriginAllowed, buildCorsHeaders } = require('./mimo-guard.js')
const { verifyCbToken } = require('./cb-auth.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const MIMO_API_KEY = process.env.MIMO_API_KEY || ''
const MIMO_BASE_URL = (process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1').replace(/\/+$/, '')
const MIMO_MODEL = process.env.MIMO_MODEL || 'mimo-v2.6-flash'
const ALLOWED_MODELS = (process.env.MIMO_ALLOWED_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
const RATE_LIMIT_PER_MIN = parseInt(process.env.MIMO_CHAT_RATE_LIMIT_PER_MIN || '30', 10)
/** 匿名全局限流：与 IP 无关，兜底 XFF 可伪造（AGENTS.md 2026-10-30 实测），默认 120/min */
const ANON_GLOBAL_LIMIT_PER_MIN = parseInt(process.env.MIMO_CHAT_ANON_GLOBAL_PER_MIN || '120', 10)
/**
 * 上游超时（ms）。AbortSignal 会覆盖整个流式 body：一旦超时，正在输出的回答会被掐断。
 * 默认 115s 留 5s 余量给函数 120s 上限（scripts/deploy-cloudbase-fn.mjs 的 FN_PROFILE），
 * 保证能在被 SCF 杀掉前补发 SSE 错误帧、把「中断」如实告知客户端。
 */
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.MIMO_CHAT_TIMEOUT_MS || '115000', 10)
/**
 * 音频物化：前端只传存储 URL，函数侧下载转 base64。
 * 起因（2026-11-03 实测）：CloudBase HTTP 访问服务入站 body 上限约 512KB~1MB
 * （511KB 通过、1023KB 返回 430/406），而 MiMo 的 input_audio 只认 base64
 * （远程 URL 报「`data` is not set」），且 MiMo 侧能处理 8.53MB / 11.9M 字符。
 * 若由前端传 base64，3.5MB 以上的音频会被网关直接拒收 → 该上限形同虚设。
 */
const MAX_AUDIO_FETCH_BYTES = parseInt(process.env.MIMO_CHAT_MAX_AUDIO_BYTES || '10485760', 10)
const AUDIO_FETCH_TIMEOUT_MS = parseInt(process.env.MIMO_CHAT_AUDIO_FETCH_TIMEOUT_MS || '25000', 10)
/** 允许代拉的存储域名（防 SSRF：客户端给的 URL 不得指向任意/内网主机） */
const AUDIO_URL_HOSTS = ['tcloudbasegateway.com', 'tcb.qcloud.la', 'myqcloud.com', 'tencentcloudbase.com']
/**
 * IP 哈希盐：未注入时启用进程级随机盐（每次冷启动变化、多实例不一致 → IP 限流随之重置），
 * 不再使用仓库公开常量。生产应注入环境变量；IP 限流仅作辅助，匿名另有全局兜底。
 */
const IP_HASH_SALT = process.env.IP_HASH_SALT || (() => {
  const generated = crypto.randomBytes(16).toString('hex')
  console.warn('[mimo-chat] IP_HASH_SALT 未配置：已启用进程级随机盐，请在云函数环境变量注入 IP_HASH_SALT')
  return generated
})()
/**
 * 计费模式：
 *   shadow  —— 只记录用量、不做任何额度判断（默认，绝不影响用户体验）
 *   enforce —— 两段式：reserve_quota 预扣 ai.tokens + settle_quota 按实际用量冲正结算
 */
const BILLING_MODE = (process.env.BILLING_MODE || 'shadow').toLowerCase()

/** 按 Asia/Shanghai 分桶（UTC+8 偏移后取 YYYY-MM），跨时区用户口径一致 */
function shanghaiPeriod(now) {
  return new Date((now || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 7)
}

/** 影子计量：只写账本，任何失败都只 console.warn，不影响主流程 */
async function recordUsage(db, uid, metric, amount, ref, period) {
  try {
    await db.rpc('record_usage', {
      p_uid: uid,
      p_metric: metric,
      p_amount: amount,
      p_ref: ref,
      p_period: period,
    })
  } catch (e) {
    console.warn('[mimo-chat] record_usage failed:', (e && e.message) || e)
  }
}

/**
 * 两段式结算：只追加冲正行（SQL 按 ref 幂等，且无 reserve 行时直接 no-op）。
 * 返回是否成功；RPC 失败由调用方以 logEvent('warn') 输出（底层即 console.warn），不影响响应。
 */
async function settleQuota(db, ref, actual, period) {
  try {
    const r = await db.rpc('settle_quota', { p_ref: ref, p_actual: actual, p_period: period })
    return !r.error
  } catch (e) {
    return false
  }
}

/**
 * 计费口径的递归字符近似：统计整个上游 payload（含 tools schema、媒体块内联 base64/URL）。
 * 与 mimo-guard.textLength 不同——后者对媒体块返回 0 用于「校验预算」；
 * 这里 base64 字符必须计入，否则会低估实际发给上游的载荷（虚低 token 预扣）。
 */
function approximateTextLength(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) return value.reduce((n, v) => n + approximateTextLength(v), 0)
  if (typeof value === 'object') return Object.values(value).reduce((n, v) => n + approximateTextLength(v), 0)
  return String(value).length
}

/**
 * 计费口径的字符数：只累加文本，跳过媒体块。
 *
 * ⚠️ 不能用 approximateTextLength(guard.value) 直接折算 token：音频经
 * materializeAudioUrls 内联成 base64 后可达 11.9M 字符，按「字符/2」会得出
 * ≈5.95M token，free 档 5 万 / PRO 20 万的额度瞬间被打穿，多模态请求
 * 在 enforce 下必然被拒（或一次结算耗尽整月额度）。
 * 上游按 token 计费的是文本内容与媒体自身的 token，不是 base64 字符数。
 */
function approximateBillableTextLength(payload) {
  let total = 0
  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  for (const m of messages) {
    const content = m?.content
    if (typeof content === 'string') {
      total += content.length
    } else if (Array.isArray(content)) {
      for (const part of content) {
        // input_audio / image_url / video_url 一律跳过
        if (part?.type === 'text') total += String(part.text || '').length
      }
    }
    if (Array.isArray(m?.tool_calls)) total += JSON.stringify(m.tool_calls).length
  }
  // tools schema 每轮必发，按一次固定开销计入（发送摘要里也是同一口径）
  if (Array.isArray(payload?.tools)) total += JSON.stringify(payload.tools).length
  return total
}

/** 清洗外部传入的 trace_id：只留 [A-Za-z0-9_.-]、限长，防日志注入；空则回退 randomUUID */
function sanitizeTraceId(raw) {
  const s = Array.isArray(raw) ? raw[0] : String(raw || '')
  return s.replace(/[^\w.-]/g, '').slice(0, 128)
}

/** 本次请求唯一 ref（提前到 reserve 之前生成，所有出口共用） */
function makeRef() {
  return 'chat-' + Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex')
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
      if (raw.length > 2_000_000) {
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

function isAllowedAudioUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  return AUDIO_URL_HOSTS.some((h) => host === h || host.endsWith('.' + h))
}

function audioFormatFromMime(mime) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('wav')) return 'wav'
  if (m.includes('flac')) return 'flac'
  if (m.includes('ogg') || m.includes('opus')) return 'ogg'
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a'
  return 'mp3'
}

async function fetchAsDataUrl(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(AUDIO_FETCH_TIMEOUT_MS) })
  if (!resp.ok) throw new Error('media fetch failed (' + resp.status + ')')
  const declared = Number(resp.headers.get('content-length') || 0)
  if (declared > MAX_AUDIO_FETCH_BYTES) throw new Error('audio too large')
  const buf = Buffer.from(await resp.arrayBuffer())
  if (buf.length > MAX_AUDIO_FETCH_BYTES) throw new Error('audio too large')
  const mime = (resp.headers.get('content-type') || 'audio/mpeg').split(';')[0].trim()
  return { data: 'data:' + mime + ';base64,' + buf.toString('base64'), mime }
}

/**
 * 把 messages 里 input_audio.url 物化为 base64 data。
 * 只处理 URL 形式；已内联的 data 原样保留（兼容旧客户端）。
 */
async function materializeAudioUrls(messages) {
  const targets = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node.type === 'input_audio' && node.input_audio && typeof node.input_audio === 'object') {
      const a = node.input_audio
      if (typeof a.url === 'string' && a.url && !a.data) targets.push(a)
    }
    for (const v of Object.values(node)) walk(v)
  }
  walk(messages)
  if (targets.length === 0) return 0
  await Promise.all(
    targets.map(async (a) => {
      if (!isAllowedAudioUrl(a.url)) throw new Error('audio url not allowed')
      const { data, mime } = await fetchAsDataUrl(a.url)
      a.data = data
      if (!a.format) a.format = audioFormatFromMime(mime)
      delete a.url
    }),
  )
  return targets.length
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now()
  const origin = req.headers['origin'] || null
  const traceId = sanitizeTraceId(req.headers['x-ulink-trace-id']) || crypto.randomUUID()
  // 全链路 trace：所有响应（含 OPTIONS/错误/流式）都回带，便于客户端与日志按 trace_id 对齐
  const cors = { ...buildCorsHeaders(origin, ALLOWED_ORIGINS), 'X-Ulink-Trace-Id': traceId }

  // 本次请求的计费上下文：ref/period 提前到 reserve 之前生成，所有出口共用
  const ref = makeRef()
  // ⚠️ 影子计量必须用独立 ref：record_usage 插入的行同样是 kind='reserve'，
  // 若与两段式预扣共用 ref，settle_quota 的「按 ref 取最新 reserve 行」会命中
  // ai.requests / ai.chars 的影子行而非 ai.tokens 预扣行，导致冲正到错误账目。
  const usageRef = ref + ':usage'
  const period = shanghaiPeriod()
  let uid = null
  let db = null
  let settled = false
  let inChars = 0
  let outBytes = 0

  /** 结构化单行 JSON 日志：恒定带 trace_id/uid/event/elapsedMs/status/tokens/errorKind */
  function logEvent(level, event, fields) {
    try {
      const f = fields || {}
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        service: 'mimo-chat',
        trace_id: traceId,
        uid,
        event,
        ref,
        elapsedMs: Date.now() - startedAt,
        status: f.status ?? res.statusCode ?? null,
        tokens: f.tokens ?? null,
        errorKind: f.errorKind ?? null,
        ...f,
      })
      const emit = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      emit(line)
    } catch (_) {
      // 日志失败绝不影响响应
    }
  }

  /**
   * 幂等收口：请求从**任何**出口结束都只执行一次（settled 去重）。
   * finish 与 close 在流式响应里都会触发，二者可能都来，靠 settled 保证只结算一次。
   * 影子计量（失败/拒绝/断连也记 ai.requests）+ settle_quota 结算都在此收口；
   * 任何 RPC 失败都只经 logEvent('warn') 输出（底层 console.warn），不影响已发/将发的响应。
   */
  function finalize(event, extra) {
    if (settled) return
    settled = true
    const e = extra || {}
    const actualTokens = Math.ceil((inChars + outBytes) / 2)
    // 计量补齐：所有出口都记 ai.requests / ai.chars（不再只在 finish && uid 时记）
    if (uid && db) {
      // 独立 ref：与两段式预扣的 kind='reserve' 行隔离开，避免 settle_quota 取错行
      void recordUsage(db, uid, 'ai.requests', 1, usageRef, period)
      void recordUsage(db, uid, 'ai.chars', inChars + outBytes, usageRef, period)
    }
    // 两段式结算：对 enforce 且已验签的请求无条件调 settle_quota（不再判断 reserve 是否成功）。
    // SQL 按 ref 幂等（同 ref 只结算一次），且无 reserve 行时直接 no-op，
    // 故 guard/限流/reserve 拒绝等「预扣前」出口也可安全调用；匿名/未验签出口无预扣，不触发。
    if (BILLING_MODE === 'enforce' && uid && db) {
      void settleQuota(db, ref, actualTokens, period).then((ok) => {
        logEvent(ok ? 'info' : 'warn', 'settle_quota', {
          status: res.statusCode,
          tokens: actualTokens,
          errorKind: ok ? null : 'settle_failed',
        })
      })
    }
    logEvent('info', event || 'finish', {
      status: e.status ?? res.statusCode ?? null,
      tokens: actualTokens,
      errorKind: e.errorKind ?? null,
      ...e,
    })
  }

  // 上游取消链路：客户端断连即 abort 上游，不再空耗配额
  const upstreamAbort = new AbortController()
  res.on('finish', () => finalize('finish'))
  res.on('close', () => {
    // 不因 writableEnded 直接 return：res.end() 后若 socket 在 finish 事件前被销毁，
    // close 先到而 finish 可能不再触发，会导致本次请求完全不结算。
    // 统一调 finalize()，由 settled 布尔保证只结算一次。
    if (!res.writableEnded && res.headersSent) {
      logEvent('warn', 'client_disconnect', { errorKind: 'client_disconnect', status: res.statusCode })
      upstreamAbort.abort()
    }
    finalize('close', {
      errorKind: res.writableEnded ? null : 'client_disconnect',
      status: res.statusCode,
    })
  })
  // 客户端连接自身出错同样不得变成未捕获异常
  res.on('error', (e) => {
    logEvent('error', 'response_stream_error', { errorKind: 'response_error', error: String((e && e.message) || e) })
    upstreamAbort.abort()
    finalize('response_error', { errorKind: 'response_error', status: res.statusCode })
  })

  if (req.method === 'OPTIONS') {
    res.writeHead(isOriginAllowed(origin, ALLOWED_ORIGINS) ? 200 : 403, cors)
    res.end()
    return
  }
  // POST：带 Origin 但不在白名单 → 403（无 Origin 的非浏览器直调不拦截，避免误伤）。
  // ⚠️ 防呆：ALLOWED_ORIGINS 未注入时为空数组，isOriginAllowed 恒 false；
  // 若此时仍做 POST 校验，会把所有浏览器请求一律 403（死链检测曾踩过这个坑）。
  // 空配置时跳过 POST 校验、只保留 OPTIONS 行为，并在启动日志里告警。
  if (req.method === 'POST' && origin && ALLOWED_ORIGINS.length > 0 && !isOriginAllowed(origin, ALLOWED_ORIGINS)) {
    logEvent('warn', 'origin_rejected', { status: 403, errorKind: 'origin_not_allowed' })
    sendJson(res, 403, { error: 'Origin not allowed' }, cors)
    return
  }
  if (!ENV_ID || !API_KEY) {
    sendJson(res, 500, { error: 'not_configured' }, cors)
    return
  }

  /**
   * 流式响应错误收口（唯一出口）。
   * pipe 上的 'error' 若无人监听会变成未捕获异常，直接把进程打挂 / 销毁 socket，
   * 浏览器只能读到被掐断的响应体（Chromium 报 TypeError: network error，用户侧就是
   * 「检索失败 (network error)」）。已发响应头时补一帧可识别的 SSE 错误帧再正常结束，
   * 前端据此提示「生成中断」并保留已生成内容。
   */
  let streamErrorSent = false
  /** 错误归因：区分「客户端主动取消」「上游超时」「上游流异常」，便于日志直读定位 */
  function classifyStreamError(err) {
    if (upstreamAbort.signal.aborted) return 'aborted_by_client'
    const name = err && err.name
    const message = String((err && err.message) || err || '')
    if (name === 'TimeoutError' || /timed? ?out|timeout/i.test(message)) return 'upstream_timeout'
    return 'upstream_stream_error'
  }
  function handleStreamError(err, alreadyLogged) {
    if (streamErrorSent) return
    streamErrorSent = true
    const kind = classifyStreamError(err)
    if (!alreadyLogged) {
      if (kind === 'aborted_by_client') {
        logEvent('warn', 'stream_aborted', { status: res.statusCode, errorKind: 'aborted_by_client' })
      } else if (kind === 'upstream_timeout') {
        logEvent('error', 'upstream_timeout', { status: 504, errorKind: 'upstream_timeout' })
      } else {
        logEvent('error', 'upstream_stream_error', { status: 502, errorKind: 'upstream_stream_error', error: String((err && err.message) || err) })
      }
    }
    // 流中断也是结算出口：幂等 finalize（不改变下面的错误帧写入逻辑）
    finalize('stream_error', { status: kind === 'upstream_timeout' ? 504 : 502, errorKind: kind })
    // 客户端已断开（cancel/导航离开）时无需也不应回写，更不能写已销毁的 socket
    if (res.destroyed || res.writableEnded) return
    try {
      if (!res.headersSent) {
        sendJson(res, kind === 'upstream_timeout' ? 504 : 502, { error: 'AI 服务流式响应中断，请稍后重试' }, cors)
        return
      }
      res.write('data: ' + JSON.stringify({ error: 'stream_interrupted' }) + '\n\n')
      res.end()
    } catch (e) {
      logEvent('error', 'error_frame_write_failed', { errorKind: 'write_failed', error: String((e && e.message) || e) })
      res.destroy()
    }
  }

  try {
    if (!MIMO_API_KEY) {
      sendJson(res, 503, { error: 'AI 服务未配置（服务端缺少 MIMO_API_KEY）' }, cors)
      return
    }

    // 用户身份：能验签就按 uid 计量；验不到（未登录 / 老客户端）回退 IP 限流，不阻断使用
    const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID }).catch(() => null)
    uid = auth && auth.ok ? auth.uid : null
    db = getDb()

    // 限流 fail-closed：转发计费通道宁可暂时不可用，也不无限放行
    const ipHash = sha256Hex(clientIp(req) + '|' + IP_HASH_SALT)
    const rl = await db.rpc('consume_rate_limit', {
      // 已登录按用户限流（跨设备统一口径，也是未来计费的主体键）
      p_key: uid ? 'mimo-chat:uid:' + uid : 'mimo-chat:ip:' + ipHash,
      p_limit: RATE_LIMIT_PER_MIN,
      p_window_secs: 60,
    })
    if (rl.error) {
      logEvent('error', 'rate_limit_rpc_failed', { status: 503, errorKind: 'rate_limit_rpc_failed' })
      sendJson(res, 503, { error: 'AI 服务暂时不可用，请稍后再试' }, cors)
      return
    }
    if (rl.data !== true) {
      logEvent('warn', 'rate_limit_rejected', { status: 429, errorKind: 'rate_limited' })
      sendJson(res, 429, { error: 'Rate limit exceeded' }, { ...cors, 'Retry-After': '60' })
      return
    }

    // 匿名全局限流（与 IP 无关）：CloudBase 网关不回填可信 IP、XFF 可伪造，
    // 单靠上面的 IP 限流可被绕过，故对 uid=null 叠加一道全局兜底（默认 120/min）。
    if (!uid) {
      const ag = await db.rpc('consume_rate_limit', {
        p_key: 'mimo-chat:anon-global',
        p_limit: ANON_GLOBAL_LIMIT_PER_MIN,
        p_window_secs: 60,
      })
      if (ag.error) {
        logEvent('error', 'anon_rate_limit_rpc_failed', { status: 503, errorKind: 'rate_limit_rpc_failed' })
        sendJson(res, 503, { error: 'AI 服务暂时不可用，请稍后再试' }, cors)
        return
      }
      if (ag.data !== true) {
        logEvent('warn', 'anon_rate_limit_rejected', { status: 429, errorKind: 'rate_limited' })
        sendJson(res, 429, { error: 'Rate limit exceeded' }, { ...cors, 'Retry-After': '60' })
        return
      }
    }

    let body
    try {
      body = await readJsonBody(req)
    } catch (e) {
      logEvent('warn', 'invalid_json', { status: 400, errorKind: 'invalid_json' })
      sendJson(res, 400, { error: 'Invalid JSON body' }, cors)
      return
    }
    const guard = validateChatBody(body, {
      defaultModel: MIMO_MODEL,
      allowedModels: ALLOWED_MODELS,
    })
    if (!guard.ok) {
      logEvent('warn', 'guard_rejected', { status: guard.status, errorKind: guard.error })
      sendJson(res, guard.status, { error: guard.error }, cors)
      return
    }

    // 原 ai_quota_check 已移除：它只查不扣，与 reserve_quota 混用会双算额度。
    // enforce 下 token 额度拦截统一由下方 reserve_quota 承担（内部已查 resolve_entitlement）。

    // ── 每日请求数拦截（enforce）：plans.features['ai.requests.daily'] ──
    // 与 token 月度额度互补：防止单日高频刷（token 总量尚未耗尽时也能拦住）。
    // 统一走 consume_daily_feature_quota：内部处理 expired/refunded 回落 free、UTC+8 自然日。
    // RPC 失败 fail-open，避免配额系统故障误伤用户。
    if (BILLING_MODE === 'enforce' && uid) {
      try {
        const daily = await db.rpc('consume_daily_feature_quota', {
          p_uid: uid,
          p_feature: 'ai.requests.daily',
          p_key_prefix: 'ai:req:',
        })
        if (daily.error) {
          logEvent('warn', 'daily_quota_rpc_failed', { errorKind: 'quota_rpc_failed' })
        } else if (daily.data && daily.data.ok === false && daily.data.limited === true) {
          logEvent('warn', 'daily_quota_exceeded', { status: 429, errorKind: 'quota_exceeded', quota: 'ai.requests.daily' })
          sendJson(res, 429, {
            error: 'quota_exceeded',
            quota: 'ai.requests.daily',
            limit: daily.data.limit,
            message: '今日 AI 请求次数已用完（免费版 20 次/日、PRO 100 次/日），请明天再试或升级。',
          }, cors)
          return
        }
      } catch (e) {
        logEvent('warn', 'daily_quota_rpc_failed', { errorKind: 'quota_exception', error: String((e && e.message) || e) })
      }
    }

    // ── 音频物化（URL → base64）：必须在转发上游前完成 ──
    try {
      const n = await materializeAudioUrls(guard.value.messages || [])
      if (n > 0) logEvent('info', 'audio_materialized', { parts: n })
    } catch (e) {
      const msg = String((e && e.message) || e)
      const tooLarge = msg.includes('too large')
      logEvent('warn', 'audio_materialize_failed', { status: tooLarge ? 413 : 400, errorKind: tooLarge ? 'audio_too_large' : 'audio_unavailable', error: msg })
      sendJson(res, tooLarge ? 413 : 400, {
        error: tooLarge ? 'audio_too_large' : 'audio_unavailable',
        message: tooLarge ? '音频过大，请截短后重试' : '音频读取失败，请重新上传',
      }, cors)
      return
    }

    // 计量口径：只算文本，跳过媒体块内联 base64（否则一次音频就按 5.95M token 记账）
    inChars = approximateBillableTextLength(guard.value)

    // ── 两段式预扣（enforce）：按「输入文本 + 4096 输出余量」估 token ──
    // ⚠️ p_metric 必须与 plans.features 的键名一致（ai.tokens.monthly）；
    // 写成 'ai.tokens' 会让 v_limit=0 → 所有登录用户在 enforce 下被 429。
    // 预扣只是并发占位，请求结束时由 finalize() 按实际输出结算冲正。
    if (BILLING_MODE === 'enforce' && uid) {
      const reserveAmount = Math.ceil((Math.min(inChars, 60000) + 4096) / 2)
      try {
        const r = await db.rpc('reserve_quota', {
          p_uid: uid,
          p_metric: 'ai.tokens.monthly',
          p_amount: reserveAmount,
          p_period: period,
          p_ref: ref,
        })
        if (r.error) {
          // fail-open：配额系统故障不误伤用户（沿用原 ai_quota_check 口径），仅留痕
          logEvent('warn', 'reserve_error', { tokens: reserveAmount, errorKind: 'reserve_rpc_failed', error: String(r.error) })
        } else if (r.data?.ok === false) {
          logEvent('warn', 'quota_exceeded', { status: 429, tokens: reserveAmount, errorKind: r.data.reason || 'quota_exceeded' })
          sendJson(res, 429, {
            error: 'quota_exceeded',
            message: '本月 AI 额度已用完。升级 PRO 解锁 20 万 tokens/月（年付折合 ¥9/月）。',
          }, cors)
          return
        } else {
          logEvent('info', 'reserve_ok', { tokens: reserveAmount })
        }
      } catch (e) {
        logEvent('warn', 'reserve_error', { tokens: reserveAmount, errorKind: 'reserve_exception', error: String((e && e.message) || e) })
      }
    }

    const upstream = await fetch(MIMO_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + MIMO_API_KEY,
      },
      body: JSON.stringify(guard.value),
      signal: AbortSignal.any([upstreamAbort.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })

    if (!upstream.ok) {
      // S11：不透传上游原始错误体（可能含 key 片段），只回状态码；
      // 但仍要读空 body 释放 undici 连接，否则高频 502 会耗尽连接池。
      await upstream.text().catch(() => '')
      logEvent('error', 'upstream_failed', { status: 502, errorKind: 'upstream_non_2xx', upstreamStatus: upstream.status })
      sendJson(res, 502, { error: 'AI 服务请求失败 (' + upstream.status + ')' }, cors)
      return
    }

    // SSE 流式透传（含 text/event-stream 头），前端解析逻辑零改动
    res.writeHead(200, {
      ...cors,
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
    })

    // 输出字节计数只用于影子计量，落账统一交给 finalize()（覆盖 finish/close/断连/流中断）
    const upstreamStream = Readable.fromWeb(upstream.body)
    upstreamStream.on('error', handleStreamError)
    if (uid) {
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          outBytes += chunk.length
          cb(null, chunk)
        },
      })
      counter.on('error', handleStreamError)
      upstreamStream.pipe(counter).pipe(res)
    } else {
      upstreamStream.pipe(res)
    }
  } catch (error) {
    const kind = classifyStreamError(error)
    const status = kind === 'upstream_timeout' ? 504 : kind === 'upstream_stream_error' ? 502 : 500
    if (kind === 'aborted_by_client') {
      logEvent('warn', 'request_aborted', { status, errorKind: 'aborted_by_client' })
    } else if (kind === 'upstream_timeout') {
      logEvent('error', 'upstream_timeout', { status, errorKind: 'upstream_timeout' })
    } else {
      logEvent('error', 'internal_error', { status, errorKind: kind, error: String((error && error.message) || error) })
    }
    finalize('request_error', { status, errorKind: kind })
    if (!res.headersSent) {
      sendJson(
        res,
        status,
        { error: kind === 'upstream_timeout' ? 'AI 服务响应超时，请稍后重试' : 'Internal server error' },
        cors,
      )
    } else {
      // 已发头：不能 res.destroy()（浏览器会只看到 network error），走统一错误帧收口
      handleStreamError(error, true)
    }
  }
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log('[mimo-chat] listening on :' + PORT)
})
