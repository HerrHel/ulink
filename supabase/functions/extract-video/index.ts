import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  validateInputUrl,
  isUrlDnsSafe,
  detectPlatform,
  isShortLinkHost,
  parseBilibiliVideoId,
  parseYouTubeVideoId,
  parseBilibiliView,
  parseBilibiliComments,
  parseBilibiliSubtitleDoc,
  parseYouTubeVideo,
  parseYouTubeComments,
} from './video-adapters.ts'
import {
  isOriginAllowed,
  buildCorsHeaders,
} from '../check-link/ssrf-guard.ts'

/**
 * extract-video — 视频内容「简介/字幕/评论区」服务端转发提取
 *
 * 背景：本机直连 r.jina.ai 在国内网络长期不可用，故抓取统一从 Cloudflare 海外节点转发。
 * 职责：
 * 1. 平台适配器：B站（view API 简介 + x/v2/reply 热评 + CC 字幕）、
 *    YouTube Data API v3（需 YOUTUBE_API_KEY，未配置则降级）；
 * 2. 长尾平台/适配器失败 → r.jina.ai 通用抓取降级（degraded=true 如实标注）；
 * 3. 鉴权 + 每用户限流（034 consume_rate_limit，fail-closed——转发层不做 fail-open）；
 * 4. CORS fail-closed（复用 check-link/ssrf-guard.ts 真源，deploy 打包相对导入）。
 *
 * 能力边界：只提取公开可读的文字内容，不做 ASR 语音识别 / 画面 OCR。
 * 隐私：目标 URL 会发送给第三方 r.jina.ai 与对应平台公开 API（降级/通用路径）。
 *
 * secrets（supabase secrets set）：
 *   ALLOWED_ORIGINS / EXTRACT_VIDEO_RATE_LIMIT_PER_MIN / EXTRACT_VIDEO_TIMEOUT_MS
 *   YOUTUBE_API_KEY（可选，未配置时 YouTube 链接走通用降级）
 */

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').filter(Boolean)
const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY') || ''
/** 每用户限流（次/分钟），默认 20：视频深挖是低频重抓取操作，更高频视为滥用 */
const RATE_LIMIT_PER_MIN = parseInt(Deno.env.get('EXTRACT_VIDEO_RATE_LIMIT_PER_MIN') || '20', 10)
/** 单次上游抓取超时（ms） */
const UPSTREAM_TIMEOUT_MS = parseInt(Deno.env.get('EXTRACT_VIDEO_TIMEOUT_MS') || '12000', 10)
/** 通用降级抓取（Jina）读取上限：覆盖简介/字幕/评论区文本 */
const GENERIC_MAX_CHARS = 30000
/** 短链解析最大重定向跳数 */
const MAX_SHORT_LINK_HOPS = 5

const BROWSER_UA = 'Mozilla/5.0 (compatible; ulink-extract/1.0; +https://ulink.ren)'

/** Deno DNS resolver 注入（isUrlDnsSafe 可测性：纯逻辑侧不直接依赖 Deno API） */
const denoDnsResolver = {
  resolve: (hostname: string, type: 'A' | 'AAAA') => Deno.resolveDns(hostname, type),
}

/**
 * 短链解析：对已知分享短链域（b23.tv 等）逐跳跟随重定向到 canonical 视频页 URL，
 * 之后才能命中 B站/YouTube 平适配器拿简介/字幕/评论（否则只会 generic 抓跳板页，答非所问）。
 * 每跳 Location 重新走 validateInputUrl 校验（短链可被任意人构造，重定向指向内网即
 * fail-closed 中止解析，返回上一跳合法 URL）；fetch 前再做 DNS 重绑定校验
 * （isUrlDnsSafe，解析到内网/解析失败一律中止）；非短链域原样返回；网络失败保持原 URL
 * 不劣于修复前行为（落 generic 降级）。
 */
async function resolveShortLink(parsed: URL, signal: AbortSignal): Promise<URL> {
  if (!isShortLinkHost(parsed.hostname)) return parsed
  let current = parsed
  for (let hop = 0; hop < MAX_SHORT_LINK_HOPS; hop++) {
    // DNS 重绑定校验 fail-closed：目标解析到内网或解析失败即中止，返回上一跳已确认安全 URL
    if (!(await isUrlDnsSafe(current, denoDnsResolver))) break
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
    } catch {
      break
    }
  }
  return current
}

