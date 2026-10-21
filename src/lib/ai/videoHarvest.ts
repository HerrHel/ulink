/**
 * videoHarvest.ts — 视频/分享内容收割层（自 cloudAiClient.ts 拆出）
 * 职责：提取 B站/抖音/小红书/网页等分享内容里的工具站点——优先服务端 extract-video
 * Edge Function 结构化文字源（简介/字幕/评论区），失败降级本地 Jina 直连；
 * 采用四大工业级准入守门：
 * 1. 网络层宿主域族归一（穿透平台短链与多级子域名）；
 * 2. 页面负载区隔离（剔除顶栏/底栏通用政策与导航噪音）；
 * 3. 404 / 软失效页面严格熔断；
 * 4. 大模型语义中枢仲裁（脑手合一：模型认定无工具/已失效时强制候选卡片清零）。
 */

import type { Category, CustomAttribute } from '../../types.js'
import type { AiCandidateBookmark, AiVideoExtractResult } from '../../types/ai.js'
import { domain } from '../../utils.js'
import { t } from '../../i18n/index.js'
import { getSmartPrefill } from './smartPrefill.js'
import { fetchPageContentViaJina } from './jinaReader.js'
import { fetchVideoExtractServer, generateVideoSummary } from './videoExtract.js'
import {
  extractDeepLinksFromText,
  getCanonicalHostFamily,
  type DeepLinkSource,
  type DeepLinkHit,
} from './deepLinkExtract.js'
import { enrichContext } from './cloudCandidates.js'

/** 来源分区的本地化标签（分区枚举值本身是内部标识，用户可见文案走 i18n） */
const SRC_LABEL_KEYS: Record<DeepLinkSource, string> = {
  '输入文本': 'ai.srcInput',
  '简介': 'ai.srcIntro',
  '字幕': 'ai.srcSubtitle',
  '评论区': 'ai.srcComments',
  '正文': 'ai.srcBody',
  '文本提及': 'ai.srcMention',
}

function linkSourceLabel(source: DeepLinkSource): string {
  return t(SRC_LABEL_KEYS[source] || 'ai.srcMention')
}

/**
 * 判定页面内容是否属于已失效、删除或 404 错误页
 */
export function isDeadOr404Content(title: string, desc: string, body: string): boolean {
  const combined = `${title} ${desc} ${body}`
  const deadPatterns = [
    /视频去哪了/,
    /视频不见了/,
    /稿件已被删除/,
    /该稿件已被隐藏/,
    /视频已被删除/,
    /视频已下架/,
    /页面不存在/,
    /页面找不到了/,
    /\b404\s*(not\s*found|错误|error)?\b/i,
    /\bvideo\s+unavailable\b/i,
    /\bthis\s+video\s+has\s+been\s+removed\b/i,
    /\bprivate\s+video\b/i,
    /\bcontent\s+not\s+found\b/i,
    /\bpage\s+not\s+found\b/i,
  ]
  return deadPatterns.some((re) => re.test(combined))
}

/**
 * 判定模型回复摘要是否明确指明页面失效或未提及有效工具
 */
export function isSummaryIndicatingNoTools(summaryText?: string): boolean {
  if (!summaryText) return false
  const p = [
    /视频已失效/,
    /视频不见了/,
    /无法总结.*?网站/,
    /没有出现其他网站或工具/,
    /未出现其他网站/,
    /未发现.*?工具/,
    /未提及.*?网站/,
    /未分享.*?工具/,
    /没有推荐.*?工具/,
    /并未提及.*?网站/,
    /no\s+(tools|websites|links)\s+(found|mentioned)/i,
    /video\s+is\s+(unavailable|deleted|missing)/i,
  ]
  return p.some((re) => re.test(summaryText))
}

/**
 * 视频/分享内容链接提炼（以页面公开可读内容为准，抓不到不伪造，失效不盲抽）
 */
