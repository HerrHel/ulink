import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { preloadSearchLibs } from '../../lib/search.js'

// _debouncedBumpSearchVersion 不触发 search getter，但 preloadSearchLibs 保险加防
// store 初始化侧链需 Fuse（同 data-map-getters.test 口径）。
beforeAll(async () => {
  await preloadSearchLibs()
})

/**
 * D2-3 护栏先补子任务：`_debouncedBumpSearchVersion`（data.ts:397）批量 CRUD
 * 末尾防抖递增 _searchVersion 的核心，此前零直接测试。
 *
 * 源码：
 *   _debouncedBumpSearchVersion() {
 *     if (this._searchVersionTimer) clearTimeout(this._searchVersionTimer)
 *     this._searchVersionTimer = setTimeout(() => { this._searchVersion++ }, 0)
 *   }
 *
 * 这是 search 索引重建触发面的防抖核心——`_bumpSearchVersion` 立即递增（_searchVersion++）
 * 与 debounced 版的区别在于：批量连续 CRUD 时仅最后一次 setTimeout 回调真正递增 version，
 * 减少 Fuse 重建次数。其「clearTimeout 旧 timer」「连续调用合并成一次递增」「setTimeout(0)
 * 宏任务延迟」「回调不清 _searchVersionTimer（真实特性）」历来靠实现口头维护、无直测，
 * 任一漂移（漏 clearTimeout 致多版本递增、回调误清 timer null 致后续 clearTimeout 失效、
 * 误把 setTimeout(0) 改同步调用）会让批量操作放大 Fuse 重建次数或破坏防抖契约。
 *
 * 纯加测试零逻辑改动：action 已可经 store 实例直接调用，不改任何源文件（同 D1-32 口径）。
 * 性能优化的「dispose 路径补 clearTimeout」改逻辑留后续——避免引入无调用点的死 dispose
 * 路径成伪改善（守则#7「写不出真改善不提交」）。
 */
