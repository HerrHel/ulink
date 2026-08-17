/**
 * dataQuery.ts — 数据查询纯函数（从 stores/data.ts 抽取）
 *
 * 仅含「过滤 / 排序 / 下标定位」等无副作用纯函数，不依赖 Pinia / 运行时状态，
 * 便于单测直测与 stores/data.ts 瘦身（TECH_DEBT A 类：过滤排序抽纯函数）。
 * 类型仅依赖 ./ui（排序模式）与 ../types（实体类型），无运行时副作用导入。
 */
import type { SortMode, SortDir } from '../stores/ui.js'

export type SortableItem = { useCount: number; order: number; updatedAt: number; pinnedAt?: number }

/**
 * 属性过滤：按激活 / 排除属性集合过滤实体列表。
 * 纯函数，依次对 activeAttrs 求交集、对 excludedAttrs 排除，返回新数组。
 */
export function _filterAttrs<T extends { attributes: Record<string, boolean> }>(items: T[], { activeAttrs, excludedAttrs }: { activeAttrs: string[]; excludedAttrs: string[] }): T[] {
  for (const aid of activeAttrs) items = items.filter(i => i.attributes[aid])
  for (const aid of excludedAttrs) items = items.filter(i => !i.attributes[aid])
  return items
}

/**
 * 经 id→实体 Map 定位数组下标（O(1) 查实体 + indexOf）。
 * map 与数组偶发不同步时回退 findIndex，保证 CRUD 不丢写。
 */
export function _indexOfById<T extends { id: string }>(
  arr: T[], map: Record<string, T>, id: string,
): number {
  const item = map[id]
  if (item) {
    const idx = arr.indexOf(item)
    if (idx >= 0) return idx
  }
  return arr.findIndex(x => x.id === id)
}

export function _sortItems<T extends SortableItem>(items: T[], { sortMode, sortDir }: { sortMode: SortMode; sortDir: SortDir }, nameKey: keyof T, dateKey: keyof T): void {
  const d = sortDir === 'asc' ? 1 : -1
  items.sort((a, b) => {
    // 置顶优先：pinnedAt 存在的项排最前，置顶项之间按当前排序模式排序
    const aPin = a.pinnedAt ? 1 : 0
    const bPin = b.pinnedAt ? 1 : 0
    if (aPin !== bPin) return bPin - aPin
    if (sortMode === 'useCount') return (a.useCount - b.useCount) * d
    if (sortMode === 'title') return String(a[nameKey]).localeCompare(String(b[nameKey])) * d
    // A1-001：dateDesc/dateAsc 已在比较式内编码方向，勿再乘 sortDir
    if (sortMode === 'dateDesc') return (((b[dateKey] as number) || 0) - ((a[dateKey] as number) || 0))
    if (sortMode === 'dateAsc') return (((a[dateKey] as number) || 0) - ((b[dateKey] as number) || 0))
    return (a.order - b.order) * d
  })
}
