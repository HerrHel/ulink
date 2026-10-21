/**
 * video-adapters.ts — 视频平台适配器纯逻辑（无 Deno / 无网络依赖，可被 vitest 单测）。
 *
 * 被 supabase/functions/extract-video/index.ts 引用，真源唯一，勿在 index.ts 内联镜像
 * （与 check-link/ssrf-guard.ts 同一可测性约定：本文件不 import 任何 Deno 或 fetch API，
 * 真源经 src/__tests__/lib/videoExtractAdapters.test.ts 覆盖）。
 *
 * 能力边界（诚实声明）：只提取「简介 / 字幕(CC) / 评论区」文字内容，
 * 不做语音识别(ASR)、画面 OCR 或视频画面理解。
 */

import { isPrivateHost, isTargetDnsSafeSyncResults } from '../check-link/ssrf-guard.ts'

/** 可识别的视频平台；generic = 非 B站/YouTube 的任意页面（走服务端 Jina 通用抓取） */
export type VideoPlatform = 'bilibili' | 'youtube' | 'generic'

/** 平台适配器提取到的统一内容结构（index.ts 序列化为 JSON 返回前端） */
export interface VideoExtractPayload {
  source: VideoPlatform
  url: string
  title: string
  description: string
  subtitles: string
  comments: string[]
  /** 仅 generic 路径填充：Jina 抓取的完整 Markdown 正文 */
  markdown?: string
  /** 是否走了通用降级路径（平台 API 不可用/风控时如实标注） */
  degraded: boolean
}

// ── URL 校验（轻量版）──
// 本函数从不直接 fetch 用户 URL（只直连固定 API 主机 + r.jina.ai），
// 故不做 check-link 级 DNS 校验；但拒绝内网字面地址，防滥用第三方抓取服务探测内网。

const PRIVATE_LITERAL_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  'metadata.google.internal', 'metadata',
])

/** IPv4 私有/保留段（与 check-link/ssrf-guard.ts 口径一致，仅覆盖点分十进制字面量） */
function isPrivateIPv4Literal(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!m) return false
  const octets = m.slice(1).map(Number)
  if (octets.some(o => Number.isNaN(o) || o > 255)) return false
  const [a, b] = octets
  return (
    a === 127 || a === 10 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

/** 校验输入 URL 形状：http/https、无认证信息、仅 80/443、非内网字面地址。
 *  违规抛 Error（中文消息可直接回给客户端）。 */
export function validateInputUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('URL 必须以 http:// 或 https:// 开头')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL 必须以 http:// 或 https:// 开头')
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL 不得包含认证信息')
  }
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    throw new Error('仅允许 80/443 端口')
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (PRIVATE_LITERAL_HOSTS.has(host) || isPrivateIPv4Literal(host) || host.includes(':')) {
    throw new Error('不允许访问内网地址')
  }
  return parsed
}

// ── DNS 重绑定校验（fail-closed）──
// validateInputUrl 只拦字面 IP：指向内网的域名（解析到 127./10./169.254. 等）
// 能绕过字面拦截，短链重定向逐跳 fetch 会形成盲 SSRF 面，故每跳 fetch 前须 DNS 校验。
// 私有段判定真源复用 check-link/ssrf-guard.ts（唯一真源）。

/** DNS resolver 接口：注入以解耦 Deno API（同 ssrf-guard.DnsResolver 口径），便于单测 */
export interface DnsResolver {
  resolve(hostname: string, type: 'A' | 'AAAA'): Promise<string[]>
}

/**
 * DNS 重绑定校验：非 IP 字面量 hostname 解析 A/AAAA，任一私有记录、解析失败
 * 或无记录一律判不安全（fail-closed，绝不「校验失败仍 fetch」）。
 * IP 字面量无需解析：私有段已由 isPrivateHost 全量覆盖，公网字面量即最终地址。
 */
