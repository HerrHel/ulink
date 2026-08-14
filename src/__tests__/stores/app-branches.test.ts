/**
 * 行为契约护栏：useAppStore Facade 委托覆盖补全
 *
 * 现有 app.test.ts 只测 3 个 CRUD 委托 + 3 个 UI 读写 + save 指纹 H1；
 * app-save-fail.test.ts 锁 save() 失败节流 + Zod 校验；app-fingerprint.test.ts 锁纯函数指纹。
 * 大量 Facade 转发/编排分支零覆盖：(restore/permanentDelete/addGroup/updateGroup/deleteGroup/
 * renameCategory/deleteCategory/addAttribute/renameAttribute/deleteAttribute/emptyTrash 委托) +
 * (selectAllBatch/saveUIState/restoreUIState/loadFromStorage/tryLoadFromIDB 委托) +
 * importFromData 编排 + debouncedSave/flushDebouncedSave + getStorageInfo 缓存dirty +
 * _backupBeforeImport 委托 + 顶层 saveAppData/debouncedSaveAppData/debouncedSaveAppDataNotes/
 * flushSaveAppData 导出 + save() vault space 分支 + cleanStale(_saveCount%10===0) 分支。
 *
 * 纯加测试零源改动：所有路径经 useAppStore() return 暴露。锁「委托目标被正确转发」+「编排副作用」
 * 真实行为契约，非刷行数。每条配一句「锁住什么行为」。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useUndoStore } from '../../stores/undo.js'
import * as persist from '../../stores/persist.js'
import {
  saveAppData,
  debouncedSaveAppData,
  debouncedSaveAppDataNotes,
  flushSaveAppData,
} from '../../stores/app.js'
import { preloadSearchLibs } from '../../lib/search.js'

beforeAll(async () => {
  await preloadSearchLibs()
})

let saveSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  setActivePinia(createPinia())
  saveSpy = vi.spyOn(persist, 'saveData').mockResolvedValue(true)
})

afterEach(() => {
  saveSpy.mockRestore()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 让 store 产生指纹变化避免被 fp===_lastSavedFp 早退跳过省测编排 */
function makeDirty() {
  useDataStore().addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com' } as never)
}

describe('useAppStore Facade — CRUD 委托转发完整性', () => {
  it('addGroup 委托 dataStore.addGroup', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'addGroup')
    store.addGroup({ id: 'g1' } as never)
    expect(spy).toHaveBeenCalledWith({ id: 'g1' })
  })
  it('updateGroup 委托 dataStore.updateGroup', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'updateGroup')
    store.updateGroup('g1', { name: '组名' })
    expect(spy).toHaveBeenCalledWith('g1', { name: '组名' })
  })
  it('deleteGroup 委托 dataStore.deleteGroup', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'deleteGroup')
    store.deleteGroup('g1')
    expect(spy).toHaveBeenCalledWith('g1')
  })
  it('addCategory 委托 dataStore.addCategory（addCategory 内部补 updatedAt，用 partial 容忍）', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'addCategory')
    store.addCategory({ id: 'cat1' } as never)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'cat1' }))
  })
  it('renameCategory 委托 dataStore.renameCategory', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'renameCategory')
    store.renameCategory('cat1', '新名')
    expect(spy).toHaveBeenCalledWith('cat1', '新名')
  })
  it('deleteCategory 委托 dataStore.deleteCategory', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'deleteCategory')
    store.deleteCategory('cat1')
    expect(spy).toHaveBeenCalledWith('cat1')
  })
  it('addAttribute 委托 dataStore.addAttribute（addAttribute 内部补 updatedAt，用 partial 容忍）', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'addAttribute')
    store.addAttribute({ id: 'a1' } as never)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }))
  })
  it('renameAttribute 委托 dataStore.renameAttribute', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'renameAttribute')
    store.renameAttribute('a1', '新属性')
    expect(spy).toHaveBeenCalledWith('a1', '新属性')
  })
  it('deleteAttribute 委托 dataStore.deleteAttribute', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'deleteAttribute')
    store.deleteAttribute('a1')
    expect(spy).toHaveBeenCalledWith('a1')
  })
  it('restoreBookmark/restoreGroup/restoreCategory/restoreAttribute 各自委托', () => {
    const store = useAppStore()
    const ds = useDataStore()
    const s1 = vi.spyOn(ds, 'restoreBookmark')
    const s2 = vi.spyOn(ds, 'restoreGroup')
    const s3 = vi.spyOn(ds, 'restoreCategory')
    const s4 = vi.spyOn(ds, 'restoreAttribute')
    store.restoreBookmark('b1'); store.restoreGroup('g1'); store.restoreCategory('c1'); store.restoreAttribute('a1')
    expect(s1).toHaveBeenCalledWith('b1')
    expect(s2).toHaveBeenCalledWith('g1')
    expect(s3).toHaveBeenCalledWith('c1')
    expect(s4).toHaveBeenCalledWith('a1')
  })
  it('permanentDeleteBookmark/Group/Category/Attribute 各自委托', () => {
    const store = useAppStore()
    const ds = useDataStore()
    const s1 = vi.spyOn(ds, 'permanentDeleteBookmark')
    const s2 = vi.spyOn(ds, 'permanentDeleteGroup')
    const s3 = vi.spyOn(ds, 'permanentDeleteCategory')
    const s4 = vi.spyOn(ds, 'permanentDeleteAttribute')
    store.permanentDeleteBookmark('b1'); store.permanentDeleteGroup('g1')
    store.permanentDeleteCategory('c1'); store.permanentDeleteAttribute('a1')
    expect(s1).toHaveBeenCalledWith('b1')
    expect(s2).toHaveBeenCalledWith('g1')
    expect(s3).toHaveBeenCalledWith('c1')
    expect(s4).toHaveBeenCalledWith('a1')
  })
  it('emptyTrash 委托 dataStore.emptyTrash', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'emptyTrash')
    store.emptyTrash()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('useAppStore Facade — UI/数据 委托转发', () => {
  it('selectAllBatch 委托 uiStore.selectAllBatch', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useUIStore(), 'selectAllBatch')
    store.selectAllBatch()
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('saveUIState 委托 uiStore.saveUIState', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useUIStore(), 'saveUIState')
    store.saveUIState()
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('restoreUIState 委托 uiStore.restoreUIState', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useUIStore(), 'restoreUIState')
    store.restoreUIState()
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('loadFromStorage 委托 dataStore.loadFromStorage', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'loadFromStorage')
    store.loadFromStorage()
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('tryLoadFromIDB 委托并透传 dataStore.tryLoadFromIDB 返回值', async () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), 'tryLoadFromIDB').mockResolvedValue(true)
    const r = await store.tryLoadFromIDB()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(r).toBe(true)
  })
  it('_dataSnapshot 委托 dataStore._dataSnapshot', () => {
    const store = useAppStore()
    const spy = vi.spyOn(useDataStore(), '_dataSnapshot').mockReturnValue({ bookmarks: [] } as never)
    const r = store._dataSnapshot()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ bookmarks: [] })
  })
})

