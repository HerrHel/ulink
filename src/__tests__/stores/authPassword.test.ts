/**
 * auth store — 邮箱密码登录（新增能力）
 *
 * 用 __setAuthDriverForTest 注入假驱动，绕开 supabase mock 的复杂度，
 * 只锁「store 自己的决策逻辑」：
 *   1) 密码登录失败给的是「引导去验证码登录再设密码」的文案（老用户没有密码时唯一可用的提示方式）
 *   2) 失败计数与锁定复用了验证码那套配额（同一账号的凭据尝试共享）
 *   3) 设密码有本地强度前置校验，不合规不发请求
 *   4) 找回密码复用发送冷却
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { __setAuthDriverForTest, type AuthDriver } from '../../lib/authDriver.js'
import { useAuthStore } from '../../stores/auth.js'

/** 假驱动：记录被调用的方法名，可按需覆盖单个方法的行为 */
function makeDriver(overrides: Partial<AuthDriver> = {}) {
  const calls: string[] = []
  const base: AuthDriver = {
    async getSession() {
      return { session: null, error: null }
    },
    onAuthStateChange() {},
    async updateUserMeta() {
      return { user: null, error: null }
    },
    async sendOtp() {
      calls.push('sendOtp')
      return { error: null }
    },
    async verifyOtp() {
      calls.push('verifyOtp')
      return { error: null }
    },
    async signInWithPassword() {
      calls.push('signInWithPassword')
      return { error: null }
    },
    async confirmPasswordReset() {
      calls.push('confirmPasswordReset')
      return { error: null }
    },
    async sendPasswordReset() {
      calls.push('sendPasswordReset')
      return { error: null }
    },
    async signOut() {
      calls.push('signOut')
      return { error: null }
    },
    async signInWithOAuth() {
      return { error: null }
    },
    async claimLegacyIdentity() {
      calls.push('claimLegacyIdentity')
      return { claimed: false, error: null }
    },
  }
  return { driver: { ...base, ...overrides } as AuthDriver, calls }
}

const EMAIL = 'user@example.com'

describe('auth store — 邮箱密码登录', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    __setAuthDriverForTest(null)
  })

  it('成功后清空错误', async () => {
    const { driver, calls } = makeDriver()
    __setAuthDriverForTest(driver)
    const s = useAuthStore()

    const ok = await s.signInWithPassword(EMAIL, 'abcd1234')
    expect(ok).toBe(true)
    expect(s.authError).toBeNull()
    expect(calls).toContain('signInWithPassword')
  })

  it('失败时给出「先用验证码登录再设密码」的引导（老用户没有密码时唯一可用的提示）', async () => {
    const { driver } = makeDriver({
      async signInWithPassword() {
        return { error: { message: 'invalid credentials' } }
      },
    })
    __setAuthDriverForTest(driver)
    const s = useAuthStore()

    const ok = await s.signInWithPassword(EMAIL, 'wrong')
    expect(ok).toBe(false)
    expect(s.authError).toContain('验证码登录')
    expect(s.authError).toContain('设置密码')
  })

  it('连续 5 次失败触发锁定，第 6 次不再打驱动', async () => {
    const { driver, calls } = makeDriver({
      async signInWithPassword() {
        return { error: { message: 'invalid credentials' } }
      },
    })
    __setAuthDriverForTest(driver)
    const s = useAuthStore()

    for (let i = 0; i < 5; i += 1) {
      await s.signInWithPassword(EMAIL, 'wrong')
    }
    expect(s.verifyLockRemaining(EMAIL)).toBeGreaterThan(0)

    const before = calls.filter((c) => c === 'signInWithPassword').length
    const ok = await s.signInWithPassword(EMAIL, 'wrong')
    expect(ok).toBe(false)
    // 锁定期内命中的是「发请求前」的前置判定，文案为「尝试次数过多，请 N 秒后重试」
    expect(s.authError).toContain('尝试次数过多')
    expect(s.authError).toContain('秒后重试')
    // 锁定期内必须在发请求前拦住
    expect(calls.filter((c) => c === 'signInWithPassword').length).toBe(before)
  })

  it('成功后清掉该邮箱的失败计数', async () => {
    let fail = true
    const { driver } = makeDriver({
      async signInWithPassword() {
        return { error: fail ? { message: 'invalid credentials' } : null }
      },
    })
    __setAuthDriverForTest(driver)
    const s = useAuthStore()

    await s.signInWithPassword(EMAIL, 'wrong')
    await s.signInWithPassword(EMAIL, 'wrong')
    fail = false
    expect(await s.signInWithPassword(EMAIL, 'right')).toBe(true)
    expect(s.verifyLockRemaining(EMAIL)).toBe(0)
  })
})

