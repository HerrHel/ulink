/**
 * authDriver — 登录驱动层
 *
 * 目的：让 `stores/auth.ts` 不再直接依赖 `supabase.auth.*`，改由驱动提供统一接口。
 * 默认仍是 Supabase（`VITE_BACKEND` 未设置），设成 `cloudbase` 才切到 CloudBase 身份认证。
 *
 * 为什么需要这一层：两边最大的差异是 **`verifyOtp` 的形态**。
 *  - Supabase：`auth.verifyOtp({ email, token, type: 'email' })`，独立调用，自带全部参数。
 *  - CloudBase：`signInWithOtp` 返回的 `data` 上挂一个闭包 `data.verifyOtp({ token })`，
 *    messageId 已绑在闭包里；直接调独立的 `auth.verifyOtp({ token })` 会报 `messageId is required`。
 * 所以驱动内部要**按邮箱暂存** sendOtp 拿到的那个闭包，verifyOtp 时再取出来用。
 *
 * 约束：Supabase 分支的调用形状必须与改造前逐字一致——`src/__tests__` 里十余个用例
 * 断言了这些调用的参数，任何改动都会连带破测。
 */
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase.js'
import { getCbAuth, getCbDb, isCloudBaseBackend } from './cloudbase.js'

export interface AuthErrorLike {
  message: string
  code?: string
}

export interface AuthDriver {
  /** 读取当前会话；未登录时 session 为 null */
  getSession(): Promise<{ session: Session | null; error: AuthErrorLike | null }>
  /** 订阅登录态变化；只回传 session，订阅/退订细节留在驱动内 */
  onAuthStateChange(cb: (session: Session | null) => void): void
  /** 更新用户元数据（昵称/头像） */
  updateUserMeta(data: Record<string, unknown>): Promise<{ user: User | null; error: AuthErrorLike | null }>
  /** 发送邮箱验证码 */
  sendOtp(email: string, captchaToken?: string): Promise<{ error: AuthErrorLike | null }>
  /** 校验邮箱验证码 */
  verifyOtp(email: string, token: string): Promise<{ error: AuthErrorLike | null }>
  /** 邮箱 + 密码登录 */
  signInWithPassword(email: string, password: string): Promise<{ error: AuthErrorLike | null }>
  /** 发送找回/设置密码的验证码（老用户首次设密码也走这条） */
  sendPasswordReset(email: string): Promise<{ error: AuthErrorLike | null }>
  /** 用验证码 + 新密码完成密码设置 */
  confirmPasswordReset(email: string, code: string, newPassword: string): Promise<{ error: AuthErrorLike | null }>
  /** 退出登录 */
  signOut(): Promise<{ error: AuthErrorLike | null }>
  /** 第三方登录：返回需要跳转的 URL（拿不到 URL 的驱动自行跳转并返回空） */
  signInWithOAuth(provider: string, redirectTo: string): Promise<{ error: AuthErrorLike | null; url?: string }>
  /**
   * 认领老身份：把历史数据从 Supabase 时代的 uuid 迁到当前 CloudBase sub。
   * 只在 CloudBase 后端有意义；Supabase 分支直接返回 not_applicable。
   */
  claimLegacyIdentity(): Promise<{
    claimed: boolean
    reason?: string
    moved?: Record<string, number>
    error: AuthErrorLike | null
  }>
}

// ── Supabase 驱动：与改造前完全一致的调用形状 ──

export function createSupabaseAuthDriver(): AuthDriver {
  return {
    async getSession() {
      const { data, error } = await supabase.auth.getSession()
      return { session: data.session, error: error ?? null }
    },

    onAuthStateChange(cb) {
      supabase.auth.onAuthStateChange((_event, s) => cb(s))
    },

    async updateUserMeta(data) {
      const { data: updated, error } = await supabase.auth.updateUser({ data })
      return { user: updated?.user ?? null, error: error ?? null }
    },

    async sendOtp(email, captchaToken) {
      const options = captchaToken ? { captchaToken } : undefined
      const { error } = await supabase.auth.signInWithOtp({ email, options })
      return { error: error ?? null }
    },

    async verifyOtp(email, token) {
      const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
      return { error: error ?? null }
    },

    async signInWithPassword(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error ?? null }
    },

    async sendPasswordReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email)
      return { error: error ?? null }
    },

    async confirmPasswordReset(email, code, newPassword) {
      // Supabase 走「验证码换 session」再改密，等价于 recovery 类型校验
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'recovery',
      })
      if (verifyError) return { error: verifyError }
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      return { error: error ?? null }
    },

    async signOut() {
      const { error } = await supabase.auth.signOut()
      return { error: error ?? null }
    },

    async signInWithOAuth(provider, redirectTo) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        // provider 由调用方限定为 'github' | 'google'
        provider: provider as 'github' | 'google',
        options: { redirectTo },
      })
      return { error: error ?? null, url: data?.url ?? undefined }
    },

    async claimLegacyIdentity() {
      // Supabase 侧没有身份映射这回事，属于预期内的无操作
      return { claimed: false, reason: 'not_applicable', error: null }
    },
  }
}

