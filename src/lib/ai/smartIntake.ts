/**
 * smartIntake.ts — 全网通用 AI 智能页面摄入与内容提炼引擎
 *
 * 核心职责：
 * 1. 突破纯本地规则与 CORS 限制，异步从真实公网网页抓取 OpenGraph / Title / Description；
 * 2. 深度清洗标题噪音（去除各类网站常见的“ - 知乎”、“ | 少数派”等站长 SEO 尾巴）；
 * 3. 严格的安全防护（内网/私有 IP/localhost 自动拦截，绝不上云）；
 * 4. 结合真实网页文本，精准匹配用户现有分类体系与属性标签。
 */

import type { Category, CustomAttribute } from '../../types.js'
import { cfApiUrl } from '../../config/urls.js'
import { isPrivateUrl } from './urlGuard.js'
import { fetchPageContentViaJina } from './jinaReader.js'
import { suggestCategory, suggestAttributes } from '../ai-classify.js'
import { CATEGORY_SYNONYMS } from './knowledge.js'

export interface SmartIntakeResult {
  success: boolean
  title?: string
  notes?: string
  categoryId?: string
  suggestedAttrIds?: string[]
  reason?: string
}

/**
 * 严格剔除一切 Emoji 表情符号（遵循克制温润排版规范，杜绝浮夸视觉噪音）
 */
export function stripEmojis(str: string): string {
  if (!str) return ''
  return str
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '')
    .trim()
}

/**
 * 清洗网页标题中的站长 SEO 后缀与堆砌关键词噪音
 */
