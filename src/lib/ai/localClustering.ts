/**
 * localClustering.ts — 本地聚类与书签整理分析引擎
 * 严守边界：绝不将子书签、已进组书签、已分类书签误判为未整理。
 * 建议分类完全基于用户已有分类体系和同域关联，杜绝臆造新分类。
 */

import type { Bookmark, Category, SiblingGroup } from '../../types.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import { suggestCategory } from '../ai-classify.js'

export interface BookmarkCluster {
  id: string
  name: string
  suggestedCategoryId?: string
  suggestedCategoryName: string
  bookmarks: Bookmark[]
}

export interface DuplicateCluster {
  primary: Bookmark
  duplicates: Bookmark[]
  normalizedUrl: string
}

export interface UncategorizedGroupItem {
  group: SiblingGroup
  suggestedCategoryId?: string
  suggestedCategoryName: string
  bookmarkCount: number
}

export interface VaultHygieneStats {
  totalCount: number
  uncategorizedCount: number
  uncategorizedGroupCount: number
  duplicateCount: number
}

/**
 * 判定是否为系统官方内置书签（如官网落地页、Edge扩展、App入口等）
 * 必须受到保护，杜绝参与重复剔除、误删或无意义的整理干扰
 */
export function isOfficialBookmark(b: Bookmark): boolean {
  if (!b || !b.id) return false
  return b.id.startsWith('bm_ulink_')
}

/**
 * 提取简化根域名
 */
function extractDomain(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    return u.hostname.replace(/^www\./i, '').toLowerCase().trim()
  } catch {
    return ''
  }
}

/**
 * 严格规范化 URL 进行重复比对
 */
export function normalizeUrlForDedup(rawUrl: string): string {
  if (!rawUrl) return ''
  try {
    const u = new URL(rawUrl.trim())
    // 过滤常见营销和追踪参数
    const params = new URLSearchParams()
    for (const [key, value] of u.searchParams.entries()) {
      if (!/^utm_|^ref$|^source$|^from$|^spm$/i.test(key)) {
        params.append(key, value)
      }
    }
    const cleanSearch = params.toString() ? `?${params.toString()}` : ''
    const cleanHost = u.hostname.replace(/^www\./i, '').toLowerCase()
    const cleanPath = u.pathname.replace(/\/+$/, '') || '/'
    return `${cleanHost}${cleanPath}${cleanSearch}`
  } catch {
    return rawUrl.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '')
  }
}

/**
 * 严格判定是否为真正待整理书签
 * 守护红线：
 * 1. 已软删除项不算
 * 2. 子书签（有 parentId）归属父卡片，不算未整理
 * 3. 已归入任何笔记组（SiblingGroup）中的书签，不算未整理
 * 4. 已有有效分类的书签，不算未整理
 */
export function isUncategorized(b: Bookmark, groupedBookmarkIds?: Set<string>): boolean {
  if (b.deletedAt) return false
  if (isOfficialBookmark(b)) return false
  if (b.parentId) return false
  if (groupedBookmarkIds && groupedBookmarkIds.has(b.id)) return false
  return !b.categoryId || b.categoryId === CAT_UNCATEGORIZED
}

/**
 * 对未整理书签按建议目标分类聚合
 * 优先依据用户现有分类中同域名的归属历史；其次依据 ai-classify 分类匹配现有分类
 */
export function clusterUncategorizedBookmarks(
  bookmarks: Bookmark[],
  categories: Category[],
  groupedBookmarkIds?: Set<string>,
): BookmarkCluster[] {
  const activeCategories = categories.filter(c => !c.deletedAt)
  const categoryMap = new Map(activeCategories.map(c => [c.id, c]))

  // 1. 过滤出严格待整理的书签
  const uncategorized = bookmarks.filter(b => isUncategorized(b, groupedBookmarkIds))
  if (!uncategorized.length) return []

  // 2. 从用户已分类的书签中学习域名与分类偏好
  const domainToCatCount = new Map<string, Map<string, number>>()
  for (const b of bookmarks) {
    if (b.deletedAt || !b.categoryId || b.categoryId === CAT_UNCATEGORIZED) continue
    const dm = extractDomain(b.url)
    if (!dm) continue
    if (!domainToCatCount.has(dm)) domainToCatCount.set(dm, new Map())
    const catMap = domainToCatCount.get(dm)!
    catMap.set(b.categoryId, (catMap.get(b.categoryId) || 0) + 1)
  }

  // 3. 对每个未整理书签确定建议分类
  const catClusters = new Map<string, Bookmark[]>()
  const unassigned: Bookmark[] = []

  for (const b of uncategorized) {
    const dm = extractDomain(b.url)
    let bestCatId: string | null = null

    // 优先：用户自己以往把该域名放到了哪个分类
    if (dm && domainToCatCount.has(dm)) {
      const catCount = domainToCatCount.get(dm)!
      let maxCnt = 0
      for (const [cid, cnt] of catCount.entries()) {
        if (cnt > maxCnt && categoryMap.has(cid)) {
          maxCnt = cnt
          bestCatId = cid
        }
      }
    }

    // 次选：基于现有分类名称匹配
    if (!bestCatId) {
      bestCatId = suggestCategory(b.url, b.title, activeCategories)
      if (!bestCatId) {
        const textLower = `${b.title || ''} ${b.url || ''}`.toLowerCase()
        for (const cat of activeCategories) {
          const catLower = cat.name.toLowerCase()
          if (textLower.includes(catLower) || (catLower.length >= 2 && catLower.split(/[\s/、]+/).some(part => part && textLower.includes(part)))) {
            bestCatId = cat.id
            break
          }
        }
      }
    }

    if (bestCatId && categoryMap.has(bestCatId)) {
      const list = catClusters.get(bestCatId) || []
      list.push(b)
      catClusters.set(bestCatId, list)
    } else {
      unassigned.push(b)
    }
  }

  const result: BookmarkCluster[] = []
  let clusterIdx = 1

  for (const [catId, bms] of catClusters.entries()) {
    const cat = categoryMap.get(catId)!
    result.push({
      id: `cluster_${clusterIdx++}`,
      name: cat.name,
      suggestedCategoryId: cat.id,
      suggestedCategoryName: cat.name,
      bookmarks: bms,
    })
  }

  if (unassigned.length > 0) {
    result.push({
      id: 'cluster_unassigned',
      name: '待分配分类',
      suggestedCategoryName: '未分类',
      bookmarks: unassigned,
    })
  }

  return result
}

