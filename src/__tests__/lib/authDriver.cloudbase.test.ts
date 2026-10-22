/**
 * authDriver.cloudbase — CloudBase 登录驱动的契约测试
 *
 * 锁住的是与 Supabase 的**唯一硬差异**：`verifyOtp` 不是独立调用，而是
 * `signInWithOtp` 返回的 `data` 上的闭包（messageId 已绑）。
 * 驱动必须在 sendOtp 与 verifyOtp 之间按邮箱暂存这个闭包。
 *
 * 另外锁住会话形状补齐：CloudBase 的 user 没有 user_metadata，
 * 驱动要补空对象，否则上层 displayName 计算会读到 undefined。
 */
import { describe, it, expect } from 'vitest'
import { createCloudBaseAuthDriver } from '../../lib/authDriver.js'

type VerifyFn = (arg: { token: string }) => Promise<{ error?: { message: string } | null }>

/** 最小可用的 fake CloudBase auth：记录调用、可控返回 */
function makeFakeAuth(opts?: {
  verifyError?: { message: string } | null
  sendError?: { message: string } | null
  session?: unknown
  noClosure?: boolean
  passwordError?: { message: string; code?: string } | null
}) {
  const calls: { method: string; args?: unknown }[] = []
  let lastVerify: VerifyFn | null = null

  const auth = {
    async getSession() {
      calls.push({ method: 'getSession' })
      return { data: { session: opts?.session ?? null }, error: null }
    },
    onAuthStateChange(cb: (event: string, session: unknown) => void) {
      calls.push({ method: 'onAuthStateChange' })
      ;(auth as unknown as { _emit: (s: unknown) => void })._emit = (s) => cb('SIGNED_IN', s)
      return { unsubscribe: () => {} }
    },
    async updateUser(arg: { data?: Record<string, unknown> }) {
      calls.push({ method: 'updateUser', args: arg })
      return { data: { user: { id: 'u1', email: 'a@b.com', ...arg.data } }, error: null }
    },
    async signInWithOtp(arg: Record<string, unknown>) {
      calls.push({ method: 'signInWithOtp', args: arg })
      if (opts?.sendError) return { data: null, error: opts.sendError }
      const verify: VerifyFn = async (v) => {
        lastVerify = verify
        calls.push({ method: 'verifyOtpClosure', args: v })
        return { error: opts?.verifyError ?? null }
      }
      return { data: opts?.noClosure ? {} : { verifyOtp: verify }, error: null }
    },
    async signOut() {
      calls.push({ method: 'signOut' })
      return { error: null }
    },
    async signInWithPassword(arg: { email: string; password: string }) {
      calls.push({ method: 'signInWithPassword', args: arg })
      return { data: {}, error: opts?.passwordError ?? null }
    },
    async resetPasswordForEmail(email: string) {
      calls.push({ method: 'resetPasswordForEmail', args: email })
      if (opts?.noClosure) return { data: {}, error: null }
      return {
        data: {
          updateUser: async (arg: { nonce: string; password: string }) => {
            calls.push({ method: 'resetClosure', args: arg })
            return { error: opts?.verifyError ?? null }
          },
        },
        error: null,
      }
    },
  }

  return { auth, calls, getLastVerify: () => lastVerify }
}

