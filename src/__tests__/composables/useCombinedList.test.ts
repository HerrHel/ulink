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

  // D2-1 护栏：custom 模式 gMap/bmMap 查找完整性 + append 顺序 / 去重不变量
  // 这些用例锁定 custom 模式「Object.fromEntries(filtered*).map([id,obj]) 建 Map → order 遍历查表」
  // 这条路径的全部行为契约，为后续若优化双重建 Map（如复用缓存、改 Map 实现）铺可回归护栏。
  it('D2-1a: custom 模式 order 含不存在 id 时跳过、不影响 append 补全顺序', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.curCat = CAT_ALL
    ui.groupsOnTop = true // 固定 groupsOnTop 让 append 顺序可观测：组段在前书签段在后
    ds._syncMaps()
    // order 含两个不存在的 id（ghost-g、ghost-b）
    ds._customCardOrder = [
      { t: 'g', id: 'ghost-g' },
      { t: 'b', id: 'b2' },
      { t: 'b', id: 'ghost-b' },
      { t: 'b', id: 'b1' },
    ]
    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('custom')
    const ids = combinedList.value.map(c => c.data.id)
    expect(ids).not.toContain('ghost-g')
    expect(ids).not.toContain('ghost-b')
    // b2、b1 按 order 序先入（组段为空，直接进书签段头部）；b3 未在 order 里 → append 补到尾部
    expect(ids).toEqual(['b2', 'b1', 'b3'])
  })

  it('D2-1b: custom 模式 order 混合 g+b 按 order 序排，未列项 append 补全、used 去重不双收', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.curCat = CAT_ALL
    ui.groupsOnTop = true
    ds.siblingGroups = [
      { id: 'g1', name: 'G1', categoryId: 'c1', icon: '', order: 10, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 1, useCount: 0, isPublic: false } as any,
      { id: 'g2', name: 'G2', categoryId: 'c2', icon: '', order: 20, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 2, useCount: 0, isPublic: false } as any,
    ]
    ds._syncMaps()
    // order 把 b2 放第一（书签），但 groupsOnTop=true 会把组整体排到书签之前
    ds._customCardOrder = [
      { t: 'b', id: 'b2' },
      { t: 'g', id: 'g2' },
      { t: 'b', id: 'b1' },
    ]
    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('custom')
    const ids = combinedList.value.map(c => c.data.id)
    // 组段：order 命中 g2，append 补 g1（filteredGs 默认序 g1 在前）→ 组段 = [g2, g1]
    // 书签段：order 命中 b2、b1，append 补 b3 → 书签段 = [b2, b1, b3]
    // groupsOnTop=true 组段整体在前
    expect(ids).toEqual(['g2', 'g1', 'b2', 'b1', 'b3'])
    // 去重不变量：每条 id 仅出现一次
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('D2-1c: custom 模式 order 命中的组在 filteredGs 之外（其它分类）→ 跳过不纳入、不被 append', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.curCat = 'c1' // 只看 c1 分类
    ds.siblingGroups = [
      { id: 'g1', name: 'G1', categoryId: 'c1', icon: '', order: 10, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 1, useCount: 0, isPublic: false } as any,
      // g2 属 c2，在 curCat=c1 过滤下应当被 filteredGroups 排除
      { id: 'g2', name: 'G2', categoryId: 'c2', icon: '', order: 20, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 2, useCount: 0, isPublic: false } as any,
    ]
    ds._syncMaps()
    // order 引用了 c2 的组 g2 —— 因为 gMap 只由 filteredGs（已过滤到 c1）构建，g2 查不到 → 跳过
    ds._customCardOrder = [
      { t: 'g', id: 'g2' },
      { t: 'g', id: 'g1' },
      { t: 'b', id: 'b1' },
    ]
    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('custom')
    const ids = combinedList.value.map(c => c.data.id)
    // g2 不应出现（order 查不到 + append 补的是 filteredGs=c1 的 g1）
    expect(ids).not.toContain('g2')
    expect(ids).toContain('g1')
    // b3 属 c2 被 filtered 排除（A1-002 同理），b2 是 c1 的新增 → append
    expect(ids).toContain('b2')
    expect(ids).not.toContain('b3')
  })

  it('D2-1d: custom 模式空 order → 全部经由 append 补全、不命中不丢项、去重', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.curCat = CAT_ALL
    ui.groupsOnTop = true
    ds.siblingGroups = [
      { id: 'g1', name: 'G1', categoryId: 'c1', icon: '', order: 10, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 1, useCount: 0, isPublic: false } as any,
    ]
    ds._syncMaps()
    ds._customCardOrder = [] // 空 order：不命中任何项，usedGs/usedBms 为空，全部走 append
    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('custom')
    const ids = combinedList.value.map(c => c.data.id)
    // 空 order 不丢项：组段全 1 个 g1 经 append、书签段全 3 个经 append
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(ids.length) // 去重不变量
    expect(new Set(ids)).toEqual(new Set(['g1', 'b1', 'b2', 'b3']))
    // groupsOnTop=true 不变：唯一组 g1 排在所有书签之前
    expect(ids[0]).toBe('g1')
  })
})
