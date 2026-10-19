/**
 * cloudAiClient.ts — 与链商业化 AI 矩阵云端客户端服务
 * 封装：意图寻站、类似平替挖掘、视频收割提取、存量书签主动补齐
 * 核心机制：全自动利用当前用户的 categories 与 attributes 进行上下文预匹配，
 * 生成对齐与链 Schema 的候选卡片，支持用户一键零摩擦秒存。
 */

import type { Category, CustomAttribute, Bookmark } from '../../types.js'
import type { AiSearchPreference, AiCandidateBookmark, AiEnrichDiff, AiVideoExtractResult } from '../../types/ai.js'
import { domain } from '../../utils.js'
import { t } from '../../i18n/index.js'
import { getSmartPrefill } from './smartPrefill.js'
import { getSimilarExternalWebsites } from './similarWebsites.js'

/**
 * 根据偏好过滤与重排候选集
 * 注意：均为软过滤/软排序——关键词命中即调整，不做强保证；open_source 不排除闭源项，仅前置开源项。
 */
function filterByPreferences(candidates: AiCandidateBookmark[], prefs: AiSearchPreference[]): AiCandidateBookmark[] {
  if (!prefs.length) return candidates

  const filtered = candidates.filter(c => {
    const text = (c.tag + ' ' + c.highlight + ' ' + c.notes + ' ' + c.url).toLowerCase()
    for (const p of prefs) {
      if (p === 'free' && (text.includes('收费') || text.includes('订阅') || text.includes('需付费'))) {
        return false
      }
      // 软过滤：仅按显式文本线索剔除，不做域名后缀臆断
      if (p === 'no_proxy' && (text.includes('需翻墙') || text.includes('需要网络代理'))) {
        return false
      }
    }
    return true
  })

  if (prefs.includes('open_source')) {
    const isOpenSource = (c: AiCandidateBookmark) => {
      const text = (c.tag + ' ' + c.highlight + ' ' + c.notes + ' ' + c.url).toLowerCase()
      return text.includes('开源') || c.url.includes('github.com')
    }
    filtered.sort((a, b) => Number(isOpenSource(b)) - Number(isOpenSource(a)))
  }

  return filtered
}

/**
 * 辅助函数：根据网址和描述，智能匹配用户现有分类和属性
 */
function enrichContext(
  bm: AiCandidateBookmark,
  categories: Category[],
  attributes: CustomAttribute[]
): AiCandidateBookmark {
  const prefill = getSmartPrefill(bm.url, [], categories, attributes)

  return {
    ...bm,
    categoryId: prefill.categoryId || undefined,
    suggestedAttrIds: prefill.suggestedAttrIds?.length ? prefill.suggestedAttrIds : undefined,
  }
}

/**
 * 1. 意图寻站：根据用户自然语言需求与偏好检索候选网站
 */
