import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase.js'
import type { User, Session } from '@supabase/supabase-js'

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
        clearInterval(_ticker!)
        _ticker = null
      }
    }, 1000)
  }

  function _rec(email: string): LimitRecord {
    let r = limits.value.get(email)
    if (!r) {
      r = { fails: 0, locks: 0, lockUntil: 0, sendUntil: 0 }
      limits.value.set(email, r)
    }
    return r
  }

  /** 当前该邮箱的发送冷却剩余秒数（0 表示可发） */
  function sendCooldownRemaining(email: string): number {
    const rec = limits.value.get(email)
    if (!rec || !rec.sendUntil) return 0
    return Math.max(0, Math.ceil((rec.sendUntil - cooldownTick.value) / 1000))
  }

  /** 当前该邮箱的验证锁定剩余秒数（0 表示未锁） */
  function verifyLockRemaining(email: string): number {
    const rec = limits.value.get(email)
    if (!rec || !rec.lockUntil) return 0
    return Math.max(0, Math.ceil((rec.lockUntil - cooldownTick.value) / 1000))
  }

  async function init() {
    loading.value = true
    const { data } = await supabase.auth.getSession()
    session.value = data.session
    user.value = data.session?.user ?? null
    loading.value = false

    supabase.auth.onAuthStateChange((_event, s) => {
      session.value = s
      user.value = s?.user ?? null
    })
  }

  async function sendOtp(email: string): Promise<boolean> {
    authError.value = null
    _ensureTicker()
    // S12：发送冷却判定（发请求前）
    const remain = sendCooldownRemaining(email)
    if (remain > 0) {
      authError.value = `验证码已发送，请 ${remain} 秒后再试`
      return false
    }
    const { error } = await supabase.auth.signInWithOtp({ email })
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

  async function verifyOtp(email: string, token: string): Promise<boolean> {
    authError.value = null
    _ensureTicker()
    // S12：锁定判定（发请求前，阻断穷举）
    const lockRemain = verifyLockRemaining(email)
    if (lockRemain > 0) {
      authError.value = `验证失败次数过多，请 ${lockRemain} 秒后重试或重新获取验证码`
      return false
    }
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (error) {
      const rec = _rec(email)
      rec.fails += 1
      if (rec.fails >= FAILS_PER_LOCK) {
        // 触发锁定：按累计锁次数升级时长
        rec.locks += 1
        const { lockMs, label } = lockDurationFor(rec.locks - 1)
        rec.lockUntil = Date.now() + lockMs
        rec.fails = 0
        authError.value = `验证失败次数过多，已锁定 ${label}，稍后请重新获取验证码`
      } else {
        // 未达锁定阈值：仅提示失败（不暴露具体次数防节奏探测）
        authError.value = '验证码错误，请检查后重试'
      }
      _ensureTicker()
      return false
    }
    // 验证成功：清整条记录
    limits.value.delete(email)
    return true
  }

  /** 重新发送时清掉该邮箱的失败计数与锁（让用户有重置机会）；累计锁次数也清零 */
  function resetVerifyState(email: string) {
    limits.value.delete(email)
  }

  async function signOut(): Promise<boolean> {
    authError.value = null
    const { error } = await supabase.auth.signOut()
    if (error) {
      authError.value = error.message
      return false
    }
    return true
  }

  return {
    user, session, loading, authError, authModalOpen,
    isLoggedIn, userEmail,
    init, sendOtp, verifyOtp, signOut, resetVerifyState,
    sendCooldownRemaining, verifyLockRemaining, cooldownTick,
  }
})
