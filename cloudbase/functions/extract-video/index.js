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
const { isOriginAllowed, buildCorsHeaders } = require('./ssrf-guard.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || ''
const RATE_LIMIT_PER_MIN = parseInt(process.env.EXTRACT_VIDEO_RATE_LIMIT_PER_MIN || '20', 10)
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.EXTRACT_VIDEO_TIMEOUT_MS || '12000', 10)
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

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'] || ''
  const first = String(xff).split(',')[0]?.trim()
  return first || req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] || 'unknown'
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

async function fetchJson(url, signal) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    return null
  }
}

async function fetchText(url, signal) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })
    if (!res.ok) return null
    return await res.text()
  } catch (e) {
    return null
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
    // 限流 fail-closed：转发层宁可暂时不可用，也不无限放行
    const ipHash = sha256Hex(clientIp(req) + '|' + IP_HASH_SALT)
    const db = getDb()
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

    const signal = upstreamAbort.signal
    const resolved = await resolveShortLink(parsed, signal)
    const platform = detectPlatform(resolved)

    // B站适配器：view API + 热评 + CC 字幕 + 官方 AI 语音小结
    if (platform === 'bilibili') {
      const ids = parseBilibiliVideoId(resolved)
      const viewQuery = ids.bvid ? 'bvid=' + ids.bvid : 'aid=' + ids.aid
      const view = parseBilibiliView(
        await fetchJson('https://api.bilibili.com/x/web-interface/view?' + viewQuery, signal),
      )
      if (view) {
        const conclusionQuery = view.cid
          ? (ids.bvid ? 'bvid=' + ids.bvid + '&cid=' + view.cid : 'aid=' + view.aid + '&cid=' + view.cid)
          : null
        const results = await Promise.all([
          fetchJson('https://api.bilibili.com/x/v2/reply?type=1&oid=' + view.aid + '&sort=1&ps=20&pn=1', signal),
          conclusionQuery
            ? fetchJson('https://api.bilibili.com/x/web-interface/view/conclusion/get?' + conclusionQuery, signal)
            : Promise.resolve(null),
          ...view.subtitleUrls.slice(0, 2).map((u) => fetchText(u, signal)),
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

        sendJson(res, 200, {
          source: 'bilibili',
          url: resolved.href,
          title: view.title,
          description: view.desc,
          subtitles,
          comments: parseBilibiliComments(commentsJson),
          degraded: false,
        }, cors)
        return
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
          url: resolved.href,
          title: video.title,
          description: video.description,
          subtitles: '',
          comments: parseYouTubeComments(results[1]),
          degraded: false,
        }, cors)
        return
      }
    }

    // 通用降级：r.jina.ai 抓取（长尾平台 / 平台风控 / 无 YouTube key）
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
            url: resolved.href,
            title: titleMatch ? titleMatch[1].trim() : '',
            description: descMatch ? descMatch[1].trim() : '',
            subtitles: '',
            comments: [],
            markdown: text.slice(0, GENERIC_MAX_CHARS),
            degraded: true,
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
