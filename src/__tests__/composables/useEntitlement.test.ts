import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useEntitlement, isProUser, ENTITLEMENT_CACHE_KEY } from '../../composables/domain/useEntitlement.js'
import type { MyEntitlement } from '../../composables/domain/useRedeem.js'

const mockFetchMyEntitlement = vi.hoisted(() => vi.fn())
vi.mock('../../composables/domain/useRedeem.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../composables/domain/useRedeem.js')>()
  return { ...actual, fetchMyEntitlement: mockFetchMyEntitlement }
})

describe('useEntitlement (会员权益与功能分层门控)', () => {
  beforeEach(() => {
    localStorage.clear()
    mockFetchMyEntitlement.mockReset()
    const { clear } = useEntitlement()
    clear()
  })

  it('1. 默认未登录/免费版用户 isPaid 与 isPro 为 false', () => {
    const { isPaid, isPro, planId } = useEntitlement()
    expect(isPaid.value).toBe(false)
    expect(isPro.value).toBe(false)
    expect(planId.value).toBe('free')
  })

  it('2. 免费版用户每日享有 3 次 AI 智能提取体验额度，用完后阻断', () => {
    const { isPro, checkAiEnrichQuota, consumeAiEnrichQuota } = useEntitlement()
    expect(isPro.value).toBe(false)

    // 初始状态：允许使用，剩余 3 次
    const q1 = checkAiEnrichQuota()
    expect(q1.allowed).toBe(true)
    expect(q1.remaining).toBe(3)
    expect(q1.total).toBe(3)

    // 消耗第 1 次
    expect(consumeAiEnrichQuota()).toBe(true)
    expect(checkAiEnrichQuota().remaining).toBe(2)

    // 消耗第 2 次
    expect(consumeAiEnrichQuota()).toBe(true)
    expect(checkAiEnrichQuota().remaining).toBe(1)

    // 消耗第 3 次
    expect(consumeAiEnrichQuota()).toBe(true)
    expect(checkAiEnrichQuota().remaining).toBe(0)
    expect(checkAiEnrichQuota().allowed).toBe(false)

    // 尝试消耗第 4 次：失败阻断
    expect(consumeAiEnrichQuota()).toBe(false)
  })

  it('3. PRO 会员（经服务端 refresh 确认）享有无限次 AI 智能提取额度', async () => {
    const pro: MyEntitlement = {
      planId: 'pro_monthly',
      planName: 'PRO 月付',
      status: 'active',
      expiresAt: '2099-01-01',
      features: { 'ai.tokens.monthly': 200000 },
      isPaid: true,
    }
    mockFetchMyEntitlement.mockResolvedValue(pro)
    // #36：PRO 门禁必须经服务端 refresh 确认，不能靠缓存/内存态赋值放行
    const { isPro, checkAiEnrichQuota, consumeAiEnrichQuota, refresh } = useEntitlement()
    await refresh()

    expect(isPro.value).toBe(true)
    const q = checkAiEnrichQuota()
    expect(q.allowed).toBe(true)
    expect(q.isPro).toBe(true)
    expect(q.remaining).toBeGreaterThan(1000)

    // 多次消耗不受限
    expect(consumeAiEnrichQuota()).toBe(true)
    expect(consumeAiEnrichQuota()).toBe(true)
    expect(consumeAiEnrichQuota()).toBe(true)
    expect(consumeAiEnrichQuota()).toBe(true)
    expect(checkAiEnrichQuota().allowed).toBe(true)
  })

  it('4. 订阅已过期时自动降级阻断，isPaid 与 isPro 为 false', () => {
    localStorage.setItem(
      'ulink_entitlement_v1',
      JSON.stringify({
        planId: 'plus_monthly',
        planName: 'Plus 月付',
        status: 'expired',
        expiresAt: '2020-01-01',
        features: { 'linkcheck.auto': 1 },
        isPaid: true,
      })
    )

    const { isPaid, isPro, planId, features, checkAiEnrichQuota } = useEntitlement()
    // 自动重置并降级
    expect(isPaid.value).toBe(false)
    expect(isPro.value).toBe(false)
    expect(planId.value).toBe('free')
    expect(features.value['linkcheck.auto']).toBeUndefined()
    expect(checkAiEnrichQuota().isPro).toBe(false)
  })

  it('5. 自动清理过往日期的 lv_ai_enrich_* 键，避免 localStorage 无限累积', () => {
    // 注入过往历史 key
    localStorage.setItem('lv_ai_enrich_2026-10-01', '3')
    localStorage.setItem('lv_ai_enrich_2026-10-02', '1')
    localStorage.setItem('lv_ai_enrich_2026-10-03', '2')

    const { checkAiEnrichQuota, consumeAiEnrichQuota } = useEntitlement()
    const quota = checkAiEnrichQuota()
    expect(quota.allowed).toBe(true)
    expect(quota.remaining).toBe(3)

    // 历史 key 应被自动清理
    expect(localStorage.getItem('lv_ai_enrich_2026-10-01')).toBeNull()
    expect(localStorage.getItem('lv_ai_enrich_2026-10-02')).toBeNull()
    expect(localStorage.getItem('lv_ai_enrich_2026-10-03')).toBeNull()

    // 消耗今天 1 次
    expect(consumeAiEnrichQuota()).toBe(true)
    expect(checkAiEnrichQuota().remaining).toBe(2)
  })

  it('6. clear() 后在途 refresh() 不写回缓存（退出登录竞态回归）', async () => {
    let resolveFetch!: (v: MyEntitlement) => void
    mockFetchMyEntitlement.mockImplementation(
      () => new Promise<MyEntitlement>((resolve) => { resolveFetch = resolve }),
    )
    const pro: MyEntitlement = {
      planId: 'pro_monthly',
      planName: 'PRO 月付',
      status: 'active',
      expiresAt: '2099-01-01',
      features: { 'ai.tokens.monthly': 200000 },
      isPaid: true,
    }
    const { refresh, clear, isPaid } = useEntitlement()
    const pending = refresh()
    clear()
    expect(localStorage.getItem(ENTITLEMENT_CACHE_KEY)).toBeNull()
    resolveFetch(pro)
    await pending
    expect(isPaid.value).toBe(false)
    expect(localStorage.getItem(ENTITLEMENT_CACHE_KEY)).toBeNull()
  })

  it('7. 最新一次 refresh() 仍正常更新权益与缓存', async () => {
    const pro: MyEntitlement = {
      planId: 'pro_monthly',
      planName: 'PRO 月付',
      status: 'active',
      expiresAt: '2099-01-01',
      features: {},
      isPaid: true,
    }
    mockFetchMyEntitlement.mockResolvedValue(pro)
    const { refresh, isPaid } = useEntitlement()
    await refresh()
    expect(isPaid.value).toBe(true)
    expect(localStorage.getItem(ENTITLEMENT_CACHE_KEY)).not.toBeNull()
  })

  // ── #36 回归：缓存仅用于展示，不得用于配额/权限决策；refresh 失败 fail-closed ──
  const proEntitlement: MyEntitlement = {
    planId: 'pro_monthly',
    planName: 'PRO 月付',
    status: 'active',
    expiresAt: '2099-01-01',
    features: {},
    isPaid: true,
  }

  it('#36 展示态/缓存 isPaid=true 未经服务端 refresh 确认 → PRO 门禁不放行（仅展示可用）', () => {
    const { entitlement, isPaid, checkAiEnrichQuota, consumeAiEnrichQuota } = useEntitlement()
    // 模拟手改 localStorage 缓存或离线恢复后展示态被置为 PRO（未经服务端校验）
    entitlement.value = { ...proEntitlement }

    expect(isPaid.value).toBe(true) // 展示态仍可显示 PRO（离线体验不破坏）
    const q = checkAiEnrichQuota()
    expect(q.isPro).toBe(false) // 门禁绝不认展示态/缓存
    expect(q.remaining).toBe(3) // 按免费档
    expect(consumeAiEnrichQuota()).toBe(true)
    expect(checkAiEnrichQuota().remaining).toBe(2)
  })

  it('#36 refresh 失败（服务端不可达）→ 门禁回落免费档 fail-closed，展示态保留', async () => {
    mockFetchMyEntitlement.mockResolvedValueOnce(proEntitlement)
    const { refresh, checkAiEnrichQuota, isPaid } = useEntitlement()
    await refresh()
    expect(checkAiEnrichQuota().isPro).toBe(true) // 先经服务端确认 PRO

    mockFetchMyEntitlement.mockRejectedValueOnce(new Error('offline'))
    await expect(refresh()).rejects.toThrow('offline')
    expect(checkAiEnrichQuota().isPro).toBe(false) // fail-closed，绝不沿用上次 PRO
    expect(checkAiEnrichQuota().remaining).toBeLessThanOrEqual(3)
    expect(isPaid.value).toBe(true) // 展示态保留上次服务端结果，不破坏离线展示
  })

  it('#36 isProUser（语义搜索等门禁）同样不认展示态/缓存，只认服务端确认', async () => {
    const { entitlement, refresh } = useEntitlement()
    entitlement.value = { ...proEntitlement }
    expect(isProUser()).toBe(false) // 仅展示态是 PRO，门禁不放行

    mockFetchMyEntitlement.mockResolvedValueOnce(proEntitlement)
    await refresh()
    expect(isProUser()).toBe(true) // 服务端确认后才放行
  })
});
