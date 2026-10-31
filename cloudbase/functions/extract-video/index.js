/**
 * extract-video — 视频内容「简介/字幕/评论区」服务端转发提取（CloudBase HTTP 云函数）
 *
 * 从 supabase/functions/extract-video/index.ts 迁移而来。业务逻辑**原样搬**：
 * 短链逐跳解析（每跳 SSRF 校验）、B站适配器（view/热评/CC 字幕/AI 语音小结）、
 * YouTube Data API（无 key 则降级）、r.jina.ai 通用降级（degraded 如实标注）、
 * CORS fail-closed、客户端断连取消。平台解析真源 video-adapters.ts（build-fn-assets 派生）。
 *
 * 迁移差异（与 jina-proxy/check-link 同口径）：
 * 1) 鉴权：Supabase getUser → IP 哈希限流（consume_rate_limit fail-closed），20/min/IP。
 * 2) DNS：Deno.resolveDns → dns.promises（DnsResolver 契约不变）。
 * 3) 断连：req.signal → res 'close' 事件。
 *
 * P0 增强（docs/VIDEO_DEEP_EXTRACT.md）：
 * - 同步响应新增 provider（bilibili-native / youtube-api / worker / jina）与 fallback_reason；
 *   worker 分支补回 duration / uploader / chapters。
 * - YouTube 无 Data API key 时先探 worker /health（5 分钟缓存）：worker 没配代理就直接 jina，
 *   不再白等 45s（函数总超时 60s，worker 超时 + jina 超时会直接被掐断）。
 * - 平台域名清单单一真源：video-platforms.json（build-fn-assets 从 src/config/videoPlatforms.json 复制）。
 * - 深度解析异步代理：action=deep / deep_status（契约见 docs/VIDEO_DEEP_EXTRACT.md §2）。
 * - 可测的纯判定函数在 routing.js（本文件只做 I/O 编排）。
 */

const http = require('http')
const dns = require('dns').promises
const crypto = require('crypto')
const {
  validateInputUrl,
  isUrlDnsSafe,
  detectPlatform,
  isShortLinkHost,
  parseBilibiliVideoId,
  parseYouTubeVideoId,
  parseBilibiliView,
  parseBilibiliComments,
  parseBilibiliSubtitleDoc,
  parseBilibiliAiConclusion,
  parseYouTubeVideo,
  parseYouTubeComments,
} = require('./video-adapters.js')
const {
  isMeaningfulText,
  isDeadPageText,
  shouldUseWorker,
  normalizeWorkerSource,
  pickFallbackReason,
  isValidJobId,
} = require('./routing.js')
const { isOriginAllowed, buildCorsHeaders } = require('./ssrf-guard.js')
const { verifyCbToken } = require('./cb-auth.js')

// 平台域名清单单一真源（scripts/build-fn-assets.mjs 从 src/config/videoPlatforms.json 复制）。
// 缺文件时宁可不走 worker（记录错误），也不要让整个函数冷启动即崩、连 B站/YouTube 适配器都不可用。
let WORKER_VIDEO_HOSTS = []
try {
  const manifest = require('./video-platforms.json')
  WORKER_VIDEO_HOSTS = Array.isArray(manifest.videoHosts) ? manifest.videoHosts : []
} catch (e) {
  console.error('[extract-video] video-platforms.json 缺失，worker 路由已禁用；请执行 node scripts/build-fn-assets.mjs')
}

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || ''
const RATE_LIMIT_PER_MIN = parseInt(process.env.EXTRACT_VIDEO_RATE_LIMIT_PER_MIN || '20', 10)
// 全局兜底限流/匿名额度：X-Forwarded-For 可被客户端伪造（网关未回填可信 IP 时按 IP 计数的键可绕过），
// 因此再加一层与 IP 无关的全局上限，保证「被刷成免费代理」的成本有界。按 uid 计数的登录用户不受影响。
const RATE_LIMIT_GLOBAL_PER_MIN = parseInt(process.env.EXTRACT_VIDEO_RATE_LIMIT_GLOBAL_PER_MIN || '1200', 10)
const ANON_GLOBAL_DAILY = parseInt(process.env.EXTRACT_VIDEO_ANON_GLOBAL_DAILY || '2000', 10)
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.EXTRACT_VIDEO_TIMEOUT_MS || '12000', 10)
// yt-dlp + 无头浏览器微服务（scripts/video-worker）：未配置则完全跳过，行为与旧版一致
const VIDEO_WORKER_URL = process.env.VIDEO_WORKER_URL || ''
const VIDEO_WORKER_TOKEN = process.env.VIDEO_WORKER_TOKEN || ''
const WORKER_TIMEOUT_MS = parseInt(process.env.EXTRACT_VIDEO_WORKER_TIMEOUT_MS || '45000', 10)
// 日配额：metric 名与 plans.features 对齐（free=1，PRO=10）
const QUOTA_METRIC = 'video.extract.daily'
// 深度解析独立配额（分钟级任务，与同步解析分开计数；迁移见 cloudbase/migrations/20261030000001_*）
const DEEP_QUOTA_METRIC = 'video.deep.daily'
// plans.features 缺 video.deep.daily 时的回落：登录且 video.extract.daily>=10 视为 PRO → 2，否则 0。
// 缺省只给「已是 PRO 档」的用户，绝不给匿名/免费档开深度解析。
const DEEP_DAILY_FALLBACK = parseInt(process.env.EXTRACT_VIDEO_DEEP_DAILY || '2', 10)
const DEEP_PRO_EXTRACT_DAILY_THRESHOLD = 10
// 深度任务代理超时：提交 15s / 查询 10s（worker 返回 202 即算成功，不在这里排队等结果）
const DEEP_SUBMIT_TIMEOUT_MS = parseInt(process.env.EXTRACT_VIDEO_DEEP_SUBMIT_TIMEOUT_MS || '15000', 10)
const DEEP_STATUS_TIMEOUT_MS = parseInt(process.env.EXTRACT_VIDEO_DEEP_STATUS_TIMEOUT_MS || '10000', 10)
// 深度任务轮询：客户端 2s 一轮、上限 150s ≈ 75 次/任务，套用 20/min 的提取限流必然误杀，
// 故 deep_status 不走提取限流，只用下面的内存级 120 次/分/IP 兜底（job_id 不可猜，刷到的只有 400）
const POLL_LIMIT_PER_MIN = 120
// worker /health 探测（仅 YouTube 无 Data API key 时用于 P0 快速失败）
const WORKER_HEALTH_TTL_MS = 5 * 60 * 1000
const WORKER_HEALTH_TIMEOUT_MS = 3000
// 窗口略大于 1 天；key 里带日期，等于「自然日固定桶」而不是滚动 24h
const QUOTA_WINDOW_SECS = 90000
const FREE_DAILY_FALLBACK = parseInt(process.env.EXTRACT_VIDEO_FREE_DAILY || '1', 10)
const ANON_DAILY_LIMIT = parseInt(process.env.EXTRACT_VIDEO_ANON_DAILY_LIMIT || '1', 10)
// 充值/权益过期时回落免费额度，而不是沿用过期 PRO 额度
const QUOTA_ENFORCE = (process.env.EXTRACT_VIDEO_QUOTA_ENFORCE || 'true') !== 'false'
const GENERIC_MAX_CHARS = 30000
const MAX_SHORT_LINK_HOPS = 5
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'ulink-extract-video'

