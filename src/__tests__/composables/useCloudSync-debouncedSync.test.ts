/**
 * 行为契约护栏：useCloudSync.debouncedSync 4 步编排 + 门控 + 防抖 timer
 *
 * Explore agentId a72cc7887c578005d 候选 #3：
 * debouncedSync（useCloudSync.ts:75-83 返回口 :223）全测试目录仅
 * cloudSyncMerge.test.ts:119 一行注释提及，0 调用 0 断言。生产调用方：
 *   App.vue:228 cloudSync.debouncedSync()
 *   useAppLifecycle.ts:86 useCloudSync().debouncedSync()
 *
 * 4 步编排承载两条用户可见门控契约 + debounce timer 语义：
 *   1. !syncStore.autoSync || !isLoggedIn.value → 整个 no-op（关自动同步本地改动不推云
 *      + 未登录 no-op —— 两条显式用户契约）
 *   2. enqueueDirtyAsOps() 排队
 *   3. clearTimeout(_syncTimer)（旧 timer 被清，防快速连点堆多 timer 并发推送）
 *   4. setTimeout(() => { _syncTimer = null; void withLock('linkvault-sync', pushFromQueue) }, 3000)
 *
 * 回归路径：误删 autoSync 检查 → 关闭自动同步的用户批量浏览编辑全静默推云、耗流量暴露浏览意图；
 * 误删 isLoggedIn 检查 → 未登录时 enqueue + 布置 timer 后 3s 调 withLock(pushFromQueue) 真去推云端
 * 触发 RLS 拒绝；漏 clearTimeout → 快速连点编辑多次堆 timer，3s 后多个 withLock 并发推送。
 *
 * 纯加测试零源文件改动：debouncedSync 经 useCloudSync().debouncedSync() 暴露。
 * mock：syncPush 整模块（enqueueDirtyAsOps/pushFromQueue spy 控制 + 隔离真实队列/端口）+
 * withLock（spy 不真执行 Web Locks）+ useAuth（isLoggedIn ref 可控 true/false）+ supabase（import 副作用 stub）。
 * 用 fake timers 钉 setTimeout(3000)/clearTimeout/3s 后 withLock tail-call 触发确定性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── useAuth mock：isLoggedIn ref 可控 true/false（reportError 门控与 debouncedSync 门控共用）──
// 真实 useAuth() 返回 auth Pinia store proxy，经 proxy 访问 isLoggedIn（内部 computed）自动解包成
// boolean，故 useCloudSync L53 `computed(() => _auth.isLoggedIn)` 读的是解包 boolean 非显式 ref。
// mock 需复现此解包语义：返回 reactive({ isLoggedIn: ref }) —— reactive 自动解包 ref，访问
// `_auth.isLoggedIn` 得解包 boolean，改 ref.value 触 reactive 响应式使 useCloudSync 内 computed 失效。
// hoisted 不能调 vue ref（hoisting 早于 import），用 plain hold box，mock 工厂内 import('vue')
// 创共享 ref 注入 box.isLoggedInRef，测试改 box.isLoggedInRef.value 即真触响应式门控。
const _auth = vi.hoisted(() => ({
  // 工厂填充：共享 ref 句柄，测试改其 .value 即触 useCloudSync 内 computed 失效
  isLoggedInRef: null as unknown as { value: boolean },
}))
vi.mock('../../composables/domain/useAuth.js', async () => {
  const { ref, reactive } = await import('vue')
  // 模块级唯一 ref（mock 工厂仅被 Vitest 执行一次），注入 hoisted box 供测试持句柄
  const isLoggedInRef = ref(true)
  _auth.isLoggedInRef = isLoggedInRef
  // reactive 包裹使 _auth.isLoggedIn 访问自动解包 ref 得 boolean（复刻 store proxy 解包语义）
  const storeProxy = reactive({ isLoggedIn: isLoggedInRef })
  return {
    useAuth: () => storeProxy,
  }
})

// ── syncPush mock：enqueueDirtyAsOps/pushFromQueue spy 隔离真实队列+端口同步副作用 ──
const _push = vi.hoisted(() => ({
  enqueueSpy: vi.fn(),
  pushFromQueueSpy: vi.fn(async () => true),
}))
vi.mock('../../composables/domain/syncPush.js', () => ({
  enqueueDirtyAsOps: _push.enqueueSpy,
  pushFromQueue: _push.pushFromQueueSpy,
}))

// ── withLock mock：spy 不真执行 Web Locks（jsdom 无 navigator.locks 会 fallback 直调 fn 即调 pushFromQueue，
//    但本上下文用 spy 完全隔离 lock 并发语义，只断 withLock 被调即可）──
const _lock = vi.hoisted(() => ({
  withLockSpy: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('../../lib/withLock.js', () => ({
  withLock: _lock.withLockSpy,
}))

// ── supabase + storage import 副作用 stub（debouncedSync 不读这两者，但 useCloudSync 顶层 import 需）──
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      insert: () => Promise.resolve({ data: null, error: null }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }), data: null }),
      delete: () => Promise.resolve({ data: null, error: null }),
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) }),
    removeChannel: () => {},
  },
}))

vi.mock('../../stores/storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/storage.js')>()
  return {
    ...actual,
    enqueueSyncOps: async () => {},
    drainSyncOps: async () => [],
    removeSyncOps: async () => {},
    updateSyncOpRetry: async () => {},
    syncOpsCount: async () => 0,
    clearAllSyncOps: async () => {},
  }
})

import { useSyncStore } from '../../stores/sync.js'
import { useCloudSync, __resetInitialSync } from '../../composables/domain/useCloudSync.js'

describe('debouncedSync 4 步编排护栏', () => {
  let syncStore: ReturnType<typeof useSyncStore>

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    __resetInitialSync()
    syncStore = useSyncStore()
    // autoSync 默认 true（sync store L23），isLoggedIn 默认 true
    _auth.isLoggedInRef.value = true
    _push.enqueueSpy.mockClear()
    _push.pushFromQueueSpy.mockClear()
    _lock.withLockSpy.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('门控 ①：autoSync=false → no-op（不 enqueue + 不布 timer + 3s 后不调 withLock）', () => {
    syncStore.setAutoSync(false)
    const { debouncedSync } = useCloudSync()
    debouncedSync()
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    // 推进 3s 后 withLock 不应被调用
    vi.advanceTimersByTime(3000)
    expect(_lock.withLockSpy).not.toHaveBeenCalled()
  })

  it('门控 ① 优先阻断：autoSync=false 时即使有 dirty id 也不推（核心用户契约：关自动同步后本地改动不推云）', () => {
    syncStore.setAutoSync(false)
    const { debouncedSync } = useCloudSync()
    debouncedSync()
    vi.advanceTimersByTime(3000)
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    expect(_push.pushFromQueueSpy).not.toHaveBeenCalled()
    expect(_lock.withLockSpy).not.toHaveBeenCalled()
  })

  it('门控 ②：isLoggedIn=false → no-op（enqueue + timer + withLock 全不调，未登录不真去推云触 RLS 拒绝）', () => {
    _auth.isLoggedInRef.value = false
    const { debouncedSync } = useCloudSync()
    debouncedSync()
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(_lock.withLockSpy).not.toHaveBeenCalled()
  })

  it('正常路径：enqueueDirtyAsOps 调一次 + 3s 后 withLock("linkvault-sync", pushFromQueue) 调一次', () => {
    const { debouncedSync } = useCloudSync()
    debouncedSync()
    expect(_push.enqueueSpy).toHaveBeenCalledTimes(1)
    // 3s 之前 withLock 未调
    vi.advanceTimersByTime(2999)
    expect(_lock.withLockSpy).not.toHaveBeenCalled()
    // 满 3s 触发 withLock
    vi.advanceTimersByTime(1)
    expect(_lock.withLockSpy).toHaveBeenCalledTimes(1)
    expect(_lock.withLockSpy.mock.calls[0][0]).toBe('linkvault-sync')
    // pushFromQueue 作为 withLock 第二参传入（mock withLock 直接调用 fn，故 spy 会真触 pushFromQueue）
    expect(_push.pushFromQueueSpy).toHaveBeenCalledTimes(1)
  })

  it('enqueue 先于 withLock：enqueueDirtyAsOps 同步执行，withLock 在 3s setTimeout 后才执行（编排顺序）', () => {
    const callOrder: string[] = []
    _push.enqueueSpy.mockImplementation(() => { callOrder.push('enqueue') })
    _lock.withLockSpy.mockImplementation(async () => { callOrder.push('withLock') })
    const { debouncedSync } = useCloudSync()
    debouncedSync()
    expect(callOrder).toEqual(['enqueue'])
    vi.advanceTimersByTime(3000)
    expect(callOrder).toEqual(['enqueue', 'withLock'])
  })

  it('防抖 timer：3s 窗口内二次调用 clearTimeout 旧 timer、旧 timer 不重复触发（去重契约 N→1）', () => {
    vi.spyOn(globalThis, 'clearTimeout')
    const { debouncedSync } = useCloudSync()
    debouncedSync() // 布置 timer1（t0 设，t0+3s 触发）
    vi.advanceTimersByTime(1000) // 推进 1s，仍在 timer1 的 3s 窗口内
    debouncedSync() // 应 clearTimeout(timer1) 布置 timer2（t1+3s 触发）；timer1 被清不应触发
    // clearTimeout 真被调（核心去重动作）
    expect(globalThis.clearTimeout).toHaveBeenCalled()
    // 推进到 timer2 之前（t1+3s = t0+4s，已推进 1s，再推进 2999ms 仍未到）
    vi.advanceTimersByTime(2999)
    expect(_lock.withLockSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1) // 满 timer2 的 3s
    // 去重契约：两次连点只触发一次 withLock（旧 timer1 被清不重复推）
    expect(_lock.withLockSpy).toHaveBeenCalledTimes(1)
  })

  it('快速连点 N 次：clearTimeout 防堆多 timer，最终只在最后一次调用后 3s 触发一次 withLock', () => {
    const { debouncedSync } = useCloudSync()
    debouncedSync()
    vi.advanceTimersByTime(1000)
    debouncedSync()
    vi.advanceTimersByTime(1000)
    debouncedSync()
    vi.advanceTimersByTime(1000)
    debouncedSync()
    // 4 次调用后已过 3s，但最后一次(t4) timer 在 t4+3s=3s 后；此时 withLock 不应已被触发
    expect(_lock.withLockSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000) // 满 t4+3s
    expect(_lock.withLockSpy).toHaveBeenCalledTimes(1)
  })

  it('enqueueDirtyAsOps 每次调用都执行一次（不像 withLock 被防抖抑制）—— 防抖仅作用于 timer 不作用于 enqueue', () => {
    const { debouncedSync } = useCloudSync()
    debouncedSync()
    debouncedSync()
    debouncedSync()
    expect(_push.enqueueSpy).toHaveBeenCalledTimes(3)
  })

  it('门控隔离：autoSync=false 后再次切 true 调用走完整 4 步（门控是每次调用重判非 setup 快照）', () => {
    syncStore.setAutoSync(false)
    const { debouncedSync } = useCloudSync()
    debouncedSync()
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    // 切 true 后再调用走正常路径
    syncStore.setAutoSync(true)
    debouncedSync()
    expect(_push.enqueueSpy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(_lock.withLockSpy).toHaveBeenCalledTimes(1)
  })

  it('isLoggedIn 切换：false→true 后 debouncedSync 走正常路径（门控每次调用重判响应式 isLoggedIn）', () => {
    _auth.isLoggedInRef.value = false
    const { debouncedSync } = useCloudSync()
    debouncedSync()
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    _auth.isLoggedInRef.value = true
    debouncedSync()
    expect(_push.enqueueSpy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(_lock.withLockSpy).toHaveBeenCalledTimes(1)
  })
})