/** 带超时的 GET JSON；失败返回 null（不抛，降级路径自行兜底） */
async function fetchJson(url: string, signal: AbortSignal): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** 带超时的 GET 文本（CC 字幕文档）；失败返回 null */
async function fetchText(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json, text/plain' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = buildCorsHeaders(origin, ALLOWED_ORIGINS)
  const jsonHeaders = { ...cors, 'Content-Type': 'application/json' }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: isOriginAllowed(origin, ALLOWED_ORIGINS) ? 200 : 403, headers: cors })
  }

  // 客户端断连 / 函数终止 → 取消所有上游抓取
  const upstreamAbort = new AbortController()
  const onClientAbort = () => upstreamAbort.abort()
  req.signal.addEventListener('abort', onClientAbort)
  Deno.addSignalListener?.('SIGTERM', onClientAbort)

  try {
    // 鉴权（对齐 check-link / mimo-chat）
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
    }

    // 限流 fail-closed：转发层宁可暂时不可用，也不做无限放行（对齐 mimo-chat）
    const { data: rlAllowed, error: rlError } = await supabase.rpc('consume_rate_limit', {
      p_key: `extract-video:${user.id}`,
      p_limit: RATE_LIMIT_PER_MIN,
      p_window_secs: 60,
    })
    if (rlError) {
      console.error('[extract-video] rate limit rpc failed (fail-closed):', rlError)
      return new Response(
        JSON.stringify({ error: '提取服务暂时不可用，请稍后再试' }),
        { status: 503, headers: jsonHeaders }
      )
    }
    if (rlAllowed === false) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded' }),
        { status: 429, headers: { ...jsonHeaders, 'Retry-After': '60' } }
      )
    }

    let body: { url?: unknown }
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders })
    }
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''

    let parsed: URL
    try {
      parsed = validateInputUrl(rawUrl)
    } catch (e) {
      return new Response(
        JSON.stringify({ error: (e as Error).message || 'Invalid URL' }),
        { status: 400, headers: jsonHeaders }
      )
    }

    const signal = upstreamAbort.signal
    // 短链（b23.tv 等）先解析到 canonical 视频页再识别平台：
    // 不解析则 b23.tv 命中不了 BV 号，只能 generic 抓跳板页（答非所问根因）
    const resolved = await resolveShortLink(parsed, signal)
    const platform = detectPlatform(resolved)

    // ── B站适配器：view API（简介/字幕列表）+ 热评 + CC 字幕 ──
    if (platform === 'bilibili') {
      const ids = parseBilibiliVideoId(resolved)!
      const viewQuery = ids.bvid ? `bvid=${ids.bvid}` : `aid=${ids.aid}`
      const view = parseBilibiliView(
        await fetchJson(`https://api.bilibili.com/x/web-interface/view?${viewQuery}`, signal)
      )
      if (view) {
        // 热评按 aid 查（与 view 并行依赖，串行一步）；字幕文档最多取 2 份（优先 CC 官方）
        const [commentsJson, ...subtitleDocs] = await Promise.all([
          fetchJson(`https://api.bilibili.com/x/v2/reply?type=1&oid=${view.aid}&sort=1&ps=20&pn=1`, signal),
          ...view.subtitleUrls.slice(0, 2).map(u => fetchText(u, signal)),
        ])
        const subtitles = subtitleDocs
          .map(d => (d ? parseBilibiliSubtitleDoc(d) : ''))
          .filter(Boolean)
          .join('\n')
        return new Response(
          JSON.stringify({
            source: 'bilibili',
            url: resolved.href,
            title: view.title,
            description: view.desc,
            subtitles,
            comments: parseBilibiliComments(commentsJson),
            degraded: false,
          }),
          { status: 200, headers: jsonHeaders }
        )
      }
      // view API 失败（风控/下架）→ 落入通用降级，degraded 如实标注
    }

    // ── YouTube 适配器：Data API v3（需 key，未配置则降级）──
    if (platform === 'youtube' && YOUTUBE_API_KEY) {
      const vid = parseYouTubeVideoId(resolved)!
      const key = encodeURIComponent(YOUTUBE_API_KEY)
      const [videoJson, commentsJson] = await Promise.all([
        fetchJson(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${vid}&key=${key}`, signal),
        fetchJson(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${vid}&order=relevance&maxResults=20&key=${key}`, signal),
      ])
      const video = parseYouTubeVideo(videoJson)
      if (video) {
        return new Response(
          JSON.stringify({
            source: 'youtube',
            url: resolved.href,
            title: video.title,
            description: video.description,
            subtitles: '', // YouTube 字幕无免鉴权 API，不伪造；空串 = 本次未取到
            comments: parseYouTubeComments(commentsJson),
            degraded: false,
          }),
          { status: 200, headers: jsonHeaders }
        )
      }
    }

    // ── 通用降级：服务端 r.jina.ai 抓取（长尾平台 / 平台 API 风控 / 无 YouTube key）──
    // 用解析后的 canonical URL 抓取（短链跳板页不含正文）
    try {
      const res = await fetch(`https://r.jina.ai/${resolved.href}`, {
        headers: { 'Accept': 'text/markdown, text/plain, */*', 'X-No-Cache': 'true' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      })
      if (res.ok) {
        const text = await res.text()
        if (text && text.trim()) {
          const titleMatch = text.match(/^Title:\s*(.+)$/im) || text.match(/^#\s+(.+)$/m)
          const descMatch = text.match(/^Description:\s*(.+)$/im)
          return new Response(
            JSON.stringify({
              source: 'generic',
              url: resolved.href,
              title: titleMatch ? titleMatch[1].trim() : '',
              description: descMatch ? descMatch[1].trim() : '',
              subtitles: '',
              comments: [],
              markdown: text.slice(0, GENERIC_MAX_CHARS),
              degraded: true,
            }),
            { status: 200, headers: jsonHeaders }
          )
        }
      }
      // 空内容/非 2xx：如实回错误，交客户端本地降级链路
      return new Response(
        JSON.stringify({ error: `页面读取失败 (HTTP ${res.status})` }),
        { status: 502, headers: jsonHeaders }
      )
    } catch {
      return new Response(
        JSON.stringify({ error: '页面读取超时或网络异常' }),
        { status: 502, headers: jsonHeaders }
      )
    }
  } catch (error) {
    console.error('[extract-video] internal error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: jsonHeaders }
    )
  } finally {
    req.signal.removeEventListener('abort', onClientAbort)
  }
})
