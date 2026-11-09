import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { getAuthDriver } from '../lib/authDriver.js'
import { dbRpc } from '../lib/dbApi.js'
import { t } from '../i18n/index.js'
import { useE2EStore } from './e2e.js'
import { useVaultStore } from './vault.js'
import { safeGetItem, safeSetItem, safeRemoveItem } from '../lib/storageSafe.js'
import type { User, Session } from '@supabase/supabase-js'

export const K_CUSTOM_NICKNAME = 'lv_user_nickname'
export const K_CUSTOM_AVATAR = 'lv_user_avatar'

// 缺陷7：跨账号切换标记。持久化 lastUserId，检测「已登录 A → 登录 B」时置位，
// 供 useCloudSync.initialSync（不在本次可改范围，由主代理接线）跳过
// _enqueueMissingToCloud，防止把上一账号的本地存量误补推到新账号。
// 本地书签数据是有意保留的本地权威数据，登出不清 IDB。
const K_LAST_USER_ID = 'lv_last_user_id'
const K_ACCOUNT_SWITCHED = 'lv_account_switched'

/** 记录当前已建立会话的 userId；与上次不同（且上次非空）时标记账号切换 */
function _observeUserId(nextId: string | null): void {
  const prevId = safeGetItem(K_LAST_USER_ID) || ''
  if (nextId && prevId && prevId !== nextId) {
    safeSetItem(K_ACCOUNT_SWITCHED, '1')
    console.warn('[auth] 检测到账号切换，标记待 useCloudSync 跳过跨账号补推')
  }
  if (nextId) safeSetItem(K_LAST_USER_ID, nextId)
}

/** 是否刚发生账号切换（供 useCloudSync.initialSync 守卫 _enqueueMissingToCloud） */
export function hasAccountSwitched(): boolean {
  return safeGetItem(K_ACCOUNT_SWITCHED) === '1'
}

/** 主代理在跳过/完成本账号基线补推后调用，清标记避免后续轮次一直跳过 */
export function clearAccountSwitched(): void {
  safeRemoveItem(K_ACCOUNT_SWITCHED)
}

/**
 * 读取用户资料时要同时认 Supabase 与 CloudBase 两套字段名。
 *
 * Supabase 时期资料写在 `user_metadata.display_name` / `user_metadata.avatar`；
 * CloudBase 的用户模型用的是 `nickname` / `avatarUrl`（SDK 的 user_metadata 里是
 * 驼峰 `nickName` / `avatarUrl`，顶层还有 `name` / `displayName`）。
 * 只认 Supabase 那套的后果：换设备或退出重登后（登出会清掉本地昵称缓存）读不到
 * 云端资料，名字退回邮箱前缀、头像退回默认。
 */
type LooseUser = Record<string, unknown> & { user_metadata?: Record<string, unknown> | null }

