/**
 * useTransactions —— 用户交易记录查询与分页管理
 *
 * 聚合订单明细（微信支付、支付宝、兑换码兑换、赠送额度）：
 *   - 交易时间、订单编号、交易金额、交易类型、支付方式、交易状态、备注
 *   - 支持分页加载、一键刷新与复制订单编号
 */
import { ref, computed } from 'vue'
import { edgeFnUrl } from '../../lib/cloudbase.js'
import { getApiToken } from '../../lib/authDriver.js'

export interface TransactionItem {
  orderId: string
  channelOrderId?: string | null
  createdAt: string
  paidAt?: string | null
  amountYen: string
  amountCents: number
  currency: string
  type: 'purchase' | 'redeem' | 'gift'
  typeLabel: string
  channel: string
  channelLabel: string
  status: 'paid' | 'pending' | 'failed' | 'refunded'
  statusLabel: string
  planId: string
  planName: string
  notes?: string
}

const transactions = ref<TransactionItem[]>([])
const loading = ref(false)
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const lastFetchedAt = ref(0)

export function formatTxTime(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function useTransactions() {
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const hasPrev = computed(() => page.value > 1)
  const hasNext = computed(() => page.value < totalPages.value)

  async function fetchTransactions(targetPage?: number): Promise<{ list: TransactionItem[]; total: number }> {
    if (typeof targetPage === 'number') {
      page.value = Math.max(1, targetPage)
    }
    loading.value = true
    try {
      const endpoint = edgeFnUrl('pay')
      const token = await getApiToken()
      if (!endpoint || !token) {
        return { list: transactions.value, total: total.value }
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'transactions',
          offset: (page.value - 1) * pageSize.value,
          limit: pageSize.value,
        }),
      })

      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        list?: TransactionItem[]
        total?: number
      }

      if (body.ok && Array.isArray(body.list)) {
        transactions.value = body.list
        total.value = typeof body.total === 'number' ? body.total : body.list.length
        lastFetchedAt.value = Date.now()
        return { list: body.list, total: total.value }
      }
    } catch (e) {
      console.warn('[transactions] fetch failed:', e)
    } finally {
      loading.value = false
    }
    return { list: transactions.value, total: total.value }
  }

  function setPage(p: number) {
    if (p < 1) return
    const maxPage = Math.max(1, Math.ceil(total.value / pageSize.value))
    if (p > maxPage) return
    page.value = p
    return fetchTransactions(p)
  }

  function nextPage() {
    if (!hasNext.value) return
    return setPage(page.value + 1)
  }

  function prevPage() {
    if (!hasPrev.value) return
    return setPage(page.value - 1)
  }

  return {
    transactions,
    loading,
    total,
    page,
    pageSize,
    totalPages,
    hasPrev,
    hasNext,
    lastFetchedAt,
    fetchTransactions,
    setPage,
    nextPage,
    prevPage,
    formatTxTime,
  }
}