const BROWSER_UA = 'Mozilla/5.0 (compatible; ulink-extract/1.0; +https://ulink.ren)'

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

/**
 * 调用方真实 IP（配额/限流键的来源）。
 *
 * 安全：客户端可以自行注入 `X-Forwarded-For`，若取「第一跳」就能伪造 IP 绕过日配额与每分钟限流
 * （2026-10-30 线上实测：带 `X-Forwarded-For: 203.0.113.77` 可让已耗尽额度的匿名调用再次成功）。
 * 网关会把真实来源追加到链尾，因此优先 `x-real-ip`，其次取 XFF 的**最后一跳**。
 */
function clientIp(req) {
  const real = req.headers['x-real-ip']
  if (typeof real === 'string' && real.trim()) return real.trim()
  const xff = String(req.headers['x-forwarded-for'] || '')
  const hops = xff.split(',').map((s) => s.trim()).filter(Boolean)
  if (hops.length) return hops[hops.length - 1]
  return req.headers['cf-connecting-ip'] || 'unknown'
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex')
}

/** 短链解析：b23.tv 等逐跳跟随到 canonical 视频页；每跳重验 URL + DNS（fail-closed） */
async function resolveShortLink(parsed, signal) {
  if (!isShortLinkHost(parsed.hostname)) return parsed
  let current = parsed
  for (let hop = 0; hop < MAX_SHORT_LINK_HOPS; hop++) {
    if (!(await isUrlDnsSafe(current, nodeDnsResolver))) break
    try {
      const res = await fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      })
      const loc = res.headers.get('Location')
      if (![301, 302, 303, 307, 308].includes(res.status) || !loc) break
      current = validateInputUrl(new URL(loc, current.href).href)
    } catch (e) {
      break
    }
  }
  return current
}

/** 带 HTTP 状态/错误原因的 JSON 抓取：适配器失败时排障要靠它（原先只返回 null，线上无从定位） */
async function fetchJsonDetailed(url, signal, extraHeaders) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json', ...(extraHeaders || {}) },
      signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })
    const status = res.status
    if (!res.ok) {
      // 非 2xx 时读完并丢弃 body，避免连接悬挂（bilibili 风控会回 -412 / 空 body）
      await res.text().catch(() => '')
      return { ok: false, status, json: null }
    }
    const json = await res.json().catch(() => null)
    return { ok: true, status, json }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      json: null,
      error: e && e.name === 'TimeoutError' ? 'timeout' : (e && e.message) || 'network_error',
    }
  }
}

async function fetchJson(url, signal, extraHeaders) {
  const r = await fetchJsonDetailed(url, signal, extraHeaders)
  return r.json
}

async function fetchText(url, signal, extraHeaders) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain', ...(extraHeaders || {}) },
      signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })
    if (!res.ok) return null
    return await res.text()
  } catch (e) {
    return null
  }
}

// B站 API 对「没有浏览器特征头」的云机房请求会回 -412 或风控空响，补 Referer/Origin/Accept-Language
const BILIBILI_HEADERS = {
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

/** worker origin（从 VIDEO_WORKER_URL 推导；未配置/非法 URL 返回空串） */
function workerOrigin() {
  if (!VIDEO_WORKER_URL) return ''
  try {
    return new URL(VIDEO_WORKER_URL).origin
  } catch (e) {
    return ''
  }
}

// /health 模块级缓存（TTL 5 分钟）。成功与失败都缓存：失败也别让每个 YouTube 请求白等 3s。
// 注意这是「实例内」缓存，冷启动后第一次会真探一次，可以接受。
let _workerHealthCache = { at: 0, data: null }

/**
 * 探测 worker /health（契约 §3：追加 proxy_configured 等字段）。
 * 返回 body 对象；不可达 / 非 2xx / 非对象一律返回 null（= 按 worker 不可用处理，见调用方注释）。
 */
async function getWorkerHealth(signal) {
  const origin = workerOrigin()
  if (!origin) return null
  const now = Date.now()
  if (_workerHealthCache.at && now - _workerHealthCache.at < WORKER_HEALTH_TTL_MS) {
    return _workerHealthCache.data
  }
  let data = null
  try {
    const res = await fetch(origin + '/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(WORKER_HEALTH_TIMEOUT_MS)]),
    })
    if (res.ok) {
      const body = await res.json().catch(() => null)
      if (body && typeof body === 'object') data = body
    }
  } catch (e) {
    // 客户端已断开：不写缓存（下次请求还要真探），直接返回未知
    if (signal.aborted) return null
  }
  _workerHealthCache = { at: now, data }
  return data
}

