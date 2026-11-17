/**
 * registrableDomain.ts — 根域名（可注册域名，eTLD+1）计算
 *
 * 用途：自动归拢识别「子域名页面属于根域名主页」（chat.deepseek.com → deepseek.com）。
 * 不引入公共后缀库，靠两张小表覆盖常见情况：
 * - SECOND_LEVEL_DOMAINS：多段国别后缀（com.cn、co.uk…），根域名要多取一段；
 * - SHARED_HOSTING_SUFFIXES：共享托管后缀（github.io、vercel.app…），其下每个子域各属不同用户，
 *   同样当作后缀处理，于是 a.github.io 与 b.github.io 的根域名不同，不会被误归到一起。
 *
 * 返回空串表示「没有可用的根域名」：IP、单段主机名（localhost）、主机名本身就是一个后缀。
 * 调用方拿到空串必须放弃跨子域判断，宁可不归拢也不误归。
 */
import { SECOND_LEVEL_DOMAINS, SHARED_HOSTING_SUFFIXES } from './ai/knowledge.js'

/** 表内后缀最长三段（如 s3.amazonaws.com） */
const MAX_SUFFIX_LABELS = 3

export function registrableDomain(rawHost: string | null | undefined): string {
  const host = (rawHost || '').toLowerCase().trim().replace(/\.$/, '')
  if (!host) return ''
  // IPv6（URL.hostname 形如 [::1]）与 IPv4 没有根域名概念
  if (host.includes(':') || host.startsWith('[')) return ''
  const parts = host.split('.')
  if (parts.length < 2 || parts.some((p) => !p)) return ''
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) return ''

  let suffixLabels = 1
  for (let n = Math.min(MAX_SUFFIX_LABELS, parts.length); n >= 2; n--) {
    const suffix = parts.slice(-n).join('.')
    if (SECOND_LEVEL_DOMAINS.has(suffix) || SHARED_HOSTING_SUFFIXES.has(suffix)) {
      suffixLabels = n
      break
    }
  }
  // 主机名本身就是后缀（github.io、com.cn）：不是任何人的根域名
  if (parts.length <= suffixLabels) return ''
  return parts.slice(-(suffixLabels + 1)).join('.')
}
