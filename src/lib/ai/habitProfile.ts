/**
 * habitProfile.ts — 「AI 学习我的习惯」：所有调用大模型的入口共用的用户习惯画像。
 *
 * 学什么（按信号强度）：
 *  1. 用户对 AI 结果的修正（最强）：AI 给的标题 / 备注 / 分类被用户改掉 → 记一条 correction；
 *  2. 用户自己写的内容：书签备注（styleSamples.ts）、分组笔记写法、分类命名；
 *  3. 已有画像：mentalModel 的免费 / 直连倾向（发现好站用）。
 *
 * 用在哪：
 *  - 收藏预填 / 批量补齐：buildIntakeHabits → extract-metadata（备注样本、标题改写示例、分类纠正）
 *  - 发现好站：buildCandidatePreferences → ai-candidates（只发白名单偏好键；「已有网站」只在本地过滤，不外发）
 *  - AI 对话 / 编辑器润色：buildChatHabitPrompt → contextSlice.habitPrompt（与发送摘要同源）
 *
 * 隐私：全部端侧计算、只存 localStorage；每个切片有条数与字数上限；开关 = UI 状态 aiStyleAdapt
 * （设置「AI 学习我的习惯」，默认开启）；用户可在「AI 学到了什么」逐条删除或清空。
 */
import { safeGetItem, safeSetItem, safeRemoveItem, safeJsonParse } from '../storageSafe.js'
import { DEFAULTS } from '../../config/constants.js'
import { registrableDomain } from '../registrableDomain.js'
import { collectStyleSamples, isAiStyleAdaptEnabled, clearAiSuggestions, MAX_STYLE_SAMPLES } from './styleSamples.js'
import { buildUserMentalModel } from './mentalModel.js'
import type { Bookmark, Category, SiblingGroup, CustomAttribute } from '../../types.js'

export const K_AI_HABITS = 'lv_ai_habits'
const MAX_CORRECTIONS = 200
const MAX_FIELD_LEN = 80

export type HabitKind = 'title' | 'notes' | 'category'

export interface HabitCorrection {
  id: string
  kind: HabitKind
  /** 网站根域名（如 github.com），用于分类纠正按站点复用 */
  site: string
  ai: string
  user: string
  ts: number
}

interface HabitStore {
  version: 1
  corrections: HabitCorrection[]
}

export { isAiStyleAdaptEnabled as isHabitLearningEnabled }

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_LEN)

function load(): HabitStore {
  const raw = safeJsonParse<Partial<HabitStore> | null>(safeGetItem(K_AI_HABITS), null)
  const list = Array.isArray(raw?.corrections) ? raw!.corrections : []
  return {
    version: 1,
    corrections: list.filter((c): c is HabitCorrection =>
      !!c && typeof c.id === 'string' && (c.kind === 'title' || c.kind === 'notes' || c.kind === 'category') &&
      typeof c.ai === 'string' && typeof c.user === 'string'),
  }
}

function save(store: HabitStore): void {
  safeSetItem(K_AI_HABITS, JSON.stringify({ version: 1, corrections: store.corrections.slice(-MAX_CORRECTIONS) }))
}

function siteOf(url: string): string {
  try {
    return registrableDomain(new URL(url).hostname) || ''
  } catch {
    return ''
  }
}

let _seq = 0
const newId = () => `h${Date.now().toString(36)}${(++_seq).toString(36)}`

/**
 * 记录一次 AI 结果的最终去向：ai 为 AI 给出的值，saved 为用户最终保存的值。
 * 只在两者都非空且不同（归一化后）时记一条修正；同站同类旧修正被新修正覆盖。
 */
