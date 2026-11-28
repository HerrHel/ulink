/**
 * inboxLlmClassify.ts — 收件箱清零的大模型兜底归类
 * 职责：本地规则（域名历史 / 词表 / 分类名命中）归不进现有分类的书签与笔记组，
 * 交给 MiMo 按「标题 + 域名」在用户现有分类里挑一个；只许选已有分类名，选不出就留空。
 * 隐私红线：只发标题与主机名（不发路径/参数/备注/密码）；私有地址（NAS、内网）只发标题；
 * 密文标题（私密空间）一律不发。任何失败 fail-open 返回空结果，由调用方如实报数。
 */

import type { Category } from '../../types.js'
import { isThreePartCipher } from '../../crypto.js'
import { askMiMoRaw, getMiMoConfig, type MiMoChatMessage } from './mimoClient.js'
import { isPrivateUrl } from './urlGuard.js'

/** 单次最多送审条数：控制 token 与响应时长 */
export const LLM_CLASSIFY_MAX_ITEMS = 80
const TIMEOUT_MS = 30000
const MAX_TITLE_LEN = 80

export interface LlmClassifyItem {
  id: string
  title: string
  url?: string
}

export interface LlmClassifyResult {
  /** 条目 id → 建议分类 id（只含模型给出且确实存在的分类） */
  assignments: Map<string, string>
  /** 实际送审条数（排除密文/空标题等不可外发项后） */
  sentCount: number
  /** 失败原因（未启用 / 网络 / 额度等）；成功为空 */
  error?: string
}

function hostOf(url?: string): string {
  if (!url || isPrivateUrl(url)) return ''
  try {
    return new URL(url.trim()).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

/** 可外发的条目描述：密文/全空返回 null（不送审） */
function describe(item: LlmClassifyItem): string | null {
  const title = item.title && !isThreePartCipher(item.title) ? item.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LEN) : ''
  const host = item.url && !isThreePartCipher(item.url) ? hostOf(item.url) : ''
  if (!title && !host) return null
  return host ? `${title || host} (${host})` : title
}

/** 解析模型回复：取首个合法 JSON 数组，元素形如 {"i":1,"c":"分类名"} */
export function parseLlmClassifyReply(text: string): Array<{ i: number; c: string }> {
  const s = text || ''
  const tryParse = (raw: string): Array<{ i: number; c: string }> | null => {
    try {
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) return null
      return arr
        .filter((x) => x && typeof x === 'object' && Number.isInteger(x.i) && typeof x.c === 'string')
        .map((x) => ({ i: x.i as number, c: (x.c as string).trim() }))
    } catch {
      return null
    }
  }
  // 逐个从 '[' 扫描括号配对（忽略 JSON 字符串内部括号），避免贪婪正则被前后的 [注释]/[1] 截坏
  for (let start = s.indexOf('['); start !== -1; start = s.indexOf('[', start + 1)) {
    let depth = 0
    let inStr = false
    let escaped = false
    for (let pos = start; pos < s.length; pos++) {
      const ch = s[pos]
      if (escaped) { escaped = false; continue }
      if (ch === '\\' && inStr) { escaped = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === '[') depth++
      else if (ch === ']') {
        depth--
        if (depth === 0) {
          const parsed = tryParse(s.slice(start, pos + 1))
          if (parsed) return parsed
          break
        }
      }
    }
  }
  return []
}

export async function classifyWithLlm(
  items: LlmClassifyItem[],
  categories: Category[],
  opts?: { signal?: AbortSignal; isZh?: boolean },
): Promise<LlmClassifyResult> {
  const assignments = new Map<string, string>()
  if (!items.length || !categories.length) return { assignments, sentCount: 0 }
  if (!getMiMoConfig().enabled) return { assignments, sentCount: 0, error: 'disabled' }

  const sendable: Array<{ id: string; text: string }> = []
  for (const it of items) {
    if (sendable.length >= LLM_CLASSIFY_MAX_ITEMS) break
    const text = describe(it)
    if (text) sendable.push({ id: it.id, text })
  }
  if (!sendable.length) return { assignments, sentCount: 0 }

  const byName = new Map<string, string>()
  for (const c of categories) {
    const name = (c.name || '').trim()
    if (name && !isThreePartCipher(name)) byName.set(name.toLowerCase(), c.id)
  }
  const catNames = categories.map((c) => (c.name || '').trim()).filter((n) => n && !isThreePartCipher(n))
  if (!catNames.length) return { assignments, sentCount: 0 }

  const zh = opts?.isZh !== false
  const system = zh
    ? '你是书签归类助手。给你一组「现有分类」和若干编号书签（标题与域名），为每条书签从现有分类里选最合适的一个。' +
      '只能使用给定的分类名原文，不得新造；拿不准就填空字符串。只输出 JSON 数组，形如 [{"i":1,"c":"分类名"}]，不要任何解释。'
    : 'You sort bookmarks. Given the existing categories and numbered bookmarks (title and domain), pick the best existing category for each. ' +
      'Use category names verbatim, never invent new ones; use an empty string when unsure. Output only a JSON array like [{"i":1,"c":"Category"}], no explanation.'
  const user =
    (zh ? '现有分类：' : 'Categories: ') + JSON.stringify(catNames) + '\n' +
    (zh ? '书签：\n' : 'Bookmarks:\n') +
    sendable.map((s, idx) => `${idx + 1}. ${s.text}`).join('\n')
  const messages: MiMoChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  opts?.signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const reply = await askMiMoRaw(messages, { signal: controller.signal, temperature: 0.1 })
    for (const { i, c } of parseLlmClassifyReply(reply)) {
      const target = sendable[i - 1]
      const catId = c ? byName.get(c.toLowerCase()) : undefined
      if (target && catId) assignments.set(target.id, catId)
    }
    return { assignments, sentCount: sendable.length }
  } catch (e) {
    return { assignments, sentCount: sendable.length, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
    opts?.signal?.removeEventListener('abort', onAbort)
  }
}