export async function isUrlDnsSafe(parsed: URL, resolver: DnsResolver): Promise<boolean> {
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (isPrivateHost(host)) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return true
  try {
    const records = [
      ...(await resolver.resolve(host, 'A')),
      ...(await resolver.resolve(host, 'AAAA')),
    ]
    return isTargetDnsSafeSyncResults(host, records)
  } catch {
    return false
  }
}

// ── 平台识别 ──

/** 已知视频分享短链域：需先跟随重定向解析到 canonical 视频页，才能命中平台适配器；
 *  不解析直接抓只会拿到跳板页（generic 降级的答非所问根因） */
const SHORT_LINK_HOSTS = new Set([
  'b23.tv', 'bili2233.cn',
  'v.douyin.com', 'vm.tiktok.com', 'vt.tiktok.com',
  'xhslink.com',
])

/** 是否为已知分享短链域（index.ts 据此做重定向解析，纯函数可测） */
export function isShortLinkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  return SHORT_LINK_HOSTS.has(host)
}

/** B站视频 ID：BV 号或 av 号（仅 /video/ 路径；b23.tv 等短链先经 resolveShortLink 解析后再进本函数） */
export function parseBilibiliVideoId(u: URL): { bvid?: string; aid?: string } | null {
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'bilibili.com' && !host.endsWith('.bilibili.com')) return null
  const m = /\/video\/(BV[0-9A-Za-z]+|av\d+)/i.exec(u.pathname)
  if (!m) return null
  const id = m[1]
  return /^BV/i.test(id) ? { bvid: id } : { aid: id.replace(/^av/i, '') }
}

/** YouTube 视频 ID：watch?v= / youtu.be/ / shorts/ / embed/ */
export function parseYouTubeVideoId(u: URL): string | null {
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'youtu.be') {
    const seg = u.pathname.split('/').filter(Boolean)[0]
    return seg && /^[\w-]{6,}$/.test(seg) ? seg : null
  }
  if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return null
  const v = u.searchParams.get('v')
  if (v && /^[\w-]{6,}$/.test(v)) return v
  const m = /^\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname)
  return m ? m[1] : null
}

export function detectPlatform(u: URL): VideoPlatform {
  if (parseBilibiliVideoId(u)) return 'bilibili'
  if (parseYouTubeVideoId(u)) return 'youtube'
  return 'generic'
}

// ── B站响应解析 ──

export interface BilibiliViewInfo {
  title: string
  desc: string
  aid: number
  cid: number
  subtitleUrls: string[]
}

/** api.bilibili.com/x/web-interface/view 响应 → 标题/简介/aid/cid/字幕 URL 列表 */
export function parseBilibiliView(json: unknown): BilibiliViewInfo | null {
  const data = (json as { code?: number; data?: Record<string, unknown> } | null)?.data
  if (!data || typeof data !== 'object') return null
  const title = typeof data.title === 'string' ? data.title : ''
  const desc = typeof data.desc === 'string' ? data.desc : ''
  const aid = typeof data.aid === 'number' ? data.aid : 0
  const cid = typeof data.cid === 'number'
    ? data.cid
    : (Array.isArray(data.pages) && typeof (data.pages[0] as { cid?: unknown })?.cid === 'number'
      ? (data.pages[0] as { cid: number }).cid
      : 0)
  const subtitleUrls: string[] = []
  const subtitle = data.subtitle as { subtitles?: unknown[] } | undefined
  if (Array.isArray(subtitle?.subtitles)) {
    for (const s of subtitle.subtitles) {
      const u = (s as { subtitle_url?: unknown })?.subtitle_url
      if (typeof u === 'string' && u) {
        // 协议相对 URL（//aisubtitle.hdslb.com/...）补 https
        subtitleUrls.push(u.startsWith('//') ? `https:${u}` : u)
      }
    }
  }
  if (!title && !desc && !aid) return null
  return { title, desc, aid, cid, subtitleUrls }
}

