/**
 * historyMax.test.ts — clampHistoryMax 域值截断护栏
 *
 * 锁闭区间 [5, 30] 截断语义 + 严格边界 + NaN 传播真实行为 + 纯函数不变量。
 * 防未来误改：下界改 <5 / 上界漏 30 / `>=` 漂移 / 加 Number.isFinite 把 NaN 稳成 5。
 */
import { describe, it, expect } from 'vitest'
import { clampHistoryMax } from '../../lib/historyMax.js'

describe('clampHistoryMax — 版本历史保留条数上限域值截断', () => {
  it('下界 5：恰在边界原样返回', () => {
    expect(clampHistoryMax(5)).toBe(5)
  })

  it('上界 30：恰在边界原样返回', () => {
    expect(clampHistoryMax(30)).toBe(30)
  })

  it('区间内合规值原样透传', () => {
    expect(clampHistoryMax(20)).toBe(20)
    expect(clampHistoryMax(10)).toBe(10)
    expect(clampHistoryMax(29)).toBe(29)
    expect(clampHistoryMax(6)).toBe(6)
  })

  it('0 夹回下界 5（防历史不足致不可回滚）', () => {
    expect(clampHistoryMax(0)).toBe(5)
  })

  it('负数夹回下界 5', () => {
    expect(clampHistoryMax(-1)).toBe(5)
    expect(clampHistoryMax(-100)).toBe(5)
  })

  it('超上界 31 夹回 30（防 localStorage 历史雪崩膨胀）', () => {
    expect(clampHistoryMax(31)).toBe(30)
  })

  it('超大值（如 1e9/5_000_000）夹回 30', () => {
    expect(clampHistoryMax(5_000_000)).toBe(30)
    expect(clampHistoryMax(1_000_000_000)).toBe(30)
  })

  it('小数向下夹回下界 5（Math.max(5, 0.5)=5，非四舍五入）', () => {
    expect(clampHistoryMax(0.5)).toBe(5)
    expect(clampHistoryMax(4.99)).toBe(5)
    expect(clampHistoryMax(5.5)).toBe(5.5)
    expect(clampHistoryMax(29.5)).toBe(29.5)
  })

  it('NaN 传播：入参 NaN 返回 NaN（现行真实行为，防误加 Number.isFinite 早退稳成 5）', () => {
    const r = clampHistoryMax(NaN)
    expect(Number.isNaN(r)).toBe(true)
  })

  it('Infinity 经 Math.max 留 Infinity 再被 Math.min(30,...) 夹回 30', () => {
    // Math.max(5, Infinity)=Infinity，Math.min(30, Infinity)=30 → 夹上界
    expect(clampHistoryMax(Number.POSITIVE_INFINITY)).toBe(30)
  })

  it('-Infinity 经 Math.max(5,-Infinity)=5，再 Math.min(30,5)=5 → 夹下界', () => {
    expect(clampHistoryMax(Number.NEGATIVE_INFINITY)).toBe(5)
  })

  it('纯函数全局：同入参多次调用恒定', () => {
    const a = clampHistoryMax(15)
    const b = clampHistoryMax(15)
    const c = clampHistoryMax(15)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('返回恒为 number 类型', () => {
    expect(typeof clampHistoryMax(10)).toBe('number')
    expect(typeof clampHistoryMax(NaN)).toBe('number')
  })
})
