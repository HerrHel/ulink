/**
 * videoExtract.ts — 视频深度提取的前端服务端客户端
 *
 * 1. fetchVideoExtractServer：调用 extract-video 云函数解析视频
 *    （平台适配器 → yt-dlp worker → r.jina.ai 兜底），响应如实带
 *    provider / degraded / fallback_reason / duration / uploader / chapters；
 *    未登录/未配置/请求失败一律返回 null，由调用方降级本地链路，绝不伪造结果。
 *    429 需区分「今日额度用完」（body 带 quota）与「每分钟限流」（body 无 quota）。
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

// 平台域名清单唯一真源：src/config/videoPlatforms.json（经 videoPlatforms.ts 派生）。
// 保留从本模块 re-export，兼容既有调用方（useAiChatAgent / 测试等）。
export { isVideoPlatformUrl } from './videoPlatforms.js'

/** extract-video Edge Function 返回的章节结构（yt-dlp info.chapters 归一） */
export interface VideoChapter {
  title: string
  start_time?: number
  end_time?: number
}

/** 服务端实际使用的解析通道（用于用户可见的来源披露与排障） */
export type VideoExtractProvider = 'bilibili-native' | 'youtube-api' | 'worker' | 'jina'

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
  /** 服务端实际使用的解析通道（契约 §2：bilibili-native / youtube-api / worker / jina） */
  provider?: VideoExtractProvider
  /** 降级原因（worker_unavailable / worker_no_proxy / adapter_empty / timeout 等） */
  fallbackReason?: string
  /** 视频时长（秒） */
  duration?: number
  /** 上传者/UP 主 */
  uploader?: string
  /** 视频章节（yt-dlp chapters） */
  chapters?: VideoChapter[]
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

/** 来源标识 → 本地化展示文案的键（内部枚举绝不直接展示给用户） */
const SOURCE_LABEL_KEYS: Record<VideoExtractSource, string> = {
  bilibili: 'ai.videoSourceBilibili',
  youtube: 'ai.videoSourceYoutube',
  douyin: 'ai.videoSourceDouyin',
  tiktok: 'ai.videoSourceTiktok',
  xiaohongshu: 'ai.videoSourceXiaohongshu',
  x: 'ai.videoSourceX',
  generic: 'ai.videoSourceGeneric',
}

/** 来源中文标签（未知来源回落「通用网页」，不泄露内部枚举） */
export function videoSourceLabel(source: string | undefined | null): string {
  return t(SOURCE_LABEL_KEYS[source as VideoExtractSource] || 'ai.videoSourceGeneric')
}

/** 已知的解析通道枚举（服务端字段可能缺失或拼写异常，非法值一律丢弃） */
const KNOWN_PROVIDERS: readonly VideoExtractProvider[] = ['bilibili-native', 'youtube-api', 'worker', 'jina']

function parseProvider(raw: unknown): VideoExtractProvider | undefined {
  return typeof raw === 'string' && (KNOWN_PROVIDERS as readonly string[]).includes(raw)
    ? (raw as VideoExtractProvider)
    : undefined
}

function parseChapters(raw: unknown): VideoChapter[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const chapters: VideoChapter[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    if (typeof c.title !== 'string' || !c.title) continue
    const chapter: VideoChapter = { title: c.title }
    if (typeof c.start_time === 'number') chapter.start_time = c.start_time
    if (typeof c.end_time === 'number') chapter.end_time = c.end_time
    chapters.push(chapter)
  }
  return chapters.length > 0 ? chapters : undefined
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

    // 429 分两种（云函数契约）：
    // 1) 今日额度用完：body 带 quota 字段 → 置 quotaExceeded，且调用方不得再降级抓取（等于绕过配额）；
    // 2) 每分钟限流：body 无 quota 字段 → 视为普通失败返回 null，不能误报「额度用完」。
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { quota?: { limit?: unknown } } | null
      const quota = body && typeof body === 'object' ? body.quota : undefined
      if (!quota || typeof quota !== 'object') return null
      const limit = typeof quota.limit === 'number' ? quota.limit : undefined
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
    const duration = typeof data.duration === 'number' && data.duration > 0 ? data.duration : undefined
    return {
      source: (data.source as VideoExtractServerResult['source']) || 'generic',
      url: typeof data.url === 'string' ? data.url : targetUrl,
      title: typeof data.title === 'string' ? data.title : '',
      description: typeof data.description === 'string' ? data.description : '',
      subtitles: typeof data.subtitles === 'string' ? data.subtitles : '',
      comments: Array.isArray(data.comments) ? data.comments.filter((c: unknown) => typeof c === 'string') : [],
      markdown: typeof data.markdown === 'string' ? data.markdown : undefined,
      degraded: Boolean(data.degraded),
      provider: parseProvider(data.provider),
      fallbackReason:
        typeof data.fallback_reason === 'string'
          ? data.fallback_reason
          : typeof data.fallbackReason === 'string'
            ? data.fallbackReason
            : undefined,
      duration,
      uploader: typeof data.uploader === 'string' && data.uploader ? data.uploader : undefined,
      chapters: parseChapters(data.chapters),
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