/** worker chapters 归一：只保留结构完整的条目，防止脏数据直通客户端 */
function normalizeChapters(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c) => c && typeof c === 'object' && typeof c.title === 'string' && c.title.trim())
    .slice(0, 100)
    .map((c) => ({
      title: c.title.trim().slice(0, 200),
      start_time: Number.isFinite(Number(c.start_time)) ? Number(c.start_time) : 0,
      end_time: Number.isFinite(Number(c.end_time)) ? Number(c.end_time) : 0,
    }))
}

/**
 * 调 yt-dlp 微服务（scripts/video-worker）提取简介/字幕/评论。
 * 返回 { payload, failure }：
 *   payload 非空 = 如实提取成功；payload 为 null 时 failure 给出原因
 *   （'timeout' / 'http' / 'empty' / 'network'），由调用方继续走 r.jina.ai 并据此填 fallback_reason。
 * 未配置 URL / 超时 / 非 2xx / success=false / 内容全空绝不伪造结果。
 */
async function fetchViaWorker(href, signal) {
  if (!VIDEO_WORKER_URL) return { payload: null, failure: 'unconfigured' }
  try {
    const res = await fetch(VIDEO_WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(VIDEO_WORKER_TOKEN ? { 'X-Worker-Token': VIDEO_WORKER_TOKEN } : {}),
      },
      body: JSON.stringify({ url: href }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(WORKER_TIMEOUT_MS)]),
    })
    if (!res.ok) {
      await res.text().catch(() => '')
      return { payload: null, failure: 'http' }
    }
    const data = await res.json().catch(() => null)
    if (!data || data.success !== true) return { payload: null, failure: 'empty' }
    const title = typeof data.title === 'string' ? data.title.slice(0, 500) : ''
    const description = typeof data.description === 'string' ? data.description.slice(0, GENERIC_MAX_CHARS) : ''
    const subtitles = typeof data.subtitles === 'string' ? data.subtitles.slice(0, GENERIC_MAX_CHARS) : ''
    const comments = Array.isArray(data.comments)
      ? data.comments.filter((c) => typeof c === 'string' && c.trim()).slice(0, 20).map((c) => c.slice(0, 300))
      : []
    // 只有平台空壳标题（如「在抖音记录美好生活」）或错误页时视为没抓到，交给 jina 兜底并如实失败
    if (!isMeaningfulText(title) && !isMeaningfulText(description) && !subtitles && comments.length === 0) {
      return { payload: null, failure: 'empty' }
    }
    if (isDeadPageText(title, description, subtitles)) {
      return { payload: null, failure: 'empty' }
    }
    // duration/uploader/chapters 此前被丢弃（P0 修复）：深度解析/前端展示需要这些字段
    const duration = Number(data.duration)
    const uploader = typeof data.uploader === 'string' ? data.uploader.trim().slice(0, 200) : ''
    const chapters = normalizeChapters(data.chapters)
    const payload = {
      source: normalizeWorkerSource(data.source),
      url: typeof data.url === 'string' && data.url ? data.url : href,
      title,
      description,
      subtitles,
      comments,
      degraded: false,
      provider: 'worker',
    }
    if (Number.isFinite(duration) && duration > 0) payload.duration = Math.round(duration)
    if (uploader) payload.uploader = uploader
    if (chapters.length) payload.chapters = chapters
    return { payload, failure: null }
  } catch (e) {
    // TimeoutError = AbortSignal.timeout 到点；AbortError 且非客户端断开 = 超时（部分 Node 版本如此）
    const timedOut = !!(e && e.name === 'TimeoutError') || !!(e && e.name === 'AbortError' && !signal.aborted)
    return { payload: null, failure: timedOut ? 'timeout' : 'network' }
  }
}

let _db = null
function getDb() {
  if (_db) return _db
  const cloudbase = require('@cloudbase/node-sdk')
  const app = cloudbase.init({ env: ENV_ID, accessKey: API_KEY })
  _db = app.rdb()
  return _db
}

/** 上海时区（UTC+8，无夏令时）自然日 key，与用户认知的「今天」一致 */
function shanghaiDateKey(now) {
  const ts = (typeof now === 'number' ? now : Date.now()) + 8 * 3600 * 1000
  return new Date(ts).toISOString().slice(0, 10)
}

/**
 * 日配额校验：登录用户按 plans.features['video.extract.daily']，匿名按 IP。
 * 返回 { ok:true } 放行；否则带 HTTP 状态：
 *   429 当天额度用完 / 401 令牌无效 / 503 配额服务不可用（fail-closed，绝不无限放行）
 */