describe('auth store — 设置密码（验证码 + 新密码）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    __setAuthDriverForTest(null)
  })

  it('长度不足时本地拦截，不发请求', async () => {
    const { driver, calls } = makeDriver()
    __setAuthDriverForTest(driver)
    const s = useAuthStore()

    expect(await s.confirmSetPassword(EMAIL, '123456', 'abc1')).toBe(false)
    expect(s.authError).toContain('8~32')
    expect(calls).not.toContain('confirmPasswordReset')
  })

  it('缺字母或数字时本地拦截', async () => {
    const { driver } = makeDriver()
    __setAuthDriverForTest(driver)
    const s = useAuthStore()

    expect(await s.confirmSetPassword(EMAIL, '123456', '12345678')).toBe(false)
    expect(s.authError).toContain('字母与数字')

    expect(await s.confirmSetPassword(EMAIL, '123456', 'abcdefgh')).toBe(false)
    expect(s.authError).toContain('字母与数字')
  })

  it('验证码为空时本地拦截', async () => {
    const { driver, calls } = makeDriver()
    __setAuthDriverForTest(driver)
    const s = useAuthStore()

    expect(await s.confirmSetPassword(EMAIL, '   ', 'abcd1234')).toBe(false)
    expect(s.authError).toContain('验证码')
    expect(calls).not.toContain('confirmPasswordReset')
  })

  it('合规输入透传给驱动（邮箱 + 验证码 + 新密码）', async () => {
    const { driver, calls } = makeDriver({
      async confirmPasswordReset() {
        calls.push('confirmPasswordReset')
        return { error: null }
      },
    })
    __setAuthDriverForTest(driver)
    const s = useAuthStore()

    expect(await s.confirmSetPassword(EMAIL, '123456', 'abcd1234')).toBe(true)
    expect(calls).toContain('confirmPasswordReset')
    expect(s.authError).toBeNull()
  })

  it('驱动报错时把 message 透到 authError', async () => {
    const { driver } = makeDriver({
      async confirmPasswordReset() {
        return { error: { message: '验证码已失效，请重新获取' } }
      },
    })
    __setAuthDriverForTest(driver)
    const s = useAuthStore()

    expect(await s.confirmSetPassword(EMAIL, '123456', 'abcd1234')).toBe(false)
    expect(s.authError).toBe('验证码已失效，请重新获取')
  })
})

describe('auth store — 找回密码', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    __setAuthDriverForTest(null)
  })

  it('发送成功后进入冷却，冷却期内不再发请求', async () => {
    const { driver, calls } = makeDriver()
    __setAuthDriverForTest(driver)
    const s = useAuthStore()

    expect(await s.sendPasswordReset(EMAIL)).toBe(true)
    expect(calls.filter((c) => c === 'sendPasswordReset')).toHaveLength(1)

    expect(await s.sendPasswordReset(EMAIL)).toBe(false)
    expect(s.authError).toContain('秒后再试')
    expect(calls.filter((c) => c === 'sendPasswordReset')).toHaveLength(1)
  })

  it('驱动报错时不清冷却、透传 message', async () => {
    const { driver } = makeDriver({
      async sendPasswordReset() {
        return { error: { message: 'user not found' } }
      },
    })
    __setAuthDriverForTest(driver)
    const s = useAuthStore()

    expect(await s.sendPasswordReset(EMAIL)).toBe(false)
    expect(s.authError).toBe('user not found')
    // 非限流错误不登记冷却，允许立即重试
    expect(s.sendCooldownRemaining(EMAIL)).toBe(0)
  })
})
