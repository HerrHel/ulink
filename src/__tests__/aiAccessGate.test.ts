/**
 * ai-api 的 AI 访问权闸门（cloudbase/functions/ai-api/ai-access.js，2026-11-21）。
 *
 * 背景：收藏时的 AI 预填此前只有每分钟限流，不看套餐——免费用户可无限调用大模型。
 * 锁住：未登录不放行；免费按终身试用扣次；PRO 另计每日请求数；任何 RPC 故障 fail-closed；
 * 未产出 AI 结果时按扣次来源退还。
 */
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { checkAiAccess, refundAiAccess } = require('../../cloudbase/functions/ai-api/ai-access.js') as {
  checkAiAccess: (db: unknown, uid: string | null) => Promise<{ allowed: boolean; consumed: 'trial' | 'daily' | null; reason: string | null }>
  refundAiAccess: (db: unknown, uid: string, consumed: 'trial' | 'daily' | null) => Promise<void>
}

type RpcResult = { data?: unknown; error?: unknown }
function fakeDb(handlers: Record<string, RpcResult | (() => never)>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  return {
    calls,
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      const h = handlers[fn]
      if (typeof h === 'function') return h()
      return h ?? { data: null, error: { message: `unexpected rpc ${fn}` } }
    }),
  }
}

describe('checkAiAccess', () => {
  it('未登录：不放行且不发任何 RPC', async () => {
    const db = fakeDb({})
    expect(await checkAiAccess(db, null)).toEqual({ allowed: false, consumed: null, reason: 'login_required' })
    expect(db.calls).toHaveLength(0)
  })

  it('免费用户有试用余量：放行，扣次来源为 trial，不再计每日请求数', async () => {
    const db = fakeDb({ consume_ai_access: { data: { ok: true, tier: 'trial', used: 3, limit: 30 } } })
    expect(await checkAiAccess(db, 'u1')).toEqual({ allowed: true, consumed: 'trial', reason: null })
    expect(db.calls.map((c) => c.fn)).toEqual(['consume_ai_access'])
    expect(db.calls[0].args).toEqual({ p_uid: 'u1' })
  })

  it('免费用户试用用完：不放行', async () => {
    const db = fakeDb({ consume_ai_access: { data: { ok: false, tier: 'trial', reason: 'trial_exhausted' } } })
    expect(await checkAiAccess(db, 'u1')).toMatchObject({ allowed: false, consumed: null, reason: 'ai_trial_exhausted' })
  })

  it('PRO：通过访问权后再计入每日请求数 ai.requests.daily', async () => {
    const db = fakeDb({
      consume_ai_access: { data: { ok: true, tier: 'pro' } },
      consume_daily_feature_quota: { data: { ok: true, limited: true, limit: 100 } },
    })
    expect(await checkAiAccess(db, 'u2')).toEqual({ allowed: true, consumed: 'daily', reason: null })
    expect(db.calls[1]).toEqual({ fn: 'consume_daily_feature_quota', args: { p_uid: 'u2', p_feature: 'ai.requests.daily', p_key_prefix: 'ai:req:' } })
  })

  it('PRO 当日次数用完：不放行（daily_exhausted）', async () => {
    const db = fakeDb({
      consume_ai_access: { data: { ok: true, tier: 'pro' } },
      consume_daily_feature_quota: { data: { ok: false, limited: true, limit: 100 } },
    })
    expect(await checkAiAccess(db, 'u2')).toMatchObject({ allowed: false, reason: 'daily_exhausted' })
  })

  it.each([
    ['访问权 RPC 报错', { consume_ai_access: { error: { message: 'db down' } } }],
    ['访问权 RPC 抛异常', { consume_ai_access: () => { throw new Error('boom') } }],
    ['PRO 每日额度 RPC 报错', { consume_ai_access: { data: { ok: true, tier: 'pro' } }, consume_daily_feature_quota: { error: { message: 'x' } } }],
  ])('%s → fail-closed（quota_unavailable），绝不放行', async (_name, handlers) => {
    const db = fakeDb(handlers as Record<string, RpcResult | (() => never)>)
    expect(await checkAiAccess(db, 'u1')).toMatchObject({ allowed: false, consumed: null, reason: 'quota_unavailable' })
  })
})

describe('refundAiAccess', () => {
  it('trial → refund_ai_trial；daily → refund_daily_feature_quota；null → 不发请求', async () => {
    const db = fakeDb({ refund_ai_trial: { data: null }, refund_daily_feature_quota: { data: null } })
    await refundAiAccess(db, 'u1', 'trial')
    await refundAiAccess(db, 'u1', 'daily')
    await refundAiAccess(db, 'u1', null)
    expect(db.calls).toEqual([
      { fn: 'refund_ai_trial', args: { p_uid: 'u1' } },
      { fn: 'refund_daily_feature_quota', args: { p_uid: 'u1', p_feature: 'ai.requests.daily' } },
    ])
  })

  it('退还失败不抛出（不影响已返回给用户的结果）', async () => {
    const db = { rpc: vi.fn(async () => { throw new Error('network') }) }
    await expect(refundAiAccess(db, 'u1', 'trial')).resolves.toBeUndefined()
  })
})