export async function extractBookmarksFromVideo(
  videoInput: string,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiVideoExtractResult> {
  const cleanInput = videoInput.trim()
  // URL 本体用 RFC 3986 白名单字符（排除空白/引号/括号与 CJK 等非 ASCII）
  const urlMatch = cleanInput.match(/https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&*+,;=%]+/i)
  const targetUrl = urlMatch ? urlMatch[0].replace(/[，。！？,.!?:;；]+$/, '') : ''

  // 用户随链接提出的具体问题（剥掉 URL 与【标题】块后的剩余文字）
  const questionText = cleanInput
    .replace(/https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&*+,;=%]+/gi, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // 1. 内容获取：优先服务端 extract-video Edge Function，失败降级本地 Jina
  let pageTitle = ''
  let pageDesc = ''
  const contentParts: Array<{ text: string; source: DeepLinkSource }> = []
  let fallbackBody = ''
  let canonicalUrl = targetUrl

  if (targetUrl) {
    let server: Awaited<ReturnType<typeof fetchVideoExtractServer>> = null
    try {
      server = await fetchVideoExtractServer(targetUrl)
    } catch {
      server = null
    }

    if (server) {
      if (server.url) canonicalUrl = server.url
      pageTitle = server.title
      pageDesc = server.description
      if (server.description.trim()) contentParts.push({ text: server.description, source: '简介' })
      if (server.subtitles.trim()) contentParts.push({ text: server.subtitles, source: '字幕' })
      if (server.comments.length) contentParts.push({ text: server.comments.join('\n'), source: '评论区' })
      if (server.markdown) contentParts.push({ text: server.markdown, source: '正文' })
    } else {
      const pageData = await fetchPageContentViaJina(targetUrl, { timeoutMs: 8000, maxChars: 30000 })
      if (pageData.success) {
        if (pageData.url) canonicalUrl = pageData.url
        if (pageData.title) pageTitle = pageData.title
        if (pageData.description) pageDesc = pageData.description
        if (pageData.markdown) fallbackBody = pageData.markdown
      }
    }
  }

  const pageBody = [...contentParts.map(p => p.text), fallbackBody].filter(Boolean).join('\n')
  const isDeadPage = isDeadOr404Content(pageTitle, pageDesc, pageBody)

  // 2. 宿主域族归一（穿透短链与主站多级子域，避免把站内导航或频道当成外部工具）
  const hostFamily = getCanonicalHostFamily([domain(targetUrl), domain(canonicalUrl)])

  // 失效/404 页面直接熔断深挖，避免将 404 页面的全局导航/底栏链接作为工具提取
  const rawHits = isDeadPage
    ? []
    : [
        ...extractDeepLinksFromText(cleanInput, { defaultSource: '输入文本', targetHost: hostFamily, dropSameSite: false }),
        ...contentParts.flatMap(p =>
          extractDeepLinksFromText(p.text, { defaultSource: p.source, targetHost: hostFamily, dropSameSite: true })
        ),
        ...extractDeepLinksFromText(fallbackBody, { defaultSource: '正文', targetHost: hostFamily, dropSameSite: true }),
      ]

  // 去重并排除目标页与重定向后自身落地页
  const norm = (u: string) => u.toLowerCase().replace(/\/+$/, '')
  const deepHits: DeepLinkHit[] = []
  const seenUrls = new Set<string>(
    [targetUrl, canonicalUrl].filter(Boolean).map(u => norm(u!))
  )
  for (const h of rawHits) {
    const key = norm(h.url)
    if (seenUrls.has(key)) continue
    seenUrls.add(key)
    deepHits.push(h)
  }

  // 匹配高频中文工具名（仅在有效页面中进行文本池匹配）
  if (!isDeadPage) {
    const textPool = cleanInput + ' ' + pageBody
    const keywordTools: Record<string, { title: string; url: string; notes: string }> = {
      '即时设计': { title: '即时设计', url: 'https://js.design', notes: t('ai.toolJsdesignNotes') },
      '摹客': { title: '摹客 Mockplus', url: 'https://www.mockplus.cn', notes: t('ai.toolMockplusNotes') },
      '墨刀': { title: '墨刀 Modao', url: 'https://modao.cc', notes: t('ai.toolModaoNotes') },
    }
    for (const [kw, tool] of Object.entries(keywordTools)) {
      if (textPool.includes(kw) && !seenUrls.has(norm(tool.url))) {
        seenUrls.add(norm(tool.url))
        deepHits.push({ url: tool.url, source: '文本提及', anchor: kw })
      }
    }
  }

  const rawBookmarks: AiCandidateBookmark[] = []

  // 若提取到了具体链接，真实转化为候选书签
  if (deepHits.length > 0) {
    for (const hit of deepHits.slice(0, 8)) {
      const dm = domain(hit.url)
      const prefill = getSmartPrefill(hit.url, [], categories, attributes)
      const title = prefill.confidence === 'high' ? prefill.title : (hit.anchor || prefill.title || dm)
      rawBookmarks.push({
        title,
        url: hit.url,
        notes: prefill.notes || hit.anchor || t('ai.extractedToolNotes', { dm }),
        tag: t('ai.tagExtractTool'),
        highlight: targetUrl
          ? t('ai.extractHighlight', { source: linkSourceLabel(hit.source), site: domain(targetUrl) })
          : t('ai.extractHighlightNoSite', { source: linkSourceLabel(hit.source) }),
      })
    }
  }

  // 3. 文字源总结速览（简介/字幕/评论区文本 → 大模型，注入前已消毒截断）
  let summary: string | undefined
  if (pageBody.trim()) {
    try {
      summary = (await generateVideoSummary(pageBody, { question: questionText || undefined })) || undefined
    } catch {
      summary = undefined
    }
  }

  // 4. 语义中枢仲裁（脑手合一）：
  // 若判定页面已失效，或模型回复明确说明未提供/未出现任何工具，强制清除所有提取候选
  const isNoToolsSummary = isSummaryIndicatingNoTools(summary)
  if (isDeadPage || isNoToolsSummary) {
    rawBookmarks.length = 0
  }

  // 5. 兜底回退：仅当页面健康有效且用户单发一条主页、却无任何子链接时，才将目标页自身作为书签提取
  if (rawBookmarks.length === 0 && targetUrl && !isDeadPage && !isNoToolsSummary) {
    const dm = domain(targetUrl)
    const prefill = getSmartPrefill(targetUrl, [], categories, attributes)
    rawBookmarks.push({
      title: pageTitle || prefill.title || dm,
      url: targetUrl,
      notes: pageDesc || prefill.notes || t('ai.contentNodeNotes', { title: pageTitle || dm }),
      tag: t('ai.tagRealRecord'),
      highlight: pageDesc ? pageDesc.slice(0, 60) : t('ai.autoExtractMeta'),
    })
  }

  const cleanTitle = isDeadPage
    ? t('ai.videoFallbackTitle')
    : pageTitle
      ? t('ai.shareGroupTitlePrefix', { title: pageTitle.slice(0, 24) })
      : t('ai.shareGroupTitleDefault')

  return {
    sourceUrl: cleanInput,
    videoTitle: pageTitle || t('ai.videoFallbackTitle'),
    groupTitle: cleanTitle,
    groupNotes: t('ai.videoGroupNotes'),
    bookmarks: rawBookmarks.map(b => enrichContext(b, categories, attributes)),
    summary,
    question: questionText || undefined,
  }
}
