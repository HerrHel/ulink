/**
 * 权益查询与兑换码核销
 *
 * 权益读取走 `my_entitlement()`（RPC 内部用 auth.uid() 取调用者本人，
 * 不接受外部传入 uid，避免越权查他人权益）。
 *
 * 核销走 `redeem` 云函数：摘要只在服务端计算与校验，且 RPC 内有原子防双兑。
 */
import { dbRpc } from '../../lib/dbApi.js'
import { edgeFnUrl, isCloudBaseBackend } from '../../lib/cloudbase.js'
import { getApiToken } from '../../lib/authDriver.js'

export interface MyEntitlement {
  planId: string
  planName: string
  status: string
  expiresAt: string | null
  features: Record<string, number>
  isPaid: boolean
}

const FREE_PLAN: MyEntitlement = {
  planId: 'free',
  planName: 'free',
  status: 'active',
  expiresAt: null,
  features: {},
  isPaid: false,
}

/** 读取当前登录用户的权益；未登录或出错时回退到免费版 */
/** AI 访问状态（服务端 my_ai_access）：PRO 不限次；免费为终身试用剩余次数；未登录不可用 */
export interface MyAiAccess {
  tier: 'pro' | 'trial' | 'anonymous' | 'unknown'
  used: number
  limit: number
  remaining: number
  /**
   * PRO 用量（服务端 20261127000002 起返回；旧服务端缺省 undefined）。
   * limit 为 0 表示该项不限 / 未配置，前端不展示。
   */
  pro?: {
    dailyUsed: number
    dailyLimit: number
    monthlyUsedTokens: number
    monthlyLimitTokens: number
    /** 本月 token 用量恢复时刻（ISO，北京时间自然月） */
    monthlyResetsAt?: string
    /** 每月请求次数（PRO 主限额，账号时区自然月）；limit 0 = 未配置（旧套餐） */
    requestsMonthUsed: number
    requestsMonthLimit: number
    requestsMonthResetsAt?: string
  }
  /** 额度时区（服务端 20261127000002 起返回；旧服务端 / 未登录为 undefined） */
  tz?: QuotaTzState
}

/** 账号额度时区状态：每日额度按 zone 的 0 点刷新 */
export interface QuotaTzState {
  /** 当前生效的 IANA 时区 */
  zone: string
  /** 账号是否已登记过时区（false = 沿用默认北京时间，需首次上报） */
  isSet: boolean
  /** 待生效的新时区与生效时刻（ISO） */
  pendingZone?: string
  pendingAt?: string
  /** 上次手动修改时间（ISO），冷却期依据 */
  changedAt?: string
  /** 下一次每日额度恢复时刻（ISO） */
  dailyResetsAt?: string
}

type RawTzFields = {
  quota_tz?: string; quota_tz_set?: boolean; pending_tz?: string | null
  pending_effective_at?: string | null; tz_changed_at?: string | null; daily_resets_at?: string | null
}

/** 解析服务端返回里的时区片段；没有 quota_tz（旧服务端）返回 undefined */
export function parseQuotaTz(raw: RawTzFields | null | undefined): QuotaTzState | undefined {
  if (!raw || typeof raw.quota_tz !== 'string' || !raw.quota_tz) return undefined
  const s = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  return {
    zone: raw.quota_tz,
    isSet: raw.quota_tz_set === true,
    pendingZone: s(raw.pending_tz),
    pendingAt: s(raw.pending_effective_at),
    changedAt: s(raw.tz_changed_at),
    dailyResetsAt: s(raw.daily_resets_at),
  }
}

export type SetTimezoneResult =
  | { ok: true; reason?: 'already_set' | 'already_pending'; tz?: QuotaTzState }
  | { ok: false; reason: 'login_required' | 'bad_tz' | 'cooldown' | 'network'; nextAllowedAt?: string; tz?: QuotaTzState }

/**
 * 设置自己的额度时区（服务端 set_my_timezone）。
 * initial=true：首次自动上报，已登记过则不改（多设备不会互相改写）；
 * initial=false：手动修改，30 天一次，到当前时区下一个 0 点生效。
 */
