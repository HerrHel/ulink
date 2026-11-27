/**
 * quotaTime.ts — 额度时区与恢复时刻的展示工具（纯函数，便于单测）
 * 每日额度按「账号额度时区」的 0 点刷新（服务端 user_quota_tz）；这里负责：
 *   · 读取本设备的 IANA 时区（首次登录上报、设置里「改为当前设备时区」）；
 *   · 把时区渲染成可读名称（「中国标准时间 · GMT+8」）；
 *   · 把服务端给的恢复时刻（绝对时间）换算成**用户本地时间**的说法（「今天 18:00」）。
 */
import { getLocale } from '../i18n/index.js'

/** 本设备的 IANA 时区；取不到返回空串 */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

function localeTag(): string {
  return getLocale() === 'zh-CN' ? 'zh-CN' : 'en-US'
}

function tzPart(zone: string, style: 'longGeneric' | 'shortOffset'): string {
  try {
    const parts = new Intl.DateTimeFormat(localeTag(), { timeZone: zone, timeZoneName: style }).formatToParts(new Date())
    return parts.find((p) => p.type === 'timeZoneName')?.value || ''
  } catch {
    return ''
  }
}

/** 时区可读名：「中国标准时间 · GMT+8」/「Pacific Time · GMT-8」；无法解析时回退为 IANA 名 */
export function timeZoneLabel(zone: string): string {
  if (!zone) return ''
  const name = tzPart(zone, 'longGeneric')
  const offset = tzPart(zone, 'shortOffset')
  if (name && offset && name !== offset) return `${name} · ${offset}`
  return name || offset || zone
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * 恢复时刻 → 本地说法：「今天 18:00」「明天 00:00」「12月1日 08:00」。
 * now 可注入以便测试；iso 非法返回空串。
 */
export function formatLocalMoment(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const tag = localeTag()
  const time = at.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit', hour12: false })
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const zh = tag === 'zh-CN'
  if (dayKey(at) === dayKey(now)) return zh ? `今天 ${time}` : `today ${time}`
  if (dayKey(at) === dayKey(tomorrow)) return zh ? `明天 ${time}` : `tomorrow ${time}`
  const date = at.toLocaleDateString(tag, { month: 'short', day: 'numeric' })
  return `${date} ${time}`
}
