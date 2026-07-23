/**
 * useCombinedList — 卡片列表组合逻辑
 *
 * 从 CardGrid.vue 提取，职责单一：根据当前视图模式
 * （聚焦组/自定义排序/常规过滤）组合书签和组的展示列表。
 */
import { computed, type ComputedRef } from 'vue'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import type { CardItem, Bookmark, SiblingGroup } from '../types.js'

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
        // A1-002：候选集一律 filtered*，避免分类/搜索/属性被自定义顺序旁路
        const filteredGs = ds.filteredGroups
        const filteredBms = ds.filteredBookmarks.filter((b: Bookmark) => !b.parentId)
        const gMap = Object.fromEntries(filteredGs.map(g => [g.id, g]))
        const bmMap = Object.fromEntries(filteredBms.map(b => [b.id, b]))
        const order = ds._customCardOrder!
        const usedBms = new Set<string>()
        const usedGs = new Set<string>()
        const combined: CardItem[] = []
        for (const entry of order) {
          if (entry.t === 'g') {
            const g = gMap[entry.id]
            if (g) { combined.push({ type: 'group', data: g }); usedGs.add(entry.id) }
          } else {
            const b = bmMap[entry.id]
            if (b) { combined.push({ type: 'bm', data: b }); usedBms.add(entry.id) }
          }
        }
        for (const g of filteredGs) {
          if (!usedGs.has(g.id)) combined.push({ type: 'group', data: g })
        }
        for (const b of filteredBms) {
          if (!usedBms.has(b.id)) combined.push({ type: 'bm', data: b })
        }
        return combined
      }
      case 'normal': {
        const groups = ds.filteredGroups
        const topLevel = ds.filteredBookmarks.filter((b: Bookmark) => !b.parentId)
        const combined: CardItem[] = []
        if (ui.groupsOnTop) {
          for (const g of groups) combined.push({ type: 'group', data: g })
          for (const b of topLevel) combined.push({ type: 'bm', data: b })
        } else {
          for (const g of groups) combined.push({ type: 'group', data: g })
          for (const b of topLevel) combined.push({ type: 'bm', data: b })
          const d = ui.sortDir === 'asc' ? 1 : -1
          const sm = ui.sortMode
          combined.sort((a, b) => {
            const da = a.data as SiblingGroup | Bookmark
            const db = b.data as SiblingGroup | Bookmark
            // 置顶优先
            const aPin = (da as any).pinnedAt ? 1 : 0
            const bPin = (db as any).pinnedAt ? 1 : 0
            if (aPin !== bPin) return bPin - aPin
            if (sm === 'useCount') return ((da.useCount || 0) - (db.useCount || 0)) * d
            if (sm === 'title') {
              const na = 'name' in da ? (da.name || '') : ('title' in da ? (da.title || '') : '')
              const nb = 'name' in db ? (db.name || '') : ('title' in db ? (db.title || '') : '')
              return na.localeCompare(nb) * d
            }
            // A1-001：dateDesc/dateAsc 已在比较式内编码方向，勿再乘 sortDir
            if (sm === 'dateDesc') return (db.updatedAt || 0) - (da.updatedAt || 0)
            if (sm === 'dateAsc') return (da.updatedAt || 0) - (db.updatedAt || 0)
            return ((da.order || 0) - (db.order || 0)) * d
          })
        }
        return combined
      }
      default:
        // mode 为 CombinedMode 三态穷尽，无遗漏；default 仅为消除 computed 不返回路径的 lint 误报。
        return []
    }
  })

  return { combinedList, mode }
}
