/**
 * 收集子孙书签 id —— 纯函数
 *
 * 从 childrenMap 做 BFS 收集给定 id 的所有后代(含自身)。
 * 统一替换 useBookmark / useBatch / DeadLinksPopover 三处复制实现。
 *
 * @param getChildren 给定父 id 返回其直接子书签数组(通常为 `id => dataStore.childrenMap[id]`)
 * @param id 起始书签 id
 * @returns 含自身在内的所有后代 id(DFS,BFS 顺序不影响最终集合)
 */
import type { Bookmark } from '../types.js'

export function collectDescendantIds(
  getChildren: (parentId: string) => Bookmark[] | undefined,
  id: string,
): string[] {
  const ids: string[] = [id]
  const stack = [id]
  while (stack.length) {
    const pid = stack.pop()!
    const children = getChildren(pid)
    if (children) {
      for (const c of children) {
        ids.push(c.id)
        stack.push(c.id)
      }
    }
  }
  return ids
}
