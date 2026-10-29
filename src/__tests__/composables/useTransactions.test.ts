import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTransactions, formatTxTime } from '../../composables/domain/useTransactions.js'

describe('useTransactions (用户交易记录与分页)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    const { page, total, transactions } = useTransactions()
    page.value = 1
    total.value = 0
    transactions.value = []
  })

  it('1. 初始状态与分页计算', () => {
    const { transactions, loading, total, page, pageSize, totalPages, hasPrev, hasNext } = useTransactions()
    expect(transactions.value).toEqual([])
    expect(loading.value).toBe(false)
    expect(total.value).toBe(0)
    expect(page.value).toBe(1)
    expect(pageSize.value).toBe(10)
    expect(totalPages.value).toBe(1)
    expect(hasPrev.value).toBe(false)
    expect(hasNext.value).toBe(false)
  })

  it('2. 分页指示器正确计算', () => {
    const { total, pageSize, totalPages, hasPrev, hasNext, page, nextPage, prevPage, setPage } = useTransactions()
    total.value = 25
    pageSize.value = 10
    expect(totalPages.value).toBe(3)
    expect(hasPrev.value).toBe(false)
    expect(hasNext.value).toBe(true)

    page.value = 2
    expect(hasPrev.value).toBe(true)
    expect(hasNext.value).toBe(true)
    nextPage()
    expect(page.value).toBe(3)

    expect(hasPrev.value).toBe(true)
    expect(hasNext.value).toBe(false)
    prevPage()
    expect(page.value).toBe(2)

    // 边界拦截
    setPage(0)
    expect(page.value).toBe(2)
    setPage(4)
    expect(page.value).toBe(2)
  })

  it('3. formatTxTime 准确格式化 ISO 时间为 YYYY-MM-DD HH:mm:ss', () => {
    expect(formatTxTime(null)).toBe('-')
    expect(formatTxTime(undefined)).toBe('-')
    expect(formatTxTime('')).toBe('-')

    const d = new Date(2026, 9, 29, 15, 15, 50) // Month index 9 = October
    const formatted = formatTxTime(d.toISOString())
    expect(formatted).toBe('2026-10-29 15:15:50')
  })

  it('4. fetchTransactions 网络返回空或未配置时优雅降级', async () => {
    const { fetchTransactions, transactions, total } = useTransactions()
    const r = await fetchTransactions()
    expect(r.list).toEqual([])
    expect(r.total).toBe(0)
    expect(transactions.value).toEqual([])
    expect(total.value).toBe(0)
  })
})
