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
 *   - sortedParents：按拼音/字母 A-Z 排序的父级列表
 *   - filterParents：支持中文/英文/拼音首字母/URL 多维实时过滤
 */

import type { Bookmark } from '../../types.js'
import { displayText } from '../../utils.js'
import { pinyin, match } from 'pinyin-pro'

/** 把汉字/混合字符串转为拼音排序键（静默降级为原字符串） */
function getSortKey(str: string): string {
  if (!str) return ''
  try {
    return pinyin(str, { toneType: 'none', nonZh: 'consecutive' }).toLowerCase()
  } catch {
    return str.toLowerCase()
  }
}

/**
 * 对父级候选列表按拼音/字母 A-Z 排序（原地不修改，返回新数组）
 */
export function sortedParents(parents: Bookmark[]): Bookmark[] {
  return [...parents].sort((a, b) => {
    const ka = getSortKey(displayText(a.title) || a.url || '')
    const kb = getSortKey(displayText(b.title) || b.url || '')
    return ka.localeCompare(kb, 'en', { numeric: true })
  })
}

/**
 * 实时过滤父级候选：支持中文文本、英文文本、拼音首字母（dy→抖音）、全拼、URL/域名
 */
export function filterParents(parents: Bookmark[], query: string): Bookmark[] {
  const q = query.trim().toLowerCase()
  if (!q) return parents
  return parents.filter(b => {
    const title = (displayText(b.title) || '').toLowerCase()
    const url = (b.url || '').toLowerCase()
    // 1. 文本直接包含
    if (title.includes(q) || url.includes(q)) return true
    // 2. 拼音首字母 / 全拼匹配
    try {
      if (match(displayText(b.title) || '', q) !== null) return true
    } catch { /* pinyin-pro 不可用时跳过拼音匹配 */ }
    // 3. 拼音全拼包含
    const py = getSortKey(displayText(b.title) || '')
    if (py && py.includes(q)) return true
    return false
  })
}

/**
 * 可选父级候选：顶层（无 parentId）且未软删、排除当前编辑项自身；
 * 若当前已指定某个父级（如孙子书签的当前父级），该父级也必须包含在列表中以确保正常回显。
 * @param bookmarks 全量书签（含软删）
 * @param excludeId 当前编辑书签 id，排除以防「自挂为父」
 * @param currentParentId 当前选中的父级 ID（确保其能被回显）
 */
export function selectableParents(
  bookmarks: Bookmark[],
  excludeId: string | undefined,
  currentParentId?: string | null,
): Bookmark[] {
  return bookmarks.filter(b => (!b.parentId || (currentParentId && b.id === currentParentId)) && !b.deletedAt && b.id !== excludeId)
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
