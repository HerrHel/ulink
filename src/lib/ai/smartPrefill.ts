/**
 * smartPrefill.ts — 智能书签预填引擎
 * 添加书签时根据 URL 智能自动补全名称、备注、分类与属性（严格从已有分类/属性中预选）。
 * 中文用户推荐地道中文名称，英文用户推荐地道英文名称。
 * 纯本地优先，零网络延迟，零隐私泄漏。
 */

import type { Bookmark, Category, CustomAttribute } from '../../types.js'
import { domain, fixUrl } from '../../utils.js'
import { getLocale } from '../../i18n/index.js'
import { CURATED_SITES, GENERIC_SUBDOMAINS, SECOND_LEVEL_DOMAINS, CATEGORY_SYNONYMS } from './knowledge.js'

export interface SmartPrefillResult {
  title: string
  notes: string
  categoryId?: string
  suggestedAttrIds: string[]
  suggestedUsername?: string
  confidence: 'high' | 'medium' | 'fallback'
}

/**
 * 从 hostname 提取核心品牌主名（如 docs.docker.com -> brand='docker', rootDomain='docker.com'）
 */
export function extractBrandFromHostname(rawHost: string): { brand: string; sub: string; rootDomain: string } {
  const host = rawHost.toLowerCase().trim().replace(/^www\./i, '')
  const parts = host.split('.')
  if (parts.length <= 1) {
    return { brand: host, sub: '', rootDomain: host }
  }

  // 检查两段式后缀（如 example.com.cn）
  const lastTwo = parts.slice(-2).join('.')
  let sld = ''
  let subParts: string[] = []
  let rootDomain = ''

  if (SECOND_LEVEL_DOMAINS.has(lastTwo) && parts.length >= 3) {
    sld = parts[parts.length - 3]
    subParts = parts.slice(0, parts.length - 3)
    rootDomain = `${sld}.${lastTwo}`
  } else {
    sld = parts[parts.length - 2]
    subParts = parts.slice(0, parts.length - 2)
    rootDomain = `${sld}.${parts[parts.length - 1]}`
  }

  // 过滤通用子域名
  const meaningfulSub = subParts.find(s => !GENERIC_SUBDOMAINS.has(s)) || ''
  return { brand: sld, sub: meaningfulSub, rootDomain }
}

/**
 * 解析文章或页面的语义 Slug
 */
function parseArticleSlug(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, '')
  const parts = clean.split('/').filter(Boolean)
  if (!parts.length) return null
  const lastPart = parts[parts.length - 1]
  if (/^[a-zA-Z0-9_\-]+$/.test(lastPart) && (lastPart.includes('-') || lastPart.includes('_')) && lastPart.length > 5) {
    const words = lastPart.split(/[-_]+/).filter(w => !/^\d+$/.test(w))
    if (words.length >= 2) {
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    }
  }
  return null
}

/**
 * 结构化解析 URL 路径生成语义化标题与描述（支持中英文）
 */
