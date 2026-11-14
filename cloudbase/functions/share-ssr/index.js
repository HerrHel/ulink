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
const crypto = require('crypto')
const {
  renderSharePage,
  renderShareCategoryPage,
  renderNotFoundPage,
  renderUnavailablePage,
  renderPasswordGate,
} = require('./share-render.js')
const { getFresh, getStale, putShare } = require('./mem-cache.js')
const {
  verifyPassword,
  makeTicket,
  checkTicket,
  ticketCookieName,
  parseCookies,
  buildTicketCookie,
} = require('./share-lock.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const APP_ORIGIN = (process.env.APP_ORIGIN || 'https://ulink.ren').replace(/\/+$/, '')
/** 票据签名密钥：缺失时带密码的分享一律 503 —— 绝不降级为「无密码放行」 */
const SHARE_LOCK_SECRET = process.env.SHARE_LOCK_SECRET || ''
/** 密码尝试限流用的 IP 盐（与其它函数同款，每函数独立） */
const IP_HASH_SALT = process.env.IP_HASH_SALT || ''
/** 密码尝试：10 次 / 10 分钟 / (gid, IP) */
const PASS_TRY_LIMIT = 10
/** 密码尝试的 per-gid 全局上限：与 IP 无关，防伪造 IP 头 / 分布式换 IP 绕过。
 *  阈值高于单人正常输错次数，但把「无限次在线爆破」收敛到有界速率。 */
const PASS_TRY_GID_LIMIT = 30
const PASS_TRY_WINDOW_SEC = 600

function clientIp(req) {
  const real = req.headers['x-real-ip']
  if (typeof real === 'string' && real.trim()) return real.trim()
  const xff = String(req.headers['x-forwarded-for'] || '')
  const hops = xff.split(',').map((s) => s.trim()).filter(Boolean)
  if (hops.length) return hops[hops.length - 1]
  return req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || 'unknown'
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
}

/** 读取表单体（只取 password 字段，硬上限 4KB 防滥用） */
function readPasswordForm(req, limit = 4096) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      resolve(v)
    }
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        finish('')
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const ct = String(req.headers['content-type'] || '')
      if (!ct.includes('application/x-www-form-urlencoded')) {
        finish('')
        return
      }
      try {
        const p = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
        finish(p.get('password') || '')
      } catch {
        finish('')
      }
    })
    req.on('error', () => finish(''))
  })
}

/**
 * 分享页安全响应头：分享页含用户内容与「保存到我的库」按钮，防嵌套点击劫持。
 *
 * CSP 说明：
 * - `script-src 'self' 'unsafe-inline'`：页面需要自有的内联脚本（主题防闪烁 / 初始数据 /
 *   渐进增强）。用户内容先经白名单清洗，`<script>` 标签整体剥离，不可能注入脚本元素。
 * - `script-src-attr 'none'`：禁止一切内联事件处理器与 `javascript:` URL。分享页与 /app
 *   同源（会话 token 在 localStorage），这层是 sanitizer 万一漏一处时的兜底。
 * - `style-src 'unsafe-inline'`：页面内联 `<style>` 与 style 属性（分类主题色等）。
 * - 字体/图标按实际来源放行：Google Fonts、任意 https 图标、data: 内联图。
 */
const SHARE_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https:",
  "img-src 'self' data: https: http:",
  "connect-src 'self' https: wss:",
].join('; ')

const SHARE_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': SHARE_CSP,
}

function sendHtml(res, status, html, extraHeaders) {
  // 分享内容页禁共享缓存：主人加上访问密码后，public/s-maxage 缓存会让未验密
  // 访客在 TTL 内继续拿到加密码前的完整 HTML（绕过 SSR 验密前置判定）。
  // 缓存只保留在函数内 mem-cache，由 get_share_secret 前置判定保护。
  const defaultCacheControl = status === 200 ? 'private, no-store' : 'no-store'
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'x-share-render': 'v2',
    // 私有分享禁止收录（与 <meta name="robots"> 双保险，覆盖不解析 HTML 的爬虫）
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': defaultCacheControl,
    ...SHARE_SECURITY_HEADERS,
    ...extraHeaders,
  })
  res.end(html)
}

