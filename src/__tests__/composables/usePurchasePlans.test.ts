import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  fetchPurchasePlans,
  prefetchPurchasePlans,
  getCachedPlans,
  _resetPurchasePlansCache,
  type PlanRow,
} from '../../composables/domain/usePurchasePlans.js'

const mockPlans: PlanRow[] = [
  { planId: 'free', name: 'Free', priceCents: 0, currency: 'CNY', periodDays: 0 },
  { planId: 'pro_monthly', name: 'PRO 月付', priceCents: 1500, currency: 'CNY', periodDays: 30 },
]

const dbRpcMock = vi.fn()
vi.mock('../../lib/dbApi.js', () => ({
  dbRpc: (...args: any[]) => dbRpcMock(...args),
}))

vi.mock('../../lib/cloudbase.js', () => ({
  edgeFnUrl: vi.fn().mockReturnValue('https://mock-env.tcloudbase.com/pay'),
  isCloudBaseBackend: vi.fn().mockReturnValue(true),
}))

vi.mock('../../lib/authDriver.js', () => ({
  getApiToken: vi.fn().mockResolvedValue('mock-token'),
}))

describe('usePurchasePlans.ts', () => {
  beforeEach(() => {
    _resetPurchasePlansCache()
    dbRpcMock.mockReset()
    vi.restoreAllMocks()
  })

  it('1. 优先通过 dbRpc(list_purchase_plans) 直连数据库并缓存', async () => {
    dbRpcMock.mockResolvedValueOnce({ data: mockPlans, error: null })

    const res = await fetchPurchasePlans()
    expect(res).toEqual(mockPlans)
    expect(dbRpcMock).toHaveBeenCalledWith('list_purchase_plans')
    expect(getCachedPlans()).toEqual(mockPlans)

    // 第二次调用命中内存缓存，不再调用 dbRpc
    const resCached = await fetchPurchasePlans()
    expect(resCached).toEqual(mockPlans)
    expect(dbRpcMock).toHaveBeenCalledTimes(1)
  })

  it('2. dbRpc 失败时自动 fallback 到云函数 pay?action=plans', async () => {
    dbRpcMock.mockResolvedValueOnce({ data: null, error: new Error('RPC not found') })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, plans: mockPlans }),
    } as Response)

    const res = await fetchPurchasePlans()
    expect(res).toEqual(mockPlans)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(getCachedPlans()).toEqual(mockPlans)
  })

  it('3. prefetchPurchasePlans 静默在后台预取', async () => {
    dbRpcMock.mockResolvedValueOnce({ data: mockPlans, error: null })

    prefetchPurchasePlans()
    // 等待异步完成
    await new Promise((r) => setTimeout(r, 10))

    expect(dbRpcMock).toHaveBeenCalledTimes(1)
    expect(getCachedPlans()).toEqual(mockPlans)
  })

  it('4. force=true 强制忽略缓存重新拉取', async () => {
    dbRpcMock.mockResolvedValue({ data: mockPlans, error: null })

    await fetchPurchasePlans()
    expect(dbRpcMock).toHaveBeenCalledTimes(1)

    await fetchPurchasePlans(true)
    expect(dbRpcMock).toHaveBeenCalledTimes(2)
  })
})
