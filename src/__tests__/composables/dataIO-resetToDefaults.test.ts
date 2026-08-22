/**
 * dataIO-resetToDefaults.test.ts — resetToDefaults 高危编排契约护栏
 *
 * resetToDefaults 是「清空本机所有数据恢复默认」的不可逆高危操作，14 步编排含 7 处
 * 隐含契约（登录感知文案 → DEFAULTS 覆盖 4 数组 → 紧随 _syncMaps 否则 map 条数相同时
 * 返回陈旧对象 → 4 个 dirty 集合必 clear 否则旧 id 被 enqueue 推云复活 → ui 5 状态重置
 * → undo 闭包里那行不起眼但关键的 _syncMaps() 否则撤销后所有 map 查找 miss 性能退化）。
 * 全链此前零断言——一旦重构误删任一步，静默退化首次被用户发现时已丢数据。
 *
 * 本文件纯加测轮：useDataIO.ts 已 export resetToDefaults，零源改动，同口径同源编排护栏。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// —— mock 外部副作用面（confirm / toast / 本机持久化 / 同步队列 / 动态 import useAuth）——

let confirmResult: boolean = true
let authLoggedIn = false

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn((_msg: string, undo: () => void) => { (toastWithUndo as any).__undo = undo }),
  showConfirm: vi.fn(() => Promise.resolve(confirmResult)),
}))

vi.mock('../../lib/search.js', () => ({ clearSearchCache: vi.fn() }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))

// storage.js 真 Dexie 封装在 jsdom 下顶层会引 IDB，整 mock 只导 resetToDefaults 实际消费的 clearAllSyncOps
vi.mock('../../stores/storage.js', () => ({ clearAllSyncOps: vi.fn() }))
// syncPending 整 mock：resetToDefaults 仅消费 __testPendingSync.clear()
vi.mock('../../composables/domain/syncPending.js', () => ({ __testPendingSync: { clear: vi.fn() } }))

// 动态 import('./useAuth.js') 拦截：控制 loggedIn 分支
vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => ({ isLoggedIn: authLoggedIn }),
}))

import { useDataStore, __testHistDebounce, _cancelPendingHist } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { resetToDefaults } from '../../composables/domain/useDataIO.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'
import { clearSearchCache } from '../../lib/search.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { clearAllSyncOps } from '../../stores/storage.js'
import { __testPendingSync } from '../../composables/domain/syncPending.js'
import { buildSeedDefaults } from '../../config/constants.js'

/** 造一个非默认填充的 store 供 reset 覆盖验证：4 数组 + 4 脏标 + _customCardOrder + ui 5 状态 全 non-default */
function seedNonDefaultState() {
  const ds = useDataStore()
  const ui = useUIStore()
  ds.addBookmark({
    id: 'bm-1', title: 'T1', url: 'https://a.example', username: '', password: '', notes: '',
    icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0,
    attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
  } as any)
  ds._customCardOrder = [{ t: 'b', id: 'bm-1' }]
  ds._dirtyIds.add('bm-1')
  ds._newIds.add('bm-1')
  ds._deletedIds.set('bm-ghost', 'bookmarks')
  ds._changedFields.set('bm-1', new Set(['title']))
  ui.curCat = 'cat-x'
  ui.focusedGroupId = 'g-something'
  ui.activeAttrs = ['attr-a']
  ui.excludedAttrs = ['attr-b']
  ui.detailCards = ['c1', 'c2', 'c3']
  return { ds, ui }
}

