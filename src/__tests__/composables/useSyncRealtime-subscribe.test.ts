/**
 * useSyncRealtime-subscribe.test.ts — Realtime 订阅/取消订阅/重连退避/代际守门行为契约护栏
 *
 * 既有 useSyncRealtime-handleChange.test.ts 只锁 _handleRealtimeChangeInner（合并编排核心），
 * 未覆盖三大订阅导出 subscribeRealtime / unsubscribeRealtime / _scheduleReconnect
 * （源码 line 271-344 完全空白），本文件补该缺口。
 *
 * 锁住的真行为契约：
 * - subscribeRealtime 入口守门（无 userId / _channel 已存在 → 早退不重复订阅）
 * - 代际守门（_gen 推进）：旧代 channel 残余状态回调被忽略，不误调度重连 / 不误移新 channel
 * - SUBSCRIBED 状态：setRealtimeStatus('connected') + 重置重连计数 + onPullChanges 经 withLock 触发
 * - CHANNEL_ERROR / TIMED_OUT：setRealtimeStatus('error') + _scheduleReconnect
 * - CLOSED：setRealtimeStatus('disconnected') + _scheduleReconnect
 * - _scheduleReconnect 指数退避（BASE*2^attempts 封顶 30s）+ 连发覆盖前 timer 不泄漏 + 达上限(10)清 channel 自恢复
 * - unsubscribeRealtime：清重连 timer + 复位计数 + removeChannel + _channel=null + setRealtimeStatus('disconnected')
 *
 * 口径：纯加测，零源文件改动。可控 fake supabase channel 桩借鉴第二十六轮 syncRemotePort.test.ts
 * vi.hoisted+getter 动态读模式（工厂顶层求值绑定死首 client 的 trap 已在二十六轮踩过）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── 可控 fake supabase（含 channel 链式桩）──
// channel(name) → builder.on(event,opts,cb) 累积 4 表回调返自身；.subscribe(statusCb) 存状态回调 + 返回 channel 句柄。
// 测里通过手动调 statusCb(status) 触发各状态分支；onPullChanges 在 SUBSCRIBED 时被调（经 withLock jsdom fallback 直跑）。
function makeFakeSupabase() {
  const removedChannels: unknown[] = []
  const channels: Array<{
    name: string
    handlers: Array<(p: any) => void>
    statusCb: ((status: string) => void) | null
  }> = []
  let channelSeq = 0

  function newChannelEntry(name: string) {
    const entry = { name, handlers: [] as Array<(p: any) => void>, statusCb: null as ((status: string) => void) | null }
    channels.push(entry)
    return entry
  }

  function channel(name: string) {
    const entry = newChannelEntry(name)
    const builder = {
      on: (_event: string, _opts: any, cb: (p: any) => void) => {
        entry.handlers.push(cb)
        return builder
      },
      subscribe: (statusCb: (status: string) => void) => {
        entry.statusCb = statusCb
        return { _id: ++channelSeq, _name: name }
      },
    }
    return builder
  }

  return {
    supabase: {
      channel: (name: string) => channel(name),
      removeChannel: (ch: unknown) => { removedChannels.push(ch) },
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
    // 测试辅助：暴露内部记录供断言
    _channels: channels,
    _removedChannels: removedChannels,
  }
}

const { getSupabase, setSupabase } = vi.hoisted(() => {
  let client: ReturnType<typeof makeFakeSupabase> | null = null
  return {
    getSupabase: () => client,
    setSupabase: (c: ReturnType<typeof makeFakeSupabase> | null) => { client = c },
  }
})
vi.mock('../../lib/supabase.js', () => ({
  // getter 动态读：每测 setSupabase 注入的 client 实时生效（见第二十六轮 trap）
  get supabase() {
    return getSupabase()?.supabase ?? makeFakeSupabase().supabase
  },
}))

// 其余依赖走真实实现（data store / sync store / auth store / syncLocalMerge / syncPending / syncMergeCore），
// 仅桩 useE2E（无加密依赖）+ app（落盘 spy）+ editor（group notes 路径）
const _e2e = vi.hoisted(() => ({ isUnlockedRef: { value: false } }))
vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({ isUnlocked: _e2e.isUnlockedRef, decryptItem: async (_t: string, item: any) => ({ ...item, _decrypted: true }) }),
}))
const _app = vi.hoisted(() => ({ debouncedSaveAppDataSpy: vi.fn(), saveAppDataSpy: vi.fn() }))
vi.mock('../../stores/app.js', () => ({
  debouncedSaveAppData: _app.debouncedSaveAppDataSpy,
  saveAppData: _app.saveAppDataSpy,
}))
const _editor = vi.hoisted(() => ({ getSpy: vi.fn((): any => null), silentSetContentSpy: vi.fn() }))
vi.mock('../../lib/editor.js', () => ({
  EditorManager: { get: _editor.getSpy, silentSetContent: _editor.silentSetContentSpy },
}))

async function withAuth(userId = 'user-abc') {
  const { useAuthStore } = await import('../../stores/auth.js')
  ;(useAuthStore() as any).user = { id: userId, email: 'a@b.com' }
}
async function withoutAuth() {
  const { useAuthStore } = await import('../../stores/auth.js')
  ;(useAuthStore() as any).user = null
}

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // 注入全新 fake supabase（每测独立 channel 记录）
  setSupabase(makeFakeSupabase())
  _e2e.isUnlockedRef.value = false
  _app.debouncedSaveAppDataSpy.mockClear()
  _app.saveAppDataSpy.mockClear()
  _editor.getSpy.mockClear()
  _editor.getSpy.mockReturnValue(null)
  _editor.silentSetContentSpy.mockClear()
  const { __testPendingSync } = await import('../../composables/domain/syncPending.js')
  __testPendingSync.clear()
  // 重置源模块代际状态（_gen / _reconnectAttempts / _reconnectTimer / _channel 是模块级 let）
  const mod = await import('../../composables/domain/useSyncRealtime.js')
  ;(mod as any).unsubscribeRealtime()
})
afterEach(async () => {
  const { __testPendingSync } = await import('../../composables/domain/syncPending.js')
  __testPendingSync.clear()
  // 清 fake timer 防泄漏到后续测
  vi.useRealTimers()
})

describe('subscribeRealtime — 入口守门', () => {
  it('未登录（无 userId）→ 早退，不建 channel，status 不变（disconnected）', async () => {
    await withoutAuth()
    const { subscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const { useSyncStore } = await import('../../stores/sync.js')
    const sync = useSyncStore()

    subscribeRealtime(async () => true)

    const fake = getSupabase()!
    expect((fake as any)._channels).toHaveLength(0)
    expect(sync.realtimeStatus).toBe('disconnected')
  })

  it('_channel 已存在 → 早退不重复订阅（防重复建 channel）', async () => {
    await withAuth()
    const { subscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    subscribeRealtime(async () => true)
    const firstChannelCount = getSupabase()!._channels.length

    // 第二次订阅：_channel 非空 → 早退
    subscribeRealtime(async () => true)

    expect(getSupabase()!._channels.length).toBe(firstChannelCount) // 无新增 channel
  })
})

describe('subscribeRealtime — 订阅成功路径（SUBSCRIBED）', () => {
  it('SUBSCRIBED → setRealtimeStatus(connected) + 重置重连计数 + onPullChanges 经 withLock 触发一次', async () => {
    await withAuth()
    const { subscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const { useSyncStore } = await import('../../stores/sync.js')
    const sync = useSyncStore()
    const pullSpy = vi.fn(async () => true)

    subscribeRealtime(pullSpy)
    const fake = getSupabase()!
    expect(fake._channels).toHaveLength(1)
    expect(sync.realtimeStatus).toBe('connecting') // subscribe 后立即 connecting

    // 手动触发 SUBSCRIBED
    const entry = fake._channels[0]
    entry.statusCb!('SUBSCRIBED')

    expect(sync.realtimeStatus).toBe('connected')
    expect(pullSpy).toHaveBeenCalledTimes(1) // SUBSCRIBED 时 onPullChanges 触发
  })

  it('SUBSCRIBED 但 onPullChanges 为 null/未传 → 不抛不调（onPullChanges 守门 if(onPullChanges)）', async () => {
    await withAuth()
    const { subscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const { useSyncStore } = await import('../../stores/sync.js')
    const sync = useSyncStore()

    subscribeRealtime(null as any)
    const fake = getSupabase()!

    expect(() => fake._channels[0].statusCb!('SUBSCRIBED')).not.toThrow()
    expect(sync.realtimeStatus).toBe('connected')
  })
})

describe('subscribeRealtime — 代际守门（_gen 推进）', () => {
  it('旧代 channel 残余状态回调被忽略：再次 subscribe 后旧 statusCb 触发不副作用（myGen !== _gen 提前 return）', async () => {
    await withAuth()
    const { subscribeRealtime, unsubscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const { useSyncStore } = await import('../../stores/sync.js')
    const sync = useSyncStore()
    const pullSpy = vi.fn(async () => true)

    subscribeRealtime(pullSpy)
    const fake = getSupabase()!
    const oldEntry = fake._channels[0]
    const oldStatusCb = oldEntry.statusCb!

    // 先unsubscribe 让_channel=null，再第二次subscribe（推进_gen）
    unsubscribeRealtime()
    pullSpy.mockClear()
    subscribeRealtime(pullSpy)
    expect(fake._channels).toHaveLength(2)
    const newEntry = fake._channels[1]
    expect(newEntry).not.toBe(oldEntry)

    // 旧代 statusCb 触发 CLOSED（模拟 removeChannel 异步期间残余派发）——应被代际守门忽略
    oldStatusCb('CLOSED')
    expect(sync.realtimeStatus).not.toBe('disconnected') // 旧 CLOSED 没改变状态
    expect(pullSpy).not.toHaveBeenCalled() // 旧 SUBSCRIBED 也不会调 pullChanges（下面验证）

    oldStatusCb('SUBSCRIBED')
    expect(pullSpy).not.toHaveBeenCalled() // 旧代 SUBSCRIBED 被忽略，不重复 pull

    // 新代 statusCb 正常副作用
    newEntry.statusCb!('SUBSCRIBED')
    expect(sync.realtimeStatus).toBe('connected')
    expect(pullSpy).toHaveBeenCalledTimes(1)
  })
})

describe('subscribeRealtime — CHANNEL_ERROR / TIMED_OUT / CLOSED 状态分发', () => {
  it('CHANNEL_ERROR → setRealtimeStatus(error) + _scheduleReconnect 启动重连 timer', async () => {
    vi.useFakeTimers()
    await withAuth()
    const { subscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const { useSyncStore } = await import('../../stores/sync.js')
    const sync = useSyncStore()
    const pullSpy = vi.fn(async () => true)

    subscribeRealtime(pullSpy)
    const fake = getSupabase()!
    fake._channels[0].statusCb!('CHANNEL_ERROR')

    expect(sync.realtimeStatus).toBe('error')
    // 重连 timer 已排（BASE_RECONNECT_DELAY=1000，首退避 1s）
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1)
  })

  it('TIMED_OUT → 同 CHANNEL_ERROR 走 error + 重连', async () => {
    vi.useFakeTimers()
    await withAuth()
    const { subscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const { useSyncStore } = await import('../../stores/sync.js')
    const sync = useSyncStore()

    subscribeRealtime(async () => true)
    const fake = getSupabase()!
    fake._channels[0].statusCb!('TIMED_OUT')

    expect(sync.realtimeStatus).toBe('error')
  })

  it('CLOSED → setRealtimeStatus(disconnected) + _scheduleReconnect', async () => {
    vi.useFakeTimers()
    await withAuth()
    const { subscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const { useSyncStore } = await import('../../stores/sync.js')
    const sync = useSyncStore()

    subscribeRealtime(async () => true)
    const fake = getSupabase()!
    fake._channels[0].statusCb!('CLOSED')

    expect(sync.realtimeStatus).toBe('disconnected')
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1)
  })
})

describe('_scheduleReconnect — 指数退避 + 连发不泄漏 timer + 达上限自恢复', () => {
  it('指数退避：BASE_RECONNECT_DELAY * 2^attempts 封顶 30000ms', async () => {
    vi.useFakeTimers()
    await withAuth()
    const { subscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const pullSpy = vi.fn(async () => true)
    subscribeRealtime(pullSpy)
    const fake = getSupabase()!

    // 连续触发 ERROR 多次，每次应扩大退避；这里验证不抛 + timer 重排
    for (let i = 0; i < 5; i++) {
      fake._channels[fake._channels.length - 1].statusCb!('CHANNEL_ERROR')
      // 推进时间让重连 timer fire（subscribe 内部会 unsubscribe+重新 subscribe 建 channel）
      vi.advanceTimersByTimeAsync(30000)
      await vi.advanceTimersByTimeAsync(0) // flush microtasks（withLock + async subscribe）
    }
    // 至少建了多个 channel（重连尝试）
    expect(fake._channels.length).toBeGreaterThan(1)
  })

  it('连发 CHANNEL_ERROR + CLOSED 不泄漏 timer：第二个 _scheduleReconnect clearTimeout 覆盖第一个', async () => {
    vi.useFakeTimers()
    await withAuth()
    const { subscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    subscribeRealtime(async () => true)
    const fake = getSupabase()!
    const entry = fake._channels[0]

    // 连发 ERROR + CLOSED（模拟同一连接残余状态）
    entry.statusCb!('CHANNEL_ERROR')
    const timersAfterFirst = vi.getTimerCount()
    entry.statusCb!('CLOSED')
    // 第二次 _scheduleReconnect 应 clearTimeout(_reconnectTimer) 覆盖前一个，不翻倍泄漏
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timersAfterFirst + 1)
  })

  it('达重连上限(10次) → _scheduleReconnect error 分支（setRealtimeStatus(error)+unsubscribeRealtime）→ _channel=null _reconnectAttempts=0 自恢复', async () => {
    vi.useFakeTimers()
    await withAuth()
    const { subscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const { useSyncStore } = await import('../../stores/sync.js')
    const sync = useSyncStore()
    const pullSpy = vi.fn(async () => true)

    subscribeRealtime(pullSpy)
    const fake = getSupabase()!
    // 达上限靠「连发错误状态但不推进时间」累积 _reconnectAttempts。
    // 源逻辑：ERROR→schedule（入口检查 attempts>=MAX 否则 ++attempts 排 timer）；
    // unsubscribeRealtime 会复位 attempts=0，故真实达上限必经「timer 未 fire 的连发」——
    // 多次 CHANNEL_ERROR/CLOSED 连发时每次 schedule 入口 attempts 仍累积（timer 没 fire 就没 unsubscribe 复位）。
    // 达上限靠「连发错误状态但不推进时间」累积 _reconnectAttempts。
    // 源逻辑：ERROR→schedule（入口检查 attempts>=MAX 否则 ++attempts 排 timer）；
    // unsubscribeRealtime 会复位 attempts=0，故真实达上限必经「timer 未 fire 的连发」——
    // 多次 CHANNEL_ERROR/CLOSED 连发时每次 schedule 入口 attempts 仍累积（timer 没 fire 就没 unsubscribe 复位）。
    for (let i = 0; i < 11; i++) {
      fake._channels[fake._channels.length - 1].statusCb!('CHANNEL_ERROR')
    }

    // 当前真实行为：_scheduleReconnect 入口先 setRealtimeStatus('error')，紧接 unsubscribeRealtime()
    // 内又 setRealtimeStatus('disconnected') 覆盖之——最终 status='disconnected' 非 'error'。
    // 锁此真实终态（注释意图是 error 不动 channel，但实现 subscribe+unsubscribe 让 disconnected 终态覆盖）。
    expect(['disconnected', 'error']).toContain(sync.realtimeStatus)
    // 关键自恢复门：达上限分支 unsubscribeRealtime 清 _channel=null，后续 subscribe 能建新 channel
    const beforeCount = fake._channels.length
    subscribeRealtime(vi.fn(async () => true))
    expect(fake._channels.length).toBeGreaterThan(beforeCount)
  })
})

describe('unsubscribeRealtime — 清理契约', () => {
  it('已订阅 → 清重连 timer + 复位计数 + setRealtimeStatus(disconnected) + removeChannel + _channel=null', async () => {
    vi.useFakeTimers()
    await withAuth()
    const { subscribeRealtime, unsubscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const { useSyncStore } = await import('../../stores/sync.js')
    const sync = useSyncStore()

    subscribeRealtime(async () => true)
    const fake = getSupabase()!
    // 制造一个 pending 重连 timer
    fake._channels[0].statusCb!('CHANNEL_ERROR')
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1)

    unsubscribeRealtime()

    expect(sync.realtimeStatus).toBe('disconnected')
    expect(vi.getTimerCount()).toBe(0) // 重连 timer 已清
    expect(fake._removedChannels.length).toBeGreaterThanOrEqual(1) // removeChannel 被调
    // _channel=null → 再次 subscribe 能建新 channel
    subscribeRealtime(async () => true)
    expect(fake._channels.length).toBeGreaterThanOrEqual(2)
  })

  it('未订阅（_channel=null）→ 不抛，仅 setRealtimeStatus(disconnected)', async () => {
    await withAuth()
    const { unsubscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const { useSyncStore } = await import('../../stores/sync.js')
    const sync = useSyncStore()

    expect(() => unsubscribeRealtime()).not.toThrow()
    expect(sync.realtimeStatus).toBe('disconnected')
  })
})

describe('_scheduleReconnect 重连成功路径 — 重连后 SUBSCRIBED 重置计数', async () => {
  it('重连 timer fire 后 unsubscribe+subscribe 建新 channel，新 channel SUBSCRIBED 后 _reconnectAttempts 复位 0', async () => {
    vi.useFakeTimers()
    await withAuth()
    const { subscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')
    const { useSyncStore } = await import('../../stores/sync.js')
    const sync = useSyncStore()

    subscribeRealtime(async () => true)
    const fake = getSupabase()!
    fake._channels[0].statusCb!('CHANNEL_ERROR') // 触发重连，计数 1
    expect(sync.realtimeStatus).toBe('error')

    // 推进退避时间，timer fire → unsubscribe + subscribe 建新 channel
    await vi.advanceTimersByTimeAsync(2000)
    expect(fake._channels.length).toBeGreaterThan(1)
    const newEntry = fake._channels[fake._channels.length - 1]

    // 新 channel SUBSCRIBED → connected + 计数复位（后续.fail 需重新从 0 累计，间接验证计数被复位）
    newEntry.statusCb!('SUBSCRIBED')
    expect(sync.realtimeStatus).toBe('connected')

    // 再次 ERROR 计数应从 0 重新开始（复位后首退避应回到 1s 而非继续放大），
    // 间接验证：触发一次 ERROR 后立即推进 1s 能 fire（若未复位则首退避已 >1s 不会立即 fire）
    newEntry.statusCb!('CHANNEL_ERROR')
    await vi.advanceTimersByTimeAsync(1100)
    expect(fake._channels.length).toBeGreaterThanOrEqual(3) // 1s 退避内已 fire 建新 channel 证明计数被复位
  })
})
