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
import { isCloudBaseBackend, edgeFnUrl } from '../cloudbase.js'
import { getApiToken } from '../authDriver.js'
import { toast } from '../toast.js'
import { askMiMo, sanitizeForPrompt } from './mimoClient.js'
import { getLocale, t } from '../../i18n/index.js'
import type { Category, CustomAttribute } from '../../types.js'
import type { AiCandidateBookmark } from '../../types/ai.js'

/** extract-video Edge Function 返回的统一内容结构 */
export interface VideoExtractServerResult {
  source: VideoExtractSource
  url: string
  title: string
  description: string
  subtitles: string
  comments: string[]
  /** 仅 generic 路径填充：完整 Markdown 正文 */
  markdown?: string
  /** 是否走了通用降级路径（平台 API 不可用/风控时服务端如实标注） */
  degraded: boolean
  /** 服务端判定今日视频解析额度已用完（调用方应停止继续抓取并提示用户） */
  quotaExceeded?: boolean
  /** 触发配额时的每日上限（免费 1 / PRO 10） */
  quotaLimit?: number
}

/** 服务端可识别的来源：专用适配器 + yt-dlp 微服务归一后的平台标识 */
export type VideoExtractSource =
  | 'bilibili'
  | 'youtube'
  | 'douyin'
  | 'tiktok'
  | 'xiaohongshu'
  | 'x'
  | 'generic'

/** 视频/图文笔记平台域名（命中即优先走视频解析链路，而不是当普通网页抓取） */
const VIDEO_PLATFORM_HOSTS = [
  'douyin.com',
  'iesdouyin.com',
  'tiktok.com',
  'xiaohongshu.com',
  'xhslink.com',
  'bilibili.com',
  'b23.tv',
  'youtube.com',
  'youtu.be',
  'x.com',
  'twitter.com',
  'vimeo.com',
  'dailymotion.com',
  'kuaishou.com',
  'weibo.com',
  'ixigua.com',
  'acfun.cn',
  'twitch.tv',
  'youku.com',
  'iqiyi.com',
  'mgtv.com',
  'douyu.com',
  'huya.com',
]

const VIDEO_SHORT_LINK_HOSTS = ['v.douyin.com', 'vm.tiktok.com', 'vt.tiktok.com', 'b23.tv', 'bili2233.cn', 'xhslink.com']

/** 是否是视频/图文笔记平台链接（含分享短链） */
export function isVideoPlatformUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return [...VIDEO_PLATFORM_HOSTS, ...VIDEO_SHORT_LINK_HOSTS].some(
      (h) => host === h || host.endsWith('.' + h)
    )
  } catch {
    return false
  }
}

/** 把服务端结构化内容拼成给大模型阅读的纯文本（空内容返回空串） */
export function buildVideoContentText(result: VideoExtractServerResult): string {
  const parts: string[] = []
  if (result.title) parts.push(`标题：${result.title}`)
  if (result.description) parts.push(`简介：${result.description}`)
  if (result.subtitles) parts.push(`字幕：${result.subtitles}`)
  if (result.comments.length) parts.push(`评论区：${result.comments.join('\n')}`)
  if (result.markdown) parts.push(result.markdown)
  return parts.join('\n\n')
}

/**
 * 优先走服务端 extract-video Edge Function 提取视频简介/字幕/评论区。
 * 失败（未登录/未配置/网络/服务端错误）返回 null，调用方降级本地链路。
 */
export async function fetchVideoExtractServer(
  targetUrl: string,
  options: { signal?: AbortSignal } = {}
): Promise<VideoExtractServerResult | null> {
  if (!targetUrl) return null
  const cbMode = isCloudBaseBackend()
  if (!cbMode && !isSupabaseConfigured) return null

  try {
    let authHeaders: Record<string, string> = {}
    if (cbMode) {
      // 日配额按 uid 计量：必须带上 CloudBase 登录 token（匿名请求只会拿到匿名额度）
      const token = await getApiToken()
      if (token) authHeaders.Authorization = `Bearer ${token}`
    } else {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) return null
      authHeaders = {
        Authorization: `Bearer ${token}`,
        apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '',
      }
    }

    const endpoint = edgeFnUrl('extract-video')
    if (!endpoint) return null
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({ url: targetUrl }),
      signal: options.signal,
    })

    // 429：今日额度用完，不当作普通失败（调用方不得再降级去抓取，否则等于绕过配额）
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { quota?: { limit?: unknown } }
      const limit = typeof body.quota?.limit === 'number' ? body.quota.limit : undefined
      toast(t('ai.videoQuotaExceeded', limit != null ? { limit } : {}), false)
      return {
        source: 'generic',
        url: targetUrl,
        title: '',
        description: '',
        subtitles: '',
        comments: [],
        degraded: true,
        quotaExceeded: true,
        quotaLimit: limit,
      }
    }
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