describe('resetToDefaults confirm 文案分支', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    confirmResult = true
    authLoggedIn = false
  })

  it('未登录时确认文案为「确认清除所有数据？」', async () => {
    authLoggedIn = false
    await resetToDefaults()
    const msg = (showConfirm as any).mock.calls[0][0] as string
    expect(msg).toContain('确认清除所有数据？')
    expect(msg).not.toContain('不会删除云端数据')
  })

  it('已登录时确认文案标明「不会删除云端数据」，提醒用户仅清本机', async () => {
    authLoggedIn = true
    await resetToDefaults()
    const msg = (showConfirm as any).mock.calls[0][0] as string
    expect(msg).toContain('不会删除云端数据')
    expect(msg).toContain('确认清除本机所有数据')
  })

  it('confirm 返回 false 时直接早返回，不触达任何状态写入/清空/持久化', async () => {
    confirmResult = false
    const { ds, ui } = seedNonDefaultState()
    const beforeCats = ds.categories.length
    const beforeBm = ds.bookmarks.length
    await resetToDefaults()
    // store 一切照旧
    expect(ds.bookmarks.length).toBe(beforeBm)
    expect(ds.categories.length).toBe(beforeCats)
    expect(ds._dirtyIds.size).toBe(1)
    expect(ds._newIds.size).toBe(1)
    expect(ds._customCardOrder).toEqual([{ t: 'b', id: 'bm-1' }])
    expect(ui.curCat).toBe('cat-x')
    expect(ui.detailCards).toEqual(['c1', 'c2', 'c3'])
    // 副作用零触达
    expect(saveAppData).not.toHaveBeenCalled()
    expect(clearAllSyncOps).not.toHaveBeenCalled()
    expect(clearSearchCache).not.toHaveBeenCalled()
    expect(toastWithUndo).not.toHaveBeenCalled()
  })
})

describe('resetToDefaults DEFAULTS 覆盖 + _syncMaps 重建索引', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    confirmResult = true
    authLoggedIn = false
    // 固定 Date.now：resetToDefaults 内部与断言期 buildSeedDefaults() 都会用 Date.now()
    // 生成 createdAt/updatedAt，真实时钟会差 1ms 导致 toEqual 失败（全量并发时必现）。
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('4 个数组应被 DEFAULTS 覆盖：清空本机非默认数据', async () => {
    seedNonDefaultState()
    const ds = useDataStore()
    expect(ds.bookmarks.length).toBeGreaterThan(0)
    await resetToDefaults()
    const expected = buildSeedDefaults()
    expect(ds.categories).toEqual(expected.categories)
    expect(ds.bookmarks).toEqual(expected.bookmarks)
    expect(ds.customAttributes).toEqual(expected.customAttributes)
    expect(ds.siblingGroups).toEqual(expected.siblingGroups)
  })

  it('覆盖后 _syncMaps 必被调，map 与数组同步（避免 map 条数相同时返回陈旧对象）', async () => {
    seedNonDefaultState()
    const ds = useDataStore()
    const spy = vi.spyOn(ds, '_syncMaps')
    await resetToDefaults()
    expect(spy).toHaveBeenCalledTimes(1)
    // 索引确实反映 seed defaults 的书签 id
    const expected = buildSeedDefaults()
    for (const b of expected.bookmarks) {
      expect(ds.bookmarkMap[b.id]).toBeTruthy()
    }
    // 旧的非默认 id 'bm-1' 应已从 map 中消失
    expect(ds.bookmarkMap['bm-1']).toBeUndefined()
  })
})

describe('resetToDefaults 4 个 dirty 集合 + _customCardOrder 清空', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    confirmResult = true
    authLoggedIn = false
  })

  it('reset 后 _dirtyIds/_newIds/_deletedIds/_changedFields 全清空，旧 id 不再 enqueue 推云复活', async () => {
    seedNonDefaultState()
    const ds = useDataStore()
    expect(ds._dirtyIds.size).toBe(1)
    expect(ds._newIds.size).toBe(1)
    expect(ds._deletedIds.size).toBe(1)
    expect(ds._changedFields.size).toBe(1)
    await resetToDefaults()
    expect(ds._dirtyIds.size).toBe(0)
    expect(ds._newIds.size).toBe(0)
    expect(ds._deletedIds.size).toBe(0)
    expect(ds._changedFields.size).toBe(0)
  })

  it('reset 后 _customCardOrder = null', async () => {
    seedNonDefaultState()
    const ds = useDataStore()
    expect(ds._customCardOrder).toEqual([{ t: 'b', id: 'bm-1' }])
    await resetToDefaults()
    expect(ds._customCardOrder).toBeNull()
  })
})

