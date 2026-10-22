/**
 * share-ssr — 公开分享页同域 SSR（CloudBase HTTP 云函数）
 *
 * 承载两条公开链接（切解析后 ulink.ren 的 /s/* 由本网关路由（path=/s + 路径透传）进本函数）：
 *   GET /s/<gid>    组分享    → renderSharePage（数据 RPC get_public_group）
 *   GET /s/c/<sid>  分类分享  → renderShareCategoryPage（数据 RPC get_public_category）
 *
 * 从 Cloudflare Pages Functions（functions/s/[gid].ts + s/c/[sid].ts）迁移而来。
 * 渲染核 share-render.ts（零依赖纯函数）由 build-fn-assets --bundle 派生，不改一行。
 * 业务逻辑原样搬：gid/sid 校验、?lang=/Accept-Language 双语、分类 layout/移动端自适应、
 * 上游故障 ≠ 404（STALE 兜底 → 503），x-share-render: v2 / x-share-cache 可观测头。
 *
 * 迁移差异（刻意为之）：
 * 1) 数据：Supabase PostgREST RPC（anon key）→ CloudBase rdb.rpc（CLOUDBASE_APIKEY）。
 * 2) 缓存：CF Cache API（边缘共享）→ 实例内存 Map（mem-cache.js，语义一致：300s 新鲜
 *    + 24h 故障兜底，双写）。多实例各自缓存，命中率略低，不引入外部依赖。
 * 3) 路由：网关 path=/s + enablePathTransmission 前缀透传，函数内按路径分流两种分享。
 */

const http = require('http')
const {
  renderSharePage,
  renderShareCategoryPage,
  renderNotFoundPage,
  renderUnavailablePage,
} = require('./share-render.js')
const { getFresh, getStale, putShare } = require('./mem-cache.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const APP_ORIGIN = (process.env.APP_ORIGIN || 'https://ulink.ren').replace(/\/+$/, '')

function sendHtml(res, status, html, extraHeaders) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'x-share-render': 'v2',
    ...extraHeaders,
  })
  res.end(html)
}

function sendText(res, status, text, extraHeaders) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'x-share-render': 'v2',
    ...extraHeaders,
  })
  res.end(text)
}

/** 分享 ID 校验：与 App 端 generateId 格式对齐（字母数字 _ -，2-64 位） */
function isValidShareId(id) {
  return /^[a-zA-Z0-9_-]{2,64}$/.test(id)
}

/** 渲染语言：显式 ?lang= 优先，其次 Accept-Language（zh* → zh-CN），兜底 zh-CN */
function resolveLocale(url, acceptLanguage) {
  const explicit = url.searchParams.get('lang')
  if (explicit === 'zh-CN' || explicit === 'en-US') return explicit
  const al = (acceptLanguage || '').toLowerCase()
  if (al.startsWith('zh')) return 'zh-CN'
  return 'en-US'
}

/** 移动端探测（分类分享无显式 layout 时：手机 list / 桌面 grid） */
function isMobileRequest(req) {
  if (req.headers['sec-ch-ua-mobile'] === '?1') return true
  const ua = String(req.headers['user-agent'] || '').toLowerCase()
  return /android|iphone|ipad|ipod|mobile|windows phone/i.test(ua)
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
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'method not allowed')
    return
  }
  if (!ENV_ID || !API_KEY) {
    sendText(res, 500, 'server misconfigured')
    return
  }

  // 路径透传后 req.url 形如 /s/<gid>?x=1 或 /s/c/<sid>
  const url = new URL(req.url || '/', APP_ORIGIN)
  const pathParts = url.pathname.split('/').filter(Boolean) // ['s', gid] 或 ['s', 'c', sid]
  const isCategory = pathParts[1] === 'c'
  const id = String(isCategory ? pathParts[2] || '' : pathParts[1] || '').trim()

  if (pathParts[0] !== 's' || !isValidShareId(id) || (isCategory && !id)) {
    sendText(res, 400, 'bad request')
    return
  }

  const locale = resolveLocale(url, req.headers['accept-language'] || '')

  // 分类分享的 layout 自适应（与 s/c/[sid].ts 同口径；无显式 layout 时按设备类型隔离缓存键）
  let cacheSearch = url.search
  let layout = null
  if (isCategory) {
    const rawLayout = url.searchParams.get('layout')
    const isMobile = isMobileRequest(req)
    layout =
      rawLayout === 'list' || rawLayout === 'mini-grid' || rawLayout === 'grid'
        ? rawLayout
        : isMobile
          ? 'list'
          : 'grid'
    cacheSearch = rawLayout
      ? url.search
      : url.search
        ? `${url.search}&_dev=${isMobile ? 'm' : 'd'}`
        : `?_dev=${isMobile ? 'm' : 'd'}`
  }

  const cacheKey = `${url.pathname}${cacheSearch}`
  const hit = getFresh(cacheKey)
  if (hit) {
    sendHtml(res, 200, hit, { 'x-share-cache': 'HIT' })
    return
  }

  // 数据：公开读走 SECURITY DEFINER RPC（列级隔离，已排除 username/password/user_id）
  const db = getDb()
  let data = null
  let upstreamFailed = false
  try {
    const r = isCategory
      ? await db.rpc('get_public_category', { p_share_id: id })
      : await db.rpc('get_public_group', { p_gid: id })
    if (r.error) {
      console.error('[share-ssr] rpc failed:', r.error)
      upstreamFailed = true
    } else {
      data = r.data
    }
  } catch (e) {
    console.error('[share-ssr] rpc threw:', e)
    upstreamFailed = true
  }

  // 上游故障 ≠ 分享不存在：404 语义保留给「不存在或未公开」。
  // 先试 24h 兜底副本（200 + STALE）；没有才 503（no-store，恢复后下次请求拿真数据）。
  if (upstreamFailed) {
    const stale = getStale(cacheKey)
    if (stale) {
      sendHtml(res, 200, stale, { 'x-share-cache': 'STALE', 'cache-control': 'public, max-age=60' })
      return
    }
    sendHtml(res, 503, renderUnavailablePage(locale), { 'cache-control': 'no-store', 'x-share-cache': 'MISS' })
    return
  }

  const found = isCategory ? data && data.category : data && data.group
  if (!found) {
    sendHtml(res, 404, renderNotFoundPage(locale), { 'x-share-cache': 'MISS' })
    return
  }

  let html
  if (isCategory) {
    const shareUrl = `${APP_ORIGIN}/s/c/${encodeURIComponent(id)}`
    html = renderShareCategoryPage(
      data.category,
      data.groups || [],
      data.bookmarks || [],
      id,
      shareUrl,
      APP_ORIGIN,
      locale,
      layout,
    )
  } else {
    const shareUrl = `${APP_ORIGIN}/s/${encodeURIComponent(id)}`
    html = renderSharePage(data.group, data.bookmarks || [], shareUrl, APP_ORIGIN, locale)
  }

  putShare(cacheKey, html)
  sendHtml(res, 200, html, { 'x-share-cache': 'MISS' })
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log('[share-ssr] listening on :' + PORT)
})
