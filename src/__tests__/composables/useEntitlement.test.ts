import { describe, it, expect, beforeEach } from 'vitest'
import { useEntitlement } from '../../composables/domain/useEntitlement.js'

describe('useEntitlement (会员权益与功能分层门控)', () => {
  beforeEach(() => {
    localStorage.clear()
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

  it('3. PRO 会员享有无限次 AI 智能提取额度', () => {
    const { entitlement, isPro, checkAiEnrichQuota, consumeAiEnrichQuota } = useEntitlement()
    entitlement.value = {
      planId: 'pro_monthly',
      planName: 'PRO 月付',
      status: 'active',
      expiresAt: '2099-01-01',
      features: { 'ai.tokens.monthly': 200000 },
      isPaid: true,
    }

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
});
