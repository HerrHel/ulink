/**
 * dragSwap-persist.test.ts — PC 拖拽排序后落盘复现护栏
 *
 * Bug 复现：PC 拖拽 `_swapAndMarkDirty` 只 swapOrder + _markDirty，不更新 a/b 的 updatedAt。
 * app.ts `save()` 用 `_fingerprint`（含 max updatedAt）与 `_lastSavedFp` 判重，
 * maxUp 不变 → `fp === _lastSavedFp` → 早退不落盘，刷新后 order 还原。
 *
 * 本条护栏直锁「拖拽后 updatedAt 必须更新」契约，防止本 bug 回归。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'
import { _swapAndMarkDirty } from '../../composables/interaction/useDragDrop.js'
import * as persist from '../../stores/persist.js'

describe('PC 拖拽排序后落盘', () => {
  let saveSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    setActivePinia(createPinia())
    // 用真实 _fingerprint 判重，但 mock saveData 只拦截 IDB 写入
    saveSpy = vi.spyOn(persist, 'saveData').mockResolvedValue(true)
  })
  afterEach(() => { saveSpy.mockRestore() })

  it('swap 后 a/b 的 updatedAt 均更新 + save() 不早退（fingerprint 变化）', async () => {
    const ds = useDataStore()
    const app = useAppStore()
    const now = Date.now()
    // 造 3 条书签，updatedAt 相同（初始 maxUp 明确可控）
    ds.bookmarks = [
      { id: 'bm1', title: 'A', url: '', username: '', password: '', notes: '', icon: '',
        categoryId: 'all', parentId: null, order: 1, useCount: 0, attributes: {},
        isExpanded: false, createdAt: now, updatedAt: now },
      { id: 'bm2', title: 'B', url: '', username: '', password: '', notes: '', icon: '',
        categoryId: 'all', parentId: null, order: 2, useCount: 0, attributes: {},
        isExpanded: false, createdAt: now, updatedAt: now },
      { id: 'bm3', title: 'C', url: '', username: '', password: '', notes: '', icon: '',
        categoryId: 'all', parentId: null, order: 3, useCount: 0, attributes: {},
        isExpanded: false, createdAt: now, updatedAt: now },
    ]
    ds._syncMaps()

    // 首次保存：建立 _lastSavedFp 基线
    ds._markDirty('bm1', 'bm2', 'bm3')
    const ok1 = await app.save()
    expect(ok1).toBe(true)
    // 首次 save 肯定调了 saveData
    expect(saveSpy).toHaveBeenCalledTimes(1)
    saveSpy.mockClear()

    // 捕获 swap 前 updatedAt
    const upBeforeA = ds.bookmarks.find(b => b.id === 'bm1')!.updatedAt
    const upBeforeB = ds.bookmarks.find(b => b.id === 'bm2')!.updatedAt

    // PC 拖拽交换 bm1/bm2（路径等价 handleBmCardDrop 的 _swapAndMarkDirty）
    const a = ds._bmMap['bm1']
    const b = ds._bmMap['bm2']
    const r = _swapAndMarkDirty(a, b)
    expect(r).toBe(true)
    expect(a.order).toBe(2)
    expect(b.order).toBe(1)

    // 核心契约：swap 后 updatedAt 必须递增（否则 fingerprint 不变，save 早退不落盘）
    const upAfterA = ds.bookmarks.find(x => x.id === 'bm1')!.updatedAt
    const upAfterB = ds.bookmarks.find(x => x.id === 'bm2')!.updatedAt
    expect(upAfterA).toBeGreaterThan(upBeforeA)
    expect(upAfterB).toBeGreaterThan(upBeforeB)

    // 落盘验证：fingerprint 变化，save 真正调 saveData（而非早退）
    saveSpy.mockClear()
    const ok2 = await app.save()
    expect(ok2).toBe(true)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('swap 且 _customCardOrder 存在：updatedAt 同样更新 + saveData 被调 + saveUIState 被调', async () => {
    const ds = useDataStore()
    const app = useAppStore()
    const now = Date.now()
    ds.bookmarks = [
      { id: 'bm1', title: 'A', url: '', username: '', password: '', notes: '', icon: '',
        categoryId: 'all', parentId: null, order: 1, useCount: 0, attributes: {},
        isExpanded: false, createdAt: now, updatedAt: now },
      { id: 'bm2', title: 'B', url: '', username: '', password: '', notes: '', icon: '',
        categoryId: 'all', parentId: null, order: 2, useCount: 0, attributes: {},
        isExpanded: false, createdAt: now, updatedAt: now },
    ]
    ds._syncMaps()
    ds._customCardOrder = [{ t: 'b', id: 'bm1' }, { t: 'b', id: 'bm2' }]
    ds._markDirty('bm1', 'bm2')
    expect(await app.save()).toBe(true)
    saveSpy.mockClear()

    const upBeforeA = ds.bookmarks.find(x => x.id === 'bm1')!.updatedAt
    const r = _swapAndMarkDirty(
      ds._bmMap['bm1'],
      ds._bmMap['bm2'],
    )
    expect(r).toBe(true)

    const upAfterA = ds.bookmarks.find(x => x.id === 'bm1')!.updatedAt
    expect(upAfterA).toBeGreaterThan(upBeforeA)

    saveSpy.mockClear()
    expect(await app.save()).toBe(true)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    // _customCardOrder 已同步交换
    expect(ds._customCardOrder).toEqual([{ t: 'b', id: 'bm2' }, { t: 'b', id: 'bm1' }])
  })
})