import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

/**
 * S12 单测：OTP 客户端限流。
 * 模拟「连续错误 OTP → 触顶锁定」与「同邮箱发送冷却」两类行为。
 *
 * 策略：mock supabase.auth.signInWithOtp / verifyOtp 按需返回 error，
 *      不打网络；断言 store 的冷却/锁定状态与按钮可见文案。
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
// 触发 mock 模块加载
import { supabase } from '../../lib/supabase.js'

function makeVerifyFail() {
  ;(supabase.auth.verifyOtp as any).mockResolvedValue({
    data: {},
    error: { message: 'Token has expired or is invalid' },
  })
}
function makeVerifyOk() {
  ;(supabase.auth.verifyOtp as any).mockResolvedValue({ data: {}, error: null })
}
function makeSendOk() {
  ;(supabase.auth.signInWithOtp as any).mockResolvedValue({ data: {}, error: null })
}
function makeSendRateLimited() {
  ;(supabase.auth.signInWithOtp as any).mockResolvedValue({
    data: {},
    error: { message: 'For security reasons, you can only request once every 60 seconds' },
  })
}

describe('S12 OTP 限流 — useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    makeSendOk()
    makeVerifyOk()
  })
  afterEach(() => vi.useRealTimers())

  it('sendOtp 成功后登记 60s 冷却，冷却中再次发送被拒', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    makeSendOk()

    const ok1 = await auth.sendOtp('a@x.com')
    expect(ok1).toBe(true)
    // 立即再发：冷却中
    const ok2 = await auth.sendOtp('a@x.com')
    expect(ok2).toBe(false)
    expect(auth.authError).toMatch(/60|秒/)
    // 只发了一次网络请求（第二次被本地冷却拦截）
    expect((supabase.auth.signInWithOtp as any)).toHaveBeenCalledTimes(1)

    // 推进 61s，冷却到期应可再发
    vi.advanceTimersByTime(61_000)
    makeSendOk()
    const ok3 = await auth.sendOtp('a@x.com')
    expect(ok3).toBe(true)
    expect((supabase.auth.signInWithOtp as any)).toHaveBeenCalledTimes(2)
  })

  it('verifyOtp 连续失败达 5 次触发 30s 锁定，锁定中拒绝且不再打网络', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    makeVerifyFail()

    // 1~4 次失败：不锁，但记计数
    for (let i = 0; i < 4; i++) {
      const ok = await auth.verifyOtp('a@x.com', '000000')
      expect(ok).toBe(false)
    }
    expect(auth.authError).toContain('验证码错误')
    // 第 5 次失败：触发锁定
    const ok5 = await auth.verifyOtp('a@x.com', '000000')
    expect(ok5).toBe(false)
    expect(auth.authError).toContain('锁定')
    expect(auth.verifyLockRemaining('a@x.com')).toBeGreaterThan(0)

    const callsBefore = (supabase.auth.verifyOtp as any).mock.calls.length
    // 锁定中再试：被本地拦截，不再打网络
    const ok6 = await auth.verifyOtp('a@x.com', '000000')
    expect(ok6).toBe(false)
    expect(auth.authError).toContain('验证失败次数过多')
    expect((supabase.auth.verifyOtp as any).mock.calls.length).toBe(callsBefore)

    // 推进 31s，锁到期应恢复网络调用
    vi.advanceTimersByTime(31_000)
    makeVerifyOk()
    const ok7 = await auth.verifyOtp('a@x.com', '123456')
    expect(ok7).toBe(true)
  })

  it('verifyOtp 重复触发锁后升级为 5min 硬锁（累计锁次数阶梯）', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    makeVerifyFail()

    // 第一轮：5 次失败 → 30s 锁
    for (let i = 0; i < 5; i++) await auth.verifyOtp('a@x.com', '000000')
    expect(auth.authError).toContain('锁定')
    expect(auth.authError).toContain('30 秒')
    let remain = auth.verifyLockRemaining('a@x.com')
    expect(remain).toBeGreaterThan(0)
    expect(remain).toBeLessThanOrEqual(30)

    // 推进过 30s 锁。ticker 每秒跑会清掉本轮失效计数，但累计锁次数保留
    vi.advanceTimersByTime(31_000)
    // 注意：store 用可变对象记录，ticker 清锁时会 reset rec.fails=0、lockUntil=0
    makeVerifyFail()
    // 第二轮：再 5 次失败 → 升级 5min 锁
    for (let i = 0; i < 5; i++) await auth.verifyOtp('a@x.com', '000000')
    expect(auth.authError).toContain('锁定')
    expect(auth.authError).toContain('5 分钟')
    remain = auth.verifyLockRemaining('a@x.com')
    expect(remain).toBeGreaterThan(200)  // 5min = 300s
  })

  it('verifyOtp 成功后清失败计数与锁', async () => {
    const auth = useAuthStore()
    makeVerifyFail()
    await auth.verifyOtp('a@x.com', '000000')
    await auth.verifyOtp('a@x.com', '000000')
    expect(auth.verifyLockRemaining('a@x.com')).toBe(0)  // 2 次未达锁

    makeVerifyOk()
    const ok = await auth.verifyOtp('a@x.com', '123456')
    expect(ok).toBe(true)
    // 成功后状态清零
    expect(auth.verifyLockRemaining('a@x.com')).toBe(0)
  })

  it('resetVerifyState 清掉某邮箱的失败计数与锁', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    makeVerifyFail()
    for (let i = 0; i < 5; i++) await auth.verifyOtp('a@x.com', '000000')  // 触发 30s 锁
    expect(auth.verifyLockRemaining('a@x.com')).toBeGreaterThan(0)

    auth.resetVerifyState('a@x.com')
    expect(auth.verifyLockRemaining('a@x.com')).toBe(0)
    // 锁清后可立即打网络
    makeVerifyOk()
    const ok = await auth.verifyOtp('a@x.com', '123456')
    expect(ok).toBe(true)
  })

  it('sendOtp 遇平台限流也登记本地冷却，避免短时重复触发', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    makeSendRateLimited()
    const ok = await auth.sendOtp('a@x.com')
    expect(ok).toBe(false)
    expect(auth.sendCooldownRemaining('a@x.com')).toBeGreaterThan(0)
    // 冷却中再发：被本地拦
    makeSendOk()
    const ok2 = await auth.sendOtp('a@x.com')
    expect(ok2).toBe(false)
  })

  it('不同邮箱互不影响限流状态', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    makeSendOk()
    await auth.sendOtp('a@x.com')
    // a 在冷却，b 不受影响
    expect(auth.sendCooldownRemaining('a@x.com')).toBeGreaterThan(0)
    expect(auth.sendCooldownRemaining('b@x.com')).toBe(0)
    const ok = await auth.sendOtp('b@x.com')
    expect(ok).toBe(true)
  })
})
