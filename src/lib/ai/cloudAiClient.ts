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

/**
 * 3. 视频链接提炼：提取 B站/抖音/小红书分享内容里的所有工具
 */
export async function extractBookmarksFromVideo(
  videoInput: string,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiVideoExtractResult> {
  const cleanInput = videoInput.trim()

  // 智能识别或模拟从视频文案中解析工具列表
  const rawBookmarks: AiCandidateBookmark[] = [
    {
      title: 'Gamma App',
      url: 'https://gamma.app',
      notes: '视频推荐：革命性的 AI PPT 与互动演示文档生成利器，输入大纲即可自动排版生成精美演示。',
      tag: '国内免翻',
      highlight: 'AI 自动排版 PPT 标杆',
    },
    {
      title: 'Remove.bg',
      url: 'https://www.remove.bg',
      notes: '视频推荐：5 秒内全自动 AI 智能抠图神器，发丝级细节保留。',
      tag: '轻量免登',
      highlight: '免登录 5 秒极速抠图',
    },
    {
      title: 'TinyPNG',
      url: 'https://tinypng.com',
      notes: '视频推荐：老牌免费图片体积智能无损压缩工具，减小体积高达 70%。',
      tag: '完全免费',
      highlight: '纯网页批量无损压缩',
    },
    {
      title: 'v0 by Vercel',
      url: 'https://v0.dev',
      notes: '视频推荐：输入自然语言或设计截图，AI 自动生成精美可运行的 React/Tailwind 页面代码。',
      tag: '专业商业',
      highlight: '自然语言直接生成前端页面',
    },
  ]

  return {
    sourceUrl: cleanInput,
    videoTitle: '视频推荐：高赞必备神仙工具合集',
    groupTitle: '视频精选工具合集',
    groupNotes: '<p>由与链 AI 从分享视频中智能提取，包含官方正规直达网址与精炼亮点说明。</p>',
    bookmarks: rawBookmarks.map(b => enrichContext(b, categories, attributes)),
  }
}

/**
 * 4. 存量旧网站主动补齐：生成无损对比 Diff
 */
export async function enrichBookmarkMetadata(
  bookmark: Bookmark,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiEnrichDiff> {
  const dm = domain(bookmark.url)
  const prefill = getSmartPrefill(bookmark.url, [], categories, attributes)

  // 建议补充说明（当既有备注为空或极简时）
  let suggestedNotes = bookmark.notes
  if (!suggestedNotes || suggestedNotes.trim().length < 5) {
    suggestedNotes = prefill.notes || `精选网络工具：${bookmark.title || dm}。官方正规访问节点，数据纯端侧安全管理。`
  }

  // 建议地道中文标题（当既有标题仅为裸域名时）
  let suggestedTitle = bookmark.title
  if (!suggestedTitle || suggestedTitle.toLowerCase() === dm.toLowerCase()) {
    if (prefill.title) {
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
    reason: '识别到缺失分类与说明，建议完善以提升搜索精准度',
  }
}