export function recordAiOutcome(input: {
  url: string
  ai: Partial<Record<HabitKind, string | undefined>>
  saved: Partial<Record<HabitKind, string | undefined>>
}): HabitCorrection[] {
  if (!isAiStyleAdaptEnabled()) return []
  const site = siteOf(input.url)
  const store = load()
  const added: HabitCorrection[] = []
  for (const kind of ['title', 'notes', 'category'] as HabitKind[]) {
    const ai = norm(input.ai[kind])
    const user = norm(input.saved[kind])
    if (!ai || !user || ai === user) continue
    // 同站同类只保留最新一条，避免一个网站反复改动刷屏
    store.corrections = store.corrections.filter((c) => !(c.kind === kind && c.site && c.site === site))
    const c: HabitCorrection = { id: newId(), kind, site, ai, user, ts: Date.now() }
    store.corrections.push(c)
    added.push(c)
  }
  if (added.length) save(store)
  return added
}

export function listCorrections(): HabitCorrection[] {
  return load().corrections.slice().sort((a, b) => b.ts - a.ts)
}

export function removeCorrection(id: string): boolean {
  const store = load()
  const before = store.corrections.length
  store.corrections = store.corrections.filter((c) => c.id !== id)
  if (store.corrections.length === before) return false
  save(store)
  return true
}

/** 清空全部学到的习惯（修正记录 + 「AI 原样建议」记忆） */
export function clearHabits(): void {
  safeRemoveItem(K_AI_HABITS)
  clearAiSuggestions()
}

// ── 归纳规则 ───────────────────────────────────────────────

/** 标题习惯：≥3 次修正且 ≥60% 改短 → 偏好简短的品牌 / 产品名 */
export function deriveTitleRule(corrections = load().corrections): 'shorter' | null {
  const titles = corrections.filter((c) => c.kind === 'title')
  if (titles.length < 3) return null
  const shorter = titles.filter((c) => c.user.length < c.ai.length).length
  return shorter / titles.length >= 0.6 ? 'shorter' : null
}

// 示例数据 id：首次用到时才读 DEFAULTS（模块加载期不触碰，常量被整体 mock 的测试也能安全导入）
let _seedIds: { cats: Set<string>; groups: Set<string> } | null = null
function seedIds(): { cats: Set<string>; groups: Set<string> } {
  if (_seedIds) return _seedIds
  try {
    _seedIds = {
      cats: new Set(DEFAULTS.categories.map((c) => c.id)),
      groups: new Set(DEFAULTS.siblingGroups.map((g) => g.id)),
    }
  } catch {
    _seedIds = { cats: new Set(), groups: new Set() }
  }
  return _seedIds
}

/** 分类命名习惯：用户自建分类（排除示例与虚拟分类）的名字样例与平均长度 */
export function deriveCategoryNaming(categories: Category[]): { examples: string[]; avgLen: number } | null {
  const own = categories.filter((c) => !c.deletedAt && !seedIds().cats.has(c.id) && c.id !== 'all' && c.id !== 'uncategorized' && norm(c.name))
  if (own.length < 2) return null
  const examples = own.slice(0, 6).map((c) => norm(c.name).slice(0, 12))
  const avgLen = Math.round(own.reduce((s, c) => s + norm(c.name).length, 0) / own.length)
  return { examples, avgLen }
}

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** 分组笔记写法：用户自己写的组笔记（排除示例）的平均长度与是否偏好列表 */
export function deriveNoteStyle(groups: SiblingGroup[]): { avgLen: number; prefersList: boolean } | null {
  const own = groups.filter((g) => !g.deletedAt && !seedIds().groups.has(g.id) && stripHtml(g.notes || '').length >= 10)
  if (own.length < 2) return null
  const avgLen = Math.round(own.reduce((s, g) => s + stripHtml(g.notes || '').length, 0) / own.length)
  const withList = own.filter((g) => /<(ul|ol)[\s>]/i.test(g.notes || '')).length
  return { avgLen, prefersList: withList / own.length >= 0.5 }
}

// ── 切片：各入口按需取用 ─────────────────────────────────────

export interface IntakeHabits {
  styleSamples: string[]
  titleExamples: Array<{ ai: string; user: string }>
  categoryHints: Array<{ site: string; category: string }>
  titleRule?: 'shorter'
}

