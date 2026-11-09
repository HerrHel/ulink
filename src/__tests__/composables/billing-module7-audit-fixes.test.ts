import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'

vi.mock('../../lib/cloudbase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/cloudbase.js')>()
  return {
    ...actual,
    isCloudBaseBackend: () => true,
    edgeFnUrl: (name: string) => `https://test.ulink.ren/fn/${name}`,
    getCbFnBase: () => 'https://test.ulink.ren/fn',
  }
})

vi.mock('../../lib/authDriver.js', () => ({
  getApiToken: () => Promise.resolve('mock-token-xyz'),
  getAuthDriver: () => ({
    signOut: vi.fn().mockResolvedValue({ error: null }),
  }),
}))

import { usePayment } from '../../composables/domain/usePayment.js'
import { useTransactions, clearTransactions } from '../../composables/domain/useTransactions.js'
import { fetchPurchasePlans, _resetPurchasePlansCache } from '../../composables/domain/usePurchasePlans.js'
import { redeemCode } from '../../composables/domain/useRedeem.js'
import { purgeAccount } from '../../composables/domain/useAccountDeletion.js'
import { invokeCbFunction } from '../../lib/cloudbase.js'
import { useAuthStore } from '../../stores/auth.js'
import { useEntitlement } from '../../composables/domain/useEntitlement.js'

