/**
 * videoExtract.ts — 视频深度提取的前端服务端客户端
 *
 * 1. fetchVideoExtractServer：调用 extract-video Edge Function（Cloudflare 海外节点转发抓取，
 *    不受国内网络 r.jina.ai 直连不可用的限制），平台适配器返回简介/字幕/评论区结构化文本。
 *    未登录/未配置/请求失败一律返回 null，由调用方降级本地 Jina 链路，绝不伪造结果。
 * 2. generateVideoSummary：文字源总结（简介/字幕/评论区文本 → 大模型），输入注入提示词前
 *    统一消毒截断（防页面内容全量泄露进提示词），失败返回 null 不阻塞链接提取。
 */

import { supabase, isSupabaseConfigured } from '../supabase.js'
import { askMiMo, getMiMoConfig, sanitizeForPrompt } from './mimoClient.js'
import { getLocale } from '../../i18n/index.js'

/** extract-video Edge Function 返回的统一内容结构 */
export interface VideoExtractServerResult {
  source: 'bilibili' | 'youtube' | 'generic'
  url: string
  title: string
  description: string
  subtitles: string
  comments: string[]
  /** 仅 generic 路径填充：完整 Markdown 正文 */
  markdown?: string
  /** 是否走了通用降级路径（平台 API 不可用/风控时服务端如实标注） */
  degraded: boolean
}

/**
 * 优先走服务端 extract-video Edge Function 提取视频简介/字幕/评论区。
 * 失败（未登录/未配置/网络/服务端错误）返回 null，调用方降级本地链路。
 */
export async function fetchVideoExtractServer(
  targetUrl: string,
  options: { signal?: AbortSignal } = {}
): Promise<VideoExtractServerResult | null> {
  if (!targetUrl || !isSupabaseConfigured) return null

  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) return null

    const fnBase = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || '').replace(/\/+$/, '')
    const res = await fetch(`${fnBase}/functions/v1/extract-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '',
      },
      body: JSON.stringify({ url: targetUrl }),
      signal: options.signal,
    })
    if (!res.ok) return null

    const data = await res.json()
    if (!data || typeof data !== 'object') return null
    return {
      source: (data.source as VideoExtractServerResult['source']) || 'generic',
      url: typeof data.url === 'string' ? data.url : targetUrl,
      title: typeof data.title === 'string' ? data.title : '',
      description: typeof data.description === 'string' ? data.description : '',
      subtitles: typeof data.subtitles === 'string' ? data.subtitles : '',
      comments: Array.isArray(data.comments) ? data.comments.filter((c: unknown) => typeof c === 'string') : [],
      markdown: typeof data.markdown === 'string' ? data.markdown : undefined,
      degraded: Boolean(data.degraded),
    }
  } catch {
    return null
  }
}

/** 注入提示词的内容截断上限：总结只需要概要，不做全量内容外送 */
const SUMMARY_MAX_INPUT_CHARS = 6000
/** 内容太短没有总结价值的下限 */
const SUMMARY_MIN_INPUT_CHARS = 40

/**
 * 文字源总结：对简介/字幕/评论区文本生成一段速览（仅基于给定文本，不编造）。
 * 无可用 AI 通道（未登录且无 BYOK）或请求失败时返回 null，调用方跳过总结。
 */
export async function generateVideoSummary(
  contentText: string,
  options: { signal?: AbortSignal } = {}
): Promise<string | null> {
  const trimmed = (contentText || '').trim()
  if (trimmed.length < SUMMARY_MIN_INPUT_CHARS) return null

  // 无可用通道时直接跳过，不做注定失败的请求
  const conf = getMiMoConfig()
  if (!conf.apiKey && !isSupabaseConfigured) return null

  const isZh = getLocale().startsWith('zh')
  const safeText = sanitizeForPrompt(trimmed, SUMMARY_MAX_INPUT_CHARS)
  const prompt = isZh
    ? `以下是一段视频/图文分享内容的公开文本（简介、字幕、评论等）。请用中文提炼其中推荐的网站/工具与核心要点，不超过 120 字，只基于给定内容，不要编造：\n\n${safeText}`
    : `Below is public text from a video or post (description, subtitles, comments). Summarize the websites/tools mentioned and key points in English, under 80 words, using only the given content:\n\n${safeText}`

  try {
    const res = await askMiMo(prompt, {
      categories: [],
      customAttributes: [],
      isZh,
      signal: options.signal,
      enableTools: false,
    })
    const text = (res.cleanText || '').trim()
    return text || null
  } catch {
    return null
  }
}