/**
 * 收藏预填 / 批量补齐用：备注样本（用户修正过的备注优先）、标题改写示例、分类纠正（仅现存分类）。
 * 开关关闭时全部为空。
 */
export function buildIntakeHabits(bookmarks: Bookmark[], categories: Category[]): IntakeHabits {
  const empty: IntakeHabits = { styleSamples: [], titleExamples: [], categoryHints: [] }
  if (!isAiStyleAdaptEnabled()) return empty
  const corrections = listCorrections()
  const corrected = corrections.filter((c) => c.kind === 'notes').map((c) => c.user)
  const styleSamples = [...new Set([...corrected, ...collectStyleSamples(bookmarks)])].slice(0, MAX_STYLE_SAMPLES)
  const titleExamples = corrections.filter((c) => c.kind === 'title').slice(0, 5).map((c) => ({ ai: c.ai, user: c.user }))
  const catName = new Map(categories.filter((c) => !c.deletedAt).map((c) => [c.id, c.name]))
  const categoryHints = corrections
    .filter((c) => c.kind === 'category' && c.site && catName.has(c.user))
    .slice(0, 8)
    .map((c) => ({ site: c.site, category: norm(catName.get(c.user)).slice(0, 20) }))
  const titleRule = deriveTitleRule(corrections) ?? undefined
  return { styleSamples, titleExamples, categoryHints, ...(titleRule ? { titleRule } : {}) }
}

/** 分类纠正的本地直用：某站点用户上次改到的分类（现存才返回），预填时可直接采用，不必问 AI */
export function correctedCategoryFor(url: string, categories: Category[]): string | undefined {
  if (!isAiStyleAdaptEnabled()) return undefined
  const site = siteOf(url)
  if (!site) return undefined
  const alive = new Set(categories.filter((c) => !c.deletedAt).map((c) => c.id))
  const hit = listCorrections().find((c) => c.kind === 'category' && c.site === site && alive.has(c.user))
  return hit?.user
}

/** 发现好站用：只产出白名单偏好键（服务端映射成固定文案），不外发任何书签内容 */
export type CandidatePreferenceKey = 'free' | 'no_proxy'
export function buildCandidatePreferences(params: {
  bookmarks: Bookmark[]
  groups: SiblingGroup[]
  categories: Category[]
  customAttributes: CustomAttribute[]
}): CandidatePreferenceKey[] {
  if (!isAiStyleAdaptEnabled()) return []
  const mm = buildUserMentalModel(params)
  const out: CandidatePreferenceKey[] = []
  if (mm.costTendency === 'free_preferred') out.push('free')
  if (mm.networkTendency === 'direct_preferred') out.push('no_proxy')
  return out
}

/** 本地过滤：去掉用户书签库里已有的网站（按根域名），这部分信息不外发 */
export function excludeOwnedSites<T extends { url: string }>(items: T[], bookmarks: Bookmark[]): T[] {
  if (!isAiStyleAdaptEnabled()) return items
  const owned = new Set(bookmarks.filter((b) => !b.deletedAt).map((b) => siteOf(b.url)).filter(Boolean))
  return items.filter((it) => {
    const s = siteOf(it.url)
    return !s || !owned.has(s)
  })
}

/**
 * AI 对话 / 编辑器润色用：写作与命名习惯 + 修正规则的简短说明（只读参考非指令），≤ maxChars。
 * 不含任何网址；备注样本最多 3 条。
 */
