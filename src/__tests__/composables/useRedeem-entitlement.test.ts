/**
 * fetchMyEntitlement 的付费判定（变异测试发现：既有测试都把整个函数 mock 掉，
 * 「过期仍判付费」的 bug 埋进去全量测试照样全绿）。
 *
 * 这里只 mock 最底层的 dbRpc，直接锁住判定规则：
 *   付费 ⇔ planId ≠ free 且 status = active 且未过期（expires_at 在未来或为空）。
 * 前端功能门控（智能预填 / 语义搜索 / 自动死链巡检等）都依赖 isPaid，判错即「过期白嫖」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.hoisted(() => ({ dbRpc: vi.fn() }))
vi.mock('../../lib/dbApi.js', () => rpc)

import { fetchMyEntitlement } from '../../composables/domain/useRedeem.js'

const DAY = 864e5
const future = () => new Date(Date.now() + 30 * DAY).toISOString()
const past = () => new Date(Date.now() - DAY).toISOString()
const PRO_FEATURES = { 'ai.requests.daily': 100 }

function rpcReturns(data: unknown, error: unknown = null) {
  rpc.dbRpc.mockResolvedValueOnce({ data, error })
}

describe('fetchMyEntitlement — 付费判定', () => {
  beforeEach(() => rpc.dbRpc.mockReset())

  it('有效期内的 active 付费套餐 → 付费，保留套餐与权益', async () => {
    const expiresAt = future()
    rpcReturns({ plan_id: 'plus_monthly', plan_name: 'PRO 月付', status: 'active', expires_at: expiresAt, features: PRO_FEATURES })
    const e = await fetchMyEntitlement()
    expect(e).toMatchObject({ planId: 'plus_monthly', planName: 'PRO 月付', status: 'active', isPaid: true, expiresAt })
    expect(e.features).toEqual(PRO_FEATURES)
    expect(rpc.dbRpc).toHaveBeenCalledWith('my_entitlement')
  })

  it('已过期（expires_at 在过去）但 status 仍为 active → 不付费，回落免费档且清空权益', async () => {
    rpcReturns({ plan_id: 'plus_monthly', plan_name: 'PRO 月付', status: 'active', expires_at: past(), features: PRO_FEATURES })
    const e = await fetchMyEntitlement()
    expect(e.isPaid).toBe(false)
    expect(e.planId).toBe('free')
    expect(e.status).toBe('expired')
    expect(e.features).toEqual({})
  })

  it('服务端已标记 status=expired → 不付费', async () => {
    rpcReturns({ plan_id: 'plus_yearly', status: 'expired', expires_at: future(), features: PRO_FEATURES })
    const e = await fetchMyEntitlement()
    expect(e.isPaid).toBe(false)
    expect(e.planId).toBe('free')
    expect(e.features).toEqual({})
  })

  it('非 active 状态（如退款）→ 不付费', async () => {
    rpcReturns({ plan_id: 'plus_monthly', status: 'refunded', expires_at: future(), features: PRO_FEATURES })
    const e = await fetchMyEntitlement()
    expect(e.isPaid).toBe(false)
    expect(e.planId).toBe('free')
    expect(e.features).toEqual({})
  })

  it('免费档 → 不付费', async () => {
    rpcReturns({ plan_id: 'free', status: 'active', expires_at: null, features: { 'ai.requests.daily': 20 } })
    const e = await fetchMyEntitlement()
    expect(e.isPaid).toBe(false)
    expect(e.planId).toBe('free')
  })

  it('active 付费套餐且无到期时间（不限期）→ 付费', async () => {
    rpcReturns({ plan_id: 'plus_yearly', status: 'active', expires_at: null, features: PRO_FEATURES })
    expect((await fetchMyEntitlement()).isPaid).toBe(true)
  })

  it('RPC 报错 / 无数据 / 抛异常 → 一律按免费档（fail-closed，绝不误判付费）', async () => {
    rpcReturns(null, { message: 'boom' })
    expect((await fetchMyEntitlement()).isPaid).toBe(false)
    rpcReturns(null)
    expect((await fetchMyEntitlement()).isPaid).toBe(false)
    rpc.dbRpc.mockRejectedValueOnce(new Error('network'))
    const e = await fetchMyEntitlement()
    expect(e.isPaid).toBe(false)
    expect(e.planId).toBe('free')
  })
})