// ── CloudBase 驱动 ──

/** CloudBase auth 里本项目用到的方法（只声明表面，避免依赖 SDK 内部类型） */
interface CbAuthLike {
  getSession?: () => Promise<{ data?: { session?: unknown; user?: unknown } | null; error?: AuthErrorLike | null }>
  /** 取当前用户完整资料（登录返回的 session.user 可能只有最小字段） */
  getUser?: () => Promise<{ data?: { user?: unknown } | null; error?: AuthErrorLike | null }>
  onAuthStateChange?: (cb: (event: string, session: unknown) => void) => unknown
  /** CloudBase 收扁平字段（nickname / avatar_url…），不是 Supabase 的 { data } 包装 */
  updateUser?: (arg: Record<string, unknown>) => Promise<{
    data?: { user?: unknown } | null
    error?: AuthErrorLike | null
  }>
  signInWithPassword?: (arg: { email: string; password: string }) => Promise<{
    data?: unknown
    error?: AuthErrorLike | null
  }>
  resetPasswordForEmail?: (email: string) => Promise<{
    data?: {
      /** 闭包：拿到用户输入的验证码后调它改密 */
      updateUser?: (arg: { nonce: string; password: string }) => Promise<{ error?: AuthErrorLike | null }>
    } | null
    error?: AuthErrorLike | null
  }>
  signInWithOtp?: (arg: Record<string, unknown>) => Promise<{
    data?: { verifyOtp?: (arg: { token: string }) => Promise<{ error?: AuthErrorLike | null }> } | null
    error?: AuthErrorLike | null
  }>
  signOut?: () => Promise<{ error?: AuthErrorLike | null }>
  signInWithOAuth?: (arg: Record<string, unknown>) => Promise<{
    data?: { url?: string } | null
    error?: AuthErrorLike | null
  }>
}

/**
 * CloudBase 的 session/user 形状与 supabase 接近但字段不全（没有 user_metadata 等）。
 * 这里补一个空的 user_metadata，让上层 `displayName` 等逻辑不因缺字段而崩。
 * 双重断言集中在驱动边界内，不向上层扩散。
 */
function mapSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  // 情况 1：raw 是标准 session 对象，内部含有 user 字段
  if (rec.user && typeof rec.user === 'object') {
    const u = rec.user as Record<string, unknown>
    return {
      ...rec,
      user: { ...u, user_metadata: (u.user_metadata as Record<string, unknown>) ?? {} },
    } as unknown as Session
  }
  // 情况 2：raw 直接是 user 对象（含有 id、sub 或 email）
  if (rec.id || rec.sub || rec.email) {
    return {
      user: { ...rec, user_metadata: (rec.user_metadata as Record<string, unknown>) ?? {} },
    } as unknown as Session
  }
  return null
}

/**
 * user 里是否已带昵称/头像（Supabase 与 CloudBase 两套字段名都算）。
 * 登录返回的 user 可能只有最小字段，缺资料时上层会退回「邮箱前缀 + 默认头像」。
 */
function _hasProfileFields(u: unknown): boolean {
  if (!u || typeof u !== 'object') return false
  const rec = u as Record<string, unknown>
  const meta = (rec.user_metadata && typeof rec.user_metadata === 'object' ? rec.user_metadata : {}) as Record<string, unknown>
  const hit = (o: Record<string, unknown>, keys: string[]) =>
    keys.some((k) => typeof o[k] === 'string' && (o[k] as string).trim())
  return (
    hit(meta, ['display_name', 'nickname', 'nickName', 'name', 'avatar', 'avatarUrl', 'avatar_url', 'picture']) ||
    hit(rec, ['displayName', 'name', 'avatarUrl', 'avatar_url'])
  )
}

