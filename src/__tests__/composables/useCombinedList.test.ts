/**
 * A1-001 / A1-002：组合列表排序与 custom 过滤
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useCombinedList } from '../../composables/useCombinedList.js'
import { CAT_ALL } from '../../config/constants.js'

describe('useCombinedList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const ds = useDataStore()
    const ui = useUIStore()
    ui.curCat = CAT_ALL
    ui.groupsOnTop = false
    ui.searchQuery = ''
    ui.activeAttrs = []
    ui.excludedAttrs = []
    ui.focusedGroupId = null
    ds.bookmarks = [
      { id: 'b1', title: 'Old', url: 'https://old.test', icon: '', username: '', password: '', notes: '', categoryId: 'c1', parentId: null, order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 100, deletedAt: null },
      { id: 'b2', title: 'New', url: 'https://new.test', icon: '', username: '', password: '', notes: '', categoryId: 'c1', parentId: null, order: 2, useCount: 0, attributes: {}, isExpanded: false, createdAt: 2, updatedAt: 900, deletedAt: null },
      { id: 'b3', title: 'OtherCat', url: 'https://other.test', icon: '', username: '', password: '', notes: '', categoryId: 'c2', parentId: null, order: 3, useCount: 0, attributes: {}, isExpanded: false, createdAt: 3, updatedAt: 500, deletedAt: null },
    ] as any
    ds.siblingGroups = []
    ds.categories = [
      { id: 'c1', name: 'A', icon: '', color: '' },
      { id: 'c2', name: 'B', icon: '', color: '' },
    ] as any
    ds.customAttributes = []
    ds._syncMaps()
  })

  it('A1-001: dateDesc with default sortDir=desc puts newer first', () => {
    const ui = useUIStore()
    ui.sortMode = 'dateDesc'
    ui.sortDir = 'desc'
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.filter(c => c.type === 'bm').map(c => c.data.id)
    expect(ids[0]).toBe('b2')
    expect(ids[ids.length - 1]).toBe('b1')
  })

  it('A1-001: dateAsc puts older first', () => {
    const ui = useUIStore()
    ui.sortMode = 'dateAsc'
    ui.sortDir = 'desc'
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.filter(c => c.type === 'bm').map(c => c.data.id)
    expect(ids[0]).toBe('b1')
  })

  it('A1-002: custom mode respects category filter on ordered and appended items', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.curCat = 'c1'
    ds._customCardOrder = [
      { t: 'b', id: 'b1' },
      { t: 'b', id: 'b3' }, // other category — must be skipped
    ]
    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('custom')
    const ids = combinedList.value.map(c => c.data.id)
    expect(ids).toContain('b1')
    expect(ids).toContain('b2') // appended new in cat c1
    expect(ids).not.toContain('b3')
  })

  it('A1-003: custom 模式下置顶项仍浮顶，不被 _customCardOrder 压住', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.curCat = CAT_ALL
    // 自定义顺序把非置顶的 b2 排在第一个，置顶的 b1 排在第二个
    ds._customCardOrder = [
      { t: 'b', id: 'b2' },
      { t: 'b', id: 'b1' },
      { t: 'b', id: 'b3' },
    ]
    // b1 置顶
    ds.bookmarks[0].pinnedAt = 1700000000000
    ds._syncMaps()
    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('custom')
    const ids = combinedList.value.map(c => c.data.id)
    // 置顶项 b1 必须排到最前，无论 _customCardOrder 怎样排
    expect(ids[0]).toBe('b1')
    // 非置顶项之间保持自定义相对序：b2 在 b3 前
    expect(ids[1]).toBe('b2')
    expect(ids[2]).toBe('b3')
  })

  it('A1-004: groupsOnTop 开启时优先级高于单条置顶——置顶书签仍排在组之后', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.curCat = CAT_ALL
    ui.groupsOnTop = true
    // 补一个非置顶组 g1
    ds.siblingGroups = [
      { id: 'g1', name: 'G1', categoryId: 'c1', icon: '', order: 10, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 1, useCount: 0, isPublic: false } as any,
    ]
    ds._syncMaps()
    // 自定义顺序刻意把置顶书签 b2 排在组 g1 之前
    ds._customCardOrder = [
      { t: 'b', id: 'b2' },
      { t: 'g', id: 'g1' },
      { t: 'b', id: 'b1' },
    ]
    // b2 置顶（单条置顶）
    ds.bookmarks[1].pinnedAt = 1700000000000
    ds._syncMaps()
    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('custom')
    const ids = combinedList.value.map(c => c.data.id)
    // 组 g1（非置顶）必须排在置顶书签 b2 前：groupsOnTop 优先级 > pinnedAt
    expect(ids[0]).toBe('g1')
    const g1Idx = ids.indexOf('g1')
    const b2Idx = ids.indexOf('b2')
    expect(g1Idx).toBeLessThan(b2Idx)
    // 书签段内部置顶仍生效：b2 在非置顶书签 b1 前
    expect(b2Idx).toBeLessThan(ids.indexOf('b1'))
  })

  it('A1-005: groupsOnTop 关闭时单条置顶全局浮顶——置顶书签可排到组之前', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.curCat = CAT_ALL
    ui.groupsOnTop = false
    ds.siblingGroups = [
      { id: 'g1', name: 'G1', categoryId: 'c1', icon: '', order: 10, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 1, useCount: 0, isPublic: false } as any,
    ]
    ds._syncMaps()
    ds._customCardOrder = [
      { t: 'g', id: 'g1' },
      { t: 'b', id: 'b2' },
      { t: 'b', id: 'b1' },
    ]
    // b2 置顶
    ds.bookmarks[1].pinnedAt = 1700000000000
    ds._syncMaps()
    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('custom')
    const ids = combinedList.value.map(c => c.data.id)
    // groupsOnTop 关、b2 置顶 → b2 浮到最前，越过非置顶组 g1
    expect(ids[0]).toBe('b2')
    // g1 与 b1 按原相对序在后
    expect(ids.indexOf('g1')).toBeLessThan(ids.indexOf('b1'))
  })
})