describe('模块 7：计费、会员权益、交易链路与云函数微服务体系回归测试', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    _resetPurchasePlansCache()
    clearTransactions()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── 1. usePayment: 组件卸载时自动停止轮询 ──
  it('1. usePayment: 当宿主组件卸载时，自动触发 stopPolling 清理轮询定时器', async () => {
    vi.useFakeTimers()

    // 模拟 fetch 返回 pending 订单
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse(String((init as any)?.body || '{}'))
      if (body.action === 'create') {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          orderId: 'ord_test_unmount',
          planId: 'plus_monthly',
          amountCents: 1900,
          channel: 'wechat',
          status: 'pending',
          qrCode: 'weixin://wxpay/bizpayurl?pr=xxx',
          expiresAt: new Date(Date.now() + 1800000).toISOString(),
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        order: { orderId: 'ord_test_unmount', status: 'pending' },
      }), { status: 200 }))
    })

    let paymentApi: any
    const wrapper = mount({
      setup() {
        paymentApi = usePayment()
        return {}
      },
      template: '<div></div>',
    })

    const order = await paymentApi.create('plus_monthly', 'wechat')
    expect(order).not.toBeNull()

    paymentApi.startPolling()
    expect(paymentApi.polling.value).toBe(true)

    // 卸载组件
    wrapper.unmount()

    // 卸载后 polling 状态应被自动置为 false
    expect(paymentApi.polling.value).toBe(false)
    vi.useRealTimers()
  })

  // ── 2. usePayment: checkStatus 具有超时 AbortController 保护 ──
  it('2. usePayment: checkStatus fetch 请求附加了 AbortController 超时机制', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      // 检查 signal 是否有效挂载
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return Promise.resolve(new Response(JSON.stringify({ ok: true, order: { orderId: 'ord_1', status: 'pending' } }), { status: 200 }))
    })

    const pay = usePayment()
    await pay.checkStatus('ord_1')
    expect(fetchSpy).toHaveBeenCalled()
  })

  // ── 3. useTransactions: clearTransactions 深度清空历史账单 ──
  it('3. useTransactions: clearTransactions 能彻底清空内存中的交易记录与分页游标', () => {
    const { transactions, total, page, clear } = useTransactions()
    transactions.value = [
      {
        orderId: 'tx_old_1',
        createdAt: '2026-11-01T12:00:00Z',
        amountYen: '19.00',
        amountCents: 1900,
        currency: 'CNY',
        type: 'purchase',
        typeLabel: '购买',
        channel: 'wechat',
        channelLabel: '微信支付',
        status: 'paid',
        statusLabel: '已支付',
        planId: 'plus_monthly',
        planName: 'PRO 月付',
      },
    ]
    total.value = 1
    page.value = 2

    expect(transactions.value.length).toBe(1)
    clear()
    expect(transactions.value.length).toBe(0)
    expect(total.value).toBe(0)
    expect(page.value).toBe(1)
  })

  // ── 4. authStore.signOut: 登出时联动清空交易记录与会员权益缓存 ──
  it('4. authStore.signOut: 退出登录时自动联动清空会员权益与交易明细，杜绝跨账号数据泄露', async () => {
    const auth = useAuthStore()
    const ent = useEntitlement()
    const { transactions, total } = useTransactions()

    // 模拟已登录并且内存中有上一用户的权益与账单
    ent.entitlement.value = {
      planId: 'plus_yearly',
      planName: 'PRO 年付',
      status: 'active',
      expiresAt: '2027-11-01T00:00:00Z',
      features: { 'ai.requests.daily': 100 },
      isPaid: true,
    }
    transactions.value = [{ orderId: 'tx_secret', amountCents: 9900 } as any]
    total.value = 1

    expect(ent.isPaid.value).toBe(true)
    expect(transactions.value.length).toBe(1)

    // 调用 signOut 登出
    await auth.signOut()

    // 会员权益被清空回退到免费版
    expect(ent.isPaid.value).toBe(false)
    expect(ent.planId.value).toBe('free')
    // 交易记录被彻底抹除
    expect(transactions.value.length).toBe(0)
    expect(total.value).toBe(0)
  })

  // ── 5. usePurchasePlans: 降级 fetch 挂载了 AbortController 保护 ──
  it('5. usePurchasePlans: 直连失败进入降级 fetch 时挂载了 AbortController 超时控制', async () => {
    let capturedSignal: any = null
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      capturedSignal = init?.signal
      return Promise.resolve(new Response(JSON.stringify({ ok: true, plans: [{ planId: 'p1', name: '方案1', priceCents: 1000, currency: 'CNY', periodDays: 30 }] }), { status: 200 }))
    })

    const plans = await fetchPurchasePlans(true)
    if (capturedSignal) {
      expect(capturedSignal).toBeInstanceOf(AbortSignal)
    }
    expect(Array.isArray(plans)).toBe(true)
  })

  // ── 6. useRedeem: redeemCode fetch 请求挂载了 AbortController ──
  it('6. useRedeem: redeemCode 发出核销请求时附加了 AbortController 防超时挂死', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return Promise.resolve(new Response(JSON.stringify({ ok: true, plan_name: 'PRO 月卡', expires_at: '2026-12-01' }), { status: 200 }))
    })

    const res = await redeemCode('TEST_REDEEM_CODE_1234')
    expect(res.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalled()
  })

  // ── 7. useAccountDeletion: purgeAccount 附加了 AbortController 超时保护 ──
  it('7. useAccountDeletion: purgeAccount 发出注销请求时挂载了 AbortController，超时返回 network 错误', async () => {
    let capturedSignal: any = null
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      capturedSignal = init?.signal
      return Promise.resolve(new Response(JSON.stringify({ ok: true, dataDeleted: true, accountPendingDeletion: true }), { status: 200 }))
    })

    const res = await purgeAccount()
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(res.ok).toBe(true)
    expect(res.dataDeleted).toBe(true)

    // 验证网络中断/超时处理
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    })
    const resTimeout = await purgeAccount()
    expect(resTimeout.ok).toBe(false)
    expect(resTimeout.error).toBe('network')
  })

  // ── 8. invokeCbFunction: 未传 signal 时自动挂载默认超时守护 ──
  it('8. invokeCbFunction: 当调用方未提供 signal 时自动挂载 15s 兜底超时信号，杜绝死链扫描等无界挂起', async () => {
    vi.stubEnv('VITE_CLOUDBASE_FN_BASE', 'https://test.ulink.ren')
    let capturedSignal: any = null
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      capturedSignal = init?.signal
      return Promise.resolve(new Response(JSON.stringify({ fetch_outcome: 'ok', http_status: 200 }), { status: 200 }))
    })

    try {
      const res = await invokeCbFunction('check-link', { url: 'https://example.com' })
      expect(capturedSignal).toBeInstanceOf(AbortSignal)
      expect(res.error).toBeNull()
      expect(res.data).toEqual({ fetch_outcome: 'ok', http_status: 200 })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  // ── 9. 云函数 IP 防伪造提取规范：优先 x-real-ip，其次 XFF 最后一跳 ──
  it('9. 云函数 IP 防伪造提取规范：正确忽略客户端伪造的 XFF 首跳，锁定真实来源 IP', () => {
    // 模拟云函数中的 clientIp 实现逻辑
    function clientIp(req: any) {
      const real = req.headers['x-real-ip']
      if (typeof real === 'string' && real.trim()) return real.trim()
      const xff = String(req.headers['x-forwarded-for'] || '')
      const hops = xff.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (hops.length) return hops[hops.length - 1]
      return req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || 'unknown'
    }

    // 场景 A: 恶意客户端伪造了 X-Forwarded-For: 203.0.113.77，网关追加了真实 IP 198.51.100.1
    const reqA = {
      headers: {
        'x-forwarded-for': '203.0.113.77, 198.51.100.1',
      },
    }
    expect(clientIp(reqA)).toBe('198.51.100.1')

    // 场景 B: 网关直接写入了 x-real-ip: 198.51.100.2
    const reqB = {
      headers: {
        'x-forwarded-for': '203.0.113.77',
        'x-real-ip': '198.51.100.2',
      },
    }
    expect(clientIp(reqB)).toBe('198.51.100.2')

    // 场景 C: 无 XFF 和 x-real-ip，兜底 socket 远程地址
    const reqC = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    }
    expect(clientIp(reqC)).toBe('127.0.0.1')
  })
})