describe('CloudBase auth driver — verifyOtp 闭包语义', () => {
  it('sendOtp 后 verifyOtp 走闭包，且只传 token', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    const sent = await d.sendOtp('a@b.com')
    expect(sent.error).toBeNull()

    const verified = await d.verifyOtp('a@b.com', '123456')
    expect(verified.error).toBeNull()

    const sendCall = f.calls.find((c) => c.method === 'signInWithOtp')
    expect(sendCall?.args).toEqual({ email: 'a@b.com' })

    const verifyCall = f.calls.find((c) => c.method === 'verifyOtpClosure')
    // 关键：闭包只接收 { token }，email/messageId 都不能再传
    expect(verifyCall?.args).toEqual({ token: '123456' })
  })

  it('没先 sendOtp 就 verifyOtp → 返回中文提示，而不是 messageId 报错', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    const r = await d.verifyOtp('nobody@b.com', '000000')
    expect(r.error?.message).toContain('重新获取')
    // 不应触发任何网络调用
    expect(f.calls.find((c) => c.method === 'verifyOtpClosure')).toBeUndefined()
  })

  it('闭包按邮箱隔离：A 的验证码不能用于 B', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    await d.sendOtp('a@b.com')
    const r = await d.verifyOtp('c@b.com', '111111')
    expect(r.error?.message).toContain('重新获取')
  })

  it('校验成功后清掉暂存，重复校验会提示重新获取', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    await d.sendOtp('a@b.com')
    expect((await d.verifyOtp('a@b.com', '123456')).error).toBeNull()
    const second = await d.verifyOtp('a@b.com', '123456')
    expect(second.error?.message).toContain('重新获取')
  })

  it('校验失败时保留闭包，允许用户重试', async () => {
    const f = makeFakeAuth({ verifyError: { message: 'invalid token' } })
    const d = createCloudBaseAuthDriver(f.auth)

    await d.sendOtp('a@b.com')
    const first = await d.verifyOtp('a@b.com', '000000')
    expect(first.error?.message).toBe('invalid token')

    const second = await d.verifyOtp('a@b.com', '123456')
    expect(second.error?.message).toBe('invalid token')
    expect(f.calls.filter((c) => c.method === 'verifyOtpClosure')).toHaveLength(2)
  })

  it('平台没返回闭包时（如 SDK 降级）不crash，verifyOtp 给可读提示', async () => {
    const f = makeFakeAuth({ noClosure: true })
    const d = createCloudBaseAuthDriver(f.auth)

    await d.sendOtp('a@b.com')
    const r = await d.verifyOtp('a@b.com', '123456')
    expect(r.error?.message).toContain('重新获取')
  })

  it('sendOtp 带 captchaToken 时透传为 options', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    await d.sendOtp('a@b.com', 'cap-token')
    expect(f.calls.find((c) => c.method === 'signInWithOtp')?.args).toEqual({
      email: 'a@b.com',
      options: { captchaToken: 'cap-token' },
    })
  })

  it('signOut 清空暂存，之后 verifyOtp 必须重新获取', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    await d.sendOtp('a@b.com')
    await d.signOut()
    const r = await d.verifyOtp('a@b.com', '123456')
    expect(r.error?.message).toContain('重新获取')
  })
})

describe('CloudBase auth driver — 会话形状', () => {
  it('未登录时 session 为 null', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)
    const r = await d.getSession()
    expect(r.session).toBeNull()
    expect(r.error).toBeNull()
  })

  it('登录态给 user 补上空 user_metadata（上层 displayName 依赖）', async () => {
    const f = makeFakeAuth({
      session: { access_token: 't', user: { id: 'u1', email: 'a@b.com' } },
    })
    const d = createCloudBaseAuthDriver(f.auth)

    const r = await d.getSession()
    expect(r.session?.user?.id).toBe('u1')
    expect(r.session?.user?.email).toBe('a@b.com')
    expect(r.session?.user?.user_metadata).toEqual({})
  })

  it('user 缺失时视为未登录', async () => {
    const f = makeFakeAuth({ session: { access_token: 't' } })
    const d = createCloudBaseAuthDriver(f.auth)
    expect((await d.getSession()).session).toBeNull()
  })

  it('updateUserMeta 也补齐 user_metadata', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    const r = await d.updateUserMeta({ display_name: 'Herr' })
    expect(r.user?.user_metadata).toEqual({})
    expect(f.calls.find((c) => c.method === 'updateUser')?.args).toEqual({
      data: { display_name: 'Herr' },
    })
  })

  it('onAuthStateChange 只向上回传 session', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    const seen: Array<unknown> = []
    d.onAuthStateChange((s) => seen.push(s))
    ;(f.auth as unknown as { _emit: (s: unknown) => void })._emit({ user: { id: 'u9', email: 'x@y.z' } })

    expect(seen).toHaveLength(1)
    expect((seen[0] as { user: { id: string } }).user.id).toBe('u9')
  })
})

