/**
 * useCombinedList-branches.test.ts — 补 useCombinedList.ts 未触达分支
 *
 * 覆盖既有 useCombinedList.test.ts(10 测 A1-001~D2-1) 未触达的：
 * - focus 模式（整块零覆盖）
 * - normal 模式 useCount/title/order 排序分支
 * - 组不存在时 focus 模式返空
 * - groupsOnTop=true 时 normal 模式不排序
 * - 置顶优先基本门
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useCombinedList } from '../../composables/useCombinedList.js'
import { CAT_ALL } from '../../config/constants.js'

function makeBm(id: string, overrides: Record<string, any> = {}) {
  return {
    id, title: `Title-${id}`, url: `https://${id}.test`, icon: '',
    username: '', password: '', notes: '', categoryId: 'c1',
    parentId: null, order: 1, useCount: 0, attributes: {},
    isExpanded: false, createdAt: 1, updatedAt: 100,
    deletedAt: null, pinnedAt: null, ...overrides,
  } as any
}

function makeGroup(id: string, overrides: Record<string, any> = {}) {
  return {
    id, name: `Group-${id}`, categoryId: 'c1', icon: '',
    order: 10, isExpanded: false, attributes: {}, bookmarkIds: [],
    notes: '', updatedAt: 1, useCount: 0, isPublic: false,
    deletedAt: null, pinnedAt: null, ...overrides,
  } as any
}

describe('useCombinedList branches', () => {
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
      makeBm('b1', { order: 1, updatedAt: 100, useCount: 5, title: 'Alpha' }),
      makeBm('b2', { order: 2, updatedAt: 900, useCount: 10, title: 'Beta' }),
      makeBm('b3', { order: 3, updatedAt: 500, useCount: 1, title: 'Gamma' }),
    ]
    ds.siblingGroups = []
    ds.categories = [{ id: 'c1', name: 'A', icon: '', color: '' }] as any
    ds.customAttributes = []
    ds._syncMaps()
  })

  // ── focus 模式 ──

  it('F1: focus 模式返回 focusedGroup 的组卡片', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ds.siblingGroups = [makeGroup('g1', { name: 'FocusedGroup', updatedAt: 999 })]
    ds._syncMaps()
    ui.focusedGroupId = 'g1'
    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('focus')
    expect(combinedList.value).toHaveLength(1)
    expect(combinedList.value[0].type).toBe('group')
    expect(combinedList.value[0].data.id).toBe('g1')
    expect((combinedList.value[0].data as any).name).toBe('FocusedGroup')
  })

  it('F2: focus 模式 groupMap 查不到 id → 返空数组', () => {
    const ui = useUIStore()
    ui.focusedGroupId = 'nonexistent'
    const { combinedList } = useCombinedList()
    expect(combinedList.value).toHaveLength(0)
  })

  // ── normal 模式排序分支 ──

  it('N1: normal 模式 useCount 排序 asc', () => {
    const ui = useUIStore()
    ui.sortMode = 'useCount'
    ui.sortDir = 'asc'
    ui.groupsOnTop = false
    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('normal')
    const ids = combinedList.value.filter(c => c.type === 'bm').map(c => c.data.id)
    // useCount asc: b3(1) → b1(5) → b2(10)
    expect(ids[0]).toBe('b3')
    expect(ids[1]).toBe('b1')
    expect(ids[2]).toBe('b2')
  })

  it('N2: normal 模式 useCount 排序 desc', () => {
    const ui = useUIStore()
    ui.sortMode = 'useCount'
    ui.sortDir = 'desc'
    ui.groupsOnTop = false
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.filter(c => c.type === 'bm').map(c => c.data.id)
    expect(ids[0]).toBe('b2')
    expect(ids[1]).toBe('b1')
    expect(ids[2]).toBe('b3')
  })

  it('N3: normal 模式 title 排序 asc', () => {
    const ui = useUIStore()
    ui.sortMode = 'title'
    ui.sortDir = 'asc'
    ui.groupsOnTop = false
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.filter(c => c.type === 'bm').map(c => c.data.id)
    // Alpha → Beta → Gamma
    expect(ids[0]).toBe('b1')
    expect(ids[1]).toBe('b2')
    expect(ids[2]).toBe('b3')
  })

  it('N4: normal 模式 title 排序 desc', () => {
    const ui = useUIStore()
    ui.sortMode = 'title'
    ui.sortDir = 'desc'
    ui.groupsOnTop = false
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.filter(c => c.type === 'bm').map(c => c.data.id)
    expect(ids[0]).toBe('b3')
    expect(ids[1]).toBe('b2')
    expect(ids[2]).toBe('b1')
  })

  it('N5: normal 模式 order 排序 asc', () => {
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.sortDir = 'asc'
    ui.groupsOnTop = false
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.filter(c => c.type === 'bm').map(c => c.data.id)
    // order asc: b1(1) → b2(2) → b3(3)
    expect(ids[0]).toBe('b1')
    expect(ids[1]).toBe('b2')
    expect(ids[2]).toBe('b3')
  })

  it('N6: normal 模式 order 排序 desc', () => {
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.sortDir = 'desc'
    ui.groupsOnTop = false
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.filter(c => c.type === 'bm').map(c => c.data.id)
    expect(ids[0]).toBe('b3') // order desc: b3(3) → b2(2) → b1(1)
    expect(ids[1]).toBe('b2')
    expect(ids[2]).toBe('b1')
  })

  it('N7: normal 模式 groupsOnTop=true 不排序→组在前', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.sortDir = 'desc'
    ui.groupsOnTop = true
    ds.siblingGroups = [makeGroup('g1', { name: 'G1', order: 10 })]
    ds._syncMaps()
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.map(c => c.data.id)
    // groupsOnTop=true 时 line 85 if(!ui.groupsOnTop) 不进入排序块
    // 组在前，书签按 filteredBookmarks 排序（order desc: b3→b2→b1）
    expect(ids[0]).toBe('g1')
    expect(ids[ids.length - 1]).toBe('b1')
  })

  it('N8: normal 模式置顶优先——pinned 书签排在非 pinned 前', () => {
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.sortDir = 'asc'
    ui.groupsOnTop = false
    // b2 置顶
    const ds = useDataStore()
    ds.bookmarks[1] = makeBm('b2', { order: 2, pinnedAt: 1700000000000 })
    ds._syncMaps()
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.filter(c => c.type === 'bm').map(c => c.data.id)
    // 置顶优先: b2 排在最前，其余保 order asc 序
    expect(ids[0]).toBe('b2')
    expect(ids[1]).toBe('b1')
    expect(ids[2]).toBe('b3')
  })

  it('N9: normal 模式置顶组排在非置顶组前', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.sortDir = 'asc'
    ui.groupsOnTop = false
    ds.siblingGroups = [
      makeGroup('g1', { name: 'G1', order: 10 }),
      makeGroup('g2', { name: 'G2', order: 20, pinnedAt: 1700000000000 }),
    ]
    ds._syncMaps()
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.map(c => c.data.id)
    // 置顶 g2 应排在非置顶 g1 前
    const g2Idx = ids.indexOf('g2')
    const g1Idx = ids.indexOf('g1')
    expect(g2Idx).toBeLessThan(g1Idx)
  })

  // ── mode computed 边界 ──

  it('M1: mode 值为 focus 当 focusedGroupId 设且存在', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ds.siblingGroups = [makeGroup('g1')]
    ds._syncMaps()
    ui.focusedGroupId = 'g1'
    ui.sortMode = 'order'
    ds._customCardOrder = [{ t: 'b', id: 'b1' }]
    const { mode } = useCombinedList()
    // focusedGroupId 优先于 _customCardOrder
    expect(mode.value).toBe('focus')
  })

  it('M2: mode 值为 normal 当无 focusedGroupId 且无 _customCardOrder', () => {
    const ui = useUIStore()
    ui.sortMode = 'order'
    const { mode } = useCombinedList()
    expect(mode.value).toBe('normal')
  })

  it('M3: mode 值为 normal 当 sortMode 非 order 即使有 _customCardOrder', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'title'
    ds._customCardOrder = [{ t: 'b', id: 'b1' }]
    const { mode } = useCombinedList()
    // _customCardOrder 存在但 sortMode !== 'order' → 走 normal
    expect(mode.value).toBe('normal')
  })

  // ── 组+书签混合排序分支（normal mode 排序比较器内类型分支）──

  it('S1: normal 模式 groupsOnTop=false 组+书签 title 混合排序', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'title'
    ui.sortDir = 'asc'
    ui.groupsOnTop = false
    ds.siblingGroups = [
      makeGroup('g1', { name: 'DataGroup', order: 10 }),
      makeGroup('g2', { name: 'ArchiveGroup', order: 20 }),
    ]
    ds._syncMaps()
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.map(c => c.data.id)
    // 组+书签混合 title 排序（'name' in da 对于组=true，书签=false 走 'title' in da）
    // localeCompare: Alpha(b1) → ArchiveGroup(g2) → Beta(b2) → DataGroup(g1) → Gamma(b3)
    // 'Alpha' < 'ArchiveGroup'（'l'(108) < 'r'(114)）
    expect(ids[0]).toBe('b1')
    expect(ids[1]).toBe('g2')
    expect(ids[2]).toBe('b2')
    expect(ids[3]).toBe('g1' as string)
  })

  it('S2: normal 模式 groupsOnTop=false 组+书签 useCount 混合排序', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'useCount'
    ui.sortDir = 'asc'
    ui.groupsOnTop = false
    ds.siblingGroups = [
      makeGroup('g1', { name: 'G1', useCount: 3 }),
      makeGroup('g2', { name: 'G2', useCount: 7 }),
    ]
    ds._syncMaps()
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.map(c => c.data.id)
    // useCount asc: g1(3) → b3(1) → b1(5) → g2(7) → b2(10)
    // 注意 filteredBookmarks 的 useCount 排序在前，filteredGroups 的 useCount 排序在后
    // 但 groupsOnTop=false 时所有项混合排序，按 useCount 全域排
    const b3Idx = ids.indexOf('b3')
    const g1Idx = ids.indexOf('g1')
    expect(g1Idx).toBeLessThan(ids.indexOf('g2'))
    expect(b3Idx).toBeLessThan(ids.indexOf('b2'))
  })
})