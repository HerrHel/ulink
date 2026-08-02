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
  // visited 守卫：防止环化数据（sync 冲突 merge 误填反向 parentId / importHTML 错误嵌套等）
  // 导致 stack 永不空栈、子孙集合无限增长直至栈溢出崩溃。起始 id 先入 visited，
  // 每个子 id 首次出现才入栈/入 ids；已访问的 id（环回边指向自身或上游节点）不再入栈，
  // 使栈在有环数据上也能收敛。无环 DAG 下每个 id 本就只被枚举一次，visited 不拦任何节点，
  // 返回结果与无守卫版本逐字一致。
  const visited = new Set<string>([id])
  while (stack.length) {
    const pid = stack.pop()!
    const children = getChildren(pid)
    if (children) {
      for (const c of children) {
        if (visited.has(c.id)) continue
        visited.add(c.id)
        ids.push(c.id)
        stack.push(c.id)
      }
    }
  }
  return ids
}