async function checkDailyQuota(req, db, ipHash) {
  if (!QUOTA_ENFORCE) return { ok: true, scope: 'disabled', limit: 0 }
  const date = shanghaiDateKey()
  const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID })

  if (auth.ok) {
    const ent = await db.rpc('resolve_entitlement', { p_uid: auth.uid })
    if (ent.error) {
      console.error('[extract-video] resolve_entitlement failed (fail-closed):', ent.error)
      return { ok: false, status: 503, error: 'quota_unavailable' }
    }
    const features = (ent.data && ent.data.features) || {}
    const expired = ent.data && ent.data.status === 'expired'
    // 订阅过期回落免费额度，不沿用过期档位的额度
    const limit = expired ? FREE_DAILY_FALLBACK : Number(features[QUOTA_METRIC] ?? FREE_DAILY_FALLBACK)
    if (!Number.isFinite(limit) || limit <= 0) {
      return { ok: false, status: 429, scope: 'user', limit: 0 }
    }
    const rl = await db.rpc('consume_rate_limit', {
      p_key: 'extract-video:uid:' + auth.uid + ':' + date,
      p_limit: limit,
      p_window_secs: QUOTA_WINDOW_SECS,
    })
    if (rl.error) {
      console.error('[extract-video] quota rpc failed (fail-closed):', rl.error)
      return { ok: false, status: 503, error: 'quota_unavailable' }
    }
    if (rl.data !== true) return { ok: false, status: 429, scope: 'user', limit }
    return { ok: true, scope: 'user', limit }
  }

  // 带了令牌但验不过：fail-closed，不静默降级成匿名额度
  if (auth.reason !== 'missing') {
    return { ok: false, status: 401, error: 'invalid_token' }
  }

  if (ANON_DAILY_LIMIT <= 0) {
    return { ok: false, status: 401, error: 'login_required' }
  }
  // 全局匿名兜底（与 IP 无关）：X-Forwarded-For 可伪造，仅按 IP 计数可被换 IP 绕过；
  // 这一层保证匿名通道的总外呼成本有上限，登录用户走 uid 额度不受影响。
  if (ANON_GLOBAL_DAILY > 0) {
    const gr = await db.rpc('consume_rate_limit', {
      p_key: 'extract-video:anon-global:' + date,
      p_limit: ANON_GLOBAL_DAILY,
      p_window_secs: QUOTA_WINDOW_SECS,
    })
    if (gr.error) {
      console.error('[extract-video] anon global quota rpc failed (fail-closed):', gr.error)
      return { ok: false, status: 503, error: 'quota_unavailable' }
    }
    if (gr.data !== true) return { ok: false, status: 429, error: 'anon_global_quota', limit: ANON_DAILY_LIMIT }
  }
  const rl = await db.rpc('consume_rate_limit', {
    p_key: 'extract-video:anon:' + ipHash + ':' + date,
    p_limit: ANON_DAILY_LIMIT,
    p_window_secs: QUOTA_WINDOW_SECS,
  })
  if (rl.error) {
    console.error('[extract-video] anon quota rpc failed (fail-closed):', rl.error)
    return { ok: false, status: 503, error: 'quota_unavailable' }
  }
  if (rl.data !== true) return { ok: false, status: 429, scope: 'anonymous', limit: ANON_DAILY_LIMIT }
  return { ok: true, scope: 'anonymous', limit: ANON_DAILY_LIMIT }
}

// ─────────────────────── 深度解析代理（action=deep / deep_status）───────────────────────
// 契约唯一真源 docs/VIDEO_DEEP_EXTRACT.md §2/§3：云函数只做「验签 + 配额 + 转发」，
// 任务排队/ASR/OCR 全在 worker，函数不缓存 worker 返回（轮询必须拿到实时状态）。

/** plans.features → 深度解析日额度；键缺失时按 video.extract.daily 判定是否 PRO 档回落 */
function deepDailyLimit(features) {
  const raw = features ? features[DEEP_QUOTA_METRIC] : undefined
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw))
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Math.max(0, Math.floor(Number(raw)))
  }
  const extractDaily = Number(features ? features[QUOTA_METRIC] : NaN)
  if (Number.isFinite(extractDaily) && extractDaily >= DEEP_PRO_EXTRACT_DAILY_THRESHOLD) {
    const fallback = Number.isFinite(DEEP_DAILY_FALLBACK) ? DEEP_DAILY_FALLBACK : 2
    return Math.max(0, Math.floor(fallback))
  }
  return 0
}

/**
 * 深度配额校验：**必须登录**（匿名一律 401 login_required），按 uid + 上海自然日计数。
 * 返回 { ok:true, uid, limit } 或 { ok:false, status, code, limit? }。
 * 额度耗尽 429 才带 code=deep_quota_exceeded + quota.limit；匿名/鉴权失败不带 quota。
 */
async function checkDeepQuota(req, db) {
  const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID })
  if (!auth.ok) {
    return {
      ok: false,
      status: 401,
      code: auth.reason === 'missing' ? 'login_required' : 'invalid_token',
    }
  }
  // 演练环境关闭配额时仍要求登录：深度解析会把音视频外送 ASR/worker，不能匿名开放
  if (!QUOTA_ENFORCE) return { ok: true, uid: auth.uid, limit: 0 }

  const date = shanghaiDateKey()
  const ent = await db.rpc('resolve_entitlement', { p_uid: auth.uid })
  if (ent.error) {
    console.error('[extract-video] deep resolve_entitlement failed (fail-closed):', ent.error)
    return { ok: false, status: 503, code: 'quota_unavailable' }
  }
  const features = (ent.data && ent.data.features) || {}
  const expired = ent.data && ent.data.status === 'expired'
  // 权益过期回落 free（深度 0），不沿用过期 PRO 额度
  const limit = expired ? 0 : deepDailyLimit(features)
  if (!Number.isFinite(limit) || limit <= 0) {
    return { ok: false, status: 429, code: 'deep_quota_exceeded', limit: 0 }
  }
  const rl = await db.rpc('consume_rate_limit', {
    p_key: 'extract-video:deep:' + auth.uid + ':' + date,
    p_limit: limit,
    p_window_secs: QUOTA_WINDOW_SECS,
  })
  if (rl.error) {
    console.error('[extract-video] deep quota rpc failed (fail-closed):', rl.error)
    return { ok: false, status: 503, code: 'quota_unavailable' }
  }
  if (rl.data !== true) return { ok: false, status: 429, code: 'deep_quota_exceeded', limit }
  return { ok: true, uid: auth.uid, limit }
}

