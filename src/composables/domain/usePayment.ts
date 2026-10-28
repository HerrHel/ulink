/**
 * usePayment —— 支付下单 / 查单 / 轮询
 *
 * 与 `useRedeem` 同款调用方式（CloudBase 云函数 + Bearer token），
 * 保证鉴权与错误处理风格一致。
 *
 * 约定：
 *   · 金额一律以**服务端返回**为准（`amountCents`），前端只做展示，不参与计算；
 *   · 通道未配置时后端回 503 `channel_not_configured`，前端应展示「即将开放」而非报错；
 *   · 轮询采用 2s 起、指数退避到 10s，到 `expiresAt` 即停（避免用户关掉页面还在跑请求）。
 */

import { ref, computed, readonly } from 'vue'
import { edgeFnUrl, isCloudBaseBackend } from '../../lib/cloudbase.js'
import { getApiToken } from '../../lib/authDriver.js'

export type PaymentChannel = 'wechat' | 'alipay'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'

export interface PaymentOrder {
  orderId: string
  planId: string
  amountCents: number
  channel: PaymentChannel
  status: PaymentStatus
  qrCode: string | null
  expiresAt: string | null
}

/** 前端可识别的失败原因（映射到 i18n 文案，不直接展示后端英文码） */
export type PaymentError =
  | 'not_configured' // 后端/函数未配置
  | 'channel_not_configured' // 该渠道商户号还没配
  | 'unauthorized' // 未登录 / token 失效
  | 'rate_limited'
  | 'plan_not_payable'
  | 'plan_not_found'
  | 'order_not_found'
  | 'channel_error'
  | 'network'
  | 'unknown'

interface RawOrder {
  orderId?: string
  planId?: string
  amountCents?: number
  channel?: PaymentChannel
  status?: PaymentStatus
  qrCode?: string | null
  expiresAt?: string | null
}

function normalizeOrder(raw: RawOrder | undefined | null): PaymentOrder | null {
  if (!raw?.orderId) return null
  return {
    orderId: raw.orderId,
    planId: raw.planId || '',
    amountCents: typeof raw.amountCents === 'number' ? raw.amountCents : 0,
    channel: raw.channel === 'alipay' ? 'alipay' : 'wechat',
    status: (raw.status as PaymentStatus) || 'pending',
    qrCode: raw.qrCode ?? null,
    expiresAt: raw.expiresAt ?? null,
  }
}

async function currentToken(): Promise<string> {
  return getApiToken()
}

/** 把后端错误码/HTTP 状态收敛成前端可展示的枚举 */
function toPaymentError(code: string | undefined, status: number): PaymentError {
  if (status === 401) return 'unauthorized'
  if (status === 429) return 'rate_limited'
  if (status === 503) return code === 'channel_not_configured' ? 'channel_not_configured' : 'not_configured'
  if (status === 502) return 'channel_error'
  if (code && code in ERROR_SET) return code as PaymentError
  return 'network'
}

const ERROR_SET: Record<string, true> = {
  not_configured: true,
  channel_not_configured: true,
  unauthorized: true,
  rate_limited: true,
  plan_not_payable: true,
  plan_not_found: true,
  order_not_found: true,
  channel_error: true,
}

export function usePayment() {
  const creating = ref(false)
  const checking = ref(false)
  const polling = ref(false)
  const error = ref<PaymentError | null>(null)
  const order = ref<PaymentOrder | null>(null)

  const isPaid = computed(() => order.value?.status === 'paid')
  const expired = computed(() => {
    const at = order.value?.expiresAt
    if (!at) return false
    const t = new Date(at).getTime()
    return Number.isFinite(t) && t < Date.now()
  })

  let pollTimer: ReturnType<typeof setTimeout> | null = null

  function stopPolling() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    polling.value = false
  }

  function reset() {
    stopPolling()
    order.value = null
    error.value = null
    creating.value = false
    checking.value = false
  }

  /** 下单：返回订单（含二维码），失败返回 null 并设置 error */
  async function create(planId: string, channel: PaymentChannel): Promise<PaymentOrder | null> {
    error.value = null
    if (!isCloudBaseBackend()) {
      error.value = 'not_configured'
      return null
    }
    const endpoint = edgeFnUrl('pay')
    if (!endpoint) {
      error.value = 'not_configured'
      return null
    }
    const token = await currentToken()
    if (!token) {
      error.value = 'unauthorized'
      return null
    }

    creating.value = true
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'create', planId, channel }),
      })
      const body = (await res.json().catch(() => ({}))) as RawOrder & { error?: string; ok?: boolean }
      if (!res.ok || body.ok !== true) {
        error.value = toPaymentError(body.error, res.status)
        return null
      }
      const o = normalizeOrder(body)
      order.value = o
      return o
    } catch {
      error.value = 'network'
      return null
    } finally {
      creating.value = false
    }
  }

  /** 查单（sync=true 时后端会主动查渠道，用于回调延迟的兜底） */
  async function checkStatus(orderId: string, sync = false): Promise<PaymentOrder | null> {
    if (!isCloudBaseBackend()) return null
    const endpoint = edgeFnUrl('pay')
    if (!endpoint) return null
    const token = await currentToken()
    if (!token) return null

    checking.value = true
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'status', orderId, sync }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        order?: RawOrder
        error?: string
      }
      if (!res.ok || body.ok !== true) return null
      const o = normalizeOrder(body.order)
      if (o) order.value = o
      return o
    } catch {
      return null
    } finally {
      checking.value = false
    }
  }

  /**
   * 开始轮询直到 paid / failed / 过期 / 主动停止。
   * 间隔 2s 起，每次 ×1.5，上限 10s；每第 3 次带 sync=true（避免频繁打渠道查单接口）。
   */
  function startPolling(onPaid?: (o: PaymentOrder) => void): void {
    const current = order.value
    if (!current) return
    stopPolling()
    polling.value = true

    let delay = 2000
    let ticks = 0
    const deadline = current.expiresAt ? new Date(current.expiresAt).getTime() : Date.now() + 30 * 60000

    const tick = async () => {
      pollTimer = null
      if (!polling.value) return
      if (Date.now() > deadline) {
        stopPolling()
        return
      }
      ticks += 1
      const o = await checkStatus(current.orderId, ticks % 3 === 0)
      if (!polling.value) return
      if (o?.status === 'paid') {
        stopPolling()
        onPaid?.(o)
        return
      }
      if (o?.status === 'failed' || o?.status === 'refunded') {
        stopPolling()
        return
      }
      delay = Math.min(Math.round(delay * 1.5), 10000)
      if (polling.value) pollTimer = setTimeout(tick, delay)
    }

    pollTimer = setTimeout(tick, delay)
  }

  return {
    creating: readonly(creating),
    checking: readonly(checking),
    polling: readonly(polling),
    error: readonly(error),
    order: readonly(order),
    isPaid,
    expired,
    create,
    checkStatus,
    startPolling,
    stopPolling,
    reset,
  }
}
