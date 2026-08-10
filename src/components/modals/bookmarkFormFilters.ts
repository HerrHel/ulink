/**
 * BookmarkModal 父级 / 子书签候选过滤纯逻辑
 *
 * 从 BookmarkModal.vue 的 parentOptions/childBookmarks 两 computed 内联过滤抽出。
 * 此前两处手写过滤不一致——parentOptions 漏 deletedAt 过滤、childBookmarks 有——
 * 致软删书签仍出现在「父级」下拉里（真 bug：选中软删父后 child 挂在 deletedAt 非空
 * 的 parent 上，主视图看不到该父子关系，parent 恢复前 child 悬空）。抽纯模块供
 * 单测复现锁定 + 单一真相源防两份再漂。
 *
 * 约束语义：
 *   - selectableParents：无 parentId（顶层书签可作父）、且未软删、且不是当前编辑项自身
 *   - selectableChildren：parentId 指向当前编辑项、且未软删
 */

import type { Bookmark } from '../../types.js'

/**
 * 可选父级候选：顶层（无 parentId）且未软删、排除当前编辑项自身
 * @param bookmarks 全量书签（含软删）
 * @param excludeId 当前编辑书签 id，排除以防「自挂为父」
 */
export function selectableParents(bookmarks: Bookmark[], excludeId: string | undefined): Bookmark[] {
  return bookmarks.filter(b => !b.parentId && !b.deletedAt && b.id !== excludeId)
}

/**
 * 当前编辑项的子书签候选：parentId 指向当前编辑项、且未软删
 * @param bookmarks 全量书签（含软删）
 * @param parentId 当前编辑书签 id
 */
export function selectableChildren(bookmarks: Bookmark[], parentId: string | undefined): Bookmark[] {
  if (!parentId) return []
  return bookmarks.filter(b => b.parentId === parentId && !b.deletedAt)
}