function _pickStr(src: Record<string, unknown> | null | undefined, keys: readonly string[]): string {
  if (!src) return ''
  for (const k of keys) {
    const v = src[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/** 云端昵称：metadata 多套键名 → 用户顶层字段 */
export function _metaDisplayName(u: User | null): string {
  if (!u) return ''
  const loose = u as unknown as LooseUser
  return _pickStr(loose.user_metadata, ['display_name', 'nickname', 'nickName', 'name'])
    || _pickStr(loose, ['displayName', 'name'])
}

/** 云端头像：metadata 多套键名 → 用户顶层字段 */
export function _metaAvatar(u: User | null): string {
  if (!u) return ''
  const loose = u as unknown as LooseUser
  return _pickStr(loose.user_metadata, ['avatar', 'avatarUrl', 'avatar_url', 'picture'])
    || _pickStr(loose, ['avatarUrl', 'avatar_url'])
}

/**
 * S12：OTP 客户端前置限流。
 *
 * 后端 Supabase Auth 有平台级速率限制，但客户端无前置防护时：
 *  - verifyOtp 的 6 位数字空间小，可被穷举
 *  - sendOtp 无本地节流，可频繁重发造成邮件轰炸 / 触发平台限流误伤正常登录
 *
 * 本 store 在客户端补充两层防护（纯内存，重启 App 即重置；后端限流仍为最终兜底）：
 *  - sendOtp：同邮箱 60s 冷却，冷却中拒绝并提示剩余秒数
 *  - verifyOtp：失败计数 + 指数退避，达阈值锁定（5 次锁 30s，10 次锁 5min），
 *    锁定中拒绝并提示剩余时间
 *
 * 关键安全语义：锁定/冷却判定必须在「发起网络请求之前」完成，否则穷举者可
 * 无视前端锁继续高速打后端的 verifyOtp。故 sendOtp/verifyOtp 先查锁再发请求。
 */

/** 单邮箱限流记录 */
interface LimitRecord {
  /** 当前轮连续失败次数（成功或锁到期后重置） */
  fails: number
  /** 累计被锁次数（用于阶梯升级惩罚） */
  locks: number
  /** 当前锁定到期时间戳（ms）；0 表示未锁 */
  lockUntil: number
  /** sendOtp 冷却到期时间戳（ms） */
  sendUntil: number
}

/** sendOtp 同邮箱发送冷却（60s） */
const SEND_COOLDOWN_MS = 60_000
/**
 * 锁定阶梯：按「累计已被锁次数」升级惩罚。
 * - 首次触发锁（locks==0→1）：30s
 * - 累计 ≥2 次锁（说明锁到期后仍继续穷举）：5min
 * 设计前提：单轮连续失败 5 次即锁，锁期内拒绝新请求（穷举者无法在锁内继续推进计数）；
 * 锁到期清掉当前轮计数，但保留累计锁次数以决定下次锁时长。
 */
export function lockDurationFor(locksBefore: number): { lockMs: number; label: string } {
  return locksBefore >= 1
    ? { lockMs: 300_000, label: '5 分钟' }
    : { lockMs: 30_000, label: '30 秒' }
}
const FAILS_PER_LOCK = 5

/**
 * 审计 R31：判定 Supabase Auth sendOtp 的 error 是否为「限流类」。
 *
 * 旧实现对**任何**平台 error（含网络错误、邮箱格式错误、signup_disabled 等）都施
 * 60s 发送冷却——用户因一次网络抖动或输错邮箱就被卡 60s 才能重发。
 *
 * 仅「限流类」error 才该登记本地冷却（防短时重复触发平台限流）。非限流类 error
 * 让用户立即重试（修对邮箱、等网络恢复即可），不该施加冷却。
 *
 * Supabase gotrue 限流 error：优先看 error.code（新 SDK 带 `over_email_send_rate_limit`「
 * 等 rate-limit code），兜底看 message 特征短语（旧 SDK 仅 message，如
 * 'For security reasons, you can only request once every 60 seconds'）。
 * message 匹配保守——只命中明确的限流措辞，避免误伤普通 error。
 */
const RATE_LIMIT_CODES = new Set([
  'over_email_send_rate_limit',
  'rate_limit_exceeded',
  'email_rate_limit_exceeded',
  'email_not_allowed_rate_limited',
])
const RATE_LIMIT_MSG_RE = /(?:rate[ _-]?limit|once every\s+\d+\s+second|too many (?:requests|emails?)|稍候|过频繁|频繁)/i

export function _isRateLimitError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : ''
  if (code && RATE_LIMIT_CODES.has(code)) return true
  const msg = typeof error.message === 'string' ? error.message : ''
  return RATE_LIMIT_MSG_RE.test(msg)
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const session = ref<Session | null>(null)
  const loading = ref(true)
  const authError = ref<string | null>(null)
  const authModalOpen = ref(false)

  // S12 限流状态（按邮箱维度，纯内存）
  const limits = ref<Map<string, LimitRecord>>(new Map())
  // 倒计时显示（让模板可读「请稍候 Xs」）
  const cooldownTick = ref(Date.now())
  let _ticker: ReturnType<typeof setInterval> | null = null

  const isLoggedIn = computed(() => !!user.value)
  const userEmail = computed(() => user.value?.email || '')

  // 用户个性化资料（昵称与头像 Emoji/图标）
  const customNickname = ref<string>(safeGetItem(K_CUSTOM_NICKNAME) || '')
  const customAvatar = ref<string>(safeGetItem(K_CUSTOM_AVATAR) || '')

  /** 显示昵称：自定义昵称 > 云端资料（Supabase / CloudBase 两套字段名） > 邮箱前缀 > '' */
  const displayName = computed(() => {
    if (customNickname.value.trim()) return customNickname.value.trim()
    const metaName = _metaDisplayName(user.value)
    if (metaName) return metaName
    const email = userEmail.value
    if (email) {
      const prefix = email.split('@')[0]
      return prefix || email
    }
    return ''
  })

  /** 显示头像 Emoji/标识：自定义头像 > 云端资料（Supabase / CloudBase 两套字段名） > '' */
  const avatar = computed(() => {
    if (customAvatar.value.trim()) return customAvatar.value.trim()
    return _metaAvatar(user.value)
  })

  /** 登录/会话恢复时把云端资料落到本地缓存，避免下次登出后彻底丢失 */
  function _syncFromMetadata(u: User | null) {
    if (!u) return
    const name = _metaDisplayName(u)
    if (name && !customNickname.value) {
      customNickname.value = name
      safeSetItem(K_CUSTOM_NICKNAME, name)
    }
    const av = _metaAvatar(u)
    if (av && !customAvatar.value) {
      customAvatar.value = av
      safeSetItem(K_CUSTOM_AVATAR, av)
    }
  }

  function _ensureTicker() {
    if (_ticker) return
    _ticker = setInterval(() => {
      cooldownTick.value = Date.now()
      const now = Date.now()
      for (const rec of limits.value.values()) {
        if (rec.lockUntil && rec.lockUntil <= now) {
          // 锁到期：重置当前轮失败计数，但保留累计锁次数（用于阶梯升级）
          rec.fails = 0
          rec.lockUntil = 0
        }
        if (rec.sendUntil && rec.sendUntil <= now) rec.sendUntil = 0
      }
      // 全部冷却/锁到期则停表
      const allIdle = [...limits.value.values()].every(r => !r.lockUntil && !r.sendUntil)
      if (allIdle) {
        _stopTicker()
      }
    }, 1000)
  }

  function _stopTicker() {
    if (_ticker) {
      clearInterval(_ticker)
      _ticker = null
    }
  }

  function _normEmail(email: string): string {
    return (email || '').trim().toLowerCase()
  }

  function _rec(email: string): LimitRecord {
    const norm = _normEmail(email)
    let r = limits.value.get(norm)
    if (!r) {
      r = { fails: 0, locks: 0, lockUntil: 0, sendUntil: 0 }
      limits.value.set(norm, r)
    }
    return r
  }

  /** 当前该邮箱的发送冷却剩余秒数（0 表示可发） */
  function sendCooldownRemaining(email: string): number {
    const rec = limits.value.get(_normEmail(email))
    if (!rec || !rec.sendUntil) return 0
    return Math.max(0, Math.ceil((rec.sendUntil - cooldownTick.value) / 1000))
  }

  /** 当前该邮箱的验证锁定剩余秒数（0 表示未锁） */
  function verifyLockRemaining(email: string): number {
    const rec = limits.value.get(_normEmail(email))
    if (!rec || !rec.lockUntil) return 0
    return Math.max(0, Math.ceil((rec.lockUntil - cooldownTick.value) / 1000))
  }

  async function init() {
    loading.value = true
    const driver = getAuthDriver()
    const { session: initial } = await driver.getSession()
    session.value = initial
    user.value = initial?.user ?? null
    _syncFromMetadata(user.value)
    // 缺陷7：会话恢复时记录 userId（跨刷新的账号切换检测）
    _observeUserId(user.value?.id ?? null)
    loading.value = false

    driver.onAuthStateChange((s) => {
      const prevUser = user.value
      session.value = s
      user.value = s?.user ?? null
      // 缺陷7：登录/换账号时检测 userId 变化并置跨账号标记
      _observeUserId(s?.user?.id ?? null)
      if (prevUser && !s?.user) {
        // 会话过期或远端登出：立即锁定 E2E 与 Vault 敏感解密密钥
        try { useE2EStore().lock() } catch { /* ignore */ }
        try { useVaultStore().lock() } catch { /* ignore */ }
      }
      _syncFromMetadata(user.value)
    })
  }

  async function updateProfile(data: { nickname?: string; avatar?: string }): Promise<boolean> {
    if (data.nickname !== undefined) {
      const trimmed = data.nickname.trim()
      customNickname.value = trimmed
      if (trimmed) {
        safeSetItem(K_CUSTOM_NICKNAME, trimmed)
      } else {
        safeRemoveItem(K_CUSTOM_NICKNAME)
      }
    }
    if (data.avatar !== undefined) {
      const trimmed = data.avatar.trim()
      customAvatar.value = trimmed
      if (trimmed) {
        safeSetItem(K_CUSTOM_AVATAR, trimmed)
      } else {
        safeRemoveItem(K_CUSTOM_AVATAR)
      }
    }

    if (user.value) {
      try {
        const updates: Record<string, unknown> = {}
        if (data.nickname !== undefined) updates.display_name = data.nickname.trim()
        if (data.avatar !== undefined) updates.avatar = data.avatar.trim()

        const { user: updatedUser, error } = await getAuthDriver().updateUserMeta(updates)
        if (error) {
          console.warn('[auth] updateUser metadata failed:', error)
        } else if (updatedUser) {
          user.value = updatedUser
          if (session.value) session.value.user = updatedUser
        }
      } catch (err) {
        console.warn('[auth] updateUser metadata error:', err)
      }
    }
    return true
  }

  async function sendOtp(email: string, captchaToken?: string): Promise<boolean> {
    authError.value = null
    _ensureTicker()
    // S12：发送冷却判定（发请求前）
    const remain = sendCooldownRemaining(email)
    if (remain > 0) {
      authError.value = t('modal.auth.cooldownError', { n: remain })
      return false
    }
    const { error } = await getAuthDriver().sendOtp(email, captchaToken)
    if (error) {
      // 审计 R31：仅「限流类」error 登记本地冷却——避免短时重复触发平台限流。
      // 非限流类（网络错误/邮箱格式错误/signup_disabled 等）不施冷却，让用户立即重试。
      // 旧实现对任何 error 都设 sendUntil，致一次网络抖动或邮箱输错也卡 60s。
      if (_isRateLimitError(error)) {
        const rec = _rec(email)
        rec.sendUntil = Date.now() + SEND_COOLDOWN_MS
        _ensureTicker()
      }
      authError.value = error.message
      return false
    }
    // 发送成功：登记冷却
    const rec = _rec(email)
    rec.sendUntil = Date.now() + SEND_COOLDOWN_MS
    _ensureTicker()
    return true
  }

  /**
   * 审计事件上报（fire-and-forget）：兑现《安全评估自评估报告》
   * 「操作日志：登录等操作留痕」的承诺，落服务端 audit_log 表。
   * 失败静默——审计失败不能阻断登录；未登录时服务端也会拒绝。
   */
  function _auditEvent(action: string): void {
    // 双重防御：dbRpc 可能同步抛错（驱动未就绪/后端未配置），审计失败绝不阻断登录
    try {
      void Promise.resolve(dbRpc('audit_log_event', { p_action: action })).catch(() => undefined)
    } catch {
      /* 静默 */
    }
  }

  async function verifyOtp(email: string, token: string): Promise<boolean> {
    authError.value = null
    _ensureTicker()
    // S12：锁定判定（发请求前，阻断穷举）
    const lockRemain = verifyLockRemaining(email)
    if (lockRemain > 0) {
      authError.value = t('modal.auth.lockError', { n: lockRemain })
      return false
    }
    const { error } = await getAuthDriver().verifyOtp(email, token)
    if (error) {
      const rec = _rec(email)
      rec.fails += 1
      if (rec.fails >= FAILS_PER_LOCK) {
        // 触发锁定：按累计锁次数升级时长
        rec.locks += 1
        const { lockMs, label } = lockDurationFor(rec.locks - 1)
        rec.lockUntil = Date.now() + lockMs
        rec.fails = 0
        authError.value = t('modal.auth.verifyLockedDuration', { label })
      } else {
        // 未达锁定阈值：仅提示失败（不暴露具体次数防节奏探测）
        authError.value = t('modal.auth.verifyCodeError')
      }
      _ensureTicker()
      return false
    }
    // 验证成功：清整条记录
    limits.value.delete(_normEmail(email))
    _auditEvent('login')
    return true
  }

  /** 重新发送时清掉该邮箱的失败计数与锁（让用户有重置机会）；累计锁次数也清零 */
  function resetVerifyState(email: string) {
    limits.value.delete(_normEmail(email))
  }

  /** 密码强度：CloudBase 要求 8~32 位且同时含字母与数字（平台侧同规则，这里先拦一道） */
  function _validatePassword(pw: string): string | null {
    if (pw.length < 8 || pw.length > 32) return t('modal.auth.passwordLengthRule')
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return t('modal.auth.passwordCharsRule')
    return null
  }

  /**
   * 邮箱 + 密码登录。
   *
   * 老用户（历史上全是验证码注册）没有密码，此时后端会返回凭据错误——无法从 error 里
   * 可靠区分「密码错」和「还没设过密码」，所以统一给出「先去验证码登录、登录后设密码」的引导语。
   * 失败计数与锁定复用验证码那套（同一账号的凭据尝试共享配额）。
   */
  async function signInWithPassword(email: string, password: string): Promise<boolean> {
    authError.value = null
    _ensureTicker()
    const lockRemain = verifyLockRemaining(email)
    if (lockRemain > 0) {
      authError.value = t('modal.auth.tryTooManySeconds', { n: lockRemain })
      return false
    }
    const { error } = await getAuthDriver().signInWithPassword(email, password)
    if (error) {
      const rec = _rec(email)
      rec.fails += 1
      if (rec.fails >= FAILS_PER_LOCK) {
        rec.locks += 1
        const { lockMs, label } = lockDurationFor(rec.locks - 1)
        rec.lockUntil = Date.now() + lockMs
        rec.fails = 0
        authError.value = t('modal.auth.tryTooManyLocked', { label })
      } else {
        authError.value = t('modal.auth.passwordWrongGuide')
      }
      _ensureTicker()
      return false
    }
    limits.value.delete(_normEmail(email))
    _auditEvent('login_password')
    return true
  }

  /**
   * 用「邮箱验证码 + 新密码」完成密码设置（老用户从验证码迁到密码的唯一路径）。
   *
   * CloudBase 的 `updateUser` 明确拒绝 password 参数，必须走 resetPasswordForEmail
   * 的验证码流程；Supabase 侧则是 verifyOtp(recovery) + updateUser，由驱动屏蔽差异。
   */
  async function confirmSetPassword(email: string, code: string, password: string): Promise<boolean> {
    authError.value = null
    const invalid = _validatePassword(password)
    if (invalid) {
      authError.value = invalid
      return false
    }
    if (!code.trim()) {
      authError.value = t('modal.auth.inputEmailCode')
      return false
    }
    const { error } = await getAuthDriver().confirmPasswordReset(email, code.trim(), password)
    if (error) {
      authError.value = error.message
      return false
    }
    _auditEvent('password_reset')
    return true
  }

  /** 发送找回密码邮件 */
  async function sendPasswordReset(email: string): Promise<boolean> {
    authError.value = null
    _ensureTicker()
    const remain = sendCooldownRemaining(email)
    if (remain > 0) {
      authError.value = t('modal.auth.retrySecondsLater', { n: remain })
      return false
    }
    const { error } = await getAuthDriver().sendPasswordReset(email)
    if (error) {
      if (_isRateLimitError(error)) {
        const rec = _rec(email)
        rec.sendUntil = Date.now() + SEND_COOLDOWN_MS
        _ensureTicker()
      }
      authError.value = error.message
      return false
    }
    const rec = _rec(email)
    rec.sendUntil = Date.now() + SEND_COOLDOWN_MS
    _ensureTicker()
    return true
  }

  async function signOut(): Promise<boolean> {
    authError.value = null
    const { error } = await getAuthDriver().signOut()
    if (error) {
      authError.value = error.message
      return false
    }
    customNickname.value = ''
    customAvatar.value = ''
    safeRemoveItem(K_CUSTOM_NICKNAME)
    safeRemoveItem(K_CUSTOM_AVATAR)

    // 缺陷7：登出清空 AI 会话，防换账号后把上一账号的隐私对话加载进 UI；
    // 书签 IDB 数据不动（本地数据权威是有意设计）。
    try {
      const { clearAllSessions } = await import('../lib/ai/chatSessions.js')
      clearAllSessions()
    } catch { /* ignore */ }

    // 清空内存限流记录与停止 ticker，避免换号或重登录残留
    limits.value.clear()
    _stopTicker()

    // 登出时重置/锁定 E2E 与 Vault 敏感解密密钥
    try { useE2EStore().lock() } catch { /* ignore */ }
    try { useVaultStore().lock() } catch { /* ignore */ }

    // 登出时清空会员权益与交易明细缓存，防换号/登出信息泄露
    try {
      const { useEntitlement } = await import('../composables/domain/useEntitlement.js')
      useEntitlement().clear()
    } catch { /* ignore */ }
    try {
      const { clearTransactions } = await import('../composables/domain/useTransactions.js')
      clearTransactions()
    } catch { /* ignore */ }

    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('lv_e2e_canary_conflict_checked')
      }
    } catch { /* ignore */ }

    try {
      const { useUIStore } = await import('./ui.js')
      const ui = useUIStore()
      if (ui.curSpace === 'vault') {
        const { useDataStore } = await import('./data.js')
        const ds = useDataStore()
        await ds.switchSpace('main')
      }
    } catch { /* ignore */ }

    user.value = null
    session.value = null
    return true
  }

  async function signInWithOAuth(provider: 'github' | 'google'): Promise<boolean> {
    authError.value = null
    const redirectOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const redirectTo = `${redirectOrigin}/app`
    const { error, url } = await getAuthDriver().signInWithOAuth(provider, redirectTo)
    if (error) {
      authError.value = error.message
      return false
    }
    if (url && typeof window !== 'undefined') {
      window.location.href = url
    }
    return true
  }

  return {
    user, session, loading, authError, authModalOpen,
    isLoggedIn, userEmail,
    customNickname, customAvatar, displayName, avatar, updateProfile,
    init, sendOtp, signInWithOAuth, verifyOtp, signOut, resetVerifyState,
    signInWithPassword, confirmSetPassword, sendPasswordReset,
    sendCooldownRemaining, verifyLockRemaining, cooldownTick,
  }
})