const DEEP_ERROR_MESSAGES = {
  login_required: '登录后可使用深度解析',
  invalid_token: '登录状态已失效，请重新登录后重试',
  quota_unavailable: '解析服务暂时不可用，请稍后再试',
  deep_unavailable: '深度解析服务暂不可用',
}

/**
 * 深度任务失败后退回一次额度（幂等：private.deep_quota_refunds 以 job_id 为主键）。
 * 仅在用户已登录且 QUOTA_ENFORCE 时生效；失败只记日志，不影响状态透传。
 */
async function refundDeepQuota(db, uid, jobId) {
  if (!QUOTA_ENFORCE || !uid || !jobId) return false
  try {
    const key = 'extract-video:deep:' + uid + ':' + shanghaiDateKey()
    const r = await db.rpc('refund_deep_quota', {
      p_uid: uid,
      p_job_id: jobId,
      p_key: key,
      p_window_secs: QUOTA_WINDOW_SECS,
    })
    if (r.error) {
      console.error('[extract-video] deep refund rpc failed:', r.error)
      return false
    }
    if (r.data === true) {
      console.log('[extract-video] deep quota refunded, job=' + jobId)
      return true
    }
    return false
  } catch (e) {
    console.error('[extract-video] deep refund error:', (e && e.message) || e)
    return false
  }
}

function sendDeepError(res, cors, result) {
  const status = result.status || 500
  const code = result.code || 'deep_unavailable'
  if (code === 'deep_quota_exceeded') {
    const limit = Math.max(0, Math.floor(Number(result.limit) || 0))
    sendJson(
      res,
      429,
      { error: '今日深度解析额度已用完（每日 ' + limit + ' 次）', code, quota: { limit } },
      { ...cors, 'Retry-After': '3600' },
    )
    return
  }
  sendJson(res, status, { error: DEEP_ERROR_MESSAGES[code] || '深度解析服务暂不可用', code }, cors)
}

/** include 白名单：只认两个布尔开关，杜绝把 body 里的任意字段透传给 worker */
function normalizeDeepInclude(raw) {
  const out = {}
  if (raw && typeof raw === 'object') {
    if (raw.transcript === true) out.transcript = true
    if (raw.ocr === true) out.ocr = true
  }
  return out
}

/**
 * 浏览器扩展上报的「页面态媒体地址」白名单。
 * 只接受各平台 CDN 上的直链（https、无 userinfo、路径/查询不校验），
 * 防止云函数被当成任意 URL 下载代理。新增平台时必须同步这里与 worker 的校验。
 */
const CLIENT_MEDIA_PLATFORMS = {
  bilibili: {
    referer: 'https://www.bilibili.com/',
    hosts: ['bilivideo.com', 'bilivideo.cn', 'bilibili.com'],
  },
  douyin: {
    referer: 'https://www.douyin.com/',
    hosts: ['douyinvod.com', 'bytecdn.cn', 'byteimg.com', 'snssdk.com', 'amemv.com', 'zjcdn.com'],
  },
  xiaohongshu: {
    referer: 'https://www.xiaohongshu.com/',
    hosts: ['xhscdn.com', 'xhsimg.com'],
  },
}

function normalizeClientMedia(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const allowedPorts = new Set(['', '443', '8082', '8443'])
  const platform = typeof raw.platform === 'string' ? raw.platform.trim().toLowerCase() : ''
  const rule = CLIENT_MEDIA_PLATFORMS[platform]
  if (!rule) return null
  const cleanUrl = (value) => {
    if (typeof value !== 'string') return ''
    const text = value.trim()
    if (!text || text.length > 2048) return ''
    try {
      const parsed = new URL(text)
      if (parsed.protocol !== 'https:') return ''
      if (parsed.username || parsed.password) return ''
      if (!allowedPorts.has(parsed.port)) return ''
      const host = parsed.hostname.toLowerCase()
      const ok = rule.hosts.some((suffix) => host === suffix || host.endsWith('.' + suffix))
      return ok ? parsed.href : ''
    } catch (_) {
      return ''
    }
  }
  const cleanList = (value) => {
    if (!Array.isArray(value)) return []
    const out = []
    for (const item of value) {
      const url = cleanUrl(item)
      if (url && !out.includes(url)) out.push(url)
      if (out.length >= 6) break
    }
    return out
  }
  const audio = cleanList(raw.audio_urls)
  const video = cleanList(raw.video_urls)
  if (!audio.length && !video.length) return null
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const duration = Number(raw.duration)
  const client = {
    platform,
    referer: rule.referer,
    audio_urls: audio,
    video_urls: video,
  }
  const title = text(raw.title, 200)
  const uploader = text(raw.uploader, 120)
  if (title) client.title = title
  if (uploader) client.uploader = uploader
  if (Number.isFinite(duration) && duration > 0 && duration <= 36000) client.duration = Math.floor(duration)
  return client
}

/**
 * POST {origin}/api/video/jobs（15s 超时）。成功统一给客户端 200 的
 * { job_id, status, eta_seconds }；worker 非 2xx / 不可达 / 返回坏 payload 一律 null → 503 deep_unavailable。
 */
