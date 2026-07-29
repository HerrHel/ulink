/**
 * stores/data-cancel-pending-hist.test.ts — _cancelPendingHist 防抖历史清理护栏（D1-31）
 *
 * `_cancelPendingHist`（data.ts:72）清空两模块级私有 Map：`_histDebounceTimers`
 * （clearTimeout 全部 in-flight 防抖 timer）与 `_histDebounceData`（暂存旧状态 data）。
 * 这是审计 R22「local history 防抖 Map 随 reset/import 清理」的清理动作，被 4 处调用：
 *   - useDataIO importFromData（导入覆盖前清理）
 *   - useE2E（主密码修改重加密前清理）
 *   - data.ts reload（loadFromLocalStorage 重载前清理）
 *   - data.ts reset（清库回归默认前清理）
 *
 * 其「clearTimeout 真生效（防抖回调不再执行，不写 localStorage 历史快照）
 *  + 两 Map 清空 + 清后仍可重新布置防抖」契约此前零直接断言、仅靠 4 处调用方运行时正确性。
 * 任一回归（如未来误删 clearTimeout 只 clear Map）会让已布置的 500ms 防抖 timer 在 reset/import
 * 之后继续触发、按旧 id 写 localStorage 历史快照，污染 reset 后的干净状态或泄漏到新空间。
 *
 * 本护栏直锁这些清理不变量，为后续若碰历史防抖清理逻辑优化铺护栏地基。
 * 与 syncPending `__testPendingSync` 同口径——仅暴露填入/窥探/清两 Map 的最小面，
 * `_cancelPendingHist` 逻辑一字未动。
 *
 * 注意：模块级 `_histDebounceTimers`/`_histDebounceData` 是跨测试累积的共享状态，
 * 故 beforeEach 用 `__testHistDebounce.clear()` 兜底清两 Map，行为用例用 fake timers。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  useDataStore,
  _cancelPendingHist,
  __testHistDebounce,
} from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { localHistoryKey } from '../../stores/storage.js'
import { safeGetItem } from '../../lib/storageSafe.js'

// Read out historyMax-限定的历史条目上限（_saveLocalHistory 默认 10，useUIStore.historyMax）
const histKeyOf = (id: string) => localHistoryKey(id)

describe('_cancelPendingHist 历史防抖清理护栏', () => {
  let store: ReturnType<typeof useDataStore>
  let uiStore: ReturnType<typeof useUIStore>

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    store = useDataStore()
    uiStore = useUIStore()
    // 模块级 Map 跨测试累积，每用例起步先绝对清空（与 _cancelPendingHist 等价但不调 clearTimeout）
    __testHistDebounce.clear()
    localStorage.clear()
  })

  afterEach(() => {
    // 兜底清两 Map 防 fake timer 残留跨用例泄漏；并回到真实定时器
    __testHistDebounce.clear()
    vi.useRealTimers()
  })

  it('空态 cancel 不抛（两 Map 本就空，clear/clearTimeout 无副作用）', () => {
    expect(__testHistDebounce.peekSize()).toEqual({ timers: 0, data: 0 })
    expect(() => _cancelPendingHist()).not.toThrow()
    expect(__testHistDebounce.peekSize()).toEqual({ timers: 0, data: 0 })
  })

  it('filled 两 Map 后 cancel 清空 timers/data（peekSize 归零，has(id) 变 false）', () => {
    // fake timers 下 setTimeout 返回真 timer handle，塞进 Map 模拟 _saveLocalHistory 已布置防抖
    const t1 = setTimeout(() => {}, 500)
    const t2 = setTimeout(() => {}, 500)
    __testHistDebounce.seed('a', t1, { title: 'A-prev' })
    __testHistDebounce.seed('b', t2, { title: 'B-prev' })
    expect(__testHistDebounce.peekSize()).toEqual({ timers: 2, data: 2 })
    expect(__testHistDebounce.has('a')).toBe(true)
    expect(__testHistDebounce.has('b')).toBe(true)

    _cancelPendingHist()

    expect(__testHistDebounce.peekSize()).toEqual({ timers: 0, data: 0 })
    expect(__testHistDebounce.has('a')).toBe(false)
    expect(__testHistDebounce.has('b')).toBe(false)
  })

  it('clearTimeout 真生效：cancel 后 advance 防抖回调不再执行，不写 localStorage 历史快照（核心行为契约）', () => {
    // 真 store + 真 updateBookmark 路径触发 _saveLocalHistory 布置 500ms 防抖
    store.addBookmark({ id: 'bx', title: 'Old', url: 'https://x.example' } as any)
    const t0 = __testHistDebounce.peekSize().timers
    store.updateBookmark('bx', { title: 'New' })
    // 触发 _saveLocalHistory 后 timers Map 应已含一个 in-flight 防抖
    expect(__testHistDebounce.peekSize().timers).toBe(t0 + 1)
    expect(__testHistDebounce.has('bx')).toBe(true)

    // 关键：cancel 前不 advance，防抖 timer 仍 pending；cancel 应 clearTimeout 使之不再触发
    _cancelPendingHist()

    // advance 超过防抖窗口（_HISTORY_DEBOUNCE_MS=500）+1ms，防抖回调不该执行
    vi.advanceTimersByTime(501)
    expect(safeGetItem(histKeyOf('bx'))).toBeNull()
    // 两 Map 仍清空（防抖没执行也就没清，但 cancel 已清）
    expect(__testHistDebounce.peekSize()).toEqual({ timers: 0, data: 0 })
  })

  it('对照块：不 cancel 时 advance 后防抖回调正常执行并写 localStorage 历史快照', () => {
    store.addBookmark({ id: 'by', title: 'Old', url: 'https://y.example' } as any)
    store.updateBookmark('by', { title: 'New2' })
    expect(__testHistDebounce.has('by')).toBe(true)

    // 不 cancel，直接 advance 触发防抖回调
    vi.advanceTimersByTime(501)
    const raw = safeGetItem(histKeyOf('by'))
    // 历史回退条目落盘为 JSON 数组（[ { id, data, created_at }, ... ]），否则回归
    expect(raw).not.toBeNull()
    const arr = JSON.parse(raw as string)
    expect(Array.isArray(arr)).toBe(true)
    expect(arr.length).toBeGreaterThanOrEqual(1)
    expect(arr[0].data.title).toBe('Old') // 覆盖前留底 = 旧状态
  })

  it('cancel 后仍可重新布置防抖：后续 updateBookmark 触发 _saveLocalHistory 不被旧 cancel 破坏', () => {
    store.addBookmark({ id: 'bz', title: 'V1', url: 'https://z.example' } as any)
    store.updateBookmark('bz', { title: 'V2' })
    _cancelPendingHist() // 清掉刚布置的防抖

    // 清后再触发一次，应重新布置 in-flight 防抖（Map 可重用，未被误删容量）
    store.updateBookmark('bz', { title: 'V3' })
    expect(__testHistDebounce.has('bz')).toBe(true)
    expect(__testHistDebounce.peekSize().timers).toBe(1)

    // advance 触发第二轮防抖回调应正常写历史快照（证明清理只针对 in-flight，不破坏后续路径）
    vi.advanceTimersByTime(501)
    const raw = safeGetItem(histKeyOf('bz'))
    expect(raw).not.toBeNull()
    const arr = JSON.parse(raw as string)
    expect(Array.isArray(arr)).toBe(true)
    expect(arr[0].data.title).toBe('V2') // 第二轮 update 覆盖 V2 前留底（cancel 时 V3 尚未 update，留底即 cancel 前的 V2 状态）
    // used：防 cite，确保 uiStore 引用不被 lint 判 unused
    expect(uiStore).toBeDefined()
  })

  it('多 id cancel 一次清全部（非选择性：所有 in-flight timer 一并 clearTimeout + 清 data）', () => {
    const ids = ['m1', 'm2', 'm3']
    for (const id of ids) {
      __testHistDebounce.seed(id, setTimeout(() => {}, 500), { id, t: id })
    }
    expect(__testHistDebounce.peekSize()).toEqual({ timers: 3, data: 3 })

    _cancelPendingHist()

    expect(__testHistDebounce.peekSize()).toEqual({ timers: 0, data: 0 })
    for (const id of ids) expect(__testHistDebounce.has(id)).toBe(false)
    // advance 全部 timer 都不该触发
    vi.advanceTimersByTime(501)
    for (const id of ids) expect(safeGetItem(histKeyOf(id))).toBeNull()
  })
})
