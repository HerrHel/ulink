/**
 * usePayment（收银台下单 / 查单 / 轮询）。此前没有任何单测——变异测试发现
 * 「401 误报为网络错误」「后端 ok:false 也当下单成功」埋进去全量测试照样全绿。
 *
 * 只 mock 边界（CloudBase 开关与基址、登录 token、fetch），锁住：
 *   - 下单请求契约与订单归一化；
 *   - HTTP 状态 / 后端错误码 → 前端错误枚举（决定收银台展示「请登录」还是「重试」等）；
 *   - 只有 HTTP 2xx 且 body.ok === true 才算下单成功；
 *   - 未登录 / 非 CloudBase 形态不发请求；
 *   - 轮询直到 paid 才回调，且只回调一次。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cb = vi.hoisted(() => ({
  isCloudBaseBackend: vi.fn(() => true),
  edgeFnUrl: vi.fn((name: string) => `https://test.ulink.ren/${name}`),
}))
vi.mock('../../lib/cloudbase.js', () => cb)
const authDriver = vi.hoisted(() => ({ getApiToken: vi.fn(async () => 'tok-123') }))
vi.mock('../../lib/authDriver.js', () => authDriver)
vi.mock('../../composables/domain/usePurchasePlans.js', () => ({ getCachedPlans: () => [] }))

import { usePayment } from '../../composables/domain/usePayment.js'

const fetchMock = vi.fn()
function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => body })
}
const ORDER = {
  ok: true,
  orderId: 'ord_1',
  planId: 'plus_monthly',
  amountCents: 1500,
  channel: 'wechat',
  status: 'pending',
  qrCode: 'weixin://wxpay/bizpayurl?pr=abc',
  expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
}

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
  cb.isCloudBaseBackend.mockReturnValue(true)
  authDriver.getApiToken.mockResolvedValue('tok-123')
})

describe('usePayment.create — 下单', () => {
  it('成功：按契约发请求（带 Bearer token），返回并保存归一化订单', async () => {
    respond(200, ORDER)
    const pay = usePayment()
    const o = await pay.create('plus_monthly', 'wechat')
    expect(o).toMatchObject({ orderId: 'ord_1', planId: 'plus_monthly', amountCents: 1500, channel: 'wechat', status: 'pending', qrCode: ORDER.qrCode })
    expect(pay.order.value?.orderId).toBe('ord_1')
    expect(pay.error.value).toBeNull()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://test.ulink.ren/pay')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-123')
    expect(JSON.parse(init.body)).toMatchObject({ action: 'create', planId: 'plus_monthly', channel: 'wechat' })
  })

  it('HTTP 200 但 body.ok !== true → 视为失败，不产生订单', async () => {
    respond(200, { ok: false, error: 'plan_not_payable' })
    const pay = usePayment()
    expect(await pay.create('plus_monthly', 'wechat')).toBeNull()
    expect(pay.order.value).toBeNull()
    expect(pay.error.value).toBe('plan_not_payable')
  })

  it('HTTP 200 但缺 ok 字段（形状异常）→ 同样视为失败', async () => {
    respond(200, { orderId: 'ord_x', qrCode: 'x' })
    const pay = usePayment()
    expect(await pay.create('plus_monthly', 'wechat')).toBeNull()
    expect(pay.order.value).toBeNull()
  })

  it.each([
    [401, {}, 'unauthorized'],
    [429, {}, 'rate_limited'],
    [503, { error: 'channel_not_configured' }, 'channel_not_configured'],
    [503, { error: 'whatever' }, 'not_configured'],
    [502, {}, 'channel_error'],
    [400, { error: 'plan_not_found' }, 'plan_not_found'],
    [400, { error: 'plan_not_payable' }, 'plan_not_payable'],
    [500, { error: 'some_internal_code' }, 'network'],
  ])('HTTP %i %j → 错误 %s', async (status, body, expected) => {
    respond(status as number, body)
    const pay = usePayment()
    expect(await pay.create('plus_monthly', 'alipay')).toBeNull()
    expect(pay.error.value).toBe(expected)
  })

  it('未登录（无 token）→ unauthorized，且不发请求', async () => {
    authDriver.getApiToken.mockResolvedValueOnce('')
    const pay = usePayment()
    expect(await pay.create('plus_monthly', 'wechat')).toBeNull()
    expect(pay.error.value).toBe('unauthorized')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('非 CloudBase 形态 → not_configured，且不发请求', async () => {
    cb.isCloudBaseBackend.mockReturnValue(false)
    const pay = usePayment()
    expect(await pay.create('plus_monthly', 'wechat')).toBeNull()
    expect(pay.error.value).toBe('not_configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('网络异常（fetch 抛出）→ network，creating 复位', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const pay = usePayment()
    expect(await pay.create('plus_monthly', 'wechat')).toBeNull()
    expect(pay.error.value).toBe('network')
    expect(pay.creating.value).toBe(false)
  })
})

describe('usePayment.checkStatus / startPolling — 查单与轮询', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('查单失败（body.ok false）返回 null，不改动已有订单', async () => {
    respond(200, ORDER)
    const pay = usePayment()
    await pay.create('plus_monthly', 'wechat')
    respond(200, { ok: false, error: 'order_not_found' })
    expect(await pay.checkStatus('ord_1')).toBeNull()
    expect(pay.order.value?.status).toBe('pending')
  })

  it('轮询：pending → paid 时回调一次并停止轮询', async () => {
    respond(200, ORDER)
    const pay = usePayment()
    await pay.create('plus_monthly', 'wechat')
    respond(200, { ok: true, order: { ...ORDER, status: 'pending' } })
    respond(200, { ok: true, order: { ...ORDER, status: 'paid' } })
    const onPaid = vi.fn()
    pay.startPolling(onPaid)
    expect(pay.polling.value).toBe(true)

    await vi.advanceTimersByTimeAsync(2000) // 第 1 次查单：pending
    expect(onPaid).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000) // 第 2 次查单（退避 ×1.5）：paid
    expect(onPaid).toHaveBeenCalledTimes(1)
    expect(onPaid.mock.calls[0][0]).toMatchObject({ orderId: 'ord_1', status: 'paid' })
    expect(pay.polling.value).toBe(false)
    expect(pay.isPaid.value).toBe(true)

    const calls = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetchMock.mock.calls.length).toBe(calls) // 已停止，不再查单
    const statusBodies = fetchMock.mock.calls.slice(1).map(([, init]) => JSON.parse(init.body))
    expect(statusBodies.every((b) => b.action === 'status' && b.orderId === 'ord_1')).toBe(true)
  })

  it('轮询：订单 failed → 停止且不回调', async () => {
    respond(200, ORDER)
    const pay = usePayment()
    await pay.create('plus_monthly', 'wechat')
    respond(200, { ok: true, order: { ...ORDER, status: 'failed' } })
    const onPaid = vi.fn()
    pay.startPolling(onPaid)
    await vi.advanceTimersByTimeAsync(2000)
    expect(onPaid).not.toHaveBeenCalled()
    expect(pay.polling.value).toBe(false)
  })
})
