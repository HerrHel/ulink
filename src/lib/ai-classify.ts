/**
 * ai-classify.ts — 本地分类建议
 * 基于关键词匹配的轻量分类器，为收藏的书签自动建议分类和属性标签。
 * 后续可替换为 Transformers.js 本地模型。
 */
import type { Category } from '../types.js'
import { DOMAIN_KEYWORDS, TITLE_KEYWORDS, ATTR_KEYWORDS, CATEGORY_SYNONYMS } from './ai/knowledge.js'

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

  // 找得分最高的分类名。
  // 支持：
  // 1. 完全匹配（大小写不敏感，最高优先级，基础分×2）
  // 2. 子串包含（如 "游戏平台" 包含 "游戏"，"前端开发" 包含 "开发"）
  // 3. 概念同义词匹配（通过 CATEGORY_SYNONYMS 映射，如 "游戏平台" 命中 "游戏" 同义词）
  // 决胜规则（审计 #13）：平局按 categories order 升序 → name 字典序兜底，完全确定。
  let bestName: string | null = null
  let bestScore = 0
  let bestOrder = 0

  for (const c of categories) {
    const cNameLower = c.name.trim().toLowerCase()
    let score = 0

    for (const [constName, s] of scores) {
      const constLower = constName.toLowerCase()
      if (cNameLower === constLower) {
        score += s * 2
      } else if (cNameLower.includes(constLower) || constLower.includes(cNameLower)) {
        score += s
      } else {
        const syns = CATEGORY_SYNONYMS[constName] || []
        if (syns.some(syn => cNameLower.includes(syn.toLowerCase()) || syn.toLowerCase().includes(cNameLower))) {
          score += s
        }
      }
    }

    if (score === 0) continue

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
    const rules = ATTR_KEYWORDS[attr.name] || ATTR_KEYWORDS[attr.name.toLowerCase()]
    if (rules) {
      const domainHit = rules.domains.some(d => urlLower.includes(d))
      const titleHit = rules.titles.some(t => titleHasKeyword(titleLower, t))
      if (domainHit || titleHit) {
        suggested.push(attr.id)
        continue
      }
    }

    // 动态匹配：若用户自定义属性名称长度>=2，且在网页标题或URL路径中明确出现，自适应智能命中
    const attrNameLower = attr.name.trim().toLowerCase()
    if (attrNameLower.length >= 2 && attrNameLower !== '自定义无关') {
      if (titleHasKeyword(titleLower, attrNameLower) || urlLower.includes(attrNameLower)) {
        suggested.push(attr.id)
      }
    }
  }

  return suggested
}