function sendText(res, status, text, extraHeaders) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'x-share-render': 'v2',
    ...SHARE_SECURITY_HEADERS,
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
  // POST 仅用于提交访问密码（组分享）；分类分享与其它方法一律拒绝
  const isPost = req.method === 'POST'
  if (!isPost && req.method !== 'GET' && req.method !== 'HEAD') {
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

  // 2026-11-14 审计 #30：多余尾段必须拒绝。原实现忽略 pathParts 的额外段，
  // 却用完整 url.pathname 做缓存键 → 攻击者用 /s/<gid>/<随机段> 可刷出无限
  // 缓存键挤爆 300 条 LRU，把合法分享缓存淘汰，形成对上游 RPC 的请求放大。
  if (pathParts.length !== (isCategory ? 3 : 2)) {
    sendText(res, 400, 'bad request')
    return
  }
  if (pathParts[0] !== 's' || !isValidShareId(id) || (isCategory && !id)) {
    sendText(res, 400, 'bad request')
    return
  }

  const locale = resolveLocale(url, req.headers['accept-language'] || '')

  // ── 访问密码前置判定（组分享）──────────────────────────────────────
  // 必须先问「这组有没有设密码」，再决定要不要读缓存 / 取内容。
  // 反过来的话，「刚加上密码」的组会继续吐上一次缓存的完整内容，密码形同虚设。
  const db = getDb()
  let hasPassword = false
  let passwordHash = null

  if (!isCategory) {
    let sec
    try {
      const r = await db.rpc('get_share_secret', { p_gid: id })
      if (r.error) {
        console.error('[share-ssr] get_share_secret failed:', r.error)
        sendText(res, 503, 'temporarily unavailable', { 'cache-control': 'no-store' })
        return
      }
      sec = r.data
    } catch (e) {
      console.error('[share-ssr] get_share_secret threw:', e)
      sendText(res, 503, 'temporarily unavailable', { 'cache-control': 'no-store' })
      return
    }

    // null = 不存在 / 未公开 / 已删除（与「存在但无密码」严格区分）
    if (!sec) {
      sendHtml(res, 404, renderNotFoundPage(locale), { 'x-share-cache': 'MISS' })
      return
    }
    hasPassword = sec.has_password === true
    passwordHash = sec.password_hash || null

    if (isPost) {
      const backTo = url.pathname
      // 没设密码：POST 无意义，直接回去
      if (!hasPassword) {
        res.writeHead(302, { Location: backTo, 'Cache-Control': 'no-store' })
        res.end()
        return
      }
      if (!SHARE_LOCK_SECRET) {
        sendText(res, 503, 'share password not configured', { 'cache-control': 'no-store' })
        return
      }

      // 爆破防护双层（缺一不可）：
      //  1) (gid, IP) 10 次 / 10 分钟 —— 限制单个客户端；
      //  2) gid 全局 30 次 / 10 分钟 —— 与 IP 无关。网关不回填可信客户端 IP，
      //     X-Real-IP / X-Forwarded-For 可伪造；只有第 1 层时，攻击者每次换头
      //     就得到全新计数桶，可对分享密码做无限次在线爆破。
      const ipHash = sha256Hex(clientIp(req) + '|' + IP_HASH_SALT)
      try {
        const buckets = [
          { key: `share-pass:${id}:${ipHash}`, limit: PASS_TRY_LIMIT },
          { key: `share-pass-gid:${id}`, limit: PASS_TRY_GID_LIMIT },
        ]
        for (const b of buckets) {
          const rl = await db.rpc('consume_rate_limit', {
            p_key: b.key,
            p_limit: b.limit,
            p_window_secs: PASS_TRY_WINDOW_SEC,
          })
          if (rl.error) {
            console.error('[share-ssr] pass rate limit failed (fail-closed):', rl.error)
            sendText(res, 503, 'temporarily unavailable', { 'cache-control': 'no-store' })
            return
          }
          // 本仓已知坑：拒绝时 data 可能是 {} 而非 false —— 必须显式判 true
          if (rl.data !== true) {
            sendHtml(res, 429, renderPasswordGate(locale, { error: true }), {
              'cache-control': 'no-store',
              'Retry-After': String(PASS_TRY_WINDOW_SEC),
            })
            return
          }
        }
      } catch (e) {
        console.error('[share-ssr] pass rate limit threw:', e)
        sendText(res, 503, 'temporarily unavailable', { 'cache-control': 'no-store' })
        return
      }

      const pw = await readPasswordForm(req)
      // 验密不套用「新密码最短长度」：历史上允许 4 位，抬高下限后旧分享必须仍可解锁。
      // 表单体上限 4KB 已挡超长输入，verifyPassword 对畸形摘要/异常格式一律 fail-closed。
      const passed = verifyPassword(pw, passwordHash)
      if (!passed) {
        sendHtml(res, 401, renderPasswordGate(locale, { error: true }), {
          'cache-control': 'no-store',
        })
        return
      }

      const ticket = makeTicket(id, SHARE_LOCK_SECRET)
      res.writeHead(302, {
        Location: backTo,
        'Set-Cookie': buildTicketCookie(id, ticket),
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      })
      res.end()
      return
    }
  } else if (isPost) {
    // 分类分享暂不支持访问密码
    sendText(res, 405, 'method not allowed', { Allow: 'GET, HEAD' })
    return
  }

  // 分类分享的 layout 自适应（与 s/c/[sid].ts 同口径；无显式 layout 时按设备类型隔离缓存键）。
  // 缓存键只纳入真正影响渲染结果的参数：组分享不依赖 query；分类只依赖 layout / 设备类型。
  // 其余 query（utm_*、随机串等）一律忽略——否则 /s/<gid>?x=<random> 可刷出无限缓存键，
  // 把 mem-cache 的 300 条上限挤爆并对上游 RPC 形成请求放大。
  let cacheSearch = ''
  let layout = null
  if (isCategory) {
    const rawLayout = url.searchParams.get('layout')
    const isMobile = isMobileRequest(req)
    const explicitLayout =
      rawLayout === 'list' || rawLayout === 'mini-grid' || rawLayout === 'grid' ? rawLayout : null
    layout = explicitLayout || (isMobile ? 'list' : 'grid')
    cacheSearch = explicitLayout ? `?layout=${explicitLayout}` : `?_dev=${isMobile ? 'm' : 'd'}`
  }

  // 2026-11-14 审计 #30：缓存键用规范化路径（只含 id），不再用原始 pathname，
  // 避免任何残留的尾段/编码差异生成等价但不同的键。
  const cacheKey = `${isCategory ? '/s/c/' : '/s/'}${id}${cacheSearch}|${locale}`

  // 有密码的组：先验票据。
  // 未通过 → 只吐密码门（可缓存，但与内容缓存键分离）；
  // 通过   → 跳过内容缓存（不读也不写），否则内容会被缓存给后续未验密的人。
  let passOk = false
  if (hasPassword) {
    if (!SHARE_LOCK_SECRET) {
      sendText(res, 503, 'share password not configured', { 'cache-control': 'no-store' })
      return
    }
    const cookies = parseCookies(req.headers.cookie)
    passOk = checkTicket(cookies[ticketCookieName(id)], id, SHARE_LOCK_SECRET)
    if (!passOk) {
      const gateKey = `${cacheKey}|gate`
      const gateHit = getFresh(gateKey)
      if (gateHit) {
        sendHtml(res, 200, gateHit, { 'x-share-cache': 'HIT' })
        return
      }
      const gateHtml = renderPasswordGate(locale)
      putShare(gateKey, gateHtml)
      sendHtml(res, 200, gateHtml, { 'x-share-cache': 'MISS' })
      return
    }
  } else {
    // 2026-11-14 审计 #28：分类分享不读内容缓存。
    // 分类路径的 get_share_secret 前置判定被 `if (!isCategory)` 跳过，hasPassword
    // 恒 false；一旦分类下某组加密码 / 取消公开，旧 HTML 仍会在 300s fresh +
    // 24h stale 内对未验密访客可见，且 mem-cache 无失效接口。分类访问量低，
    // 直接每次回源（SQL 层 20261114000002 已补密码过滤），用实时性换安全。
    if (!isCategory) {
      const hit = getFresh(cacheKey)
      if (hit) {
        sendHtml(res, 200, hit, { 'x-share-cache': 'HIT' })
        return
      }
    }
  }

  // 数据：公开读走 SECURITY DEFINER RPC（列级隔离，已排除 username/password/user_id）
  let data = null
  let upstreamFailed = false
  try {
    const r = isCategory
      ? await db.rpc('get_public_category', { p_share_id: id })
      : await db.rpc('get_public_group_verified', { p_gid: id })
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
    // 分类页同样不读 stale（见 #28），避免 24h 前含旧组内容的副本被回吐。
    const stale = isCategory ? null : getStale(cacheKey)
    if (stale) {
      // 2026-11-14 审计 #6：分享内容页任何路径都不得标 public / s-maxage。
      // 原实现在「无密码」时下发 public,max-age=60，主人随后加密码后 TTL 内
      // 共享缓存可直接把加密码前的完整 HTML 给未验密访客，绕过验密前置判定。
      sendHtml(res, 200, stale, {
        'x-share-cache': 'STALE',
        'cache-control': 'private, no-store',
      })
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

  // 分类分享不写内容缓存（#28）；带密码的组也不写（凭票据可见）。
  if (!hasPassword && !isCategory) {
    putShare(cacheKey, html)
  }
  // 已验密的页面属于「凭票据可见」，不允许任何中间层缓存
  sendHtml(
    res,
    200,
    html,
    hasPassword
      ? { 'x-share-cache': 'BYPASS', 'cache-control': 'private, no-store' }
      : { 'x-share-cache': 'MISS' },
  )
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log('[share-ssr] listening on :' + PORT)
})