/**
 * 判定是否为未分类的笔记组
 */
export function isUncategorizedGroup(g: SiblingGroup): boolean {
  if (g.deletedAt) return false
  return !g.categoryId || g.categoryId === CAT_UNCATEGORIZED
}

/**
 * 检索并分析未分类笔记组，并基于组内书签或标题关键词匹配现有分类
 */
export function findUncategorizedGroups(
  groups: SiblingGroup[],
  categories: Category[],
  bookmarks: Bookmark[],
): UncategorizedGroupItem[] {
  const activeCats = categories.filter(c => !c.deletedAt)
  const catMap = new Map(activeCats.map(c => [c.id, c]))
  const bmMap = new Map(bookmarks.filter(b => !b.deletedAt).map(b => [b.id, b]))

  const uncatGroups = groups.filter(g => isUncategorizedGroup(g))
  if (!uncatGroups.length) return []

  return uncatGroups.map(g => {
    let bestCatId: string | null = null

    // 1. 优先：根据组内书签的历史分类统计最高频分类
    const catCount = new Map<string, number>()
    for (const bid of g.bookmarkIds || []) {
      const bm = bmMap.get(bid)
      if (bm?.categoryId && bm.categoryId !== CAT_UNCATEGORIZED && catMap.has(bm.categoryId)) {
        catCount.set(bm.categoryId, (catCount.get(bm.categoryId) || 0) + 1)
      }
    }
    let maxCnt = 0
    for (const [cid, cnt] of catCount.entries()) {
      if (cnt > maxCnt) {
        maxCnt = cnt
        bestCatId = cid
      }
    }

    // 2. 次选：根据组名称与现有分类名匹配
    if (!bestCatId) {
      const textLower = `${g.name || ''} ${g.notes ? g.notes.replace(/<[^>]+>/g, '') : ''}`.toLowerCase()
      for (const cat of activeCats) {
        const catLower = cat.name.toLowerCase()
        if (textLower.includes(catLower) || (catLower.length >= 2 && catLower.split(/[\s/、]+/).some(p => p && textLower.includes(p)))) {
          bestCatId = cat.id
          break
        }
      }
    }

    const cat = bestCatId ? catMap.get(bestCatId) : null
    return {
      group: g,
      suggestedCategoryId: cat?.id,
      suggestedCategoryName: cat?.name || '未分类',
      bookmarkCount: (g.bookmarkIds || []).length,
    }
  })
}

/**
 * 查找疑似重复链接（基于规范化后的一致 URL）
 * 严格红线：
 * 1. 排除系统官方保留书签（如 bm_ulink_*）
 * 2. 排除子书签（子书签为卡片附属链接，绝不作为顶层重复项被剔除）
 */
export function findDuplicateCandidates(bookmarks: Bookmark[]): DuplicateCluster[] {
  const active = bookmarks.filter(b => !b.deletedAt && b.url && !isOfficialBookmark(b) && !b.parentId)
  const normMap = new Map<string, Bookmark[]>()

  for (const b of active) {
    const norm = normalizeUrlForDedup(b.url)
    if (!norm) continue
    const group = normMap.get(norm) || []
    group.push(b)
    normMap.set(norm, group)
  }

  const results: DuplicateCluster[] = []
  for (const [norm, bms] of normMap.entries()) {
    if (bms.length > 1) {
      // 选出主书签：优先排序使用频次 highest useCount，次选 updatedAt 最新的
      const sorted = [...bms].sort((a, b) => (b.useCount || 0) - (a.useCount || 0) || (b.updatedAt || 0) - (a.updatedAt || 0))
      const [primary, ...duplicates] = sorted
      results.push({
        primary,
        duplicates,
        normalizedUrl: norm,
      })
    }
  }

  return results
}

/**
 * 汇总书签库当前状态
 */
export function calculateVaultHealth(
  bookmarks: Bookmark[],
  _categories: Category[],
  groupedBookmarkIds?: Set<string>,
  groups?: SiblingGroup[],
): VaultHygieneStats {
  const active = bookmarks.filter(b => !b.deletedAt)
  const totalCount = active.length
  if (totalCount === 0) {
    return {
      totalCount: 0,
      uncategorizedCount: 0,
      uncategorizedGroupCount: 0,
      duplicateCount: 0,
    }
  }

  const uncategorizedCount = active.filter(b => isUncategorized(b, groupedBookmarkIds)).length
  const duplicates = findDuplicateCandidates(active)
  const duplicateCount = duplicates.reduce((acc, d) => acc + d.duplicates.length, 0)
  const uncategorizedGroupCount = groups ? groups.filter(g => isUncategorizedGroup(g)).length : 0

  return {
    totalCount,
    uncategorizedCount,
    uncategorizedGroupCount,
    duplicateCount,
  }
}