export function cleanWebTitle(rawTitle: string, targetUrl?: string): string {
  if (!rawTitle) return ''
  let title = stripEmojis(rawTitle.trim())

  // 常见中文/英文站长追加的品牌尾巴与通用域名后缀
  const suffixes = [
    /\s*[-_—|·]\s*(知乎专栏|知乎|稀土掘金|掘金|少数派|哔哩哔哩|bilibili|简书|博客园|腾讯新闻|新浪科技|36氪|网易新闻|微信公众平台|微信公众|百度百科|百度经验|CSDN博客|CSDN|雪球|下厨房|丁香园).*/i,
    /\s*[-_—|·]\s*(GitHub|GitLab|YouTube|Reddit|Medium|Stack Overflow|Twitter|X|V2EX|Notion).*/i,
    /\s*[-_—|·]\s*(www\.[a-z0-9-]+\.[a-z]+|[a-z0-9-]+\.(?:com|cn|net|org|io|cc|co)).*$/i,
    /\s*[-_—|·]\s*(官方网站|官网|首页|Home|Official\s*Site).*$/i,
    /\s*\(.*?哔哩哔哩.*?\)/i,
    /\s*\(.*?知乎.*?\)/i,
  ]

  for (const suf of suffixes) {
    if (suf.test(title)) {
      const stripped = title.replace(suf, '').trim()
      if (stripped.length >= 2) {
        title = stripped
      }
    }
  }

  // 清洗逗号/下划线SEO堆砌关键词（如：“小游戏,4399小游戏,小游戏大全,双人小游戏大全”）
  if (/[,，、_]/.test(title)) {
    const parts = title.split(/[,，、_]/).map(s => s.trim()).filter(Boolean)
    if (parts.length > 1) {
      let brand = ''
      if (targetUrl) {
        try {
          const u = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl)
          brand = u.hostname.replace(/^www\./, '').split('.')[0]
        } catch {
          // 忽略非法 URL 格式
        }
      }
      if (brand && brand.length >= 2) {
        const brandMatch = parts.find(p => p.toLowerCase().includes(brand.toLowerCase()))
        if (brandMatch && brandMatch.length <= 20) {
          title = brandMatch
        }
      }
    }
  }

  // 清洗首尾引号与多余空白
  title = title.replace(/^["'“‘]+|["'”’]+$/g, '').trim()
  return title
}

/**
 * 清洗网页描述文本（压缩多余空白，截取精炼前段）
 */
export function cleanWebDescription(rawDesc: string, maxLen = 240): string {
  if (!rawDesc) return ''
  let desc = stripEmojis(rawDesc).replace(/\s+/g, ' ').trim()
  if (desc.length > maxLen) {
    desc = desc.slice(0, maxLen - 3) + '...'
  }
  return desc
}

/**
 * 异步获取公网网页的真实元数据并智能提炼
 */
export async function fetchUrlMetadataAsync(
  targetUrl: string,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<SmartIntakeResult> {
  const url = targetUrl.trim()
  if (!url || !/^https?:\/\//i.test(url)) {
    return { success: false, reason: 'invalid_url' }
  }

  // 安全防线：私有网络地址绝不上云抓取，保护内网拓扑与凭据安全
  if (isPrivateUrl(url)) {
    return { success: false, reason: 'private_url_blocked' }
  }

  let rawTitle = ''
  let rawDesc = ''
  let serverCategoryId: string | undefined = undefined
  let serverSuggestedAttrIds: string[] = []

  // 1. 优先尝试边缘/服务端元数据端点 /api/extract-metadata（支持 Cloudflare Pages Edge 及 Vite Dev）
  try {
    const activeAttrs = attributes.filter(a => !a.deletedAt && a.id !== 'is-group')
    const activeCats = categories.filter(c => !c.deletedAt)
    const apiRes = await fetch(cfApiUrl('/api/extract-metadata'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        availableAttributes: activeAttrs.map(a => ({ id: a.id, name: a.name })),
        availableCategories: activeCats.map(c => ({ id: c.id, name: c.name })),
      }),
      signal: AbortSignal.timeout(18000),
    })
    if (apiRes.ok) {
      const data = (await apiRes.json()) as { success?: boolean; title?: string; description?: string; categoryId?: string; suggestedAttrIds?: string[] }
      if (data && data.success) {
        rawTitle = data.title || ''
        rawDesc = data.description || ''
        if (data.categoryId && typeof data.categoryId === 'string') {
          serverCategoryId = data.categoryId
        }
        if (Array.isArray(data.suggestedAttrIds)) {
          serverSuggestedAttrIds = data.suggestedAttrIds
        }
      }
    }
  } catch {
    // /api/extract-metadata 不可用或超时，继续尝试 Jina Reader 转发
  }

  // 2. 降级：经云函数转发至 Jina Reader
  if (!rawTitle && !rawDesc) {
    try {
      const jinaRes = await fetchPageContentViaJina(url, { timeoutMs: 5000, maxChars: 2000, silentNotice: true })
      if (jinaRes && jinaRes.success) {
        rawTitle = jinaRes.title || ''
        rawDesc = jinaRes.description || ''
      }
    } catch {
      // 降级失败
    }
  }

  const title = cleanWebTitle(rawTitle, url)
  const notes = cleanWebDescription(rawDesc)

  if (!title && !notes) {
    return { success: false, reason: 'empty_extracted_content' }
  }

  // 结合真实抓取到的标题与描述做二次分类与属性匹配（优先使用服务端大模型推荐，若无则本地多级分类匹配）
  let matchedCatId = serverCategoryId || suggestCategory(url, title || notes, categories) || undefined
  if (!matchedCatId && categories.length > 0) {
    const fullText = `${url} ${title} ${notes}`.toLowerCase()
    for (const [kw, synonyms] of Object.entries(CATEGORY_SYNONYMS)) {
      if (synonyms.some(s => fullText.includes(s))) {
        const matched = categories.find(c => {
          const cn = c.name.toLowerCase()
          return cn.includes(kw.toLowerCase()) || synonyms.some(s => cn.includes(s) || s.includes(cn))
        })
        if (matched) {
          matchedCatId = matched.id
          break
        }
      }
    }
  }
  const localAttrIds = suggestAttributes(url, `${title} ${notes}`, attributes)
  const suggestedAttrIds = [...new Set([...serverSuggestedAttrIds, ...localAttrIds])]

  return {
    success: true,
    title: title || undefined,
    notes: notes || undefined,
    categoryId: matchedCatId,
    suggestedAttrIds,
    reason: 'realtime_page_extract',
  }
}
