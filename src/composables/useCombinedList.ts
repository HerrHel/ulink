/**
 * useCombinedList — 卡片列表组合逻辑
 *
 * 从 CardGrid.vue 提取，职责单一：根据当前视图模式
 * （聚焦组/自定义排序/常规过滤）组合书签和组的展示列表。
 */
import { computed, type ComputedRef } from 'vue'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import type { CardItem, Bookmark } from '../types.js'

export type CombinedMode = 'focus' | 'custom' | 'normal'

export function useCombinedList(): { combinedList: ComputedRef<CardItem[]>; mode: ComputedRef<CombinedMode> } {
  const ds = useDataStore()
  const ui = useUIStore()

  const mode = computed<CombinedMode>(() => {
    if (ui.focusedGroupId) return 'focus'
    if (ds._customCardOrder != null && ui.sortMode === 'order') return 'custom'
    return 'normal'
  })

  const combinedList = computed<CardItem[]>(() => {
    switch (mode.value) {
      case 'focus': {
        const g = ds.groupMap[ui.focusedGroupId!]
        return g ? [{ type: 'group' as const, data: g }] : []
      }
      case 'custom': {
        const bmMap = ds.bookmarkMap
        const gMap = ds.groupMap
        const order = ds._customCardOrder!
        const usedBms = new Set<string>()
        const usedGs = new Set<string>()
        const combined: CardItem[] = []
        for (const entry of order) {
          if (entry.t === 'g') {
            const g = gMap[entry.id]
            if (g && !g.deletedAt) { combined.push({ type: 'group', data: g }); usedGs.add(entry.id) }
          } else {
            const b = bmMap[entry.id]
            if (b && !b.parentId && !b.deletedAt) { combined.push({ type: 'bm', data: b }); usedBms.add(entry.id) }
          }
        }
        // 追加不在自定义顺序中的新项
        for (const g of ds.siblingGroups) {
          if (!g.deletedAt && !usedGs.has(g.id)) combined.push({ type: 'group', data: g })
        }
        for (const b of ds.bookmarks) {
          if (!b.parentId && !b.deletedAt && !usedBms.has(b.id)) combined.push({ type: 'bm', data: b })
        }
        return combined
      }
      case 'normal': {
        const groups = ds.filteredGroups
        const topLevel = ds.filteredBookmarks.filter((b: Bookmark) => !b.parentId)
        const combined: CardItem[] = []
        for (const g of groups) combined.push({ type: 'group', data: g })
        for (const b of topLevel) combined.push({ type: 'bm', data: b })
        return combined
      }
    }
  })

  return { combinedList, mode }
}
