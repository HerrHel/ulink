/**
 * useCloudSync online/visibility 监听护栏（精简版）
 *
 * 原文件 20 例随 r9 补入,逐 realtimeStatus 分支各立例镜像。online 事件 !isLoggedIn
 * 真去推云会触 RLS 拒绝 + 跨账号残留队列污染,有真实后果;visibility 后台早返省流量;
 * realtimeStatus !== connected 重建订阅(H2 自恢复)。此精简版留 8 例守核心契约。
 *
 * 删去:A2/A3 init subscribe、B2 unsubscribe、C1/C2/C3 编排步骤逐镜像、D5/D6/D7
 * 三 realtimeStatus 分支镜像(留 C4 一例代表)、E2 visibility 门控镜像、A1 注册镜像。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const _auth = vi.hoisted(() => ({ isLoggedInRef: null as unknown as { value: boolean } }))
vi.mock('../../composables/domain/useAuth.js', async () => {
  const { ref, reactive } = await import('vue')
  const isLoggedInRef = ref(true)
  _auth.isLoggedInRef = isLoggedInRef
  return { useAuth: () => reactive({ isLoggedIn: isLoggedInRef }) }
})

const _push = vi.hoisted(() => ({ enqueueSpy: vi.fn(), pushFromQueueSpy: vi.fn(async () => true) }))
vi.mock('../../composables/domain/syncPush.js', () => ({
  enqueueDirtyAsOps: _push.enqueueSpy,
  pushFromQueue: _push.pushFromQueueSpy,
  _opNeedsUnlock: vi.fn(() => false),
}))

const _pull = vi.hoisted(() => ({ pullChangesSpy: vi.fn(async () => true) }))
vi.mock('../../composables/domain/syncPull.js', () => ({ pullChanges: _pull.pullChangesSpy }))

const _rt = vi.hoisted(() => ({ subscribeSpy: vi.fn(), unsubscribeSpy: vi.fn() }))
vi.mock('../../composables/domain/useSyncRealtime.js', () => ({
  subscribeRealtime: _rt.subscribeSpy,
  unsubscribeRealtime: _rt.unsubscribeSpy,
}))

vi.mock('../../composables/domain/syncShare.js', () => ({
  setGroupPublic: vi.fn(async () => true),
  fetchPublicGroup: vi.fn(async () => null),
}))
vi.mock('../../composables/domain/useSyncHistory.js', () => ({
  fetchHistory: vi.fn(async () => []),
  restoreFromHistory: vi.fn(async () => true),
  _getUserId: vi.fn(() => 'test-user-id'),
}))
vi.mock('../../composables/domain/syncRemotePort.js', () => ({
  getSyncRemotePort: vi.fn(() => ({})),
  setSyncRemotePort: vi.fn(),
  createMemorySyncPort: vi.fn(),
}))
const _lock = vi.hoisted(() => ({ withLockSpy: vi.fn(async (_n: string, fn: () => Promise<unknown>) => fn()) }))
vi.mock('../../lib/withLock.js', () => ({ withLock: _lock.withLockSpy }))
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

let _winHandlers: { [type: string]: EventListener } = {}
let _docHandlers: { [type: string]: EventListener } = {}
let _winAddSpy: ReturnType<typeof vi.spyOn>
let _winRmSpy: ReturnType<typeof vi.spyOn>
let _docAddSpy: ReturnType<typeof vi.spyOn>
let _docRmSpy: ReturnType<typeof vi.spyOn>

describe('useCloudSync online/visibility 核心契约护栏', () => {
  let syncStore: ReturnType<typeof useSyncStore>

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    __resetInitialSync()
    syncStore = useSyncStore()
    _auth.isLoggedInRef.value = true
    _winHandlers = {}
    _docHandlers = {}
    _winAddSpy = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, l: EventListenerOrEventListenerObject) => { _winHandlers[type] = l as EventListener }) as any)
    _winRmSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((() => {}) as any)
    _docAddSpy = vi.spyOn(document, 'addEventListener').mockImplementation(((type: string, l: EventListenerOrEventListenerObject) => { _docHandlers[type] = l as EventListener }) as any)
    _docRmSpy = vi.spyOn(document, 'removeEventListener').mockImplementation((() => {}) as any)
    _push.enqueueSpy.mockClear()
    _push.pushFromQueueSpy.mockClear()
    _pull.pullChangesSpy.mockClear()
    _rt.subscribeSpy.mockClear()
    _rt.unsubscribeSpy.mockClear()
    _lock.withLockSpy.mockClear()
  })
  afterEach(() => {
    _winAddSpy.mockRestore(); _winRmSpy.mockRestore(); _docAddSpy.mockRestore(); _docRmSpy.mockRestore()
    vi.useRealTimers()
  })

  function initAndDispatch(evType: 'online' | 'visibilitychange', visible = true) {
    const { initOnlineListener } = useCloudSync()
    initOnlineListener()
    if (evType === 'online') _winHandlers['online']?.(new Event('online'))
    else {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visible ? 'visible' : 'hidden')
      _docHandlers['visibilitychange']?.(new Event('visibilitychange'))
    }
  }

  it('destroyOnlineListener 移除两监听（防卸载后内存泄漏 + 收事件污染已卸载 store）', () => {
    const { initOnlineListener, destroyOnlineListener } = useCloudSync()
    initOnlineListener()
    destroyOnlineListener()
    expect(_winRmSpy).toHaveBeenCalledWith('online', _winHandlers['online'])
    expect(_docRmSpy).toHaveBeenCalledWith('visibilitychange', _docHandlers['visibilitychange'])
  })

  it('online 事件 且 isLoggedIn=false → 全 no-op（未登录不该 online 真去推云触 RLS 拒绝）', () => {
    _auth.isLoggedInRef.value = false
    initAndDispatch('online')
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    expect(_lock.withLockSpy).not.toHaveBeenCalled()
    expect(_rt.subscribeSpy).not.toHaveBeenCalled()
  })

  it('online 事件 且 realtimeStatus≠"connected" → unsubscribe+subscribe 重建订阅（H2 自恢复契约）', async () => {
    syncStore.setRealtimeStatus('disconnected')
    const { initOnlineListener } = useCloudSync()
    initOnlineListener()
    _rt.subscribeSpy.mockClear()
    _rt.unsubscribeSpy.mockClear()
    _winHandlers['online']?.(new Event('online'))
    expect(_rt.unsubscribeSpy).toHaveBeenCalledTimes(1)
    expect(_rt.subscribeSpy).toHaveBeenCalledTimes(1)
  })

  it('online 事件 且 realtimeStatus="connected" → 不重订阅（已连不打断）', async () => {
    syncStore.setRealtimeStatus('connected')
    initAndDispatch('online')
    expect(_rt.subscribeSpy).toHaveBeenCalledTimes(1) // 仅 init 那次
    expect(_rt.unsubscribeSpy).not.toHaveBeenCalled()
  })

  it('visibility hidden → 早返 no-op（后台切回才同步，省流量）', () => {
    initAndDispatch('visibilitychange', false)
    expect(_pull.pullChangesSpy).not.toHaveBeenCalled()
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    expect(_lock.withLockSpy).not.toHaveBeenCalled()
  })

  it('visibility visible 且 autoSync=true → pull 先于 enqueue+push（编排顺序契约，防旧推送覆盖新拉取）', async () => {
    syncStore.setAutoSync(true)
    const order: string[] = []
    _pull.pullChangesSpy.mockImplementation(async () => { order.push('pull'); return true })
    _push.enqueueSpy.mockImplementation(() => { order.push('enqueue') })
    _push.pushFromQueueSpy.mockImplementation(async () => { order.push('push'); return true })
    initAndDispatch('visibilitychange', true)
    await vi.runAllTimersAsync()
    expect(order.indexOf('pull')).toBeLessThan(order.indexOf('enqueue'))
    expect(order).toContain('push')
  })

  it('visibility visible 且 autoSync=false → 只 pull 不 push（自动同步关不推云）', async () => {
    syncStore.setAutoSync(false)
    initAndDispatch('visibilitychange', true)
    await vi.runAllTimersAsync()
    expect(_pull.pullChangesSpy).toHaveBeenCalledTimes(1)
    expect(_push.pushFromQueueSpy).not.toHaveBeenCalled()
  })

  it('online 门控响应式重判：false 态 no-op，切 true 再派走完整编排（非 setup 快照）', async () => {
    _auth.isLoggedInRef.value = false
    const { initOnlineListener } = useCloudSync()
    initOnlineListener()
    _winHandlers['online']?.(new Event('online'))
    expect(_push.enqueueSpy).not.toHaveBeenCalled()
    _auth.isLoggedInRef.value = true
    _winHandlers['online']?.(new Event('online'))
    expect(_push.enqueueSpy).toHaveBeenCalledTimes(1)
    expect(_lock.withLockSpy).toHaveBeenCalledTimes(1)
  })
})
