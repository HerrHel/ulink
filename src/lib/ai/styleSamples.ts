/**
 * styleSamples.ts — AI 预填「模仿我的写法」：从用户自己写过的书签备注里挑风格样本。
 *
 * 发给 extract-metadata 的样本只用于模仿长度 / 语气 / 句式，不用于事实推断。
 * 选样规则（宁缺毋滥，样本不像用户本人写的就会把风格带偏）：
 *  - 只取未删除、备注为单行短句（2～80 字）的书签；
 *  - 排除未改动过的示例数据（id 属于默认示例且备注与默认值一致）与官网书签（bm_ulink_*）；
 *  - 排除 AI 预填后用户原样保存的备注（rememberAiSuggestion 记下的建议文本）——
 *    否则 AI 会越学越像自己，而不是像用户；
 *  - 按最近更新优先，最多 8 条。
 * 开关：设置「AI 预填模仿我的写法」（UI 状态 aiStyleAdapt，默认开启）；AI 总开关关闭时整体不发请求。
 */
import { UI_STATE_KEY, DEFAULTS, buildSeedDefaults } from '../../config/constants.js'
import { safeGetItem, safeSetItem, safeJsonParse } from '../storageSafe.js'
import type { Bookmark } from '../../types.js'

export const MAX_STYLE_SAMPLES = 8
const MIN_LEN = 2
const MAX_LEN = 80
const AI_SUGGESTION_KEY = 'lv_ai_note_suggestions'
const MAX_REMEMBERED = 300

/** 读取「AI 预填模仿我的写法」开关（默认开启；读不到状态视为开启） */
export function isAiStyleAdaptEnabled(): boolean {
  try {
    const raw = safeGetItem(UI_STATE_KEY)
    if (!raw) return true
    const state = JSON.parse(raw) as { aiStyleAdapt?: unknown } | null
    return typeof state?.aiStyleAdapt === 'boolean' ? state.aiStyleAdapt : true
  } catch {
    return true
  }
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

function readRemembered(): string[] {
  const list = safeJsonParse<string[] | null>(safeGetItem(AI_SUGGESTION_KEY), null)
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []
}

/** 记下一条 AI 给出的备注建议：之后若用户原样保存，它不会被当作用户的写法 */
export function rememberAiSuggestion(text: string | undefined | null): void {
  const t = norm(String(text ?? ''))
  if (!t) return
  const list = readRemembered().filter((x) => x !== t)
  list.push(t)
  safeSetItem(AI_SUGGESTION_KEY, JSON.stringify(list.slice(-MAX_REMEMBERED)))
}

let _seedNotes: Map<string, Set<string>> | null = null
/** 示例数据 id → 各语言默认备注（用户未改动过的示例备注不算用户写法） */
function seedNotes(): Map<string, Set<string>> {
  if (_seedNotes) return _seedNotes
  const m = new Map<string, Set<string>>()
  const add = (bms: Bookmark[]) => {
    for (const b of bms) {
      if (!m.has(b.id)) m.set(b.id, new Set())
      m.get(b.id)!.add(norm(b.notes || ''))
    }
  }
  try { add(DEFAULTS.bookmarks) } catch { /* 常量不可用（如被测试整体 mock）时不排除示例 */ }
  try { add(buildSeedDefaults('zh-CN').bookmarks) } catch { /* 种子构建失败时仅用静态默认 */ }
  try { add(buildSeedDefaults('en-US').bookmarks) } catch { /* 同上 */ }
  _seedNotes = m
  return m
}

/** 从书签库挑选用户自己写的备注作为风格样本（开关关闭时返回空数组） */
export function collectStyleSamples(bookmarks: Bookmark[], max = MAX_STYLE_SAMPLES): string[] {
  if (!isAiStyleAdaptEnabled()) return []
  const remembered = new Set(readRemembered())
  const seeds = seedNotes()
  const picked: string[] = []
  const sorted = [...bookmarks].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  for (const b of sorted) {
    if (b.deletedAt || b.id.startsWith('bm_ulink_')) continue
    const raw = String(b.notes || '')
    if (/[\r\n]/.test(raw.trim())) continue // 多行笔记不像「一句话备注」，不作样本
    const note = norm(raw)
    if (note.length < MIN_LEN || note.length > MAX_LEN) continue
    if (seeds.get(b.id)?.has(note)) continue
    if (remembered.has(note)) continue
    if (picked.includes(note)) continue
    picked.push(note)
    if (picked.length >= max) break
  }
  return picked
}

/** 清空「AI 原样建议」记忆（「AI 学到了什么 → 清空」时一并清掉） */
export function clearAiSuggestions(): void {
  safeSetItem(AI_SUGGESTION_KEY, '[]')
}
