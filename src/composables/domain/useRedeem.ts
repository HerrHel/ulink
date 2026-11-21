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
}

export const UNKNOWN_AI_ACCESS: MyAiAccess = { tier: 'unknown', used: 0, limit: 0, remaining: 0 }

/** 读取**自己**的 AI 访问状态；失败返回 unknown（由服务端在实际调用时最终裁决） */
export async function fetchMyAiAccess(): Promise<MyAiAccess> {
  try {
    const { data, error } = await dbRpc('my_ai_access')
    if (error || !data) return UNKNOWN_AI_ACCESS
    const raw = data as { tier?: string; used?: number; limit?: number; remaining?: number }
    const tier = raw.tier === 'pro' || raw.tier === 'trial' || raw.tier === 'anonymous' ? raw.tier : 'unknown'
    const limit = Number(raw.limit) || 0
    const used = Number(raw.used) || 0
    const remaining = typeof raw.remaining === 'number' ? Math.max(0, raw.remaining) : Math.max(0, limit - used)
    return { tier, used, limit, remaining }
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
