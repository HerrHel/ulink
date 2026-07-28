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
import { lockDurationFor, _isRateLimitError } from '../../stores/auth.js'
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
function makeSendRateLimitedWithCode() {
  ;(supabase.auth.signInWithOtp as any).mockResolvedValue({
    data: {},
    error: { code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' },
  })
}
function makeSendInvalidEmail() {
  // 非限流类 error：邮箱格式错误。旧实现对任何 error 都施 60s 冷却，致一次邮箱输错被卡 60s。
  ;(supabase.auth.signInWithOtp as any).mockResolvedValue({
    data: {},
    error: { message: 'Unable to validate email address: invalid format' },
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

  it('审计 R31：非限流类 error（邮箱格式错误）不施冷却，可立即重发', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    makeSendInvalidEmail()
    const ok1 = await auth.sendOtp('bad-email')
    expect(ok1).toBe(false)
    expect(auth.authError).toMatch(/validate email|format|invalid/i)
    // 非限流错误不登记冷却——用户改对邮箱后应能立即重发，不被卡 60s
    expect(auth.sendCooldownRemaining('bad-email')).toBe(0)
    // 立即改对邮箱重发：网络应被再次调用
    makeSendOk()
    const ok2 = await auth.sendOtp('good@x.com')
    expect(ok2).toBe(true)
    expect((supabase.auth.signInWithOtp as any)).toHaveBeenCalledTimes(2)
  })

  it('审计 R31：限流类 error（带 code）仍施 60s 冷却', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    makeSendRateLimitedWithCode()
    const ok = await auth.sendOtp('c@x.com')
    expect(ok).toBe(false)
    expect(auth.sendCooldownRemaining('c@x.com')).toBeGreaterThan(0)
    // 冷却中再发被本地拦
    makeSendOk()
    const ok2 = await auth.sendOtp('c@x.com')
    expect(ok2).toBe(false)
  })
})

/**
 * 审计 R31 / S12 限流纯函数护栏。
 * 锁定阶梯 lockDurationFor 与限流判定 _isRateLimitError 是 sendOtp 验证逻辑核心，
 * 此前仅经端到端 mock supabase 间接覆盖；这里直锁契约，防止限流语义漂移。
 */
