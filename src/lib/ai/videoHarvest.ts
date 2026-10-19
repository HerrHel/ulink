/**
 * videoHarvest.ts — 视频/分享内容收割层（自 cloudAiClient.ts 拆出）
 * 职责：提取 B站/抖音/小红书/网页等分享内容里的工具站点——优先服务端 extract-video
 * Edge Function 结构化文字源（简介/字幕/评论区），失败降级本地 Jina 直连；
 * 深挖链接按来源分区标注，文字源总结带用户问题走「回答提问」模式。抓不到不伪造。
 */

import type { Category, CustomAttribute } from '../../types.js'
import type { AiCandidateBookmark, AiVideoExtractResult } from '../../types/ai.js'
import { domain } from '../../utils.js'
import { t } from '../../i18n/index.js'
import { getSmartPrefill } from './smartPrefill.js'
import { fetchPageContentViaJina } from './jinaReader.js'
import { fetchVideoExtractServer, generateVideoSummary } from './videoExtract.js'
import { extractDeepLinksFromText, type DeepLinkSource, type DeepLinkHit } from './deepLinkExtract.js'
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
 * 3. 视频/分享内容链接真实提炼：提取 B站/抖音/小红书/网页等分享内容里的工具
 * 深度抓取页面正文，简介/字幕/评论区里出现的链接一并提取（以页面公开可读内容为准，抓不到不伪造）。
 */
export async function extractBookmarksFromVideo(
  videoInput: string,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiVideoExtractResult> {
  const cleanInput = videoInput.trim()
  // URL 本体用 RFC 3986 白名单字符（排除空白/引号/括号与 CJK 等非 ASCII）：
  // 粘贴文本常把 URL 与中文紧贴（如「https://b23.tv/xxx总结视频里的网站」），
  // 按空白贪婪匹配会把中文吞进地址导致 404，遇非 ASCII 应截止
  const urlMatch = cleanInput.match(/https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&*+,;=%]+/i)
  const targetUrl = urlMatch ? urlMatch[0].replace(/[，。！？,.!?:;；]+$/, '') : ''

  // 用户随链接提出的具体问题（如「总结视频内出现的网站」）：剥掉 URL 与【标题】块后的剩余文字。
  // 透传给总结提示词做「回答用户问题」模式，避免回复固定套路与提问脱节（答非所问）
  const questionText = cleanInput
    .replace(/https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&*+,;=%]+/gi, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // 1. 内容获取：优先服务端 extract-video Edge Function（海外节点转发抓取，平台适配器
  //    结构化返回简介/字幕/评论区，每段独立标注来源）；失败/未登录降级本地 Jina 直连
  //    （国内网络可能不可用，抓不到不伪造）
  let pageTitle = ''
  let pageDesc = ''
  const contentParts: Array<{ text: string; source: DeepLinkSource }> = []
  let fallbackBody = ''
  if (targetUrl) {
    let server: Awaited<ReturnType<typeof fetchVideoExtractServer>> = null
    try {
      server = await fetchVideoExtractServer(targetUrl)
    } catch {
      server = null
    }

    if (server) {
      pageTitle = server.title
      pageDesc = server.description
      if (server.description.trim()) contentParts.push({ text: server.description, source: '简介' })
      if (server.subtitles.trim()) contentParts.push({ text: server.subtitles, source: '字幕' })
      if (server.comments.length) contentParts.push({ text: server.comments.join('\n'), source: '评论区' })
      if (server.markdown) contentParts.push({ text: server.markdown, source: '正文' })
    } else {
      const pageData = await fetchPageContentViaJina(targetUrl, { timeoutMs: 8000, maxChars: 30000 })
      if (pageData.success) {
        if (pageData.title) pageTitle = pageData.title
        if (pageData.description) pageDesc = pageData.description
        if (pageData.markdown) fallbackBody = pageData.markdown
      }
    }
  }

  // 2. 从输入文本与抓取内容深挖链接：输入文本保留用户意图（不过滤同站），
  //    抓取内容过滤站内自链与资源噪声（导航/头像/封面图等不是推荐网站）
  const targetHost = targetUrl ? domain(targetUrl).toLowerCase() : ''
  const rawHits = [
    ...extractDeepLinksFromText(cleanInput, { defaultSource: '输入文本', targetHost, dropSameSite: false }),
    ...contentParts.flatMap(p =>
      extractDeepLinksFromText(p.text, { defaultSource: p.source, targetHost, dropSameSite: true })
    ),
    ...extractDeepLinksFromText(fallbackBody, { defaultSource: '正文', targetHost, dropSameSite: true }),
  ]

  // 去重并排除目标页自身
  const norm = (u: string) => u.toLowerCase().replace(/\/+$/, '')
  const deepHits: DeepLinkHit[] = []
  const seenUrls = new Set<string>(targetUrl ? [norm(targetUrl)] : [])
  for (const h of rawHits) {
    const key = norm(h.url)
    if (seenUrls.has(key)) continue
    seenUrls.add(key)
    deepHits.push(h)
  }

  // 匹配高频中文工具名（如“即时设计”、“摹客”）：输入文本与抓取内容都算池子
  const pageBody = [...contentParts.map(p => p.text), fallbackBody].filter(Boolean).join('\n')
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

  const rawBookmarks: AiCandidateBookmark[] = []

  // 若提取到了具体链接，真实转化为候选书签
  if (deepHits.length > 0) {
    for (const hit of deepHits.slice(0, 8)) {
      const dm = domain(hit.url)
      const prefill = getSmartPrefill(hit.url, [], categories, attributes)
      // 精选站点标题置信度高直接用；否则优先用锚文本（博主原话比机器兜底标题更准）
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

  // 3. 若未提取到任何子链接，则将目标页面本身作为优质工具提取（真实验证）
  if (rawBookmarks.length === 0 && targetUrl) {
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

  // 4. 若纯文本无 URL 且无法抓取：诚实返回空，不硬编码候选冒充提取产物
  //    （调用方 formatFoundCount(0) 会走 emptyResultsHint 空态提示）

  const cleanTitle = pageTitle ? t('ai.shareGroupTitlePrefix', { title: pageTitle.slice(0, 24) }) : t('ai.shareGroupTitleDefault')

  // 5. 文字源总结速览（简介/字幕/评论区文本 → 大模型，注入前已消毒截断）：
  //    带用户问题走「回答提问」模式；无可用 AI 通道或失败则缺省，不阻塞链接提取
  let summary: string | undefined
  if (pageBody.trim()) {
    try {
      summary = (await generateVideoSummary(pageBody, { question: questionText || undefined })) || undefined
    } catch {
      summary = undefined
    }
  }

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
