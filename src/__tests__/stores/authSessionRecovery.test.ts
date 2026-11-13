/**
 * 登录态「自己掉了」的修复回归（2026-11-13）
 *
 * 背景：CloudBase 的 `getSession()` 只读本地凭证、不比较 `expires_at`，
 * 内部调的是 `getUser(false)`（不 refresh）。于是 access token（约 2h）过期后，
 * 一次页面刷新就会拿到 401 → 前端判定未登录，而 refresh_token 其实还活着。
 *
 * 修复要点（本文件锁住）：
 *   1) `init()`：getSession 报错时先 refreshSession 抢救，成功即保持登录；
 *   2) 运行中收到「无会话」事件时同样先抢救，成功则完全不改变登录态；
 *   3) 抢救失败才落回登出（并照旧锁定 E2E / Vault）；
 *   4) 用户主动退出时不抢救（否则会用未清干净的 refresh_token 登回来）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { __setAuthDriverForTest, type AuthDriver, type AuthErrorLike } from '../../lib/authDriver.js'
import { useAuthStore } from '../../stores/auth.js'
import type { Session } from '@supabase/supabase-js'

function fakeSession(id = 'u1'): Session {
  return { accessToken: 'tok-new', user: { id, email: 'u@example.com' } } as unknown as Session
}

type SessionResult = { session: Session | null; error: AuthErrorLike | null }

/** 假驱动：记录调用序列，可保存 onAuthStateChange 回调供测试触发 */
function makeDriver(opts: {
  onGetSession?: () => Promise<SessionResult>
  onRefresh?: () => Promise<SessionResult>
} = {}) {
  const calls: string[] = []
  let emit: ((s: Session | null) => void) | null = null
  const driver: AuthDriver = {
    async getSession() {
      calls.push('getSession')
      return opts.onGetSession ? opts.onGetSession() : { session: null, error: null }
    },
    async refreshSession() {
      calls.push('refreshSession')
      return opts.onRefresh ? opts.onRefresh() : { session: null, error: { message: 'no refresh token' } }
    },
    onAuthStateChange(cb) {
      emit = cb
    },
    async updateUserMeta() {
      return { user: null, error: null }
    },
    async sendOtp() {
      return { error: null }
    },
    async verifyOtp() {
      return { error: null }
    },
    async signInWithPassword() {
      return { error: null }
    },
    async sendPasswordReset() {
      return { error: null }
    },
    async confirmPasswordReset() {
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
      return { claimed: false, error: null }
    },
  }
  return { driver, calls, emit: (s: Session | null) => emit?.(s) }
}

beforeEach(() => {
  setActivePinia(createPinia())
  __setAuthDriverForTest(null)
})

describe('init 时的令牌过期抢救', () => {
  it('getSession 报错（401）但 refresh 成功 → 保持登录', async () => {
    const { driver, calls } = makeDriver({
      onGetSession: async () => ({ session: null, error: { message: 'invalid jwt' } }),
      onRefresh: async () => ({ session: fakeSession(), error: null }),
    })
    __setAuthDriverForTest(driver)
    const store = useAuthStore()
    await store.init()
    expect(store.isLoggedIn).toBe(true)
    expect(store.userEmail).toBe('u@example.com')
    expect(calls).toContain('refreshSession')
  })

  it('getSession 报错且 refresh 也失败 → 按未登录处理（refresh_token 真过期）', async () => {
    const { driver } = makeDriver({
      onGetSession: async () => ({ session: null, error: { message: 'invalid jwt' } }),
      onRefresh: async () => ({ session: null, error: { message: 'invalid_grant' } }),
    })
    __setAuthDriverForTest(driver)
    const store = useAuthStore()
    await store.init()
    expect(store.isLoggedIn).toBe(false)
  })

  it('getSession 正常时不做多余刷新', async () => {
    const { driver, calls } = makeDriver({ onGetSession: async () => ({ session: fakeSession(), error: null }) })
    __setAuthDriverForTest(driver)
    const store = useAuthStore()
    await store.init()
    expect(store.isLoggedIn).toBe(true)
    expect(calls).not.toContain('refreshSession')
  })
})

describe('运行中「会话消失」事件的抢救', () => {
  it('抢救成功 → 保持登录，不触发敏感密钥上锁', async () => {
    const { driver, emit } = makeDriver({
      onGetSession: async () => ({ session: fakeSession(), error: null }),
      onRefresh: async () => ({ session: fakeSession(), error: null }),
    })
    __setAuthDriverForTest(driver)
    const store = useAuthStore()
    await store.init()
    expect(store.isLoggedIn).toBe(true)

    emit(null) // SDK 抛无会话事件（token 过期 / 网络抖动）
    await vi.waitFor(() => expect(store.isLoggedIn).toBe(true))
    expect(store.userEmail).toBe('u@example.com')
  })

  it('抢救失败 → 落回登出', async () => {
    const { driver, emit } = makeDriver({
      onGetSession: async () => ({ session: fakeSession(), error: null }),
      onRefresh: async () => ({ session: null, error: { message: 'invalid_grant' } }),
    })
    __setAuthDriverForTest(driver)
    const store = useAuthStore()
    await store.init()
    expect(store.isLoggedIn).toBe(true)

    emit(null)
    await vi.waitFor(() => expect(store.isLoggedIn).toBe(false))
  })

  it('用户主动退出时不抢救（防用力过猛把人登回来）', async () => {
    const { driver, calls, emit } = makeDriver({
      onGetSession: async () => ({ session: fakeSession(), error: null }),
      onRefresh: async () => ({ session: fakeSession(), error: null }),
    })
    __setAuthDriverForTest(driver)
    const store = useAuthStore()
    await store.init()
    const ok = await store.signOut()
    expect(ok).toBe(true)
    emit(null)
    await new Promise((r) => setTimeout(r, 20))
    expect(store.isLoggedIn).toBe(false)
    expect(calls).not.toContain('refreshSession')
  })
})