function parsePathSemantics(urlObj: URL, isZh: boolean): { title?: string; notes?: string } {
  const host = urlObj.hostname.replace(/^www\./i, '').toLowerCase()
  const path = urlObj.pathname.replace(/\/+$/, '')

  // 1. GitHub 深度路径解析
  if (host === 'github.com') {
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 2) {
      const [owner, repo] = parts
      return {
        title: `${repo} (${owner}/${repo})`,
        notes: isZh
          ? `GitHub 开源项目仓库：${owner}/${repo}`
          : `GitHub open-source repository: ${owner}/${repo}`,
      }
    } else if (parts.length > 2) {
      const [owner, repo, sub, ...rest] = parts
      if (sub === 'issues') {
        const issueNum = rest[0] ? `#${rest[0]}` : 'Issues'
        return {
          title: `${repo} ${issueNum} · Issue`,
          notes: isZh
            ? `GitHub 项目 ${owner}/${repo} 的 Issue 讨论跟踪。`
            : `Issue discussion and bug tracking for ${owner}/${repo}.`,
        }
      } else if (sub === 'pull' || sub === 'pulls') {
        const prNum = rest[0] ? `#${rest[0]}` : 'PR'
        return {
          title: `${repo} ${prNum} · Pull Request`,
          notes: isZh
            ? `GitHub 项目 ${owner}/${repo} 的代码合入请求。`
            : `Code pull request for ${owner}/${repo}.`,
        }
      }
      return {
        title: `${repo} · ${sub}`,
        notes: isZh
          ? `GitHub 项目 ${owner}/${repo} 的 ${sub} 模块。`
          : `${sub} section of ${owner}/${repo} on GitHub.`,
      }
    }
  }

  // 2. 技术文档子域 (docs.*, *.org/docs)
  if (host.startsWith('docs.') || path.startsWith('/docs') || path.startsWith('/guide')) {
    const { brand } = extractBrandFromHostname(host)
    const formattedBrand = brand.charAt(0).toUpperCase() + brand.slice(1)
    return {
      title: isZh ? `${formattedBrand} 官方开发文档` : `${formattedBrand} Official Docs`,
      notes: isZh
        ? `${formattedBrand} 官方指南、架构概念与 API 接口参考。`
        : `Official guides, architecture, and API references for ${formattedBrand}.`,
    }
  }

  // 3. V2EX 帖子
  if (host === 'v2ex.com' && path.startsWith('/t/')) {
    return {
      title: isZh ? 'V2EX 讨论帖' : 'V2EX Discussion Post',
      notes: isZh
        ? 'V2EX 社区技术或生活交流主题帖。'
        : 'Topic discussion thread on V2EX tech community.',
    }
  }

  // 4. Bilibili 视频
  if (host === 'bilibili.com' && path.startsWith('/video/')) {
    return {
      title: isZh ? 'Bilibili 视频教程与精选' : 'Bilibili Video',
      notes: isZh ? '哔哩哔哩视频播放页面。' : 'Video stream on Bilibili.',
    }
  }

  // 5. 掘金文章
  if (host === 'juejin.cn' && path.startsWith('/post/')) {
    return {
      title: isZh ? '掘金技术博客文章' : 'Juejin Technical Article',
      notes: isZh
        ? '稀土掘金开发者技术沉淀与分享文章。'
        : 'Developer knowledge sharing post on Juejin.',
    }
  }

  // 6. 文章 Slug 提炼
  const articleTitle = parseArticleSlug(urlObj.pathname)
  if (articleTitle) {
    const { brand } = extractBrandFromHostname(host)
    const brandName = brand.charAt(0).toUpperCase() + brand.slice(1)
    return {
      title: `${articleTitle} · ${brandName}`,
      notes: isZh ? `来自 ${brandName} 的文章与精选内容。` : `Article and reading from ${brandName}.`,
    }
  }

  return {}
}

/**
 * 智能根据 URL 提炼预填信息
 * @param rawUrl 待预填的网址
 * @param existingBookmarks 用户现有书签库（用于同源历史偏好继承）
 * @param categories 用户现有分类（严格从中预选最匹配分类）
 * @param customAttributes 用户现有属性（严格从中预选最匹配属性）
 * @param lang 语言偏好，默认取当前界面语言（中文用户推荐中文名，英文用户推荐英文名）
 */