describe('importFromData 编排：委托 ds.importFromData + 重置 UI 态 + 触发 save', () => {
  it('重置 curCat/focusedGroupId/activeAttrs/excludedAttrs/detailCards + 调 save', async () => {
    const store = useAppStore()
    const ds = useDataStore()
    const ui = useUIStore()
    // 预置非默认 UI 态验证清爽
    ui.curCat = 'someCat'; ui.focusedGroupId = 'g1'
    ui.activeAttrs = ['a1']; ui.excludedAttrs = ['a2']; ui.detailCards = ['b1']
    const importSpy = vi.spyOn(ds, 'importFromData').mockImplementation(() => {})

    const payload = { bookmarks: [{ id: 'x1' }] } as never
    store.importFromData(payload)
    expect(importSpy).toHaveBeenCalledWith(payload)
    expect(ui.curCat).toBe('all')
    expect(ui.focusedGroupId).toBeNull()
    expect(ui.activeAttrs).toEqual([])
    expect(ui.excludedAttrs).toEqual([])
    expect(ui.detailCards).toEqual([])
    // importFromData 末尾调 this.save() → saveData 被调
    // 注意 importFromData 是同步函但 save 返 Promise；saveData mockResolvedValue(true) 已设
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
})

describe('save() — vault space 分支 + cleanStale 触发分支', () => {
  it('vault space：指纹按 vault 键存取（与 main 独立）', async () => {
    const store = useAppStore()
    const ui = useUIStore()
    ui.curSpace = 'vault'
    makeDirty()
    await store.save()
    expect(saveSpy).toHaveBeenCalledTimes(1)
    // 同指纹再 save（vault 空间下）应被早退
    await store.save()
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
  it('main 与 vault 指纹独立：main 落盘后切 vault 仍需重新落盘', async () => {
    const store = useAppStore()
    const ui = useUIStore()
    makeDirty()
    ui.curSpace = 'main'
    await store.save()
    expect(saveSpy).toHaveBeenCalledTimes(1)
    // 切 vault：fp 走 _lastSavedFp['vault']（空）→ 不早退，重新落盘
    ui.curSpace = 'vault'
    await store.save()
    expect(saveSpy).toHaveBeenCalledTimes(2)
  })
  it('cleanStale 每 10 次 save 触发一次（_saveCount % 10 === 0）', async () => {
    const store = useAppStore()
    const cleanSpy = vi.spyOn(useUndoStore(), 'cleanStale')
    // _saveCount 从 0 起，每次 save 递增；% 10===0 在第 10 次（_saveCount=10）触发
    // 前 9 次每次须 dirty（指纹变化才不被早退递增 _saveCount）
    for (let i = 0; i < 9; i++) {
      useDataStore().addBookmark({ id: `bm${i}`, title: String(i), url: `https://${i}.com` } as never)
      await store.save()
    }
    expect(cleanSpy).not.toHaveBeenCalled()
    // 第 10 次：_saveCount 变 10，%10===0 触发 cleanStale
    useDataStore().addBookmark({ id: 'bm9', title: '9', url: 'https://9.com' } as never)
    await store.save()
    expect(cleanSpy).toHaveBeenCalledTimes(1)
  })
})

describe('debouncedSave / flushDebouncedSave', () => {
  it('debouncedSave 设 timer，延迟内不再 save；到期触发 save', () => {
    vi.useFakeTimers()
    const store = useAppStore()
    makeDirty()
    store.debouncedSave()
    expect(saveSpy).not.toHaveBeenCalled()
    // 重复调用覆盖前 timer 不泄漏：clear 上一个再设
    store.debouncedSave()
    vi.advanceTimersByTime(300)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
  it('debouncedSave 自定义 delayMs', () => {
    vi.useFakeTimers()
    const store = useAppStore()
    makeDirty()
    store.debouncedSave(1000)
    vi.advanceTimersByTime(300)
    expect(saveSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(700)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
  it('flushDebouncedSave：取消在途 timer 并立即 save（可 await）', async () => {
    vi.useFakeTimers()
    const store = useAppStore()
    makeDirty()
    store.debouncedSave(1000)
    const p = store.flushDebouncedSave()
    await p
    expect(saveSpy).toHaveBeenCalledTimes(1)
    // timer 已被清，假时器推进到期日不该再触发
    vi.advanceTimersByTime(2000)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
  it('flushDebouncedSave 无在途 timer 也直接 save', async () => {
    vi.useFakeTimers()
    const store = useAppStore()
    makeDirty()
    await store.flushDebouncedSave()
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
})

describe('getStorageInfo 缓存 dirty 分支', () => {
  it('dirty 时重算 + 清 dirty + cache；再取复用 cache 不重算', () => {
    const store = useAppStore()
    const ds = useDataStore()
    ds._storageInfoDirty = true
    ds._cachedStorageInfo = null
    const infoSpy = vi.spyOn(persist, 'getStorageInfo').mockReturnValue({ size: 100, percent: 10, label: '100B' })
    const r1 = store.getStorageInfo()
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(r1).toEqual({ size: 100, percent: 10, label: '100B' })
    expect(ds._cachedStorageInfo).toEqual({ size: 100, percent: 10, label: '100B' })
    expect(ds._storageInfoDirty).toBe(false)
    // 再取：非 dirty + 有 cache → 复用不重算
    const r2 = store.getStorageInfo()
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(r2).toEqual({ size: 100, percent: 10, label: '100B' })
  })
  it('非 dirty 且有 cachedStorageInfo 时复用不调 getStorageInfo', () => {
    const store = useAppStore()
    const ds = useDataStore()
    ds._storageInfoDirty = false
    ds._cachedStorageInfo = { size: 50, percent: 5, label: '50B' }
    const infoSpy = vi.spyOn(persist, 'getStorageInfo').mockReturnValue({ size: 0, percent: 0, label: '' })
    const r = store.getStorageInfo()
    expect(infoSpy).not.toHaveBeenCalled()
    expect(r).toEqual({ size: 50, percent: 5, label: '50B' })
  })
})

describe('_backupBeforeImport 委托 persist.saveToLocalStorage', () => {
  it('调 persist.saveToLocalStorage 传当前 snapshot + curSpace', () => {
    const store = useAppStore()
    const snap = { bookmarks: [{ id: 'x' }] } as never
    vi.spyOn(useDataStore(), '_dataSnapshot').mockReturnValue(snap)
    const ui = useUIStore()
    ui.curSpace = 'vault'
    const saveLsSpy = vi.spyOn(persist, 'saveToLocalStorage').mockReturnValue(true)
    store._backupBeforeImport()
    expect(saveLsSpy).toHaveBeenCalledWith(snap, 'vault')
  })
})

describe('顶层导出 saveAppData 系列委托 useAppStore', () => {
  it('saveAppData() 委托 useAppStore().save()', async () => {
    makeDirty()
    const r = await saveAppData()
    expect(r).toBe(true)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
  it('debouncedSaveAppData() 委托 debouncedSave（设 timer）', () => {
    vi.useFakeTimers()
    makeDirty()
    debouncedSaveAppData()
    expect(saveSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
  it('debouncedSaveAppDataNotes(delayMs) 用更长 delay', () => {
    vi.useFakeTimers()
    makeDirty()
    debouncedSaveAppDataNotes(1200)
    vi.advanceTimersByTime(300)
    expect(saveSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(900)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
  it('flushSaveAppData() 委托 flushDebouncedSave（可 await）', async () => {
    vi.useFakeTimers()
    makeDirty()
    const r = await flushSaveAppData()
    expect(r).toBe(true)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
})

describe('save() 指纹早退真分支返值', () => {
  it('fp 非空且等于上次落盘指纹：早退返 true 不调 saveData', async () => {
    const store = useAppStore()
    makeDirty()
    await store.save()
    saveSpy.mockClear()
    // 不改数据再 save：fp 等于已落盘指纹
    const r = await store.save()
    expect(r).toBe(true)
    expect(saveSpy).not.toHaveBeenCalled()
  })
})
