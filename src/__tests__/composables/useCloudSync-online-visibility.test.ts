/**
 * 行为契约护栏：useCloudSync online/visibility 监听编排 + handler 门控与重订阅
 *
 *Explore agentId ab9f0fef9d18c9f9b 缺口 #5：
 * useCloudSync `_onOnline`/`_onVisibilityChange`/`initOnlineListener`/
 * `destroyOnlineListener`（useCloudSync.ts:163-198）4 个 handler + listener 生命周期
 * 在全测试目录零直接护栏（realBugFixes.test.ts:30 仅把 initOnlineListener mock 成 vi.fn()
 * 防依赖，不测其编排；usePasswordVisibility/e2e/vault 的 visibilitychange 命中是别模块）。
 *
 * 生产调用方：
 *   useAppLifecycle.ts:82  sync.initOnlineListener()      onMounted 初始化
 *   useAppLifecycle.ts:133  useCloudSync().destroyOnlineListener()  onUnmounted 清理
 *
 * 编排承载 5 条用户可见契约：
 *   A. initOnlineListener 注册 window 'online' + document 'visibilitychange' + (isLoggedIn 时) subscribeRealtime
 *   B. destroyOnlineListener 移除两监听 + unsubscribeRealtime（防泄漏/防注销后仍收远端事件污染已卸载 store）
 *   C. _onOnline：!isLoggedIn 无操作（未登录收到 online 事件不应触发推送/拉取触 RLS 或脏状态）
 *      + enqueueDirtyAsOps + withLock('linkvault-sync', pushFromQueue).then(pullChanges)
 *      + 若 realtimeStatus !== 'connected' → unsubscribeRealtime + subscribeRealtime 重建（H2 自恢复 S13）
 *   D. _onVisibilityChange：visibilityState !== 'visible' 早返（后台切前台才同步，后台不同步省流量/省电）
 *      + !isLoggedIn 早返 + withLock 内 pull 先于 (autoSync 时 enqueue+push)
 *      + realtimeStatus !== 'connected' && !== 'connecting' → 重建订阅（连接中不打断）
 *   E. handler 是每次调度重判门控（响应式 isLoggedIn/autoSync），非 setup 快照
 *
 * 回归路径：误删 isLoggedIn 守卫 → 未登录 online 事件真去 withLock(push) 触 RLS 拒绝 +
 * 污染跨账号残留队列；误删 realtimeStatus 重订阅分支 → H2 修复白做（达上限断开后 online 事件
 * 不再重建订阅，realtime 永久断开）；误删 pull 先于 push 顺序 → 旧脏推送覆盖新拉取覆盖；
 * 误删 destroy 移除监听 → 组件卸载后 document listener 仍存内存泄漏 + 收事件调已卸载 store。
 *
 * 纯加测试零源文件改动。mock 上 useCloudSync 顶层 import 的全副依赖（syncPush/pull/realtime/
 * withLock/syncShare/syncHistory/syncRemotePort + supabase/storage stub + useAuth 解包语义）。
 * 模块私有 _onOnline/_onVisibilityChange 经 addEventListener 间接注册——借 vi.spyOn
 * window/document addEventListener 在 initOnlineListener() 调用时捕获 handler 引用，
 * 再手动派发 Event('online')/Event('visibilitychange') 触发编排断言。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── useAuth mock：reactive({ isLoggedIn: ref }) 复刻 store proxy 自动解包语义 ──
// useCloudSync L53 `computed(() => _auth.isLoggedIn)` 经 proxy 访问 isLoggedIn 自动解包得 boolean，
// mock 需返 reactive 包裹使访问得解包 boolean、改 ref.value 触响应式使内层 computed 失效重判。
// hoisted 不能调 vue ref（hoisting 早于 import），用 plain hold box，mock 工厂内 import('vue')
// 创共享 ref 注入 box.isLoggedInRef。
const _auth = vi.hoisted(() => ({
  isLoggedInRef: null as unknown as { value: boolean },
}))
vi.mock('../../composables/domain/useAuth.js', async () => {
  const { ref, reactive } = await import('vue')
  const isLoggedInRef = ref(true)
  _auth.isLoggedInRef = isLoggedInRef
  const storeProxy = reactive({ isLoggedIn: isLoggedInRef })
  return { useAuth: () => storeProxy }
})

// ── syncPush mock：enqueueDirtyAsOps + pushFromQueue spy ──
const _push = vi.hoisted(() => ({
  enqueueSpy: vi.fn(),
  pushFromQueueSpy: vi.fn(async () => true),
}))
vi.mock('../../composables/domain/syncPush.js', () => ({
  enqueueDirtyAsOps: _push.enqueueSpy,
  pushFromQueue: _push.pushFromQueueSpy,
  _opNeedsUnlock: vi.fn(() => false),
}))

// ── syncPull mock：pullChanges spy（隔离真 port/E2E/data store 全家桶）──
const _pull = vi.hoisted(() => ({ pullChangesSpy: vi.fn(async () => true) }))
vi.mock('../../composables/domain/syncPull.js', () => ({
  pullChanges: _pull.pullChangesSpy,
}))

// ── useSyncRealtime mock：subscribe/unsubscribe spy（_onOnline/_onVisibility/init 直接调）──
const _rt = vi.hoisted(() => ({
  subscribeSpy: vi.fn(),
  unsubscribeSpy: vi.fn(),
}))
vi.mock('../../composables/domain/useSyncRealtime.js', () => ({
  subscribeRealtime: _rt.subscribeSpy,
  unsubscribeRealtime: _rt.unsubscribeSpy,
}))

// ── syncShare mock：顶层 import 副作用 stub ──
vi.mock('../../composables/domain/syncShare.js', () => ({
  setGroupPublic: vi.fn(async () => true),
  fetchPublicGroup: vi.fn(async () => null),
}))

// ── useSyncHistory mock：顶层 import 副作用 stub（_getUserId 供 initialSync 路径，本护栏不调）──
vi.mock('../../composables/domain/useSyncHistory.js', () => ({
  fetchHistory: vi.fn(async () => []),
  restoreFromHistory: vi.fn(async () => true),
  _getUserId: vi.fn(() => 'test-user-id'),
}))

// ── syncRemotePort mock：顶层 import 副作用 stub ──
vi.mock('../../composables/domain/syncRemotePort.js', () => ({
  getSyncRemotePort: vi.fn(() => ({})),
  setSyncRemotePort: vi.fn(),
  createMemorySyncPort: vi.fn(),
}))

// ── withLock mock：spy 直接执行 fn（jsdom 无 navigator.locks fallback 直调，但用 spy 隔离 lock 并发语义）──
const _lock = vi.hoisted(() => ({
  withLockSpy: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('../../lib/withLock.js', () => ({ withLock: _lock.withLockSpy }))

// ── supabase + storage import 副作用 stub ──
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

// 捕获 addEventListener 注册的 handler 引用（模块私有 _onOnline/_onVisibilityChange 间接捕获）
interface WindowEventMapish { [type: string]: EventListener }
let _winHandlers: WindowEventMapish = {}
let _docHandlers: WindowEventMapish = {}
let _winAddSpy: ReturnType<typeof vi.spyOn>
let _winRmSpy: ReturnType<typeof vi.spyOn>
let _docAddSpy: ReturnType<typeof vi.spyOn>
let _docRmSpy: ReturnType<typeof vi.spyOn>

describe('useCloudSync online/visibility 监听编排护栏', () => {
  let syncStore: ReturnType<typeof useSyncStore>

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    __resetInitialSync()
    syncStore = useSyncStore()
    // autoSync 默认 true（sync store L23），isLoggedIn 默认 true
    _auth.isLoggedInRef.value = true

    // 捕获 window/document addEventListener 注册的 handler
    _winHandlers = {}
    _docHandlers = {}
    _winAddSpy = vi.spyOn(window, 'addEventListener').mockImplementation(((
      type: string, listener: EventListenerOrEventListenerObject,
    ) => { _winHandlers[type] = listener as EventListener }) as any)
    _winRmSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(((
      _type: string, _listener: EventListenerOrEventListenerObject,
    ) => {}) as any)
    _docAddSpy = vi.spyOn(document, 'addEventListener').mockImplementation(((
      type: string, listener: EventListenerOrEventListenerObject,
    ) => { _docHandlers[type] = listener as EventListener }) as any)
    _docRmSpy = vi.spyOn(document, 'removeEventListener').mockImplementation(((
      _type: string, _listener: EventListenerOrEventListenerObject,
    ) => {}) as any)

    _push.enqueueSpy.mockClear()
    _push.pushFromQueueSpy.mockClear()
    _pull.pullChangesSpy.mockClear()
    _rt.subscribeSpy.mockClear()
    _rt.unsubscribeSpy.mockClear()
    _lock.withLockSpy.mockClear()
  })

  afterEach(() => {
    _winAddSpy.mockRestore()
    _winRmSpy.mockRestore()
    _docAddSpy.mockRestore()
    _docRmSpy.mockRestore()
    vi.useRealTimers()
  })

  // helper：调 initOnlineListener 捕获 handler 后派发对应事件
  function initAndDispatch(evType: 'online' | 'visibilitychange', visible = true) {
    const { initOnlineListener } = useCloudSync()
    initOnlineListener()
    if (evType === 'online') {
      _winHandlers['online']?.(new Event('online'))
    } else {
      // _onVisibilityChange 读 document.visibilityState
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visible ? 'visible' : 'hidden')
      _docHandlers['visibilitychange']?.(new Event('visibilitychange'))
    }
  }

  // ─────────────── A. initOnlineListener 注册 ───────────────
  it('A1：initOnlineListener 注册 window "online" + document "visibilitychange" 两监听', () => {
    const { initOnlineListener } = useCloudSync()
    initOnlineListener()
    expect(_winHandlers['online']).toBeDefined()
    expect(_docHandlers['visibilitychange']).toBeDefined()
  })

  it('A2：initOnlineListener 时 isLoggedIn=true → 立即 subscribeRealtime(pullChanges) 订阅一次', () => {
    const { initOnlineListener } = useCloudSync()
    initOnlineListener()
    expect(_rt.subscribeSpy).toHaveBeenCalledTimes(1)
    // subscribeRealtime 入参应是被 import 丙的 pullChanges（mock 的 spy 引用）
    expect(_rt.subscribeSpy.mock.calls[0][0]).toBe(_pull.pullChangesSpy)
  })

  it('A3：initOnlineListener 时 isLoggedIn=false → 不 subscribeRealtime（未登录不建订阅触 RLS）', () => {
    _auth.isLoggedInRef.value = false
    const { initOnlineListener } = useCloudSync()
    initOnlineListener()
    expect(_rt.subscribeSpy).not.toHaveBeenCalled()
  })

  // ─────────────── B. destroyOnlineListener 清理 ───────────────
  it('B1：destroyOnlineListener 移除 window "online" + document "visibilitychange" 监听（防泄漏）', () => {
    const { initOnlineListener, destroyOnlineListener } = useCloudSync()
    initOnlineListener()
    destroyOnlineListener()
    expect(_winRmSpy).toHaveBeenCalledWith('online', _winHandlers['online'])
    expect(_docRmSpy).toHaveBeenCalledWith('visibilitychange', _docHandlers['visibilitychange'])
  })

  it('B2：destroyOnlineListener 调 unsubscribeRealtime（卸载后不再收远端事件污染已卸载 store）', () => {
    const { initOnlineListener, destroyOnlineListener } = useCloudSync()
    initOnlineListener()
    _rt.unsubscribeSpy.mockClear() // init 时 subscribe 不含 unsubscribe
    destroyOnlineListener()
    expect(_rt.unsubscribeSpy).toHaveBeenCalledTimes(1)
  })

  // ─────────────── C. _onOnline 编排 ───────────────
  it('C1：online 事件 → enqueueDirtyAsOps 调一次（编排入口副作用）', () => {
    initAndDispatch('online')
    expect(_push.enqueueSpy).toHaveBeenCalledTimes(1)
  })

  it('C2：online 事件 → withLock("linkvault-sync", pushFromQueue) 调一次（lock 同步语义隔离）', async () => {
    initAndDispatch('online')
    await Promise.resolve()
    expect(_lock.withLockSpy).toHaveBeenCalledTimes(1)
    expect(_lock.withLockSpy.mock.calls[0][0]).toBe('linkvault-sync')
    expect(_lock.withLockSpy.mock.calls[0][1]).toBe(_push.pushFromQueueSpy)
  })

  it('C3：online 事件 → withLock(push).then(pullChanges)（推送后拉取，编排顺序）', async () => {
    initAndDispatch('online')
    // 清微任务让 withLock fn 执行 + then 链推进
    await vi.runAllTimersAsync()
    expect(_push.pushFromQueueSpy).toHaveBeenCalledTimes(1)
    expect(_pull.pullChangesSpy).toHaveBeenCalledTimes(1)
  })

  it('C4：online 事件 且 realtimeStatus !== "connected" → unsubscribeRealtime + subscribeRealtime 重建（H2 自恢复契约）', async () => {
    syncStore.setRealtimeStatus('disconnected') // 非 connected
    const { initOnlineListener } = useCloudSync()
    initOnlineListener()
    // init 已 subscribe 一次（isLoggedIn=true）；清零隔离，单锁 online 事件的重建分支
    _rt.subscribeSpy.mockClear()
    _rt.unsubscribeSpy.mockClear()
    _winHandlers['online']?.(new Event('online'))
    expect(_rt.unsubscribeSpy).toHaveBeenCalledTimes(1)
    expect(_rt.subscribeSpy).toHaveBeenCalledTimes(1) // 仅 online 事件触发的重建那一次
  })

  it('C5：online 事件 且 realtimeStatus === "connected" → 不重订阅（已连不打断订阅）', async () => {
    syncStore.setRealtimeStatus('connected')
    initAndDispatch('online')
    // init 已 subscribe 一次，online 事件不应再调（connected 短路重订阅分支）
    expect(_rt.subscribeSpy).toHaveBeenCalledTimes(1)
    expect(_rt.unsubscribeSpy).not.toHaveBeenCalled()
  })

  it('C6：online 事件 且 isLoggedIn=false → 全 no-op（未登录不该 online 真去推云触 RLS）', () => {
    _auth.isLoggedInRef.value = false
    initAndDispatch('online')
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    expect(_lock.withLockSpy).not.toHaveBeenCalled()
    expect(_rt.subscribeSpy).not.toHaveBeenCalled()
  })

  // ─────────────── D. _onVisibilityChange 编排 ───────────────
  it('D1：visibilityState="hidden" → 早返 no-op（后台不同步省流量）', () => {
    initAndDispatch('visibilitychange', /* visible */ false)
    expect(_pull.pullChangesSpy).not.toHaveBeenCalled()
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    expect(_push.pushFromQueueSpy).not.toHaveBeenCalled()
    expect(_lock.withLockSpy).not.toHaveBeenCalled()
  })

  it('D2：visibilityState="visible" 且 autoSync=true → pull 先于 enqueue+push（编排顺序契约）', async () => {
    syncStore.setAutoSync(true)
    const order: string[] = []
    _pull.pullChangesSpy.mockImplementation(async () => { order.push('pull'); return true })
    _push.enqueueSpy.mockImplementation(() => { order.push('enqueue') })
    _push.pushFromQueueSpy.mockImplementation(async () => { order.push('push'); return true })
    initAndDispatch('visibilitychange', /* visible */ true)
    await vi.runAllTimersAsync()
    expect(order[0]).toBe('pull')
    expect(order).toContain('enqueue')
    expect(order).toContain('push')
    // pull 必须先于 enqueue（withLock 同体先 await pull 再 autoSync enqueue+push）
    expect(order.indexOf('pull')).toBeLessThan(order.indexOf('enqueue'))
  })

  it('D3：visibilityState="visible" 且 autoSync=false → 只 pull 不 push（自动同步关不推云）', async () => {
    syncStore.setAutoSync(false)
    initAndDispatch('visibilitychange', /* visible */ true)
    await vi.runAllTimersAsync()
    expect(_pull.pullChangesSpy).toHaveBeenCalledTimes(1)
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    expect(_push.pushFromQueueSpy).not.toHaveBeenCalled()
  })

  it('D4：visibility 事件 且 isLoggedIn=false → no-op（未登录切前台也不拉取）', () => {
    _auth.isLoggedInRef.value = false
    initAndDispatch('visibilitychange', /* visible */ true)
    expect(_pull.pullChangesSpy).not.toHaveBeenCalled()
    expect(_lock.withLockSpy).not.toHaveBeenCalled()
  })

  it('D5：visibility 事件 realtimeStatus="disconnected" → unsubscribe+subscribe 重建（断开可恢复）', async () => {
    syncStore.setRealtimeStatus('disconnected')
    const { initOnlineListener } = useCloudSync()
    initOnlineListener()
    _rt.subscribeSpy.mockClear() // init 已 subscribe 一次，清零隔离事件重建分支
    _rt.unsubscribeSpy.mockClear()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    _docHandlers['visibilitychange']?.(new Event('visibilitychange'))
    await Promise.resolve()
    expect(_rt.unsubscribeSpy).toHaveBeenCalledTimes(1)
    expect(_rt.subscribeSpy).toHaveBeenCalledTimes(1)
  })

  it('D6：visibility 事件 realtimeStatus="connecting" → 不重订阅（连接中不打断）', async () => {
    syncStore.setRealtimeStatus('connecting')
    initAndDispatch('visibilitychange', /* visible */ true)
    await Promise.resolve()
    // init 已 subscribe（disconnected→init subscribe→connecting），visibility 不应再触发
    expect(_rt.subscribeSpy).toHaveBeenCalledTimes(1)
    expect(_rt.unsubscribeSpy).not.toHaveBeenCalled()
  })

  it('D7：visibility 事件 realtimeStatus="connected" → 两分支均不命中不重订阅（短路）', async () => {
    syncStore.setRealtimeStatus('connected')
    initAndDispatch('visibilitychange', /* visible */ true)
    await Promise.resolve()
    expect(_rt.subscribeSpy).toHaveBeenCalledTimes(1)
    expect(_rt.unsubscribeSpy).not.toHaveBeenCalled()
  })

  // ─────────────── E. 门控每次调度重判（响应式非 setup 快照） ───────────────
  it('E1：online 门控响应式重判 —— 先 isLoggedIn=false no-op，后切 true 再 dispatch online 走完整编排', async () => {
    _auth.isLoggedInRef.value = false
    const { initOnlineListener } = useCloudSync()
    initOnlineListener()
    _winHandlers['online']?.(new Event('online')) // false 态首派
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    _auth.isLoggedInRef.value = true // 切登录态
    _winHandlers['online']?.(new Event('online')) // true 态再派
    expect(_push.enqueueSpy).toHaveBeenCalledTimes(1)
    expect(_lock.withLockSpy).toHaveBeenCalledTimes(1)
  })

  it('E2：visibility 门控响应式重判 —— autoSync false→true 在 visibility 事件间切换，push 只在 true 态发生', async () => {
    syncStore.setAutoSync(false)
    const { initOnlineListener } = useCloudSync()
    initOnlineListener()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    _docHandlers['visibilitychange']?.(new Event('visibilitychange')) // autoSync=false 首派
    await vi.runAllTimersAsync()
    expect(_push.pushFromQueueSpy).not.toHaveBeenCalled()
    syncStore.setAutoSync(true)
    _docHandlers['visibilitychange']?.(new Event('visibilitychange')) // 切 true 再派
    await vi.runAllTimersAsync()
    expect(_push.pushFromQueueSpy).toHaveBeenCalledTimes(1)
  })
})