describe('resetToDefaults 历史/搜索/同步队列清空三件套', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    __testHistDebounce.clear()
    vi.clearAllMocks()
    confirmResult = true
    authLoggedIn = false
  })

  it('_cancelPendingHist 调用后模块级历史防抖 Map 被清空', async () => {
    // seed 一个待清的防抖 timer+data，模拟 reset 前已有布置的防抖定时器
    const t = setTimeout(() => {}, 1000)
    __testHistDebounce.seed('hist-id', t, { x: 1 })
    expect(__testHistDebounce.peekSize().timers).toBe(1)
    expect(__testHistDebounce.peekSize().data).toBe(1)
    seedNonDefaultState()
    await resetToDefaults()
    expect(__testHistDebounce.peekSize().timers).toBe(0)
    expect(__testHistDebounce.peekSize().data).toBe(0)
    clearTimeout(t)
  })

  it('clearSearchCache 与 _bumpSearchVersion 都被调（搜索索引全量重建信号）', async () => {
    seedNonDefaultState()
    const ds = useDataStore()
    const before = ds._searchVersion
    await resetToDefaults()
    expect(clearSearchCache).toHaveBeenCalledTimes(1)
    // _bumpSearchVersion 直接 _searchVersion++，非防抖版
    expect(ds._searchVersion).toBe(before + 1)
  })

  it('clearAllSyncOps 与 __testPendingSync.clear 都被调，同步推云队列清空', async () => {
    seedNonDefaultState()
    await resetToDefaults()
    expect(clearAllSyncOps).toHaveBeenCalledTimes(1)
    expect((__testPendingSync.clear as any)).toHaveBeenCalledTimes(1)
  })
})

describe('resetToDefaults ui 5 状态重置', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    confirmResult = true
    authLoggedIn = false
  })

  it('curCat/focusedGroupId/activeAttrs/excludedAttrs/detailCards 全部归零', async () => {
    seedNonDefaultState()
    const ui = useUIStore()
    await resetToDefaults()
    expect(ui.curCat).toBe('all')
    expect(ui.focusedGroupId).toBeNull()
    expect(ui.activeAttrs).toEqual([])
    expect(ui.excludedAttrs).toEqual([])
    expect(ui.detailCards).toEqual([])
  })
})

describe('resetToDefaults 持久化 + toast 文案', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    confirmResult = true
    authLoggedIn = false
  })

  it('saveAppData 被调，把重置后状态落本机', async () => {
    seedNonDefaultState()
    await resetToDefaults()
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('toastWithUndo 用文案「数据已重置为默认」注册 undo 闭包', async () => {
    seedNonDefaultState()
    await resetToDefaults()
    expect(toastWithUndo).toHaveBeenCalledTimes(1)
    expect((toastWithUndo as any).mock.calls[0][0]).toBe('数据已重置为默认')
  })
})

describe('resetToDefaults undo 闭包：撤销必正确还原 + 重建索引', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    confirmResult = true
    authLoggedIn = false
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('undo 闭包执行后：4 数组 + curCat 回到 snapshot，_syncMaps 再调一次重建索引', async () => {
    seedNonDefaultState()
    const ds = useDataStore()
    const ui = useUIStore()
    const expectedBmLen = ds.bookmarks.length
    // 先捕获 undo 闭包（toastWithUndo mock 第二参存到 __undo）
    await resetToDefaults()
    // reset 后已被 seed defaults 覆盖
    expect(ds.bookmarks).toEqual(buildSeedDefaults().bookmarks)
    expect(ui.curCat).toBe('all')
    const undo = (toastWithUndo as any).__undo as () => void
    expect(typeof undo).toBe('function')
    // 计 undo 调用前的 _syncMaps 次数（reset 已调 1 次）
    const spy = vi.spyOn(ds, '_syncMaps')
    undo()
    // 数组与 curCat 回到 snapshot
    expect(ds.bookmarks.length).toBe(expectedBmLen)
    expect(ds.bookmarks[0].id).toBe('bm-1')
    expect(ui.curCat).toBe('cat-x')
    // 关键：undo 必 _syncMaps 重建索引，否则撤销后所有 map miss
    expect(spy).toHaveBeenCalledTimes(1)
    expect(ds.bookmarkMap['bm-1']).toBeTruthy()
  })

  it('undo 闭包执行后 debouncedSaveAppData 被调 + toast「数据已恢复」', async () => {
    seedNonDefaultState()
    await resetToDefaults()
    const undo = (toastWithUndo as any).__undo as () => void
    undo()
    expect(debouncedSaveAppData).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('数据已恢复')
  })
})