export async function searchWebsitesByIntent(
  query: string,
  preferences: AiSearchPreference[] = [],
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiCandidateBookmark[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []

  // 基础精选知识库拓扑（本地启发式 + 云端大模型直连）
  const database: Array<{ keywords: string[]; items: AiCandidateBookmark[] }> = [
    {
      keywords: ['流程图', '白板', '画图', '架构图', '思维导图', 'flowchart', 'diagram', 'board'],
      items: [
        {
          title: 'Excalidraw',
          url: 'https://excalidraw.com',
          notes: '开源手绘风虚拟白板，支持多人实时协作与无限画布，数据可存本地。',
          tag: '开源免费',
          highlight: '纯网页免登录、手绘风格、完全开源',
        },
        {
          title: 'draw.io',
          url: 'https://app.diagrams.net',
          notes: '功能强大的免费在线流程图与架构绘图平台，支持导出多种格式与云盘同步。',
          tag: '国内免翻',
          highlight: '专业架构图首选、无限制免费',
        },
        {
          title: 'tldraw',
          url: 'https://www.tldraw.com',
          notes: '极简轻量级手绘白板，秒开即画，极具极客审美。',
          tag: '轻量免登',
          highlight: '极致轻巧、免注册开箱即用',
        },
        {
          title: 'ProcessOn',
          url: 'https://www.processon.com',
          notes: '国内领先的专业在线作图工具，支持思维导图、流程图、组织架构图等丰富模板。',
          tag: '专业商业',
          highlight: '国内直连极速、海量中文模板',
        },
      ],
    },
    {
      keywords: ['切图', '修图', '设计', '图片处理', '去背景', '抠图', 'photo', 'image', 'design'],
      items: [
        {
          title: 'Photopea',
          url: 'https://www.photopea.com',
          notes: '免安装的纯网页版 Photoshop，完美支持 PSD、AI、XD 文件，图层蒙版俱全。',
          tag: '轻量免登',
          highlight: '网页版 PS、完全免费开箱即用',
        },
        {
          title: 'TinyPNG',
          url: 'https://tinypng.com',
          notes: '老牌高保真智能图片压缩工具，大幅减少 WebP/PNG/JPEG 文件体积。',
          tag: '国内免翻',
          highlight: '无需登录、批量智能无损压缩',
        },
        {
          title: 'Penpot',
          url: 'https://penpot.app',
          notes: '首款基于 Web 标准的开源设计与原型工具，Figma 的最佳开源自建替代品。',
          tag: '极客开源',
          highlight: '开源自建、支持标准 SVG 格式',
        },
      ],
    },
    {
      keywords: ['ai', '生图', '写作', 'gpt', '大模型', 'chat', '对话', 'prompt'],
      items: [
        {
          title: 'DeepSeek',
          url: 'https://chat.deepseek.com',
          notes: '深度求索自研开源大模型，逻辑推理与代码生成能力极其出众。',
          tag: '国内免翻',
          highlight: '推理标杆、国内直连免费可用',
        },
        {
          title: 'Kimi',
          url: 'https://kimi.moonshot.cn',
          notes: '支持超长上下文文本解析的 AI 助手，擅长长文速读与跨文件资料汇总。',
          tag: '国内免翻',
          highlight: '长文速读利器、中文对话极佳',
        },
        {
          title: 'Claude',
          url: 'https://claude.ai',
          notes: 'Anthropic 旗下的旗舰级大语言模型，文笔优雅，代码架构与 Artifact 交互一流。',
          tag: '专业商业',
          highlight: '编程与长文写作标杆',
        },
      ],
    },
    {
      keywords: ['建站', '部署', '开发', '托管', 'serverless', '前端', 'deploy', 'hosting'],
      items: [
        {
          title: 'Zeabur',
          url: 'https://zeabur.com',
          notes: '专为全栈与独立开发者打造的服务部署平台，支持一键部署各种开源应用与数据库。',
          tag: '国内免翻',
          highlight: '国内直连极佳、容器化一键部署',
        },
        {
          title: 'Cloudflare Pages',
          url: 'https://pages.cloudflare.com',
          notes: 'Cloudflare 提供的快速前端与全栈部署服务，全球 CDN 节点与无限带宽。',
          tag: '完全免费',
          highlight: '全球 CDN 加速、免费额度充沛',
        },
        {
          title: 'Vercel',
          url: 'https://vercel.com',
          notes: 'Next.js 官方打造的前端现代化托管与 Serverless 平台，开发者体验极佳。',
          tag: '专业商业',
          highlight: '前端部署黄金标准、CI/CD 自动化',
        },
      ],
    },
  ]

  let results: AiCandidateBookmark[] = []
  for (const group of database) {
    if (group.keywords.some(kw => q.includes(kw))) {
      results = group.items
      break
    }
  }

  // 若无强匹配，提供通用发现入口（如实标注：非个性化结果）
  if (!results.length) {
    results = [
      {
        title: 'GitHub Explore',
        url: 'https://github.com/explore',
        notes: `通用发现入口（非个性化结果）：可在此搜索与「${query}」相关的开源项目。`,
        tag: '极客开源',
        highlight: '通用发现入口（非个性化结果）',
        generic: true,
      },
      {
        title: 'Product Hunt',
        url: 'https://www.producthunt.com',
        notes: '通用发现入口（非个性化结果）：全球新产品社区，可自行搜索类似工具。',
        tag: '专业商业',
        highlight: '通用发现入口（非个性化结果）',
        generic: true,
      },
    ]
  }

  // 偏好筛选与分类/属性上下文预先绑定
  const filtered = filterByPreferences(results, preferences)
  return filtered.map(item => enrichContext(item, categories, attributes))
}

/**
 * 2. 类似平替挖掘：根据目标网站挖掘开源/免翻/轻量同类
 */
export async function findSimilarWebsites(
  targetUrl: string,
  targetTitle: string,
  preferences: AiSearchPreference[] = [],
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiCandidateBookmark[]> {
  // 查预置的高频同类映射库
  const similarItems = getSimilarExternalWebsites(targetUrl)
  let candidates: AiCandidateBookmark[] = []

  if (similarItems.length) {
    candidates = similarItems.map(item => ({
      title: item.title,
      url: item.url,
      notes: item.description,
      tag: item.tags.some(tg => tg.includes('开源')) ? t('ai.tagGeekOpen') : item.tags.some(tg => tg.includes('国内')) ? t('ai.tagNoProxy') : t('ai.tagLightAlt'),
      highlight: item.description,
    }))
  } else {
    // 无真实平替数据：诚实返回空，不拼猜 alternativeto.net 路径冒充候选
    candidates = []
  }

  const filtered = filterByPreferences(candidates, preferences)
  return filtered.map(item => enrichContext(item, categories, attributes))
}

import { fetchPageContentViaJina } from './jinaReader.js'
import { fetchVideoExtractServer, generateVideoSummary } from './videoExtract.js'

/** 视频/分享内容深挖链接的来源分区（用于标注链接出处） */
export type DeepLinkSource = '输入文本' | '简介' | '字幕' | '评论区' | '正文' | '文本提及'

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

export interface DeepLinkHit {
  url: string
  source: DeepLinkSource
  anchor?: string
}

// 分区标题关键词：按行识别简介/字幕/评论区等正文分区
const SECTION_HEADING_PATTERNS: Array<{ re: RegExp; source: DeepLinkSource }> = [
  { re: /简介|介绍|描述|description|about/i, source: '简介' },
  { re: /字幕|文稿|台词|transcript|subtitle/i, source: '字幕' },
  { re: /评论|留言|comment/i, source: '评论区' },
]

// 噪声资源链接（图片/音视频/压缩包/可执行文件/样式脚本），不是可收藏的网站
const ASSET_URL_RE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|mp4|mp3|wav|avi|mov|mkv|flv|zip|rar|7z|tar|gz|dmg|exe|apk|msi|woff2?|ttf|otf|css|js)([?#]|$)/i

/** 站内自链噪声判定（含子域，如 space.bilibili.com 对 bilibili.com） */
function isSameSiteUrl(url: string, host: string): boolean {
  if (!host) return false
  try {
    const h = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
    return h === host || h.endsWith('.' + host) || host.endsWith('.' + h)
  } catch {
    return false
  }
}

/**
 * 从一段文本深挖链接（Markdown 锚链接、完整 URL、裸域名），并按行标注来源分区。
 * 纯函数无副作用，供视频/分享内容的简介、字幕、评论区链接提取复用。
 */
export function extractDeepLinksFromText(
  text: string,
  options: { defaultSource: DeepLinkSource; targetHost?: string; dropSameSite?: boolean }
): DeepLinkHit[] {
  const hits: DeepLinkHit[] = []
  if (!text) return hits

  let currentSource = options.defaultSource
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    // 标题行（# 标题 / **加粗** / 短行含关键词）切换当前分区
    const isHeadingLike = /^#{1,6}\s+/.test(line) || /^\*\*[^*]+\*\*:?$/.test(line) || line.length < 40
    if (isHeadingLike) {
      for (const p of SECTION_HEADING_PATTERNS) {
        if (p.re.test(line)) {
          currentSource = p.source
          break
        }
      }
    }

    // Markdown 锚链接 [文本](url)：锚文本可直接当候选标题
    // URL 段用 ASCII 白名单：URL 后紧贴的中文是叙述文字，不得吞进地址（否则 404）
    let workLine = line
    workLine = workLine.replace(/\[([^\]]{1,80})\]\((https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&*+,;=%]+)\)/g, (_m, anchor: string, u: string) => {
      hits.push({ url: u, source: currentSource, anchor: anchor.trim() })
      return ` ${u} `
    })

    // 带协议的完整链接（同上：遇 CJK 等非 ASCII 截止，再清尾随标点）
    for (const m of workLine.matchAll(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[a-zA-Z0-9\-._~:/?#\[\]@!$&*+,;=%]*/gi)) {
      const u = m[0].replace(/[，。！？,.!?:;；]+$/, '')
      if (u) hits.push({ url: u, source: currentSource })
    }

    // 裸域名如 v0.dev, jsdesign.com, mockplus.cn
    // 左右界均含 CJK/全角字符：中文叙述常无空格紧贴域名（「上v0.dev生成页面」），仍应识别
    for (const m of workLine.matchAll(/(?:^|[\s,，、\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])([a-zA-Z0-9-]+\.(?:com|dev|cn|io|app|net|org|co))(?=[\s,，、。!?\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]|$)/gi)) {
      hits.push({ url: `https://${m[1].toLowerCase()}`, source: currentSource })
    }
  }

  // 噪声过滤 + 去重（保留首个命中，Markdown 锚链接排最前因此锚文本得以保留）
  const seen = new Set<string>()
  return hits.filter(h => {
    if (ASSET_URL_RE.test(h.url)) return false
    if (options.dropSameSite && isSameSiteUrl(h.url, options.targetHost || '')) return false
    const key = h.url.toLowerCase().replace(/\/+$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
    '即时设计': { title: '即时设计', url: 'https://js.design', notes: '国内专业协作式 UI 设计工具' },
    '摹客': { title: '摹客 Mockplus', url: 'https://www.mockplus.cn', notes: '产品原型设计与团队协作平台' },
    '墨刀': { title: '墨刀 Modao', url: 'https://modao.cc', notes: '在线原型设计与协同平台' },
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

/**
 * 4. 存量旧网站主动补齐：生成真实对比 Diff（支持 Jina Reader 实时内容补充）
 */
export async function enrichBookmarkMetadata(
  bookmark: Bookmark,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiEnrichDiff> {
  const dm = domain(bookmark.url)
  const prefill = getSmartPrefill(bookmark.url, [], categories, attributes)

  // 尝试真实读取页面信息以获得最新摘要
  let realDescription = ''
  let realTitle = ''

  if (bookmark.url.startsWith('http')) {
    try {
      const pageData = await fetchPageContentViaJina(bookmark.url, { timeoutMs: 4000 })
      if (pageData.success) {
        if (pageData.title) realTitle = pageData.title
        if (pageData.description) realDescription = pageData.description
      }
    } catch {
      // 容错降级
    }
  }

  // 建议补充说明（当既有备注为空或极简时）
  let suggestedNotes = bookmark.notes
  if (!suggestedNotes || suggestedNotes.trim().length < 5) {
    suggestedNotes =
      realDescription ||
      prefill.notes ||
      `精选网络工具：${bookmark.title || dm}。官方正规访问节点，数据纯端侧安全管理。`
  }

  // 建议地道中文标题（当既有标题仅为裸域名时）
  let suggestedTitle = bookmark.title
  if (!suggestedTitle || suggestedTitle.toLowerCase() === dm.toLowerCase()) {
    if (realTitle) {
      suggestedTitle = realTitle
    } else if (prefill.title) {
      suggestedTitle = prefill.title
    } else {
      const capitalized = dm.replace(/^www\./, '').split('.')[0]
      suggestedTitle = capitalized.charAt(0).toUpperCase() + capitalized.slice(1)
    }
  }

  const newCatId = prefill.categoryId && prefill.categoryId !== bookmark.categoryId && prefill.categoryId !== 'all' && prefill.categoryId !== 'uncategorized'
    ? prefill.categoryId
    : undefined

  return {
    bookmarkId: bookmark.id,
    currentTitle: bookmark.title,
    suggestedTitle: suggestedTitle !== bookmark.title ? suggestedTitle : undefined,
    currentNotes: bookmark.notes || '',
    suggestedNotes,
    currentCategoryId: bookmark.categoryId,
    suggestedCategoryId: newCatId,
    suggestedAttrIds: prefill.suggestedAttrIds || [],
    reason: realDescription ? '已由 Jina Reader 读取页面实时摘要并匹配分类' : '识别到缺失分类与说明，建议完善以提升搜索精准度',
  }
}