/** 注入提示词的内容截断上限：总结只需要概要，不做全量内容外送。
 *  上限须与转发层单条消息上限对齐（mimo-guard MAX_MESSAGE_CHARS_DEFAULT = 4000）：
 *  模板文案（~120）+ 问题（≤200）+ 内容（≤3500）合计不超限，否则超长视频的总结
 *  会被 guard 413 整条拒绝、静默失效。 */
const SUMMARY_MAX_INPUT_CHARS = 3500
/** 用户问题注入提示词前的截断上限：问题只需短句，超长按噪声处理 */
const SUMMARY_MAX_QUESTION_CHARS = 200
/** 内容太短没有总结价值的下限 */
const SUMMARY_MIN_INPUT_CHARS = 40

export interface VideoAiInsight {
  summary: string | null
  candidates: AiCandidateBookmark[]
}

/**
 * 视频内容深度 AI 洞察：同时提炼速览摘要与文中提及的工具/网站候选卡片。
 * 若内容中仅提及工具名称而未附带完整网址，大模型将根据知识库补全官方主页。
 */
export async function extractVideoInsightsWithAI(
  contentText: string,
  categories: Category[] = [],
  attributes: CustomAttribute[] = [],
  options: { signal?: AbortSignal; question?: string } = {}
): Promise<VideoAiInsight> {
  const trimmed = (contentText || '').trim()
  if (trimmed.length < SUMMARY_MIN_INPUT_CHARS) {
    return { summary: null, candidates: [] }
  }

  const cbMode = isCloudBaseBackend()
  if (!cbMode && !isSupabaseConfigured) {
    return { summary: null, candidates: [] }
  }

  const isZh = getLocale().startsWith('zh')
  const safeText = sanitizeForPrompt(trimmed, SUMMARY_MAX_INPUT_CHARS)
  const safeQuestion = (options.question || '').trim()
    ? sanitizeForPrompt(options.question!.trim(), SUMMARY_MAX_QUESTION_CHARS)
    : ''

  const cardFmtZh = '\n若内容中提及、演示或推荐了具体的工具、软件、网站或开源项目，请结合你的知识库补全其官方主页 URL，并在回复末尾以如下格式输出结构化卡片（没有则不输出）：\n```ulink-card\n[\n  { "title": "工具名", "url": "https://...", "notes": "核心功能" }\n]\n```'
  const cardFmtEn = '\nIf any tools, software, websites, or open-source projects are mentioned or shown, complete their official homepages and output structured cards at the end (omit if none):\n```ulink-card\n[\n  { "title": "Tool Name", "url": "https://...", "notes": "Core feature" }\n]\n```'

  const prompt = safeQuestion
    ? (isZh
        ? `用户提问：${safeQuestion}\n以下是一段视频/图文内容的公开文本（简介、字幕、语音转写/AI小结、评论等）。请基于给定内容回答用户提问，列出出现的网站与工具（附网址），不超过 160 字：${cardFmtZh}\n\n${safeText}`
        : `User question: ${safeQuestion}\nBelow is public text from a video or post. Answer the question and list mentioned websites/tools, under 120 words:${cardFmtEn}\n\n${safeText}`)
    : (isZh
        ? `以下是一段视频/图文分享内容的公开文本（简介、字幕、语音转写/AI小结、评论等）。请用中文提炼其中推荐的网站/工具与核心要点，不超过 130 字：${cardFmtZh}\n\n${safeText}`
        : `Below is public text from a video or post. Summarize the websites/tools mentioned and key points, under 90 words:${cardFmtEn}\n\n${safeText}`)

  try {
    const res = await askMiMo(prompt, {
      categories,
      customAttributes: attributes,
      isZh,
      signal: options.signal,
      enableTools: false,
    })
    const text = (res.cleanText || '').trim()
    return {
      summary: text || null,
      candidates: res.candidates || [],
    }
  } catch {
    return { summary: null, candidates: [] }
  }
}

export interface GenerateVideoSummaryOptions {
  signal?: AbortSignal
  question?: string
  categories?: Category[]
  attributes?: CustomAttribute[]
  onCandidates?: (candidates: AiCandidateBookmark[]) => void
}

/**
 * 文字源总结：对简介/字幕/评论区文本生成一段速览（仅基于给定文本，不编造）。
 * 保持向下兼容既有调用方签名，同时支持通过 onCandidates 回传大模型提炼的结构化工具卡片。
 */
export async function generateVideoSummary(
  contentText: string,
  options: GenerateVideoSummaryOptions = {}
): Promise<string | null> {
  const result = await extractVideoInsightsWithAI(
    contentText,
    options.categories || [],
    options.attributes || [],
    { signal: options.signal, question: options.question }
  )
  if (result.candidates && result.candidates.length > 0) {
    options.onCandidates?.(result.candidates)
  }
  return result.summary
}