/** 可注入的 CloudBase auth 表面，便于单测；不传则用真实客户端 */
export function createCloudBaseAuthDriver(
  injected?: CbAuthLike,
  injectedDb?: { rpc: <T>(name: string) => Promise<{ data: T | null; error: AuthErrorLike | null }> },
): AuthDriver {
  // 按邮箱暂存 sendOtp 返回的 verifyOtp 闭包（messageId 绑在里面）
  const pending = new Map<string, (arg: { token: string }) => Promise<{ error?: AuthErrorLike | null }>>()
  // 按邮箱暂存 resetPasswordForEmail 返回的改密闭包（nonce = 邮件验证码）
  const resetPending = new Map<
    string,
    (arg: { nonce: string; password: string }) => Promise<{ error?: AuthErrorLike | null }>
  >()

  const auth = () => injected ?? (getCbAuth() as CbAuthLike | null)

  return {
    async getSession() {
      const a = auth()
      if (!a?.getSession) return { session: null, error: { message: 'CloudBase 未配置' } }
      const { data, error } = await a.getSession()
      if (error) return { session: null, error }
      if (!data) return { session: null, error: null }
      if (data.session) {
        const s = { ...(data.session as Record<string, unknown>) }
        if (!s.user && data.user) s.user = data.user
        return { session: mapSession(s), error: null }
      }
      if (data.user) {
        return { session: mapSession(data.user), error: null }
      }
      return { session: null, error: null }
    },

    onAuthStateChange(cb) {
      auth()?.onAuthStateChange?.((event, session) => {
        const mapped = mapSession(session)
        // 先同步交付，保持「回调即事件」的原有契约
        cb(mapped)
        // 刚登录时 session 里的 user 可能只带最小字段（没有昵称/头像）：再补一次
        // getUser() 把完整资料捞回来，否则上层 displayName 会退回邮箱前缀、头像退回默认，
        // 看起来像「登录到了别人的默认账号」。取不到就不做事，不影响登录。
        if (event !== 'SIGNED_IN' || !mapped?.user || _hasProfileFields(mapped.user)) return
        const a = auth()
        Promise.resolve(a?.getUser?.())
          .then((res) => {
            const full = res?.data?.user
            if (!full) return
            const withProfile = mapSession({ user: full })
            if (withProfile?.user) cb(withProfile)
          })
          .catch(() => { /* 补全失败保持首帧结果 */ })
      })
    },

    async updateUserMeta(data) {
      const a = auth()
      if (!a?.updateUser) return { user: null, error: { message: 'CloudBase 未配置' } }
      // CloudBase 的用户资料字段是 nickname / avatar_url（Supabase 时期叫 display_name / avatar），
      // 且 updateUser 收的是**扁平对象**而非 `{ data }` 包装（见 SDK 的 UpdateUserReq = UserAttributes）。
      // 照 Supabase 的键名透传会被平台忽略：资料根本写不进云端，退出重登或换设备后
      // （登出会清掉本地昵称/头像缓存）就退回「邮箱前缀 + 默认头像」。
      const req: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(data)) {
        if (k === 'display_name') req.nickname = v
        else if (k === 'avatar') req.avatar_url = v
        else req[k] = v
      }
      let { data: updated, error } = await a.updateUser(req)
      // 本项目的「头像」是 emoji 而不是 URL。若平台对 avatar_url 做格式校验而拒掉，
      // 退一步只写昵称——总比整次保存失败、名字也丢了强。
      if (error && 'avatar_url' in req) {
        delete req.avatar_url
        ;({ data: updated, error } = await a.updateUser(req))
      }
      const u = updated?.user as Record<string, unknown> | undefined
      return {
        user: u ? ({ ...u, user_metadata: u.user_metadata ?? {} } as unknown as User) : null,
        error: error ?? null,
      }
    },

    async sendOtp(email, captchaToken) {
      const a = auth()
      if (!a?.signInWithOtp) return { error: { message: 'CloudBase 未配置' } }
      const arg: Record<string, unknown> = { email }
      if (captchaToken) arg.options = { captchaToken }
      const { data, error } = await a.signInWithOtp(arg)
      if (!error && typeof data?.verifyOtp === 'function') {
        pending.set(email, data.verifyOtp)
      }
      return { error: error ?? null }
    },

    async verifyOtp(email, token) {
      const fn = pending.get(email)
      if (!fn) {
        // 没有闭包说明没有发起过 sendOtp（或页面刷新丢了内存态）——提示重新获取，而不是报 messageId 缺失
        return { error: { message: '验证码已失效，请重新获取' } }
      }
      const { error } = await fn({ token })
      if (!error) pending.delete(email)
      return { error: error ?? null }
    },

    async signOut() {
      const a = auth()
      if (!a?.signOut) return { error: null }
      pending.clear()
      resetPending.clear()
      const { error } = await a.signOut()
      return { error: error ?? null }
    },

    async signInWithPassword(email, password) {
      const a = auth()
      if (!a?.signInWithPassword) return { error: { message: 'CloudBase 未配置' } }
      const { error } = await a.signInWithPassword({ email, password })
      return { error: error ?? null }
    },

    async sendPasswordReset(email) {
      const a = auth()
      if (!a?.resetPasswordForEmail) return { error: { message: 'CloudBase 未配置' } }
      const { data, error } = await a.resetPasswordForEmail(email)
      // CloudBase 把「改密」做成了返回 data 上的闭包（与 signInWithOtp/verifyOtp 同款），
      // 必须存起来等用户输完验证码再用
      if (!error && typeof data?.updateUser === 'function') {
        resetPending.set(email, data.updateUser)
      }
      return { error: error ?? null }
    },

    async confirmPasswordReset(email, code, newPassword) {
      const fn = resetPending.get(email)
      if (!fn) return { error: { message: '验证码已失效，请重新获取' } }
      // 闭包参数是 { nonce, password }——nonce 就是邮件里的验证码
      const { error } = await fn({ nonce: code, password: newPassword })
      if (!error) resetPending.delete(email)
      return { error: error ?? null }
    },

    async signInWithOAuth(provider, redirectTo) {
      const a = auth()
      if (!a?.signInWithOAuth) return { error: { message: 'CloudBase 暂不支持该第三方登录' } }
      const { data, error } = await a.signInWithOAuth({ provider, options: { redirectTo } })
      return { error: error ?? null, url: data?.url ?? undefined }
    },

    async claimLegacyIdentity() {
      const db = injectedDb ?? getCbDb()
      const r = await db.rpc<{
        claimed?: boolean
        reason?: string
        moved?: Record<string, number>
      }>('claim_legacy_identity')
      if (r.error) return { claimed: false, error: r.error }
      const payload = (r.data || {}) as { claimed?: boolean; reason?: string; moved?: Record<string, number> }
      return {
        claimed: Boolean(payload.claimed),
        reason: payload.reason,
        moved: payload.moved,
        error: null,
      }
    },
  }
}

