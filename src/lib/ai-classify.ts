/**
 * ai-classify.ts — 本地分类建议
 * 基于关键词匹配的轻量分类器，为收藏的书签自动建议分类和属性标签。
 * 后续可替换为 Transformers.js 本地模型。
 */
import type { Category } from '../types.js'
import { DOMAIN_KEYWORDS, TITLE_KEYWORDS, ATTR_KEYWORDS } from './ai/knowledge.js'

/** 纯 ASCII 短词判定 + 词边界正则缓存：关键词是模块级常量，编译结果按 kw 复用免每次 new RegExp */
const _ASCII_KW = /^[a-z0-9.+#-]{1,12}$/i
const _kwReCache = new Map<string, RegExp>()
export function titleHasKeyword(titleLower: string, kw: string): boolean {
  if (_ASCII_KW.test(kw)) {
    let re = _kwReCache.get(kw)
    if (!re) {
      re = new RegExp(`(?:^|[^a-z0-9])${kw.replace(/[.+#-]/g, '\\$&')}(?=[^a-z0-9]|$)`, 'i')
      _kwReCache.set(kw, re)
    }
    return re.test(titleLower)
  }
  return titleLower.includes(kw)
}

/**
 * 根据 URL 和标题建议分类
 * 返回最匹配的分类 ID，无匹配返回 null
 */
export function suggestCategory(
  url: string,
  title: string,
  categories: Category[],
): string | null {
  if (!url && !title) return null
  const urlLower = (url || '').toLowerCase()
  const titleLower = (title || '').toLowerCase()
  const scores = new Map<string, number>()

  // 域名匹配（权重高）
  for (const [catName, domains] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const d of domains) {
      if (urlLower.includes(d)) {
        scores.set(catName, (scores.get(catName) || 0) + 3)
        break
      }
    }
  }

  // 标题关键词匹配（M9：短英文词边界）
  for (const [catName, keywords] of Object.entries(TITLE_KEYWORDS)) {
    for (const kw of keywords) {
      if (titleHasKeyword(titleLower, kw)) {
        scores.set(catName, (scores.get(catName) || 0) + 1)
      }
    }
  }

  if (scores.size === 0) return null

  // 找得分最高的分类名。审计 #41：scores 的 key 是 DOMAIN_KEYWORDS/TITLE_KEYWORDS
  // 常量分类名（如 'AI'），用户分类名可能与常量大小写不同（如 'ai'）。按 lowercase 做
  // 大小写不敏感匹配：把 scores（常量驱动）按 lowercase 映射回用户 category，未映射到的忽略。
  // 审计 #13：原 `score > bestScore`（严格大于）平局时让 Map 先入项胜出，偏向常量声明序
  // 这种偶然顺序。改为按 categories 顺序遍历候选 + 平局 order 升序 → name 字典序兜底，
  // 完全确定且不偏向常量声明顺序。
  const scoresByLower = new Map<string, number>()
  for (const [constName, s] of scores) scoresByLower.set(constName.toLowerCase(), s)
  let bestName: string | null = null
  let bestScore = 0
  let bestOrder = 0
  // 以 categories（用户排序）为主顺序遍历，保证平局定序符合用户意图；
  // scores 可能含 c.name 大小写不匹配的 key，用 lowercase 反查兜底。
  for (const c of categories) {
    const score = scoresByLower.get(c.name.toLowerCase())
    if (score === undefined) continue
    if (
      bestName === null ||
      score > bestScore ||
      (score === bestScore && (c.order < bestOrder || (c.order === bestOrder && c.name < bestName)))
    ) {
      bestScore = score
      bestName = c.name
      bestOrder = c.order
    }
  }
  if (bestName === null) return null

  return categories.find(c => c.name === bestName)?.id ?? null
}

/**
 * 根据 URL 和标题建议属性标签
 * 返回建议勾选的属性 ID 数组
 */
export function suggestAttributes(
  url: string,
  title: string,
  customAttributes: { id: string; name: string }[],
): string[] {
  if (!url && !title) return []
  const urlLower = (url || '').toLowerCase()
  const titleLower = (title || '').toLowerCase()
  const suggested: string[] = []

  for (const attr of customAttributes) {
    const rules = ATTR_KEYWORDS[attr.name]
    if (!rules) continue
    const domainHit = rules.domains.some(d => urlLower.includes(d))
    const titleHit = rules.titles.some(t => titleHasKeyword(titleLower, t))
    if (domainHit || titleHit) suggested.push(attr.id)
  }

  return suggested
}
