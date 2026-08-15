import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

/**
 * auth store 生命周期补测 —— 锁 init / signOut / ticker 自动停表
 * 既有 auth.test.ts 覆盖 S12 限流主路径 + R31 限流纯函数护栏，
 * 但 init()（getSession + onAuthStateChange 回调）、signOut()（成功/失败）
 * 与 _ensureTicker ticker 全 idle 停表契约从未直接触达（均为整函数零覆盖）。
 * 本测补三层契约：①init 编排 + onAuthStateChange 回调派发 session/user
 * ②signOut 成功返 true / 失败设 authError 返 false ③ticker 锁/冷却到期清理
 * 与「全部 idle 时停 clearInterval 防泄漏」生命周期收口。
 *
 * 桩沿用既有 auth.test.ts 同构：vi.mock supabase.auth 各方法可控返回，
 * fake timers 驱动 ticker 每秒回调。
 */
vi.mock('../../lib/supabase.js', () => {
  return {
    supabase: {
      auth: {
        signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
        verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
        signOut: vi.fn(async () => ({ error: null })),
        getSession: vi.fn(async () => ({ data: { session: null } })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      },
    },
  }
})

import { useAuthStore } from '../../stores/auth.js'
import { supabase } from '../../lib/supabase.js'

/** 造一个带 user 的真 session 对象（init/onAuthStateChange 路径断言用） */
function fakeSession(email = 'u@x.com') {
  return {
    access_token: 'atk',
    refresh_token: 'rtk',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: 'uid-1', email, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01' },
  } as any
}

describe('auth 生命周期 — init / signOut / ticker 停表', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => vi.useRealTimers())

  it('init: loading 流转 + getSession 命中 session→设 user/session + loading 收尾', async () => {
    const sess = fakeSession('init@x.com')
    ;(supabase.auth.getSession as any).mockResolvedValue({ data: { session: sess } })
    ;(supabase.auth.onAuthStateChange as any).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })

    const auth = useAuthStore()
    expect(auth.loading).toBe(true) // store 定义初值
    await auth.init()
    expect(auth.loading).toBe(false)
    // Pinia 经 reactive 代理后 ref.value 持有 proxy 非原始 sess 引用，用属性断言
    expect(auth.session).not.toBeNull()
    expect(auth.session).toEqual(sess)
    expect(auth.user?.email).toBe('init@x.com')
    expect(auth.isLoggedIn).toBe(true)
    expect(auth.userEmail).toBe('init@x.com')
    expect((supabase.auth.getSession as any)).toHaveBeenCalledTimes(1)
    // onAuthStateChange 注册回调（sub 句柄保留防泄漏）
    expect((supabase.auth.onAuthStateChange as any)).toHaveBeenCalledTimes(1)
  })

  it('init: getSession 无 session → user/session 为 null + loading 收尾（未登录态）', async () => {
    ;(supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } })
    ;(supabase.auth.onAuthStateChange as any).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })

    const auth = useAuthStore()
    await auth.init()
    expect(auth.loading).toBe(false)
    expect(auth.session).toBeNull()
    expect(auth.user).toBeNull()
    expect(auth.isLoggedIn).toBe(false)
    expect(auth.userEmail).toBe('')
  })

  it('init: 注册的 onAuthStateChange 回调派发后同步更新 session/user', async () => {
    // 捕获回调以手动派发（init 内部把回调传给 supabase，无返回路径）
    let stateCb: ((evt: any, s: any) => void) | null = null
    ;(supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } })
    ;(supabase.auth.onAuthStateChange as any).mockImplementation((cb: any) => {
      stateCb = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    const auth = useAuthStore()
    await auth.init()
    expect(auth.user).toBeNull()

    // 模拟 supabase 派发 SIGNED_IN 事件带新 session
    const sess = fakeSession('signed-in@x.com')
    expect(stateCb).not.toBeNull()
    stateCb!('SIGNED_IN', sess)
    expect(auth.session).not.toBeNull()
    expect(auth.session).toEqual(sess)
    expect(auth.user?.email).toBe('signed-in@x.com')

    // 派发 SIGNED_OUT → session/user 清空
    stateCb!('SIGNED_OUT', null)
    expect(auth.session).toBeNull()
    expect(auth.user).toBeNull()
    expect(auth.isLoggedIn).toBe(false)
  })

  it('signOut 成功 → 清 authError 返 true', async () => {
    ;(supabase.auth.signOut as any).mockResolvedValue({ error: null })
    const auth = useAuthStore()
    auth.authError = '旧错误' // 预置非空验证进 signOut 入口清错分支
    const ok = await auth.signOut()
    expect(ok).toBe(true)
    expect(auth.authError).toBeNull()
    expect((supabase.auth.signOut as any)).toHaveBeenCalledTimes(1)
  })

  it('signOut 失败 → 设 authError=message 返 false 不清旧 error（被 message 覆盖）', async () => {
    ;(supabase.auth.signOut as any).mockResolvedValue({ error: { message: 'Failed to sign out' } })
    const auth = useAuthStore()
    auth.authError = '旧错误'
    const ok = await auth.signOut()
    expect(ok).toBe(false)
    expect(auth.authError).toBe('Failed to sign out')
  })

  it('ticker: 锁到期 reset fails/lockUntil、冷却到期清 sendUntil（保留累计锁次数）', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    // 触发 30s 锁：5 次失败
    ;(supabase.auth.verifyOtp as any).mockResolvedValue({
      data: {},
      error: { message: 'Token has expired or is invalid' },
    })
    for (let i = 0; i < 5; i++) await auth.verifyOtp('t@x.com', '000000')
    expect(auth.verifyLockRemaining('t@x.com')).toBeGreaterThan(0)

    // 推进过 30s 锁——ticker 每秒跑应清 lockUntil + fails=0
    vi.advanceTimersByTime(31_000)
    expect(auth.verifyLockRemaining('t@x.com')).toBe(0)
    // 累计锁次数保留（下次锁升级 5min）——直接再 5 次失败应升级
    ;(supabase.auth.verifyOtp as any).mockResolvedValue({
      data: {},
      error: { message: 'Token has expired or is invalid' },
    })
    for (let i = 0; i < 5; i++) await auth.verifyOtp('t@x.com', '000000')
    // 升级锁：5min
    const remain = auth.verifyLockRemaining('t@x.com')
    expect(remain).toBeGreaterThan(200)
  })

  it('ticker: 锁与冷却皆 idle 后自动 clearInterval 停表（生命周期收口，防 setInterval 泄漏）', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    // 登记一个 sendCooldown（sendOtp 成功路径）
    ;(supabase.auth.signInWithOtp as any).mockResolvedValue({ data: {}, error: null })
    const ok = await auth.sendOtp('idle@x.com')
    expect(ok).toBe(true)
    // 取停表前的 setInterval 句柄计数：ticker 活跃
    // 推进 61s 让冷却到期——全 idle 后 ticker 应 clearInterval 自停
    const spyClear = vi.spyOn(globalThis, 'clearInterval')
    vi.advanceTimersByTime(61_000)
    // 停表分支被触：clearInterval 被调（在 _ensureTicker 内 clearInterval(_ticker)）
    expect(spyClear).toHaveBeenCalled()
    // 停表后不再起 ticker：再调一个新邮箱 sendOtp 会重新 _ensureTicker（if _ticker 已 null）
    ;(supabase.auth.signInWithOtp as any).mockResolvedValue({ data: {}, error: null })
    const ok2 = await auth.sendOtp('idle2@x.com')
    expect(ok2).toBe(true)
    spyClear.mockRestore()
  })

  it('ticker: 冷却中再发被本地拒，且 ticker 不因冷却中（非全 idle）继续走表不误停', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    ;(supabase.auth.signInWithOtp as any).mockResolvedValue({ data: {}, error: null })
    await auth.sendOtp('running@x.com')
    // 10s 时仍未到期——再发应被本地冷却拒
    vi.advanceTimersByTime(10_000)
    ;(supabase.auth.signInWithOtp as any).mockResolvedValue({ data: {}, error: null })
    const ok = await auth.sendOtp('running@x.com')
    expect(ok).toBe(false)
    // 剩余 ~50s
    expect(auth.sendCooldownRemaining('running@x.com')).toBeGreaterThan(40)
    expect(auth.sendCooldownRemaining('running@x.com')).toBeLessThanOrEqual(50)
  })
})
