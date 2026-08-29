/**
 * 分类分享页视图模型：把「分类下的书签」切成组卡与散落书签卡两套（对齐 App 分类视图
 * 的混排逻辑：组卡在前，散落书签卡在后，一张书签只出现一次）。
 *
 * 抽成纯函数便于单测锁定口径（SSR 侧 functions/_lib/share-render.ts 的
 * splitCategoryItems 是同一逻辑的 snake_case 版本，两处口径必须保持一致）。
 *
 * 口径：
 * - 组内书签按 group.bookmarkIds 顺序取（与 App 组内顺序一致），不存在的 id 跳过
 * - 散落书签 = 不属于任何组 且 非子书签（parentId 非空在 App 内嵌在父书签下，不单独成卡）
 * - 同一书签被多组引用时以首个组为准（used 去重，避免重复成卡）
 */
import type { Bookmark, SiblingGroup } from '../types.js'

export interface CategoryGroupCard {
  group: SiblingGroup
  items: Bookmark[]
}

export interface SplitCategoryItems {
  groupCards: CategoryGroupCard[]
  loose: Bookmark[]
}

export function splitCategoryItems(
  groups: SiblingGroup[],
  bookmarks: Bookmark[],
): SplitCategoryItems {
  const byId = new Map<string, Bookmark>()
  for (const b of bookmarks || []) {
    if (b && b.id) byId.set(b.id, b)
  }
  const used = new Set<string>()
  const groupCards: CategoryGroupCard[] = (groups || []).map((g) => {
    const ids = Array.isArray(g.bookmarkIds) ? g.bookmarkIds : []
    const items: Bookmark[] = []
    for (const id of ids) {
      const b = byId.get(id)
      if (!b || used.has(id)) continue
      used.add(id)
      items.push(b)
    }
    return { group: g, items }
  })
  const loose = (bookmarks || []).filter((b) => {
    if (!b || !b.id) return false
    if (used.has(b.id)) return false
    return !b.parentId
  })
  return { groupCards, loose }
}
