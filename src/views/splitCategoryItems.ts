/**
 * 分类分享页视图模型：把「分类下的书签」切成组卡与散落书签卡两套（对齐 App 分类视图
 * 的混排逻辑：组卡在前，散落书签卡在后，一张书签只出现一次）。
 *
 * 抽成纯函数便于单测锁定口径（SSR 侧 functions/_lib/share-render.ts 的
 * splitCategoryItems 是同一逻辑的 snake_case 版本，两处口径必须保持一致）。
 *
 * 口径：
 * - 组内书签按 group.bookmarkIds 顺序取（与 App 组内顺序一致），不存在的 id 跳过；
 *   **子书签也保留**（跟随组顺序），由渲染层按 parentId 缩进体现层级
 * - 散落书签 = 不属于任何组的书签；**子书签不丢弃**：父也在散落集合里的挂到父卡片的
 *   children（支持多层级，depth 表示缩进深度），父在组内/不在本分类的孤儿则独立成卡
 *   （渲染层据 parentId 打「子书签」标记，说明父级不在当前展示范围）
 * - 同一书签被多组引用时以首个组为准（used 去重，避免重复成卡）
 */
import type { Bookmark, SiblingGroup } from '../types.js'

export interface CategoryGroupCard {
  group: SiblingGroup
  items: Bookmark[]
}

/** 散落卡片下的子书签（含层级，depth 从 1 起 = 直接子级） */
export interface CategoryLooseChild {
  bookmark: Bookmark
  depth: number
}

/** 散落书签卡：顶层书签 + 其子孙（DFS 扁平化，depth 表示缩进层级） */
export interface CategoryLooseCard {
  bookmark: Bookmark
  children: CategoryLooseChild[]
}

export interface SplitCategoryItems {
  groupCards: CategoryGroupCard[]
  loose: CategoryLooseCard[]
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

  // 未被任何组包含的书签（子书签在内，随后按 parentId 归位到父卡片）
  const rest: Bookmark[] = (bookmarks || []).filter((b) => {
    if (!b || !b.id) return false
    return !used.has(b.id)
  })
  const restIds = new Set(rest.map((b) => b.id))

  // 父 id → 直接子书签（保持原顺序）
  const kidsOf = new Map<string, Bookmark[]>()
  for (const b of rest) {
    const pid = (b.parentId || '').trim()
    if (!pid || !restIds.has(pid)) continue
    const arr = kidsOf.get(pid) || []
    arr.push(b)
    kidsOf.set(pid, arr)
  }
  // DFS 收集全部后代（支持孙级），扁平化后由 depth 表达缩进
  const collect = (parentId: string, depth: number, out: CategoryLooseChild[]): void => {
    for (const kid of kidsOf.get(parentId) || []) {
      out.push({ bookmark: kid, depth })
      collect(kid.id, depth + 1, out)
    }
  }

  const loose: CategoryLooseCard[] = []
  for (const b of rest) {
    const pid = (b.parentId || '').trim()
    // 父也在散落集合 → 该书签作为父卡片的子项出现（由父那轮 DFS 收集），此处不重复成卡
    if (pid && restIds.has(pid)) continue
    const children: CategoryLooseChild[] = []
    collect(b.id, 1, children)
    loose.push({ bookmark: b, children })
  }
  return { groupCards, loose }
}
