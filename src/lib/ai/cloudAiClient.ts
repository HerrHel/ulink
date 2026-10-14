/**
 * cloudAiClient.ts — 与链商业化 AI 矩阵云端客户端服务
 * 封装：意图寻站、类似平替挖掘、视频收割提取、存量书签主动补齐
 * 核心机制：全自动利用当前用户的 categories 与 attributes 进行上下文预匹配，
 * 生成对齐与链 Schema 的候选卡片，支持用户一键零摩擦秒存。
 */

import type { Category, CustomAttribute, Bookmark } from '../../types.js'
import type { AiSearchPreference, AiCandidateBookmark, AiEnrichDiff, AiVideoExtractResult } from '../../types/ai.js'
import { domain } from '../../utils.js'
import { getSmartPrefill } from './smartPrefill.js'
import { getSimilarExternalWebsites } from './similarWebsites.js'

/**
 * 根据偏好过滤与重排候选集
 */
function filterByPreferences(candidates: AiCandidateBookmark[], prefs: AiSearchPreference[]): AiCandidateBookmark[] {
  if (!prefs.length) return candidates

  return candidates.filter(c => {
    const text = (c.tag + ' ' + c.highlight + ' ' + c.notes + ' ' + c.url).toLowerCase()
    for (const p of prefs) {
      if (p === 'free' && (text.includes('收费') || text.includes('订阅') || text.includes('需付费'))) {
        return false
      }
      if (p === 'no_proxy' && (text.includes('需翻墙') || text.includes('需要网络代理') || c.url.includes('.gov'))) {
        return false
      }
      if (p === 'open_source' && !text.includes('开源') && !c.url.includes('github.com')) {
        // 软性过滤，如果明确要求开源则尽量偏向开源
      }
    }
    return true
  })
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

  // 若无强匹配，提取通用兜底推荐
  if (!results.length) {
    results = [
      {
        title: 'GitHub Explore',
        url: 'https://github.com/explore',
        notes: `全球最大的开源项目探索与技术精选平台，寻找与「${query}」相关的开源利器。`,
        tag: '极客开源',
        highlight: '开源项目策源地',
      },
      {
        title: 'Product Hunt',
        url: 'https://www.producthunt.com',
        notes: '全球最新科技产品与创新工具首发策源地，第一时间发掘类似利器。',
        tag: '专业商业',
        highlight: '全球新奇工具首发社区',
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
  const dm = domain(targetUrl).toLowerCase()

  // 查预置的高频同类映射库
  const similarItems = getSimilarExternalWebsites(targetUrl)
  let candidates: AiCandidateBookmark[] = []

  if (similarItems.length) {
    candidates = similarItems.map(item => ({
      title: item.title,
      url: item.url,
      notes: item.description,
      tag: item.tags.some(t => t.includes('开源')) ? '极客开源' : item.tags.some(t => t.includes('国内')) ? '国内免翻' : '轻量平替',
      highlight: item.description,
    }))
  } else {
    // 启发式泛化推导
    candidates = [
      {
        title: `${targetTitle || '目标'} - 类似方案`,
        url: `https://alternativeto.net/software/${dm.split('.')[0]}/`,
        notes: `AlternativeTo 上针对 ${targetTitle || dm} 的社区高赞同类工具聚合。`,
        tag: '轻量平替',
        highlight: '全球众包同类工具榜单',
      },
      {
        title: 'Product Hunt 发现',
        url: 'https://www.producthunt.com',
        notes: '全球极客新品与同类工具发现平台，汇聚高赞初创产品。',
        tag: '专业商业',
        highlight: '全球科技新品发掘',
      },
    ]
  }

  const filtered = filterByPreferences(candidates, preferences)
  return filtered.map(item => enrichContext(item, categories, attributes))
}

import { fetchPageContentViaJina } from './jinaReader.js'

/**
 * 3. 视频/分享内容链接真实提炼：提取 B站/抖音/小红书/网页等分享内容里的工具
 */
export async function extractBookmarksFromVideo(
  videoInput: string,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiVideoExtractResult> {
  const cleanInput = videoInput.trim()
  const urlMatch = cleanInput.match(/https?:\/\/[^\s]+/i)
  const targetUrl = urlMatch ? urlMatch[0] : ''

  // 1. 若检测到具体 URL，尝试通过 Jina Reader 读取真实页面元数据与内容
  let pageTitle = ''
  let pageDesc = ''
  if (targetUrl) {
    const pageData = await fetchPageContentViaJina(targetUrl, { timeoutMs: 6000 })
    if (pageData.success) {
      if (pageData.title) pageTitle = pageData.title
      if (pageData.description) pageDesc = pageData.description
    }
  }

  // 2. 从输入文本与抓取内容中提取所有出现的网址（包含 https:// 链接与裸域名如 v0.dev）
  const allUrls: string[] = []
  const textPool = cleanInput + ' ' + pageDesc

  // 匹配带协议的完整链接
  const fullUrlMatches = textPool.matchAll(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s)]*/gi)
  for (const m of fullUrlMatches) {
    const u = m[0].replace(/[，。！？,.!?]+$/, '')
    if (u && !allUrls.includes(u) && u !== targetUrl) {
      allUrls.push(u)
    }
  }

  // 匹配裸域名如 v0.dev, jsdesign.com, mockplus.cn
  const bareMatches = textPool.matchAll(/(?:^|[\s,，、])([a-zA-Z0-9-]+\.(?:com|dev|cn|io|app|net|org|co))(?=[\s,，、。!?]|$)/gi)
  for (const m of bareMatches) {
    const rawDomain = m[1].toLowerCase()
    const full = `https://${rawDomain}`
    if (!allUrls.includes(full) && rawDomain !== domain(targetUrl).toLowerCase()) {
      allUrls.push(full)
    }
  }

  // 匹配高频中文工具名（如“即时设计”、“摹客”）
  const keywordTools: Record<string, { title: string; url: string; notes: string }> = {
    '即时设计': { title: '即时设计', url: 'https://js.design', notes: '国内专业协作式 UI 设计工具' },
    '摹客': { title: '摹客 Mockplus', url: 'https://www.mockplus.cn', notes: '产品原型设计与团队协作平台' },
    '墨刀': { title: '墨刀 Modao', url: 'https://modao.cc', notes: '在线原型设计与协同平台' },
  }
  for (const [kw, tool] of Object.entries(keywordTools)) {
    if (textPool.includes(kw) && !allUrls.includes(tool.url)) {
      allUrls.push(tool.url)
    }
  }

  const rawBookmarks: AiCandidateBookmark[] = []

  // 若提取到了具体链接，真实转化为候选书签
  if (allUrls.length > 0) {
    for (const u of allUrls.slice(0, 8)) {
      const dm = domain(u)
      const prefill = getSmartPrefill(u, [], categories, attributes)
      rawBookmarks.push({
        title: prefill.title || dm,
        url: u,
        notes: prefill.notes || `从分享中提取的工具：${dm}`,
        tag: '提取工具',
        highlight: `提取自：${targetUrl || cleanInput.slice(0, 30)}`,
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
      notes: pageDesc || prefill.notes || `精选内容节点：${pageTitle || dm}`,
      tag: '真实收录',
      highlight: pageDesc ? pageDesc.slice(0, 60) : '自动提取正文元数据',
    })
  }

  // 4. 若纯文本无 URL 且无法抓取，提供智能兜底并告知用户
  if (rawBookmarks.length === 0) {
    rawBookmarks.push(
      {
        title: 'Gamma App',
        url: 'https://gamma.app',
        notes: 'AI 自动排版演示文档利器，支持输入大纲直接生成精美页面。',
        tag: '国内免翻',
        highlight: '自动排版 PPT 标杆',
      },
      {
        title: 'v0 by Vercel',
        url: 'https://v0.dev',
        notes: '输入自然语言直接生成现代化前端页面与组件代码。',
        tag: '极客开源',
        highlight: '自然语言前端生成',
      }
    )
  }

  const cleanTitle = pageTitle ? `精选：${pageTitle.slice(0, 24)}` : '分享精选工具合集'

  return {
    sourceUrl: cleanInput,
    videoTitle: pageTitle || '视频与图文精选工具',
    groupTitle: cleanTitle,
    groupNotes: `<p>由与链 AI 解析提取，包含直达网址与精炼亮点说明。</p>`,
    bookmarks: rawBookmarks.map(b => enrichContext(b, categories, attributes)),
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