async function submitWorkerJob(parsed, include, signal, client) {
  const url = workerOrigin() + '/api/video/jobs'
  try {
    const payload = { url: parsed.href, include }
    if (client) payload.client = client
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(VIDEO_WORKER_TOKEN ? { 'X-Worker-Token': VIDEO_WORKER_TOKEN } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([signal, AbortSignal.timeout(DEEP_SUBMIT_TIMEOUT_MS)]),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[extract-video] deep submit failed: HTTP', res.status, String(detail || '').slice(0, 200))
      return null
    }
    const data = await res.json().catch(() => null)
    if (!data || typeof data !== 'object' || !isValidJobId(data.job_id)) {
      console.error(
        '[extract-video] deep submit bad payload:',
        data && typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : typeof data,
      )
      return null
    }
    const job = {
      job_id: data.job_id,
      status: typeof data.status === 'string' && data.status ? data.status : 'queued',
      // 契约 §2.1 要求 eta_seconds；worker 未给时按默认排队时长 60s 兜底（前端只用于展示）
      eta_seconds: 60,
    }
    const eta = Number(data.eta_seconds)
    if (Number.isFinite(eta) && eta >= 0) job.eta_seconds = eta
    return job
  } catch (e) {
    console.error('[extract-video] deep submit error:', (e && e.message) || e)
    return null
  }
}

/** GET {origin}/api/video/jobs/{job_id}（10s 超时）；非 2xx / 不可达 → null（503 deep_unavailable） */
async function fetchWorkerJob(jobId, signal) {
  const origin = workerOrigin()
  if (!origin) return null
  try {
    const res = await fetch(origin + '/api/video/jobs/' + encodeURIComponent(jobId), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(VIDEO_WORKER_TOKEN ? { 'X-Worker-Token': VIDEO_WORKER_TOKEN } : {}),
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(DEEP_STATUS_TIMEOUT_MS)]),
    })
    if (!res.ok) {
      await res.text().catch(() => '')
      console.error('[extract-video] deep status failed: HTTP', res.status, 'job=' + jobId)
      return null
    }
    const data = await res.json().catch(() => null)
    if (!data || typeof data !== 'object') {
      console.error('[extract-video] deep status bad payload, job=' + jobId)
      return null
    }
    return data
  } catch (e) {
    console.error('[extract-video] deep status error:', (e && e.message) || e)
    return null
  }
}

// deep_status 的内存级轮询兜底（实例内有效；多实例各算各的，只防单实例被刷爆）
const _pollWindows = new Map()
function allowPoll(ipHash) {
  if (!(POLL_LIMIT_PER_MIN > 0)) return true
  const now = Date.now()
  const rec = _pollWindows.get(ipHash)
  if (!rec || now - rec.start >= 60_000) {
    if (_pollWindows.size > 5000) _pollWindows.clear()
    _pollWindows.set(ipHash, { start: now, count: 1 })
    return true
  }
  if (rec.count >= POLL_LIMIT_PER_MIN) return false
  rec.count += 1
  return true
}