describe('CloudBase auth driver — 身份认领', () => {
  it('认领成功时透传 moved 统计', async () => {
    const f = makeFakeAuth()
    const db = {
      rpc: async <T,>(name: string) => {
        expect(name).toBe('claim_legacy_identity')
        return { data: { claimed: true, moved: { bookmarks: 235, categories: 33 } } as T, error: null }
      },
    }
    const d = createCloudBaseAuthDriver(f.auth, db as never)

    const r = await d.claimLegacyIdentity()
    expect(r.claimed).toBe(true)
    expect(r.moved).toEqual({ bookmarks: 235, categories: 33 })
    expect(r.error).toBeNull()
  })

  it('没有待认领记录时 claimed=false 且带 reason', async () => {
    const f = makeFakeAuth()
    const db = {
      rpc: async () => ({ data: { claimed: false, reason: 'no_pending_mapping' }, error: null }),
    }
    const d = createCloudBaseAuthDriver(f.auth, db as never)

    const r = await d.claimLegacyIdentity()
    expect(r.claimed).toBe(false)
    expect(r.reason).toBe('no_pending_mapping')
  })

  it('rpc 报错时 claimed=false 并把 error 透出（不抛）', async () => {
    const f = makeFakeAuth()
    const db = {
      rpc: async () => ({ data: null, error: { message: 'not authenticated' } }),
    }
    const d = createCloudBaseAuthDriver(f.auth, db as never)

    const r = await d.claimLegacyIdentity()
    expect(r.claimed).toBe(false)
    expect(r.error?.message).toBe('not authenticated')
  })
})

describe('CloudBase auth driver — 缺少客户端时降级', () => {
  it('注入空对象（等价于未配置）时 getSession 返回错误而非抛异常', async () => {
    // 刻意传 {} 而不是 undefined：undefined 会回落到真实 getCbAuth()，
    // 测试环境若已从 .env.local 读到 env 就会真发网络请求，既慢又不稳定。
    const d = createCloudBaseAuthDriver({})
    const r = await d.getSession()
    expect(r.session).toBeNull()
    expect(r.error?.message).toContain('未配置')
  })
})

describe('CloudBase auth driver — 邮箱密码', () => {
  it('signInWithPassword 透传 email + password', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    const r = await d.signInWithPassword('a@b.com', 'secret123')
    expect(r.error).toBeNull()
    expect(f.calls.find((c) => c.method === 'signInWithPassword')?.args).toEqual({
      email: 'a@b.com',
      password: 'secret123',
    })
  })

  it('密码错误时原样回传平台 error（不吞 code）', async () => {
    const f = makeFakeAuth({
      passwordError: { message: 'invalid credentials', code: 'invalid_credentials' },
    })
    const d = createCloudBaseAuthDriver(f.auth)

    const r = await d.signInWithPassword('a@b.com', 'wrong')
    expect(r.error).toEqual({ message: 'invalid credentials', code: 'invalid_credentials' })
  })

  it('sendPasswordReset 暂存改密闭包，confirm 用 { nonce, password } 调它', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    expect((await d.sendPasswordReset('a@b.com')).error).toBeNull()
    expect(f.calls.find((c) => c.method === 'resetPasswordForEmail')?.args).toBe('a@b.com')

    const r = await d.confirmPasswordReset('a@b.com', '654321', 'newpass123')
    expect(r.error).toBeNull()
    // 关键：闭包只接收 { nonce(验证码), password }，其余都不要再传
    expect(f.calls.find((c) => c.method === 'resetClosure')?.args).toEqual({
      nonce: '654321',
      password: 'newpass123',
    })
  })

  it('没发码就 confirm → 提示重新获取，不发请求', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    const r = await d.confirmPasswordReset('a@b.com', '654321', 'newpass123')
    expect(r.error?.message).toContain('重新获取')
    expect(f.calls.find((c) => c.method === 'resetClosure')).toBeUndefined()
  })

  it('成功后清暂存，重复 confirm 提示重新获取', async () => {
    const f = makeFakeAuth()
    const d = createCloudBaseAuthDriver(f.auth)

    await d.sendPasswordReset('a@b.com')
    expect((await d.confirmPasswordReset('a@b.com', '654321', 'newpass123')).error).toBeNull()
    const second = await d.confirmPasswordReset('a@b.com', '654321', 'newpass123')
    expect(second.error?.message).toContain('重新获取')
  })

  it('注入空对象时三个新方法都返回错误而非抛异常', async () => {
    const d = createCloudBaseAuthDriver({})
    await expect(d.signInWithPassword('a@b.com', 'x')).resolves.toHaveProperty('error')
    await expect(d.sendPasswordReset('a@b.com')).resolves.toHaveProperty('error')
    await expect(d.confirmPasswordReset('a@b.com', '1', 'x')).resolves.toHaveProperty('error')
  })
})