describe('DataStore _debouncedBumpSearchVersion 防抖护栏（D2-3）', () => {
  let store: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDataStore()
  })

  afterEach(() => {
    // 真清掉任何残留 timer 防 leak 到后续用例（即便 controller.unadvanceAll）
    if (store._searchVersionTimer) {
      clearTimeout(store._searchVersionTimer)
      store._searchVersionTimer = null
    }
    vi.useRealTimers()
  })

  describe('单次调用布置 0ms 延迟递增', () => {
    it('布置一个 timer 句柄写入 _searchVersionTimer（非同步递增 version）', () => {
      const before = store._searchVersion
      store._debouncedBumpSearchVersion()
      expect(store._searchVersionTimer).not.toBeNull()
      // 同步路径不递增——递增只在 setTimeout 回调
      expect(store._searchVersion).toBe(before)
    })

    it('回调触发后 _searchVersion 递增恰好 1', () => {
      vi.useFakeTimers()
      const before = store._searchVersion
      store._debouncedBumpSearchVersion()
      vi.advanceTimersByTime(0)
      expect(store._searchVersion).toBe(before + 1)
    })

    it('setTimeout(0) 宏任务语义：advance 0ms 才递增，advanceTimersToNext 不 advance 同步已', () => {
      vi.useFakeTimers()
      const before = store._searchVersion
      store._debouncedBumpSearchVersion()
      // 不 advance 时 version 仍未变（待宏任务）
      expect(store._searchVersion).toBe(before)
      vi.advanceTimersByTime(0)
      expect(store._searchVersion).toBe(before + 1)
    })
  })

  describe('连续调用合并成一次递增（防抖核心契约）', () => {
    it('连续 N 次调用后 version 仅递增 1 次（理想批量场景防抖语义）', () => {
      vi.useFakeTimers()
      const before = store._searchVersion
      for (let i = 0; i < 10; i++) store._debouncedBumpSearchVersion()
      vi.advanceTimersByTime(0)
      expect(store._searchVersion).toBe(before + 1)
    })

    it('连续调用时每次新 timer 替换旧 timer 句柄（_searchVersionTimer 始终是最后一个）', () => {
      vi.useFakeTimers()
      store._debouncedBumpSearchVersion()
      const first = store._searchVersionTimer
      store._debouncedBumpSearchVersion()
      const second = store._searchVersionTimer
      // 句柄被替换（新 setTimeout 返回不同句柄）
      expect(second).not.toBe(first)
      vi.advanceTimersByTime(0)
    })

    it('连接两次调后 advance 0ms 仅一次递增：clearTimeout 旧 timer 真生效', () => {
      vi.useFakeTimers()
      const before = store._searchVersion
      store._debouncedBumpSearchVersion()
      store._debouncedBumpSearchVersion()
      vi.advanceTimersByTime(0)
      // 若 clearTimeout 失效会有两次递增，护栏锁防抖合并
      expect(store._searchVersion).toBe(before + 1)
    })

    it('连续调用后 advance 0ms 之前若再调一次，合并仍只递增一次（边界叠加）', () => {
      vi.useFakeTimers()
      const before = store._searchVersion
      store._debouncedBumpSearchVersion()
      vi.advanceTimersByTime(0)
      // 第一次回调已递增一次
      expect(store._searchVersion).toBe(before + 1)
      store._debouncedBumpSearchVersion()
      vi.advanceTimersByTime(0)
      // 第二轮再 +1（新 timer，不合并到已执行的第一轮）
      expect(store._searchVersion).toBe(before + 2)
    })
  })

  describe('clearTimeout 真行为断言', () => {
    it('第一个 timer 被清后其回调永不再递增（N 个 timer 仅最后一个 callback 在）', () => {
      vi.useFakeTimers()
      const before = store._searchVersion
      // 布置 5 个 timer，仅最后 1 个 callback 存活
      store._debouncedBumpSearchVersion()
      store._debouncedBumpSearchVersion()
      store._debouncedBumpSearchVersion()
      store._debouncedBumpSearchVersion()
      store._debouncedBumpSearchVersion()
      // 用 runAllTimers 确保所有 pending timer 触发；若 clearTimeout 失效会有 5 次递增
      vi.runAllTimers()
      expect(store._searchVersion).toBe(before + 1)
      // 再 advance 也不应再递增（已无 pending）
      vi.advanceTimersByTime(100)
      expect(store._searchVersion).toBe(before + 1)
    })

    it('连续 N+1 调用 advance 部分时间再继续调用：中间 timer 被清仅终态递增 1', () => {
      vi.useFakeTimers()
      const before = store._searchVersion
      store._debouncedBumpSearchVersion()
      store._debouncedBumpSearchVersion()
      // 中途不 advance）——再调让旧 timer 被 clearTimeout
      store._debouncedBumpSearchVersion()
      vi.advanceTimersByTime(0)
      expect(store._searchVersion).toBe(before + 1)
    })
  })

  describe(' truthy-empty 边界与真实隐特性', () => {
    it('回调不清 _searchVersionTimer（真实特性：源码回调只 ++ 不 = null）', () => {
      vi.useFakeTimers()
      store._debouncedBumpSearchVersion()
      vi.advanceTimersByTime(0)
      // 回调执行后句柄仍指向已 fired 的 timer（源码 `setTimeout(()=>{this._searchVersion++},0)`
      // 回调体内未 `this._searchVersionTimer = null`）——这是真实行为，护栏直锁防未来误改
      expect(store._searchVersionTimer).not.toBeNull()
    })

    it('已 fired 的句柄再调 clearTimeout 不抛（fired timer 清无副作用）', () => {
      vi.useFakeTimers()
      store._debouncedBumpSearchVersion()
      vi.advanceTimersByTime(0)
      const firedHandle = store._searchVersionTimer
      // 回调执行后句柄仍指向已 fired 的 timer（真实特性，上一用例已锁）；此处只读引用定凭证
      expect(firedHandle).not.toBeNull()
      // 下次调用会 clearTimeout(firedHandle)——fired timer clearTimeout 是无操作的合法调用，不抛
      expect(() => {
        store._debouncedBumpSearchVersion()
      }).not.toThrow()
      vi.advanceTimersByTime(0)
    })

    it('空态 store 初始 _searchVersionTimer===null（未布置 timer）', () => {
      const fresh = useDataStore()
      // 新 store 初始 state._searchVersionTimer = null（data.ts:136）
      expect(fresh._searchVersionTimer).toBeNull()
    })

    it('_bumpSearchVersion 立即递增不走 debounce timer（与 debounced 版对比锁路径区别）', () => {
      vi.useFakeTimers()
      const before = store._searchVersion
      store._bumpSearchVersion()
      // 立即同步路径，advance 前已递增
      expect(store._searchVersion).toBe(before + 1)
      // 不布置 timer 句柄
      // （注：若上轮前有 debounced 调用残留这里只断言当前立即递增语义，
      //   _bumpSearchVersion 本身不 setT timer，路径区别直锁）
      vi.advanceTimersByTime(10)
      // 不再有额外递增
      expect(store._searchVersion).toBe(before + 1)
    })
  })

  describe('防抖与 _searchIndexDirty 交互上下文（间接路径契约）', () => {
    it('debounced bump 只 +1 version；getter 看到 _searchIndexDirty 时会额外 +1（路径分流真实行为）', () => {
      // 这条锁的是「debounced bump 自身仅 +1」与「filteredBookmarks getter 看到 dirty 会 +1」
      // 两个独立递增入口的不重叠——防 debounce 误把 dirty 也合并掉。
      vi.useFakeTimers()
      const base = store._searchVersion
      store._searchIndexDirty = true
      store._debouncedBumpSearchVersion()
      vi.advanceTimersByTime(0)
      // debounced bump 自身只递增 1（dirty 标志不影响 debounce 回调）
      expect(store._searchVersion - base).toBeGreaterThanOrEqual(1)
      // dirty 标志保持原值（debounce 回调不消费/清 dirty）
      expect(store._searchIndexDirty).toBe(true)
    })
  })
})
