/**
 * 续费提醒纯函数（不依赖 Vue / Pinia，便于单测）
 *
 * 背景：所有档位都不自动续费，季付用户每 3 个月都要自己决定续不续——这是流失最集中、
 * 也最适合推荐年付的时刻。服务端 settle_paid_order 在权益未到期时把新周期叠加在原到期日
 * 之后（expires_at + period_days），所以提前续费不浪费剩余天数；提醒与购买弹窗都要把这点讲明白。
 *
 * 提醒节奏：到期前 7 天内提醒一次（week 阶段），最后 1 天再提醒一次（final 阶段）；
 * 用户关闭后同一到期日的同一阶段不再出现，最多打扰两次。
 */

/** 到期前多少天开始提醒 */
export const RENEWAL_REMIND_DAYS = 7
/** 进入「最后提醒」阶段的剩余天数 */
export const RENEWAL_FINAL_DAYS = 1

const DAY_MS = 86_400_000
const DISMISS_KEY_PREFIX = 'ulink_renewal_dismissed:'

export type RenewalStage = 'week' | 'final'

/** 剩余天数（向上取整：还剩 2 小时也算 1 天）；无到期日、无法解析或已过期返回 null */
export function daysUntilExpiry(expiresAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!expiresAt) return null
  const t = new Date(expiresAt).getTime()
  if (!Number.isFinite(t)) return null
  const diff = t - now
  if (diff <= 0) return null
  return Math.ceil(diff / DAY_MS)
}

/** 当前所处的提醒阶段；不在提醒窗口内返回 null */
export function renewalStage(daysLeft: number | null): RenewalStage | null {
  if (daysLeft === null || daysLeft > RENEWAL_REMIND_DAYS) return null
  return daysLeft <= RENEWAL_FINAL_DAYS ? 'final' : 'week'
}

/** 关闭记录的存储键：按到期日 + 阶段区分，续费后到期日变化即自动失效 */
export function renewalDismissKey(expiresAt: string, stage: RenewalStage): string {
  return `${DISMISS_KEY_PREFIX}${expiresAt}:${stage}`
}

export interface RenewalReminderInput {
  isPaid: boolean
  expiresAt: string | null | undefined
  now?: number
  /** 该键是否已被用户关闭过 */
  isDismissed: (key: string) => boolean
}

export interface RenewalReminder {
  daysLeft: number
  stage: RenewalStage
  dismissKey: string
}

/** 是否应显示续费提醒；需要显示时返回剩余天数、阶段与关闭键 */
export function computeRenewalReminder(input: RenewalReminderInput): RenewalReminder | null {
  if (!input.isPaid || !input.expiresAt) return null
  const daysLeft = daysUntilExpiry(input.expiresAt, input.now)
  const stage = renewalStage(daysLeft)
  if (daysLeft === null || stage === null) return null
  const dismissKey = renewalDismissKey(input.expiresAt, stage)
  if (input.isDismissed(dismissKey)) return null
  return { daysLeft, stage, dismissKey }
}
