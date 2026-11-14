/**
 * authDriver 竞态修复回归（#39 / #46）
 *  - #39 getApiToken：30s 节流 + 并发单飞 + 未登录不发刷新请求
 *  - #46 _authGen：只在 SIGNED_OUT / 切号 / refreshSession / signOut 时递增，
 *    TOKEN_REFRESHED 不作废在途的 getUser() 资料补全
 *
 * 模块级节流状态需隔离，故每个用例前 vi.resetModules() + 动态 import。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
  },
}))
vi.mock('../../lib/cloudbase.js', () => ({
  getCbAuth: () => null,
  getCbDb: () => ({ rpc: vi.fn() }),
  isCloudBaseBackend: () => false,
}))

beforeEach(() => { vi.resetModules() })

describe('getApiToken 刷新节流 + 并发单飞（#39）', () => {
  it('并发多次调用只发一次 refreshSession（单飞）', async () => {
    let refreshCount = 0
    const driver = {
      getSession: vi.fn(async () => ({ session: null, error: { message: 'expired' } })),
      refreshSession: vi.fn(async () => {
        refreshCount++
        return { session: { accessToken: 'tok-new' }, error: null }
      }),
    }
    const mod = await import('../../lib/authDriver.js')
    mod.__setAuthDriverForTest(driver as never)
    const results = await Promise.all([
      mod.getApiToken(), mod.getApiToken(), mod.getApiToken(),
    ])
    expect(refreshCount).toBe(1)
    expect(results).toEqual(['tok-new', 'tok-new', 'tok-new'])
  })

  it('30s 内的后续调用不再刷新（节流）', async () => {
    let refreshCount = 0
    const driver = {
      getSession: vi.fn(async () => ({ session: null, error: { message: 'expired' } })),
      refreshSession: vi.fn(async () => {
        refreshCount++
        return { session: null, error: { message: 'invalid_grant' } }
      }),
    }
    const mod = await import('../../lib/authDriver.js')
    mod.__setAuthDriverForTest(driver as never)
    await mod.getApiToken()
    await mod.getApiToken()
    await mod.getApiToken()
    expect(refreshCount).toBe(1)
  })

  it('真未登录（无 session 且无 error）不发刷新请求', async () => {
    const refreshSession = vi.fn(async () => ({ session: { accessToken: 'x' }, error: null }))
    const driver = {
      getSession: vi.fn(async () => ({ session: null, error: null })),
      refreshSession,
    }
    const mod = await import('../../lib/authDriver.js')
    mod.__setAuthDriverForTest(driver as never)
    await mod.getApiToken()
    expect(refreshSession).not.toHaveBeenCalled()
  })
})

/** 可控 event 与延迟 getUser 的 fake CloudBase auth */
function makeGenHarness() {
  let cb: ((e: string, s: unknown) => void) | null = null
  let resolveUser!: (v: unknown) => void
  const getUserPromise = new Promise((r) => { resolveUser = r })
  const fakeAuth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    refreshSession: async () => ({ data: null, error: null }),
    onAuthStateChange: (c: (e: string, s: unknown) => void) => { cb = c; return { unsubscribe() {} } },
    getUser: () => getUserPromise,
    updateUser: async () => ({ data: null, error: null }),
    signOut: async () => ({ error: null }),
    signInWithOtp: async () => ({ data: {}, error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    signInWithPassword: async () => ({ data: {}, error: null }),
    signInWithOAuth: async () => ({ data: {}, error: null }),
  }
  return {
    fakeAuth,
    get cb() { return cb! },
    resolveUser: (v: unknown) => resolveUser(v),
  }
}

describe('onAuthStateChange _authGen 递增时机（#46）', () => {
  it('TOKEN_REFRESHED 不递增代次：在途 getUser 资料补全正常回写', async () => {
    const { createCloudBaseAuthDriver } = await import('../../lib/authDriver.js')
    const h = makeGenHarness()
    const d = createCloudBaseAuthDriver(h.fakeAuth as never)
    const seen: Array<unknown> = []
    d.onAuthStateChange((s) => seen.push(s))
    h.cb('SIGNED_IN', { id: 'u1', email: 'a@b.com' })        // user 缺资料 → 触发 getUser
    h.cb('TOKEN_REFRESHED', { id: 'u1', email: 'a@b.com' })  // 修复后不递增 _authGen
    h.resolveUser({ data: { user: { id: 'u1', user_metadata: { display_name: '昵称' } } } })
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(3))
    expect(seen.some((s) => (s as { user?: { user_metadata?: { display_name?: string } } })?.user?.user_metadata?.display_name === '昵称')).toBe(true)
  })

  it('SIGNED_OUT 递增代次：作废在途 getUser 资料补全', async () => {
    const { createCloudBaseAuthDriver } = await import('../../lib/authDriver.js')
    const h = makeGenHarness()
    const d = createCloudBaseAuthDriver(h.fakeAuth as never)
    const seen: Array<unknown> = []
    d.onAuthStateChange((s) => seen.push(s))
    h.cb('SIGNED_IN', { id: 'u1', email: 'a@b.com' })
    h.cb('SIGNED_OUT', null) // 登出 → _authGen++
    h.resolveUser({ data: { user: { id: 'u1', user_metadata: { display_name: '昵称' } } } })
    await new Promise((r) => setTimeout(r, 0))
    // 只有 SIGNED_IN + SIGNED_OUT 两次交付，补全被丢弃
    expect(seen).toHaveLength(2)
  })
})
