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
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: trimmed }),
    })
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
