import { describe, it, expect } from 'vitest'
import { formatLocalMoment, timeZoneLabel, browserTimeZone } from '../../lib/quotaTime.js'

describe('quotaTime — 额度恢复时刻的本地化展示', () => {
  // 用本地时间构造日期，测试与运行环境时区无关
  const now = new Date(2026, 10, 27, 15, 30)

  it('同一天 → 今天 HH:mm；次日 → 明天 HH:mm；更远 → 月日 HH:mm', () => {
    expect(formatLocalMoment(new Date(2026, 10, 27, 18, 0).toISOString(), now)).toBe('今天 18:00')
    expect(formatLocalMoment(new Date(2026, 10, 28, 0, 0).toISOString(), now)).toBe('明天 00:00')
    const far = formatLocalMoment(new Date(2026, 11, 1, 8, 5).toISOString(), now)
    expect(far).toContain('08:05')
    expect(far).toMatch(/12/)
  })

  it('跨月的「明天」也能识别', () => {
    const endOfMonth = new Date(2026, 10, 30, 22, 0)
    expect(formatLocalMoment(new Date(2026, 11, 1, 0, 0).toISOString(), endOfMonth)).toBe('明天 00:00')
  })

  it('空值 / 非法时间返回空串，由调用方回退固定说法', () => {
    expect(formatLocalMoment(undefined, now)).toBe('')
    expect(formatLocalMoment('not-a-date', now)).toBe('')
  })

  it('timeZoneLabel：可解析的时区给出名称或偏移，非法时区回退原样', () => {
    const label = timeZoneLabel('Asia/Shanghai')
    expect(label.length).toBeGreaterThan(0)
    expect(label).not.toBe('')
    expect(timeZoneLabel('Not/AZone')).toBe('Not/AZone')
    expect(timeZoneLabel('')).toBe('')
  })

  it('browserTimeZone 返回 IANA 名称', () => {
    expect(browserTimeZone()).toMatch(/^[A-Za-z_]+(\/[A-Za-z_+-]+)*$|^UTC$/)
  })
})