/** action=deep：验签 → 深度配额 → 提交 worker 任务 */
async function handleDeepSubmit(req, res, cors, body, db, signal) {
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  let parsed
  try {
    parsed = validateInputUrl(rawUrl)
  } catch (e) {
    sendJson(res, 400, { error: (e && e.message) || 'Invalid URL', code: 'invalid_url' }, cors)
    return
  }

  // 先确认 worker 可用再扣额度：worker 未配置时直接 503，不白烧用户当日深度额度
  if (!workerOrigin()) {
    console.error('[extract-video] deep submit: VIDEO_WORKER_URL 未配置')
    sendDeepError(res, cors, { status: 503, code: 'deep_unavailable' })
    return
  }

  const quota = await checkDeepQuota(req, db)
  if (!quota.ok) {
    sendDeepError(res, cors, quota)
    return
  }

  const job = await submitWorkerJob(
    parsed,
    normalizeDeepInclude(body.include),
    signal,
    normalizeClientMedia(body.client),
  )
  if (!job) {
    // worker 未接单：本次扣的额度立即退回（job_id 用一次性合成值，天然幂等）
    await refundDeepQuota(db, quota.uid, 'submit-failed-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10))
    sendDeepError(res, cors, { status: 503, code: 'deep_unavailable' })
    return
  }
  sendJson(res, 200, job, cors)
}

/** action=deep_status：校验 job_id 后透传 worker 实时状态（不扣配额、不缓存） */
async function handleDeepStatus(req, res, cors, body, ipHash, signal, db) {
  if (!allowPoll(ipHash)) {
    sendJson(res, 429, { error: 'Rate limit exceeded' }, { ...cors, 'Retry-After': '60' })
    return
  }
  const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : ''
  if (!isValidJobId(jobId)) {
    sendJson(res, 400, { error: 'Invalid job_id', code: 'invalid_job_id' }, cors)
    return
  }
  const data = await fetchWorkerJob(jobId, signal)
  if (!data) {
    sendDeepError(res, cors, { status: 503, code: 'deep_unavailable' })
    return
  }
  // 异步任务失败：退回本次深度额度（幂等；未登录/不可识别时跳过）
  let refunded = false
  if (data.status === 'failed' && db) {
    try {
      const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID })
      if (auth.ok) refunded = await refundDeepQuota(db, auth.uid, jobId)
    } catch (e) {
      console.error('[extract-video] deep status refund skipped:', (e && e.message) || e)
    }
  }
  // 透传给前端，便于如实提示「本次失败已退回额度」
  data.quota_refunded = refunded
  sendJson(res, 200, data, cors)
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

  const upstreamAbort = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) upstreamAbort.abort()
  })

  try {
    const ipHash = sha256Hex(clientIp(req) + '|' + IP_HASH_SALT)
    const db = getDb()
    const signal = upstreamAbort.signal

    let body
    try {
      body = await readJsonBody(req)
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid JSON body' }, cors)
      return
    }
    const action = typeof body.action === 'string' ? body.action.trim() : ''

    // 深度任务查询：客户端 2s 一轮、上限 150s，套用 20/min 的提取限流会误杀，故提前分支并豁免
    if (action === 'deep_status') {
      await handleDeepStatus(req, res, cors, body, ipHash, signal, db)
      return
    }

    // 限流 fail-closed：转发层宁可暂时不可用，也不无限放行
    // 先做与 IP 无关的全局限流（XFF 可伪造，防单点被刷爆外呼成本），再做按 IP 的细粒度限流
    if (RATE_LIMIT_GLOBAL_PER_MIN > 0) {
      const grl = await db.rpc('consume_rate_limit', {
        p_key: 'extract-video:global',
        p_limit: RATE_LIMIT_GLOBAL_PER_MIN,
        p_window_secs: 60,
      })
      if (grl.error) {
        console.error('[extract-video] global rate limit rpc failed (fail-closed):', grl.error)
        sendJson(res, 503, { error: '提取服务暂时不可用，请稍后再试' }, cors)
        return
      }
      if (grl.data !== true) {
        sendJson(res, 429, { error: 'Rate limit exceeded' }, { ...cors, 'Retry-After': '60' })
        return
      }
    }
    const rl = await db.rpc('consume_rate_limit', {
      p_key: 'extract-video:ip:' + ipHash,
      p_limit: RATE_LIMIT_PER_MIN,
      p_window_secs: 60,
    })
    if (rl.error) {
      console.error('[extract-video] rate limit rpc failed (fail-closed):', rl.error)
      sendJson(res, 503, { error: '提取服务暂时不可用，请稍后再试' }, cors)
      return
    }
    if (rl.data !== true) {
      sendJson(res, 429, { error: 'Rate limit exceeded' }, { ...cors, 'Retry-After': '60' })
      return
    }

    // 深度解析异步任务：独立日配额（video.deep.daily），提交后立即返回 job_id
    if (action === 'deep') {
      await handleDeepSubmit(req, res, cors, body, db, signal)
      return
    }
    if (action && action !== 'extract') {
      sendJson(res, 400, { error: 'Unsupported action', code: 'unsupported_action' }, cors)
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

    // 日配额：按登录 uid（免费 1/日、PRO 10/日）或匿名 IP，抓取前拦截
    const quota = await checkDailyQuota(req, db, ipHash)
    if (!quota.ok) {
      const status = quota.status || 500
      const message =
        quota.error === 'quota_unavailable'
          ? '解析服务暂时不可用，请稍后再试'
          : quota.error === 'invalid_token'
            ? '登录状态已失效，请重新登录后重试'
            : quota.error === 'login_required'
              ? '请先登录后再使用视频解析'
              : quota.error === 'anon_global_quota'
                ? '今日匿名视频解析服务繁忙，请登录后使用或稍后再试'
                : '今日视频解析额度已用完（免费 1 次/日，PRO 10 次/日），明天再来或升级 PRO'
      sendJson(
        res,
        status,
        { error: message, quota: { limit: quota.limit, scope: quota.scope || null } },
        status === 429 ? { ...cors, 'Retry-After': '3600' } : cors,
      )
      return
    }

    const resolved = await resolveShortLink(parsed, signal)
    const platform = detectPlatform(resolved)
    // 平台专用适配器是否真的跑过（B站恒有；YouTube 只有配了 Data API key 才跑）——
    // 决定 jina 兜底时 fallback_reason 是 adapter_empty 还是 worker_unavailable
    const adapterAttempted = platform === 'bilibili' || (platform === 'youtube' && !!YOUTUBE_API_KEY)

    // B站适配器：view API + 热评 + CC 字幕 + 官方 AI 语音小结
    if (platform === 'bilibili') {
      const ids = parseBilibiliVideoId(resolved)
      if (ids) {
        const viewQuery = ids.bvid ? 'bvid=' + ids.bvid : 'aid=' + ids.aid
        const viewResp = await fetchJsonDetailed(
          'https://api.bilibili.com/x/web-interface/view?' + viewQuery,
          signal,
          BILIBILI_HEADERS,
        )
        const view = parseBilibiliView(viewResp.json)
        if (view) {
          const conclusionQuery = view.cid
            ? (ids.bvid ? 'bvid=' + ids.bvid + '&cid=' + view.cid : 'aid=' + view.aid + '&cid=' + view.cid)
            : null
          const results = await Promise.all([
            fetchJson(
              'https://api.bilibili.com/x/v2/reply?type=1&oid=' + view.aid + '&sort=1&ps=20&pn=1',
              signal,
              BILIBILI_HEADERS,
            ),
            conclusionQuery
              ? fetchJson(
                  'https://api.bilibili.com/x/web-interface/view/conclusion/get?' + conclusionQuery,
                  signal,
                  BILIBILI_HEADERS,
                )
              : Promise.resolve(null),
            ...view.subtitleUrls.slice(0, 2).map((u) => fetchText(u, signal, BILIBILI_HEADERS)),
          ])
          const commentsJson = results[0]
          const conclusionJson = results[1]
          const subtitleDocs = results.slice(2)

          const ccSubtitles = subtitleDocs
            .map((d) => (d ? parseBilibiliSubtitleDoc(d) : ''))
            .filter(Boolean)
            .join('\n')
          const aiConclusion = parseBilibiliAiConclusion(conclusionJson)
          const subtitles = [ccSubtitles, aiConclusion].filter(Boolean).join('\n\n')

          // 有 CC 字幕轨却一个字都没解析出来：这是解析器/上游格式问题，必须能在线上日志定位
          if (view.subtitleUrls.length > 0 && !ccSubtitles) {
            console.error(
              '[extract-video] bilibili cc subtitles parsed empty:',
              JSON.stringify({ url: resolved.href, subtitleUrls: view.subtitleUrls.length }),
            )
          }

          sendJson(res, 200, {
            source: 'bilibili',
            provider: 'bilibili-native',
            url: resolved.href,
            title: view.title,
            description: view.desc,
            subtitles,
            comments: parseBilibiliComments(commentsJson),
            degraded: false,
          }, cors)
          return
        }
        // 适配器失败原因（HTTP 状态 / bilibili code / 响应对不上结构）打日志，保持失败后回落 worker 的既有顺序
        console.error(
          '[extract-video] bilibili view adapter empty:',
          JSON.stringify({
            url: resolved.href,
            httpStatus: viewResp.status,
            biliCode: viewResp.json && viewResp.json.code,
            biliMessage: viewResp.json && viewResp.json.message,
            error: viewResp.error || null,
          }),
        )
      }
    }

    // YouTube 适配器：Data API v3（需 key，未配置则降级）
    if (platform === 'youtube' && YOUTUBE_API_KEY) {
      const vid = parseYouTubeVideoId(resolved)
      const key = encodeURIComponent(YOUTUBE_API_KEY)
      const results = await Promise.all([
        fetchJson('https://www.googleapis.com/youtube/v3/videos?part=snippet&id=' + vid + '&key=' + key, signal),
        fetchJson('https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=' + vid + '&order=relevance&maxResults=20&key=' + key, signal),
      ])
      const video = parseYouTubeVideo(results[0])
      if (video) {
        sendJson(res, 200, {
          source: 'youtube',
          provider: 'youtube-api',
          url: resolved.href,
          title: video.title,
          description: video.description,
          subtitles: '',
          comments: parseYouTubeComments(results[1]),
          degraded: false,
        }, cors)
        return
      }
      console.error('[extract-video] youtube api adapter empty:', resolved.href)
    }

    // worker 路由：平台域名清单来自 video-platforms.json（单一真源）
    const workerConfigured = !!VIDEO_WORKER_URL
    let workerSkipped = null
    let workerTimedOut = false
    let workerPayload = null
    if (shouldUseWorker(resolved, WORKER_VIDEO_HOSTS)) {
      // P0 快速失败：YouTube 无 Data API key 时，worker 没配出站代理就必然抓不到（白等 45s，
      // 叠加 jina 12s 会直接撞 60s 函数超时）。先探 /health（5 分钟缓存）再决定。
      if (platform === 'youtube' && !YOUTUBE_API_KEY && workerConfigured) {
        const health = await getWorkerHealth(signal)
        if (!health) {
          // /health 不可达 = worker 多半整体不可用；此刻仍试一次 worker 只会白等 45s 并撞函数超时，
          // 直接 jina 更稳妥（health 有 TTL，恢复后 5 分钟内自动重试）
          workerSkipped = 'unavailable'
          console.error('[extract-video] worker health unreachable, skip worker for youtube')
        } else if (health.proxy_configured === false) {
          // 明确知道没代理才跳过；老 worker 没这个字段（undefined）时保持原行为，不误伤可用链路
          workerSkipped = 'no_proxy'
          console.error('[extract-video] worker has no proxy for youtube, fallback to jina')
        }
      }
      if (!workerSkipped) {
        const worker = await fetchViaWorker(resolved.href, signal)
        workerPayload = worker.payload
        if (worker.failure === 'timeout') workerTimedOut = true
        if (!workerPayload && worker.failure) {
          console.error('[extract-video] worker fell through:', worker.failure, resolved.href)
        }
      }
    }
    if (workerPayload) {
      sendJson(res, 200, workerPayload, cors)
      return
    }

    // 通用降级：r.jina.ai 抓取（长尾平台 / 平台风控 / 无 YouTube key）
    const fallbackReason = pickFallbackReason({
      workerSkipped,
      workerTimedOut,
      adapterAttempted,
    })
    try {
      const up = await fetch('https://r.jina.ai/' + resolved.href, {
        headers: { Accept: 'text/markdown, text/plain, */*', 'X-No-Cache': 'true' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      })
      if (up.ok) {
        const text = await up.text()
        if (text && text.trim()) {
          const titleMatch = text.match(/^Title:\s*(.+)$/im) || text.match(/^#\s+(.+)$/m)
          const descMatch = text.match(/^Description:\s*(.+)$/im)
          sendJson(res, 200, {
            source: 'generic',
            provider: 'jina',
            url: resolved.href,
            title: titleMatch ? titleMatch[1].trim() : '',
            description: descMatch ? descMatch[1].trim() : '',
            subtitles: '',
            comments: [],
            markdown: text.slice(0, GENERIC_MAX_CHARS),
            degraded: true,
            fallback_reason: fallbackReason,
          }, cors)
          return
        }
      }
      sendJson(res, 502, { error: '页面读取失败 (HTTP ' + up.status + ')' }, cors)
    } catch (e) {
      sendJson(res, 502, { error: '页面读取超时或网络异常' }, cors)
    }
  } catch (error) {
    console.error('[extract-video] internal error:', error)
    sendJson(res, 500, { error: 'Internal server error' }, cors)
  }
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log('[extract-video] listening on :' + PORT)
})