export async function setMyTimezone(tz: string, initial = false): Promise<SetTimezoneResult> {
  try {
    const { data, error } = await dbRpc('set_my_timezone', { p_tz: tz, p_initial: initial })
    if (error || !data) return { ok: false, reason: 'network' }
    const raw = data as RawTzFields & { ok?: boolean; reason?: string; next_allowed_at?: string }
    const tzState = parseQuotaTz(raw)
    if (raw.ok) {
      const reason = raw.reason === 'already_set' || raw.reason === 'already_pending' ? raw.reason : undefined
      return { ok: true, reason, tz: tzState }
    }
    const reason = raw.reason === 'login_required' || raw.reason === 'bad_tz' || raw.reason === 'cooldown' ? raw.reason : 'network'
    return { ok: false, reason, nextAllowedAt: raw.next_allowed_at || undefined, tz: tzState }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

export const UNKNOWN_AI_ACCESS: MyAiAccess = { tier: 'unknown', used: 0, limit: 0, remaining: 0 }

/** 读取**自己**的 AI 访问状态；失败返回 unknown（由服务端在实际调用时最终裁决） */
export async function fetchMyAiAccess(): Promise<MyAiAccess> {
  try {
    const { data, error } = await dbRpc('my_ai_access')
    if (error || !data) return UNKNOWN_AI_ACCESS
    const raw = data as RawTzFields & {
      tier?: string; used?: number; limit?: number; remaining?: number
      daily_used?: number; daily_limit?: number; monthly_used_tokens?: number; monthly_limit_tokens?: number
      monthly_resets_at?: string | null
      requests_month_used?: number; requests_month_limit?: number; requests_month_resets_at?: string | null
    }
    const tier = raw.tier === 'pro' || raw.tier === 'trial' || raw.tier === 'anonymous' ? raw.tier : 'unknown'
    const limit = Number(raw.limit) || 0
    const used = Number(raw.used) || 0
    const remaining = typeof raw.remaining === 'number' ? Math.max(0, raw.remaining) : Math.max(0, limit - used)
    const access: MyAiAccess = { tier, used, limit, remaining }
    if (tier === 'pro' && (raw.daily_limit !== undefined || raw.monthly_limit_tokens !== undefined)) {
      const n = (v: unknown) => Math.max(0, Number(v) || 0)
      access.pro = {
        dailyUsed: n(raw.daily_used),
        dailyLimit: n(raw.daily_limit),
        monthlyUsedTokens: n(raw.monthly_used_tokens),
        monthlyLimitTokens: n(raw.monthly_limit_tokens),
        requestsMonthUsed: n(raw.requests_month_used),
        requestsMonthLimit: n(raw.requests_month_limit),
      }
      if (typeof raw.monthly_resets_at === 'string' && raw.monthly_resets_at) access.pro.monthlyResetsAt = raw.monthly_resets_at
      if (typeof raw.requests_month_resets_at === 'string' && raw.requests_month_resets_at) {
        access.pro.requestsMonthResetsAt = raw.requests_month_resets_at
      }
    }
    const tz = tier === 'anonymous' ? undefined : parseQuotaTz(raw)
    if (tz) access.tz = tz
    return access
  } catch {
    return UNKNOWN_AI_ACCESS
  }
}

export async function fetchMyEntitlement(): Promise<MyEntitlement> {
  try {
    const { data, error } = await dbRpc('my_entitlement')
    if (error || !data) return FREE_PLAN
    const raw = data as {
      plan_id?: string
      plan_name?: string
      status?: string
      expires_at?: string | null
      features?: Record<string, number>
    }
    const planId = raw.plan_id || 'free'
    const status = raw.status || 'active'
    const isExpired = status === 'expired' || (raw.expires_at ? new Date(raw.expires_at).getTime() < Date.now() : false)
    const isPaid = planId !== 'free' && !isExpired && status === 'active'
    return {
      planId: isPaid ? planId : 'free',
      planName: isPaid ? (raw.plan_name || planId) : (isExpired ? '免费版 (已过期)' : '免费版'),
      status: isExpired ? 'expired' : status,
      expiresAt: raw.expires_at || null,
      features: isPaid ? (raw.features || {}) : {},
      isPaid,
    }
  } catch {
    return FREE_PLAN
  }
}

export type RedeemError = 'invalid_code' | 'not_found' | 'already_used' | 'plan_inactive' | 'unauthorized' | 'rate_limited' | 'network' | 'not_configured'

export interface RedeemResult {
  ok: boolean
  planName?: string
  expiresAt?: string
  error?: RedeemError
}

/** 核销兑换码 */
export async function redeemCode(code: string): Promise<RedeemResult> {
  const trimmed = (code || '').trim()
  if (!trimmed) return { ok: false, error: 'invalid_code' }
  if (!isCloudBaseBackend()) return { ok: false, error: 'not_configured' }

  const endpoint = edgeFnUrl('redeem')
  if (!endpoint) return { ok: false, error: 'not_configured' }

  const token = await getApiToken()
  if (!token) return { ok: false, error: 'unauthorized' }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: trimmed }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      plan_name?: string
      expires_at?: string
      reason?: string
    }
    if (res.ok && body.ok === true) {
      return { ok: true, planName: body.plan_name, expiresAt: body.expires_at }
    }
    if (res.status === 401) return { ok: false, error: 'unauthorized' }
    if (res.status === 429) return { ok: false, error: 'rate_limited' }
    const reason = body.reason as RedeemError | undefined
    if (reason) return { ok: false, error: reason }
    return { ok: false, error: 'network' }
  } catch {
    return { ok: false, error: 'network' }
  }
}