// ── 选择 ──

let _driver: AuthDriver | null = null

/** 按后端开关惰性创建：VITE_BACKEND=cloudbase 走 CloudBase，否则 Supabase */
export function getAuthDriver(): AuthDriver {
  if (!_driver) {
    _driver = isCloudBaseBackend() ? createCloudBaseAuthDriver() : createSupabaseAuthDriver()
  }
  return _driver
}

/** 测试专用：清空惰性单例 / 注入自定义驱动 */
export function __setAuthDriverForTest(driver: AuthDriver | null): void {
  _driver = driver
}

/**
 * 取 HTTP 直调用的 Bearer token（跨后端统一入口）。
 *
 * 为什么不能直接 `supabase.auth.getSession()`：CloudBase 后端下 supabase.ts 创建的是
 * **真 Supabase 客户端**（VITE_SUPABASE_URL 仍配着，作遗留/迁移用途），其 storageKey
 * `linkvault_auth` 里永远没有 session（用户全部走 CloudBase 登录）——
 * usePayment/useRedeem 曾因此静默拿不到 token，「暂无可购买的套餐」的最终根因。
 * 必须走 authDriver（CloudBase 分支读 js-sdk 登录态，session.accessToken）。
 */
export async function getApiToken(): Promise<string> {
  try {
    const driver = getAuthDriver()
    const { session } = await driver.getSession()
    if (!session) return ''
    const rec = session as unknown as Record<string, unknown>
    return String(rec.accessToken ?? rec.access_token ?? '')
  } catch {
    return ''
  }
}