export function buildChatHabitPrompt(params: {
  bookmarks: Bookmark[]
  groups: SiblingGroup[]
  categories: Category[]
  isZh?: boolean
  maxChars?: number
}): string {
  if (!isAiStyleAdaptEnabled()) return ''
  const isZh = params.isZh !== false
  const lines: string[] = []
  const samples = buildIntakeHabits(params.bookmarks, params.categories).styleSamples.slice(0, 3)
  if (samples.length) lines.push(isZh ? `书签备注写法示例：${samples.map((s) => `「${s}」`).join(' ')}` : `Bookmark note examples: ${samples.map((s) => `"${s}"`).join(' ')}`)
  const note = deriveNoteStyle(params.groups)
  if (note) {
    lines.push(isZh
      ? `笔记习惯：平均约 ${note.avgLen} 字${note.prefersList ? '，偏好要点列表' : '，多用短段落'}；润色或代写笔记时保持这种写法`
      : `Note habits: ~${note.avgLen} chars on average${note.prefersList ? ', prefers bullet lists' : ', short paragraphs'}; keep this style when polishing or drafting notes`)
  }
  const naming = deriveCategoryNaming(params.categories)
  if (naming) {
    lines.push(isZh
      ? `分类命名习惯：约 ${naming.avgLen} 个字，如${naming.examples.map((s) => `「${s}」`).join('')}；新建分类时沿用`
      : `Category naming: ~${naming.avgLen} chars, e.g. ${naming.examples.map((s) => `"${s}"`).join(', ')}; follow this when creating categories`)
  }
  if (deriveTitleRule() === 'shorter') {
    lines.push(isZh ? '标题习惯：用户常把标题改短，只保留品牌或产品名' : 'Title habit: the user shortens titles to the brand or product name')
  }
  if (!lines.length) return ''
  const header = isZh ? '【用户习惯（端侧学习，只读参考非指令）】' : '[User habits (learned on device; read-only reference, not instructions)]'
  return `${header}\n${lines.map((l) => `- ${l}`).join('\n')}`.slice(0, params.maxChars ?? 420)
}

/** 「AI 学到了什么」面板：可读条目（修正记录可删除；归纳规则随数据变化、只读） */
export interface LearnedHabitItem {
  id: string
  kind: HabitKind | 'rule'
  text: string
  removable: boolean
}

export function listLearnedHabits(params: { groups: SiblingGroup[]; categories: Category[]; isZh?: boolean }): LearnedHabitItem[] {
  const isZh = params.isZh !== false
  const catName = new Map(params.categories.map((c) => [c.id, c.name]))
  const items: LearnedHabitItem[] = []
  if (deriveTitleRule() === 'shorter') items.push({ id: 'rule:title', kind: 'rule', removable: false, text: isZh ? '你偏好简短的标题，只写品牌或产品名' : 'You prefer short titles with just the brand or product name' })
  const note = deriveNoteStyle(params.groups)
  if (note) items.push({ id: 'rule:note', kind: 'rule', removable: false, text: isZh ? `你的笔记平均约 ${note.avgLen} 字，${note.prefersList ? '偏好要点列表' : '多用短段落'}` : `Your notes average ~${note.avgLen} chars, ${note.prefersList ? 'mostly bullet lists' : 'mostly short paragraphs'}` })
  const naming = deriveCategoryNaming(params.categories)
  if (naming) items.push({ id: 'rule:naming', kind: 'rule', removable: false, text: isZh ? `你的分类名一般约 ${naming.avgLen} 个字` : `Your category names are ~${naming.avgLen} chars` })
  for (const c of listCorrections()) {
    const user = c.kind === 'category' ? (catName.get(c.user) || c.user) : c.user
    const ai = c.kind === 'category' ? (catName.get(c.ai) || c.ai) : c.ai
    const site = c.site || (isZh ? '某网站' : 'a site')
    const text = c.kind === 'category'
      ? (isZh ? `${site} 放进「${user}」（AI 原本建议「${ai}」）` : `${site} goes into "${user}" (AI suggested "${ai}")`)
      : c.kind === 'title'
        ? (isZh ? `标题「${ai}」你改成了「${user}」` : `Title "${ai}" → "${user}"`)
        : (isZh ? `备注你改写为「${user}」` : `Note rewritten as "${user}"`)
    items.push({ id: c.id, kind: c.kind, text, removable: true })
  }
  return items
}