describe('auth 限流纯函数护栏 — lockDurationFor / _isRateLimitError', () => {
  describe('lockDurationFor：锁定阶梯升级', () => {
    it('首次触发锁（locksBefore=0）→ 30s', () => {
      const r = lockDurationFor(0)
      expect(r.lockMs).toBe(30_000)
      expect(r.label).toBe('30 秒')
    })

    it('累计 1 次锁（locksBefore=1）→ 升级 5min', () => {
      const r = lockDurationFor(1)
      expect(r.lockMs).toBe(300_000)
      expect(r.label).toBe('5 分钟')
    })

    it('累计 ≥2 次锁仍为 5min（阶梯封顶，非无限升级）', () => {
      const r2 = lockDurationFor(2)
      const r5 = lockDurationFor(5)
      expect(r2.lockMs).toBe(300_000)
      expect(r2.label).toBe('5 分钟')
      expect(r5.lockMs).toBe(300_000)
      expect(r5.label).toBe('5 分钟')
    })

    it('边界：负数 locksBefore 视为 0 档（非 ≥1）→ 30s', () => {
      // rec.locks - 1 理论非负，但护栏锁定负入参仍应走 30s 分支不抛错
      const r = lockDurationFor(-1)
      expect(r.lockMs).toBe(30_000)
    })
  })

  describe('_isRateLimitError：限流类 error 判定', () => {
    it('null / undefined → false（不入冷却）', () => {
      expect(_isRateLimitError(null)).toBe(false)
      expect(_isRateLimitError(undefined)).toBe(false)
    })

    it('空对象 / 无 code 无 message → false', () => {
      expect(_isRateLimitError({})).toBe(false)
      expect(_isRateLimitError({ code: undefined, message: undefined })).toBe(false)
    })

    it('code 命中 RATE_LIMIT_CODES（精确）→ true', () => {
      // 四个限流 code 逐个锁——漂移任一会回归「任何 error 都施冷却」
      expect(_isRateLimitError({ code: 'over_email_send_rate_limit' })).toBe(true)
      expect(_isRateLimitError({ code: 'rate_limit_exceeded' })).toBe(true)
      expect(_isRateLimitError({ code: 'email_rate_limit_exceeded' })).toBe(true)
      expect(_isRateLimitError({ code: 'email_not_allowed_rate_limited' })).toBe(true)
    })

    it('code 大小写不敏感（大写仍命中）→ true', () => {
      // 实测锁定 toLowerCase 行为：上端 error code 未必规范小写
      expect(_isRateLimitError({ code: 'OVER_EMAIL_SEND_RATE_LIMIT' })).toBe(true)
      expect(_isRateLimitError({ code: 'Rate_Limit_Exceeded' })).toBe(true)
    })

    it('非限流 code → false（不误伤普通 error）', () => {
      // signup_disabled / invalid email / 网络错误等不该施冷却
      expect(_isRateLimitError({ code: 'signup_disabled' })).toBe(false)
      expect(_isRateLimitError({ code: 'invalid_credentials' })).toBe(false)
      expect(_isRateLimitError({ code: 'unknown_code' })).toBe(false)
    })

    it('message 命中限流措辞（旧 SDK 仅 message）→ true', () => {
      // gotrue 经典限流文案
      expect(
        _isRateLimitError({ message: 'For security reasons, you can only request once every 60 seconds' }),
      ).toBe(true)
      expect(_isRateLimitError({ message: 'too many requests' })).toBe(true)
      expect(_isRateLimitError({ message: 'too many emails' })).toBe(true)
    })

    it('message 中文限流措辞（稍候/过频繁/频繁）→ true', () => {
      expect(_isRateLimitError({ message: '请求过于频繁，请稍候再试' })).toBe(true)
      expect(_isRateLimitError({ message: '操作过频繁' })).toBe(true)
      expect(_isRateLimitError({ message: '访问频繁，请稍候' })).toBe(true)
    })

    it('message 含 rate-limit 各分隔变体（空格/下划线/连字符）→ true', () => {
      expect(_isRateLimitError({ message: 'rate limit reached' })).toBe(true)
      expect(_isRateLimitError({ message: 'rate_limit reached' })).toBe(true)
      expect(_isRateLimitError({ message: 'rate-limit reached' })).toBe(true)
      expect(_isRateLimitError({ message: 'ratelimit reached' })).toBe(true)
    })

    it('非限流 message → false', () => {
      // 邮箱格式错误 / signup 禁用 / 网络错误文案不得误判为限流
      expect(_isRateLimitError({ message: 'Unable to validate email address: invalid format' })).toBe(false)
      expect(_isRateLimitError({ message: 'Signup disabled' })).toBe(false)
      expect(_isRateLimitError({ message: 'Network request failed' })).toBe(false)
      expect(_isRateLimitError({ message: 'Token has expired or is invalid' })).toBe(false)
    })

    it('code 优先于 message：code 限流命中即使 message 空也 true；code 非限流但 message 限流仍 true', () => {
      // 双通道或关系——任一命中即施冷却
      expect(_isRateLimitError({ code: 'over_email_send_rate_limit', message: '' })).toBe(true)
      expect(_isRateLimitError({ code: 'signup_disabled', message: 'too many requests' })).toBe(true)
    })

    it('code 为非 string（number/object）→ 不抛错，仅看 message', () => {
      // error.code 类型不可控时的兜底，护栏锁定非 string code 不参与判定。
      // 运行时 supabase error.code 可能是非 string 值，用 as any 模拟运行时形态。
      expect(_isRateLimitError({ code: 123 as any, message: 'rate limit' })).toBe(true)
      expect(_isRateLimitError({ code: 123 as any, message: 'normal error' })).toBe(false)
      expect(_isRateLimitError({ code: { x: 1 } as any, message: 'ok' })).toBe(false)
    })
  })
})