/**
 * B站官方 AI 视频小结 / 视频结论接口 (x/web-interface/view/conclusion/get) 响应解析
 * 提取由平台 ASR 语音识别与模型总结生成的核心速览 (summary) 与按时间戳分段大纲 (outline)，
 * 彻底弥补 UP 主未上传 CC 字幕或纯口播视频的文字源缺失。
 */
export function parseBilibiliAiConclusion(json: unknown): string {
  const data = (json as {
    code?: number
    data?: {
      model_result?: {
        summary?: string
        outline?: Array<{
          title?: string
          part_outline?: Array<{ timestamp?: number; content?: string }>
        }>
      }
    }
  } | null)?.data

  const model = data?.model_result
  if (!model || typeof model !== 'object') return ''

  const lines: string[] = []
  if (typeof model.summary === 'string' && model.summary.trim()) {
    lines.push(`【视频语音核心速览】\n${model.summary.trim()}`)
  }

  if (Array.isArray(model.outline) && model.outline.length > 0) {
    lines.push('【内容分段大纲】')
    for (const sec of model.outline) {
      if (sec?.title && typeof sec.title === 'string' && sec.title.trim()) {
        lines.push(`### ${sec.title.trim()}`)
      }
      if (Array.isArray(sec?.part_outline)) {
        for (const p of sec.part_outline) {
          const timeSec = typeof p?.timestamp === 'number' ? p.timestamp : 0
          const min = Math.floor(timeSec / 60)
          const s = timeSec % 60
          const timeStr = `${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          if (p?.content && typeof p.content === 'string' && p.content.trim()) {
            lines.push(`- [${timeStr}] ${p.content.trim()}`)
          }
        }
      }
    }
  }

  return lines.join('\n')
}

/** api.bilibili.com/x/v2/reply 响应 → 热评文本列表（过滤空串） */
export function parseBilibiliComments(json: unknown): string[] {
  const data = (json as { data?: { replies?: unknown[] } } | null)?.data
  const replies = Array.isArray(data?.replies) ? data!.replies : []
  const out: string[] = []
  for (const r of replies) {
    const msg = (r as { content?: { message?: unknown } })?.content?.message
    if (typeof msg === 'string' && msg.trim()) out.push(msg.trim())
    if (out.length >= 20) break
  }
  return out
}

/** B站 CC 字幕文档（JSON：{ body: [{ content }] }）→ 平铺文本 */
export function parseBilibiliSubtitleDoc(raw: string): string {
  try {
    const doc = JSON.parse(raw) as { body?: unknown[] }
    if (!Array.isArray(doc.body)) return ''
    return doc.body
      .map(seg => ((seg as { content?: unknown })?.content as string) || '')
      .filter(Boolean)
      .join('\n')
  } catch {
    return ''
  }
}

// ── YouTube Data API v3 响应解析 ──

export interface YouTubeSnippet {
  title: string
  description: string
}

/** youtube/v3/videos?part=snippet 响应 → 标题/描述 */
export function parseYouTubeVideo(json: unknown): YouTubeSnippet | null {
  const items = (json as { items?: unknown[] } | null)?.items
  const snippet = Array.isArray(items) && items.length
    ? (items[0] as { snippet?: Record<string, unknown> })?.snippet
    : undefined
  if (!snippet) return null
  return {
    title: typeof snippet.title === 'string' ? snippet.title : '',
    description: typeof snippet.description === 'string' ? snippet.description : '',
  }
}

/** youtube/v3/commentThreads?part=snippet 响应 → 热评文本列表 */
export function parseYouTubeComments(json: unknown): string[] {
  const items = (json as { items?: unknown[] } | null)?.items
  if (!Array.isArray(items)) return []
  const out: string[] = []
  for (const it of items) {
    const text = (it as {
      snippet?: { topLevelComment?: { snippet?: { textDisplay?: unknown } } }
    })?.snippet?.topLevelComment?.snippet?.textDisplay
    if (typeof text === 'string' && text.trim()) out.push(text.trim())
    if (out.length >= 20) break
  }
  return out
}
