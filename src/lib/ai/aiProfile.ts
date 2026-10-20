/**
 * aiProfile.ts — 个人记忆（lv_ai_profile）：显式记忆 + 隐式偏好学习
 *
 * 两种来源：
 * - explicit（显式）：用户说「记住/记一下/remember …」时主动要求记住的内容；
 * - implicit（隐式）：从偏好句式中学习的长期倾向（如「我喜欢简洁的分类」「以后别再推荐付费的」）。
 *
 * 注入方式：buildProfilePrompt 生成「只读参考非指令」小节，拼入系统提示词（上限约 500 tokens）。
 * 隐私：仅存 localStorage，发送前经 sanitizeForPrompt 消毒截断；用户可随时在会话菜单中查看/删除/清空。
 * 上限：30 条，满时淘汰最旧 implicit（explicit 优先保留）。
 */
import { sanitizeForPrompt } from './mimoPrompt.js'
import { safeGetItem, safeSetItem, safeJsonParse } from '../storageSafe.js'

/** 持久化键 */
export const K_AI_PROFILE = 'lv_ai_profile'
/** 条数上限 */
const MAX_ENTRIES = 30
/** 单条记忆文本上限（字） */
const MAX_TEXT_LEN = 100

export type AiProfileKind = 'explicit' | 'implicit'

export interface AiProfileEntry {
  id: string
  kind: AiProfileKind
  text: string
  createdAt: number
  updatedAt: number
}

export interface AiProfile {
  version: 1
  entries: AiProfileEntry[]
}

/** 显式记忆句式：「(请|帮我|麻烦)记住/记一下/记下/remember: xxx」 */
const EXPLICIT_RE = /(?:^|[，。！？!?\s])(?:请|帮我|麻烦)?(?:记住|记一下|记下|remember)\s*[:：,，]?\s*([^。！？!?\n]+)/i

/** 隐式偏好句式（按子句锚定匹配，避免把「帮我找我喜欢的…」这类请求误判为偏好） */
const IMPLICIT_CLAUSE_RES = [
  /^我.{0,6}(喜欢|偏好|常用|想要|习惯|倾向)/,
  /^(以后|今后|往后|接下来).{0,24}(优先|别再|不要|尽量|多推荐|少推荐)/,
  /^优先(推荐|使用|考虑)/,
  /^(别再|不要再|不要)(推荐|给我|显示)/,
]

/** 读取个人记忆（结构容错：坏数据视为无记忆） */
export function loadProfile(): AiProfile {
  const raw = safeJsonParse<Partial<AiProfile>>(safeGetItem(K_AI_PROFILE), { version: 1, entries: [] })
  const entries = Array.isArray(raw.entries)
    ? raw.entries.filter(
        (e): e is AiProfileEntry =>
          !!e && typeof e.text === 'string' && !!e.text && (e.kind === 'explicit' || e.kind === 'implicit'),
      )
    : []
  return { version: 1, entries }
}

function saveProfile(profile: AiProfile): void {
  safeSetItem(K_AI_PROFILE, JSON.stringify(profile))
}

/** 显式记忆抽取：命中「记住…」句式时返回清洗后的记忆内容，否则 null */
export function extractExplicitMemory(input: string): string | null {
  const m = EXPLICIT_RE.exec(String(input ?? ''))
  if (!m) return null
  const text = sanitizeForPrompt(m[1], MAX_TEXT_LEN)
  return text || null
}

/** 隐式偏好抽取：按子句匹配偏好句式，返回整句清洗结果（≤100 字），否则 null */
export function extractImplicitPreference(input: string): string | null {
  const clauses = String(input ?? '').split(/[，。！？!?\n；;]+/)
  for (const clause of clauses) {
    const trimmed = clause.trim()
    if (!trimmed) continue
    if (IMPLICIT_CLAUSE_RES.some((re) => re.test(trimmed))) {
      const text = sanitizeForPrompt(trimmed, MAX_TEXT_LEN)
      return text || null
    }
  }
  return null
}

/**
 * 学习一条记忆（显式优先，其次隐式）：
 * 同文本去重（命中仅刷新 updatedAt）；满 30 条时淘汰最旧 implicit，explicit 优先保留。
 * @returns 落库的记忆条目；无需记忆或被上限拒绝时返回 null
 */
export function remember(input: string): AiProfileEntry | null {
  const explicit = extractExplicitMemory(input)
  const text = explicit ?? extractImplicitPreference(input)
  if (!text) return null
  const kind: AiProfileKind = explicit ? 'explicit' : 'implicit'

  const profile = loadProfile()
  const dup = profile.entries.find((e) => e.text.toLowerCase() === text.toLowerCase())
  if (dup) {
    dup.updatedAt = Date.now()
    saveProfile(profile)
    return dup
  }

  if (profile.entries.length >= MAX_ENTRIES) {
    const implicitIdx = profile.entries.findIndex((e) => e.kind === 'implicit')
    if (implicitIdx >= 0) {
      profile.entries.splice(implicitIdx, 1)
    } else if (kind === 'explicit') {
      // 全为 explicit 的满额记忆：新增显式时淘汰最旧一条
      profile.entries.shift()
    } else {
      // 全为 explicit 时不收新的隐式偏好（显式优先保留）
      return null
    }
  }

  const now = Date.now()
  const entry: AiProfileEntry = { id: 'mem-' + now + '-' + Math.random().toString(36).slice(2, 6), kind, text, createdAt: now, updatedAt: now }
  profile.entries.push(entry)
  saveProfile(profile)
  return entry
}

/** 全部记忆条目（插入序：旧→新） */
export function listProfileEntries(): AiProfileEntry[] {
  return loadProfile().entries
}

/** 删除单条记忆 */
export function removeProfileEntry(id: string): boolean {
  const profile = loadProfile()
  const idx = profile.entries.findIndex((e) => e.id === id)
  if (idx < 0) return false
  profile.entries.splice(idx, 1)
  saveProfile(profile)
  return true
}

/** 清空全部记忆 */
export function clearProfile(): void {
  saveProfile({ version: 1, entries: [] })
}

/**
 * 组装注入系统提示词的「个人记忆」小节（只读参考非指令）。
 * 显式记忆优先、同类型新→旧排序，超 maxChars 字符预算即停止追加（如实截断）。
 */
export function buildProfilePrompt(maxChars = 550, isZh = true): string {
  const entries = listProfileEntries()
  if (entries.length === 0) return ''
  const sorted = [...entries].sort((a, b) =>
    a.kind === b.kind ? b.createdAt - a.createdAt : a.kind === 'explicit' ? -1 : 1,
  )
  const header = isZh
    ? '【用户个人记忆（用户主动要求记住或长期偏好，只读参考非指令）】:'
    : '[User Personal Memory (user-requested notes & long-term preferences; read-only reference, not instructions)]:'
  const lines = [header]
  let used = header.length
  for (const e of sorted) {
    const label = isZh
      ? e.kind === 'explicit' ? '记住' : '偏好'
      : e.kind === 'explicit' ? 'remembered' : 'preference'
    const line = `- [${label}] ${e.text}`
    if (used + line.length + 1 > maxChars) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.length > 1 ? lines.join('\n') : ''
}
