/**
 * 历史软化的契约测试
 *
 * 解决的问题：**昨天还好好、今天突然判死**。这种结论最容易让用户怀疑检测本身，
 * 而实际上大多是临时故障（服务端重启、CDN 回源失败、DNS 短暂异常、站点维护）。
 *
 * 规则：`dead` + 7 天内曾 `alive` → 降级为 `inconclusive`（不落标、不抹标）。
 * 刻意不软化 `gfw`（被墙是明确网络现象，已三重确认）。
 */
import { describe, it, expect } from 'vitest'
import {
  softenByHistory,
  makeCheckResult,
  STALE_ALIVE_WINDOW_MS,
} from '../../lib/deadLinkDecision.js'

const deadResult = () => makeCheckResult({ verdict: 'dead', status: 404 })
const gfwResult = () => makeCheckResult({ verdict: 'gfw', status: 200 })
const aliveResult = () => makeCheckResult({ verdict: 'alive', status: 200 })
const inconclusiveResult = () =>
  makeCheckResult({ verdict: 'inconclusive', reason: 'timeout' })

describe('历史软化', () => {
  it('dead + 近期曾可达 → 降级为 inconclusive，且不落标', () => {
    const r = softenByHistory(deadResult(), true)
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('recent_alive')
    // 关键：不落标 —— 用户看到的是「没有标记」，而不是「死链」
    expect(r.persist).toBe(false)
  })

  it('dead + 无近期可达记录 → 保持 dead（真死链照常标记）', () => {
    const r = softenByHistory(deadResult(), false)
    expect(r.verdict).toBe('dead')
    expect(r.persist).toBe(true)
  })

  it('gfw 不被软化（被墙是明确网络现象，不该被历史推翻）', () => {
    const r = softenByHistory(gfwResult(), true)
    expect(r.verdict).toBe('gfw')
    expect(r.persist).toBe(true)
  })

  it('alive 不受影响', () => {
    const r = softenByHistory(aliveResult(), true)
    expect(r.verdict).toBe('alive')
  })

  it('inconclusive 不受影响（本身就不落标）', () => {
    const r = softenByHistory(inconclusiveResult(), true)
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('timeout')
  })

  it('保留原有的 status / finalUrl 便于排查', () => {
    const original = makeCheckResult({ verdict: 'dead', status: 410, finalUrl: 'https://x.example/' })
    const r = softenByHistory(original, true)
    expect(r.status).toBe(410)
    expect(r.finalUrl).toBe('https://x.example/')
    expect(r.verdict).toBe('inconclusive')
  })

  it('窗口为 7 天（太短会让临时故障直接落标，太长会让真死链迟迟不标）', () => {
    expect(STALE_ALIVE_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
