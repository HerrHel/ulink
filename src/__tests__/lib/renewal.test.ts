import { describe, it, expect } from 'vitest'
import {
  daysUntilExpiry,
  renewalStage,
  renewalDismissKey,
  computeRenewalReminder,
  RENEWAL_REMIND_DAYS,
} from '../../lib/renewal.js'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0)
const iso = (ms: number) => new Date(ms).toISOString()

describe('renewal：续费提醒规则', () => {
  it('剩余天数向上取整；无到期日 / 无法解析 / 已过期返回 null', () => {
    expect(daysUntilExpiry(iso(NOW + 3 * DAY), NOW)).toBe(3)
    expect(daysUntilExpiry(iso(NOW + 2 * 3600_000), NOW)).toBe(1)
    expect(daysUntilExpiry(iso(NOW + 6 * DAY + 1), NOW)).toBe(7)
    expect(daysUntilExpiry(null, NOW)).toBeNull()
    expect(daysUntilExpiry('not-a-date', NOW)).toBeNull()
    expect(daysUntilExpiry(iso(NOW - 1), NOW)).toBeNull()
    expect(daysUntilExpiry(iso(NOW), NOW)).toBeNull()
  })

  it('7 天内为 week 阶段，最后 1 天为 final 阶段，超过 7 天不提醒', () => {
    expect(renewalStage(null)).toBeNull()
    expect(renewalStage(RENEWAL_REMIND_DAYS + 1)).toBeNull()
    expect(renewalStage(RENEWAL_REMIND_DAYS)).toBe('week')
    expect(renewalStage(2)).toBe('week')
    expect(renewalStage(1)).toBe('final')
  })

  it('关闭键按到期日 + 阶段区分：续费后到期日变化即重新提醒', () => {
    const a = renewalDismissKey('2026-11-30T00:00:00Z', 'week')
    expect(a).not.toBe(renewalDismissKey('2026-11-30T00:00:00Z', 'final'))
    expect(a).not.toBe(renewalDismissKey('2027-02-28T00:00:00Z', 'week'))
  })

  it('免费用户、无到期日、超出提醒窗口都不提醒', () => {
    const never = () => false
    expect(computeRenewalReminder({ isPaid: false, expiresAt: iso(NOW + 3 * DAY), now: NOW, isDismissed: never })).toBeNull()
    expect(computeRenewalReminder({ isPaid: true, expiresAt: null, now: NOW, isDismissed: never })).toBeNull()
    expect(computeRenewalReminder({ isPaid: true, expiresAt: iso(NOW + 30 * DAY), now: NOW, isDismissed: never })).toBeNull()
  })

  it('窗口内提醒；关闭 week 后进入 final 阶段仍会再提醒一次', () => {
    const exp = iso(NOW + 3 * DAY)
    const dismissed = new Set<string>()
    const isDismissed = (k: string) => dismissed.has(k)

    const week = computeRenewalReminder({ isPaid: true, expiresAt: exp, now: NOW, isDismissed })
    expect(week).toEqual({ daysLeft: 3, stage: 'week', dismissKey: renewalDismissKey(exp, 'week') })
    dismissed.add(week!.dismissKey)
    expect(computeRenewalReminder({ isPaid: true, expiresAt: exp, now: NOW + DAY, isDismissed })).toBeNull()

    const final = computeRenewalReminder({ isPaid: true, expiresAt: exp, now: NOW + 2.5 * DAY, isDismissed })
    expect(final?.stage).toBe('final')
    dismissed.add(final!.dismissKey)
    expect(computeRenewalReminder({ isPaid: true, expiresAt: exp, now: NOW + 2.9 * DAY, isDismissed })).toBeNull()
  })
})