export function getSmartPrefill(
  rawUrl: string,
  existingBookmarks: Bookmark[] = [],
  categories: Category[] = [],
  customAttributes: CustomAttribute[] = [],
  lang?: string,
): SmartPrefillResult {
  const url = fixUrl(rawUrl)
  let urlObj: URL | null = null
  try {
    urlObj = new URL(url)
  } catch {
    return {
      title: rawUrl,
      notes: '',
      suggestedAttrIds: [],
      confidence: 'fallback',
    }
  }

  const effectiveLang = lang || (typeof getLocale === 'function' ? getLocale() : 'zh-CN')
  const isZh = effectiveLang.toLowerCase().startsWith('zh')

  const fullHost = urlObj.hostname.replace(/^www\./i, '').toLowerCase()
  const { brand, rootDomain } = extractBrandFromHostname(fullHost)

  let matchedTitle = ''
  let matchedNotes = ''
  let matchedCatKeyword = ''
  const tagList: string[] = []
  let confidence: 'high' | 'medium' | 'fallback' = 'fallback'

  // 1. 精选站点匹配（最高优先级）
  // 先找全 host，再找 rootDomain
  const curated = CURATED_SITES[fullHost] || CURATED_SITES[rootDomain]
  if (curated) {
    matchedTitle = isZh ? curated.titleZh : curated.titleEn
    matchedNotes = isZh ? curated.notesZh : curated.notesEn
    matchedCatKeyword = curated.categoryKeyword || ''
    if (curated.tags) tagList.push(...curated.tags)
    confidence = 'high'
  }

  // 2. 路径语义识别覆盖（如 GitHub 仓库、PR、Issue、文档、博客等）
  const pathSemantics = parsePathSemantics(urlObj, isZh)
  if (pathSemantics.title) {
    matchedTitle = pathSemantics.title
    confidence = 'high'
  }
  if (pathSemantics.notes) {
    matchedNotes = pathSemantics.notes
  }

  // 3. 兜底标题生成（去除子域噪音，精准品牌大写）
  if (!matchedTitle) {
    const firstPart = fullHost.split('.')[0]
    const chosen = GENERIC_SUBDOMAINS.has(firstPart) ? brand : firstPart
    const formatted = chosen.charAt(0).toUpperCase() + chosen.slice(1)
    matchedTitle = formatted
    confidence = 'medium'
  }

  // 4. 同源继承：从用户已有的同域历史书签中继承分类、常用账号与标签偏好
  let inheritedCatId: string | undefined = undefined
  let inheritedUsername: string | undefined = undefined
  const activeExistingBms = existingBookmarks.filter(b => !b.deletedAt && b.url)
  const sameDomainBms = activeExistingBms.filter(b => {
    const bHost = domain(b.url).toLowerCase().replace(/^www\./i, '')
    return bHost === fullHost || bHost === rootDomain
  })

  if (sameDomainBms.length > 0) {
    // 统计同域名下最常用的已有分类
    const catFrequency = new Map<string, number>()
    for (const b of sameDomainBms) {
      if (b.categoryId && b.categoryId !== 'uncategorized' && b.categoryId !== 'all') {
        catFrequency.set(b.categoryId, (catFrequency.get(b.categoryId) || 0) + 1)
      }
      if (!inheritedUsername && b.username) {
        inheritedUsername = b.username
      }
      if (b.attributes) {
        for (const [aid, val] of Object.entries(b.attributes)) {
          if (val && !tagList.includes(aid)) tagList.push(aid)
        }
      }
    }
    let maxCnt = 0
    for (const [cid, cnt] of catFrequency.entries()) {
      if (cnt > maxCnt) {
        maxCnt = cnt
        inheritedCatId = cid
      }
    }
  }

  // 5. 分类匹配定位（严格从用户已有分类中预选）
  let finalCatId = inheritedCatId
  const activeCats = categories.filter(c => !c.deletedAt && c.id !== 'all' && c.id !== 'uncategorized')

  if (!finalCatId && matchedCatKeyword && activeCats.length > 0) {
    const kwLower = matchedCatKeyword.toLowerCase()
    const synonyms = CATEGORY_SYNONYMS[matchedCatKeyword] || [kwLower]

    // A. 尝试直接名称包含
    for (const cat of activeCats) {
      const cname = cat.name.toLowerCase()
      if (synonyms.some(s => cname.includes(s) || s.includes(cname))) {
        finalCatId = cat.id
        break
      }
    }

    // B. 若还未匹配到，尝试与品牌词/标签碰撞
    if (!finalCatId) {
      for (const cat of activeCats) {
        const cname = cat.name.toLowerCase()
        if (tagList.some(tag => cname.includes(tag.toLowerCase()) || tag.toLowerCase().includes(cname))) {
          finalCatId = cat.id
          break
        }
      }
    }
  }

  // 6. 属性标签匹配（严格从用户已有的属性中预选）
  const suggestedAttrIds: string[] = []
  const activeAttrs = customAttributes.filter(a => !a.deletedAt)
  for (const attr of activeAttrs) {
    const attrLower = attr.name.toLowerCase()
    const isMatched = tagList.some(t => {
      const tLower = t.toLowerCase()
      return t === attr.id || tLower === attrLower || attrLower.includes(tLower) || tLower.includes(attrLower)
    })
    if (isMatched && !suggestedAttrIds.includes(attr.id)) {
      suggestedAttrIds.push(attr.id)
    }
  }

  return {
    title: matchedTitle,
    notes: matchedNotes,
    categoryId: finalCatId,
    suggestedAttrIds,
    suggestedUsername: inheritedUsername,
    confidence,
  }
}
