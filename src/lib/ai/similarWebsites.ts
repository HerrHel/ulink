/**
 * similarWebsites.ts — 本地类似网站知识图谱与外部竞品推荐
 * 纯前端离线运作，基于高频域名拓扑与分类原型推荐类似优秀工具与网站。
 */
import type { ExternalSimilarItem } from './knowledge.js'
import { CATEGORY_FALLBACK_SIMILAR, DOMAIN_SIMILAR_MAP } from './knowledge.js'

/** 规范化域名匹配键 */
function normalizeDomain(urlOrDomain: string): string {
  try {
    const raw = urlOrDomain.startsWith('http') ? new URL(urlOrDomain).hostname : urlOrDomain
    return raw.replace(/^www\./, '').toLowerCase().trim()
  } catch {
    return (urlOrDomain || '').replace(/^www\./, '').toLowerCase().trim()
  }
}

/**
 * 获取与当前书签相关的外部优秀同类网站推荐
 * 优先按精确域名匹配；未命中时按包含匹配；仍未命中时按分类关键词兜底
 */
export function getSimilarExternalWebsites(
  url: string,
  categoryName?: string | null,
  limit = 4,
): ExternalSimilarItem[] {
  const norm = normalizeDomain(url)
  if (!norm) return []

  // 1. 精确匹配
  if (DOMAIN_SIMILAR_MAP[norm]) {
    return DOMAIN_SIMILAR_MAP[norm].slice(0, limit)
  }

  // 2. 泛域名或子串匹配（如 chat.openai.com 命中 chatgpt.com 等）
  if (norm.includes('openai.com')) return DOMAIN_SIMILAR_MAP['chatgpt.com'].slice(0, limit)
  if (norm.includes('claude')) return DOMAIN_SIMILAR_MAP['claude.ai'].slice(0, limit)
  if (norm.includes('deepseek')) return DOMAIN_SIMILAR_MAP['deepseek.com'].slice(0, limit)

  for (const [key, items] of Object.entries(DOMAIN_SIMILAR_MAP)) {
    if (norm.includes(key) || key.includes(norm)) {
      return items.slice(0, limit)
    }
  }

  // 3. 分类兜底匹配
  if (categoryName) {
    const matchedCategory = Object.keys(CATEGORY_FALLBACK_SIMILAR).find(cat =>
      categoryName.includes(cat) || cat.includes(categoryName),
    )
    if (matchedCategory && CATEGORY_FALLBACK_SIMILAR[matchedCategory]) {
      // 过滤掉自身已经对应的域名
      return CATEGORY_FALLBACK_SIMILAR[matchedCategory]
        .filter(it => it.domain !== norm)
        .slice(0, limit)
    }
  }

  return []
}
