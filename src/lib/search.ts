/**
 * search.ts — Fuse.js 模糊搜索 + 拼音支持
 * 提供书签和组的统一搜索能力，替换原 data.ts 中的暴力 includes 匹配。
 *
 * PERF-5：fuse.js / pinyin-pro 动态 import，不进首包；未就绪时用 includes 降级。
 */
import type { Bookmark, SiblingGroup, CustomAttribute } from '../types.js'

type FuseInstance<T> = {
  search: (q: string, opts?: { limit?: number }) => Array<{ item: T; matches?: ReadonlyArray<{ key?: string; value?: string; indices: ReadonlyArray<readonly [number, number]> }> }>
}
type FuseCtor = new <T>(list: T[], opts: Record<string, unknown>) => FuseInstance<T>
type PinyinFn = (text: string, opts: { toneType: string; type: string }) => string[]

type FuseOptionKeyObject = { name: string; weight: number }
type IFuseOptions = {
  threshold?: number
  distance?: number
  includeScore?: boolean
  // D1-001：Fuse includeMatches 开启后才有 matches 供高亮
  includeMatches?: boolean
  minMatchCharLength?: number
  ignoreLocation?: boolean
  findAllMatches?: boolean
}
type FuseResult = {
  item: BookmarkSearchItem | GroupSearchItem
  refIndex?: number
  score?: number
  matches?: ReadonlyArray<{
    key?: string
    value?: string
    indices: ReadonlyArray<readonly [number, number]>
  }>
}

// ── 动态加载 fuse / pinyin ──
let FuseClass: FuseCtor | null = null
let pinyinFn: PinyinFn | null = null
let _libsLoading: Promise<void> | null = null

function ensureSearchLibs(): boolean {
  if (FuseClass && pinyinFn) return true
  if (!_libsLoading) {
    _libsLoading = Promise.all([import('fuse.js'), import('pinyin-pro')]).then(([fuseMod, pyMod]) => {
      FuseClass = fuseMod.default as unknown as FuseCtor
      pinyinFn = pyMod.pinyin as PinyinFn
    }).catch(e => {
      console.warn('[search] fuse/pinyin load failed:', e)
      _libsLoading = null
    })
  }
  return !!(FuseClass && pinyinFn)
}

/** 测试/预热：等待 fuse/pinyin 动态 import 完成 */
export async function preloadSearchLibs(): Promise<void> {
  ensureSearchLibs()
  if (_libsLoading) await _libsLoading
}

// 模块加载即开始拉分包（不阻塞主线程解析）
ensureSearchLibs()

// ── 拼音缓存（避免同一条目重复计算）──
// L5 修复：旧实现 `_pyCache.size >= _PY_CACHE_MAX` 时执行 `_pyCache.clear()` 全量清空，
// 大数据集（数千条中文书签 title+notes 各算一次拼音逼近 10000）会反复触发全清，导致拼音
// 被重复同步计算（pinyin-pro 同步 CPU 密集），CRUD 重建时主线程被同步阻塞。Map 迭代顺序即
// 插入顺序，改为 LRU 淘汰最旧条目（删第一个 entry）而非全清。
const _pyCache = new Map<string, string>()
const _PY_CACHE_MAX = 10000

function _toPy(text: string): string {
  if (!text) return ''
  let cached = _pyCache.get(text)
  if (cached !== undefined) return cached
  if (!pinyinFn) { ensureSearchLibs(); return '' }
  // LRU 淘汰：超限时删最早插入的条目（Map 第一个 entry），而非整表清空
  if (_pyCache.size >= _PY_CACHE_MAX) {
    const oldest = _pyCache.keys().next().value
    if (oldest !== undefined) _pyCache.delete(oldest)
  }
  cached = pinyinFn(text, { toneType: 'none', type: 'array' }).join('')
  _pyCache.set(text, cached)
  return cached
}

// ── Fuse.js 配置 ──
const BOOKMARK_KEYS: FuseOptionKeyObject[] = [
  { name: 'title',    weight: 0.35 },
  { name: 'url',      weight: 0.25 },
  { name: 'notes',    weight: 0.15 },
  { name: 'username', weight: 0.10 },
  { name: 'attrNames', weight: 0.10 },
  { name: 'titlePy',  weight: 0.03 },
  { name: 'notesPy',  weight: 0.02 },
]

const GROUP_KEYS: FuseOptionKeyObject[] = [
  { name: 'name',       weight: 0.40 },
  { name: 'attrNames',  weight: 0.15 },
  { name: 'childTitle', weight: 0.25 },
  { name: 'childUrl',   weight: 0.10 },
  { name: 'namePy',     weight: 0.05 },
  { name: 'childTitlePy', weight: 0.05 },
]

const FUSE_OPTIONS: IFuseOptions = {
  threshold: 0.2,
  distance: 200,
  includeScore: true,
  // D1-001：无 includeMatches 时 Fuse 不返回 matches，搜索建议高亮永久为空
  includeMatches: true,
  minMatchCharLength: 1,
  ignoreLocation: true,
  findAllMatches: true,
}

// ── 搜索可序列化对象 ──
interface BookmarkSearchItem {
  id: string
  title: string
  url: string
  notes: string
  username: string
  attrNames: string
  titlePy: string
  notesPy: string
}

interface GroupSearchItem {
  id: string
  name: string
  attrNames: string
  childTitle: string
  childUrl: string
  namePy: string
  childTitlePy: string
}

/** 属性 id → 显示名；搜索索引构建与降级路径共用 */
function _buildAttrNameMap(customAttributes: CustomAttribute[]): Map<string, string> {
  return new Map(customAttributes.map(a => [a.id, a.name]))
}

/** 将勾选属性 id 映射为可搜的空格分隔名称串 */
function _attrsToAttrNames(
  attributes: Record<string, boolean> | undefined,
  attrNameMap: Map<string, string>,
): string {
  if (!attributes) return ''
  return Object.keys(attributes)
    .filter(k => attributes[k])
    .map(k => attrNameMap.get(k) || '')
    .filter(Boolean)
    .join(' ')
}

function _buildBookmarkSearchItems(
  bookmarks: Bookmark[],
  customAttributes: CustomAttribute[],
): BookmarkSearchItem[] {
  const attrNameMap = _buildAttrNameMap(customAttributes)
  return bookmarks.map(b => ({
    id: b.id,
    title: b.title || '',
    url: b.url || '',
    notes: b.notes || '',
    username: b.username || '',
    attrNames: _attrsToAttrNames(b.attributes, attrNameMap),
    titlePy: _toPy(b.title || ''),
    notesPy: _toPy(b.notes || ''),
  }))
}

function _buildGroupSearchItems(
  groups: SiblingGroup[],
  bookmarkMap: Record<string, Bookmark>,
  customAttributes: CustomAttribute[],
): GroupSearchItem[] {
  const attrNameMap = _buildAttrNameMap(customAttributes)
  return groups.map(g => {
    const childTitles: string[] = []
    const childUrls: string[] = []
    for (const bid of g.bookmarkIds || []) {
      const b = bookmarkMap[bid]
      if (b) { childTitles.push(b.title || ''); childUrls.push(b.url || '') }
    }
    const ct = childTitles.join(' ')
    return {
      id: g.id,
      name: g.name || '',
      attrNames: _attrsToAttrNames(g.attributes, attrNameMap),
      childTitle: ct,
      childUrl: childUrls.join(' '),
      namePy: _toPy(g.name || ''),
      childTitlePy: _toPy(ct),
    }
  })
}

// ── 统一搜索缓存（供 searchBookmarkIds / searchWithHighlights 共享）──
// _bmBaseRef / _grpBaseRef 跟踪原始数组引用，
// 所有搜索函数共用同一份转换后的搜索项，避免双倍构建
// _bmVersion / _grpVersion 来自 dataStore._searchVersion，
// 仅在 CRUD 发生时重建 Fuse 索引，UI 筛选切换时不重建。
let _bmBaseRef: Bookmark[] | null = null
let _bmBaseItems: BookmarkSearchItem[] = []
let _bmBaseAttrs: CustomAttribute[] | null = null
let _bmFuse: FuseInstance<BookmarkSearchItem> | null = null
let _bmVersion = -1

let _grpBaseRef: SiblingGroup[] | null = null
let _grpBaseItems: GroupSearchItem[] = []
let _grpBaseAttrs: CustomAttribute[] | null = null
let _grpBaseMap: Record<string, Bookmark> | null = null
let _grpFuse: FuseInstance<GroupSearchItem> | null = null
let _grpVersion = -1

function _ensureBookmarkBase(bookmarks: Bookmark[], customAttributes: CustomAttribute[], version = -1) {
  if (!ensureSearchLibs() || !FuseClass) {
    _bmFuse = null
    return false
  }
  if (bookmarks !== _bmBaseRef || customAttributes !== _bmBaseAttrs || version !== _bmVersion) {
    _bmBaseItems = _buildBookmarkSearchItems(bookmarks, customAttributes)
    _bmFuse = new FuseClass(_bmBaseItems, { ...FUSE_OPTIONS, keys: BOOKMARK_KEYS })
    _bmBaseRef = bookmarks
    _bmBaseAttrs = customAttributes
    _bmVersion = version
  }
  return true
}

function _ensureGroupBase(groups: SiblingGroup[], bookmarkMap: Record<string, Bookmark>, customAttributes: CustomAttribute[], version = -1) {
  if (!ensureSearchLibs() || !FuseClass) {
    _grpFuse = null
    return false
  }
  if (groups !== _grpBaseRef || bookmarkMap !== _grpBaseMap || customAttributes !== _grpBaseAttrs || version !== _grpVersion) {
    _grpBaseItems = _buildGroupSearchItems(groups, bookmarkMap, customAttributes)
    _grpFuse = new FuseClass(_grpBaseItems, { ...FUSE_OPTIONS, keys: GROUP_KEYS })
    _grpBaseRef = groups
    _grpBaseMap = bookmarkMap
    _grpBaseAttrs = customAttributes
    _grpVersion = version
  }
  return true
}

/** 库未就绪时的 includes 降级（无拼音）
 *  L6 修复：旧实现仅匹配 title/url/notes/username 四字段，不含 attrNames（也缺拼音），
 *  与正常 Fuse 路径的 attrNames(权重 0.10) 范围不一致，降级时按自定义属性名搜不到对应书签。
 *  追加 attrNames 匹配，保持降级与正常路径覆盖范围一致（拼音是能力缺失，不再补）。 */
function _fallbackBmIds(bookmarks: Bookmark[], query: string, customAttributes: CustomAttribute[] = []): Set<string> {
  const q = query.trim().toLowerCase()
  const attrNameMap = _buildAttrNameMap(customAttributes)
  return new Set(
    bookmarks
      .filter(b => {
        if ((b.title || '').toLowerCase().includes(q)) return true
        if ((b.url || '').toLowerCase().includes(q)) return true
        if ((b.notes || '').toLowerCase().includes(q)) return true
        if ((b.username || '').toLowerCase().includes(q)) return true
        // 属性名匹配：与 Fuse 路径的 attrNames 覆盖范围一致
        if (q && _attrsToAttrNames(b.attributes, attrNameMap).toLowerCase().includes(q)) return true
        return false
      })
      .map(b => b.id)
  )
}

function _fallbackGrpIds(groups: SiblingGroup[], query: string, bookmarkMap: Record<string, Bookmark>): Set<string> {
  const q = query.trim().toLowerCase()
  return new Set(
    groups
      .filter(g => {
        if ((g.name || '').toLowerCase().includes(q)) return true
        for (const bid of g.bookmarkIds || []) {
          const b = bookmarkMap[bid]
          if (b && ((b.title || '').toLowerCase().includes(q) || (b.url || '').toLowerCase().includes(q))) return true
        }
        return false
      })
      .map(g => g.id)
  )
}

// ── 公开 API ──

/**
 * 模糊搜索书签，返回匹配的 ID 集合。
 * query 为空时返回 null（表示无需过滤）。
 * 内部缓存 Fuse 实例，同一 bookmarks 数组引用不重复构建。
 */
export function searchBookmarkIds(
  bookmarks: Bookmark[],
  query: string,
  customAttributes: CustomAttribute[],
  version = -1,
): Set<string> | null {
  if (!query.trim()) return null
  if (!_ensureBookmarkBase(bookmarks, customAttributes, version) || !_bmFuse) {
    return _fallbackBmIds(bookmarks, query, customAttributes)
  }
  const results = _bmFuse.search(query.trim())
  return new Set(results.map(r => r.item.id))
}

/**
 * 模糊搜索组，返回匹配的 ID 集合。
 * 同时匹配组名、属性名、组内书签标题/URL。
 * query 为空时返回 null（表示无需过滤）。
 * 内部缓存 Fuse 实例，同一 groups 数组引用不重复构建。
 * @param version - dataStore._searchVersion，仅 CRUD 时递增，用于判断缓存是否有效
 */
export function searchGroupIds(
  groups: SiblingGroup[],
  query: string,
  bookmarkMap: Record<string, Bookmark>,
  customAttributes: CustomAttribute[],
  version = -1,
): Set<string> | null {
  if (!query.trim()) return null
  if (!_ensureGroupBase(groups, bookmarkMap, customAttributes, version) || !_grpFuse) {
    return _fallbackGrpIds(groups, query, bookmarkMap)
  }
  const results = _grpFuse.search(query.trim())
  return new Set(results.map(r => r.item.id))
}

// ── 带高亮信息的搜索（供 SearchSuggest 使用）──
export interface HighlightSegment { text: string; highlight: boolean }
export interface SearchResultItem {
  id: string
  title?: string
  name?: string
  url?: string
  bookmarkIds?: string[]
  _isGroup?: boolean
  _displayTitle?: string
  _highlights: Record<string, HighlightSegment[]>
  _divider?: string
}

function _buildHighlightSegments(text: string, indices: ReadonlyArray<readonly [number, number]>): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  let cursor = 0
  for (const [start, end] of indices) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlight: false })
    segments.push({ text: text.slice(start, end + 1), highlight: true })
    cursor = end + 1
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlight: false })
  return segments.length ? segments : [{ text, highlight: false }]
}

function _extractHighlights(fuseResult: FuseResult, keyMap: Record<string, string>): Record<string, HighlightSegment[]> {
  const out: Record<string, HighlightSegment[]> = {}
  for (const match of fuseResult.matches || []) {
    if (!match.key || !match.indices?.length) continue
    // M8 修复：拼音 key（titlePy/notesPy/namePy/childTitlePy）命中时，Fuse 的 match.value 是
    // 拼音串（如 'kaiFaGongJu'）、indices 指向拼音串的字符位置。若把拼音串作 text 生成高亮段，
    // SearchSuggest/CommandPalette 的建议项名称位置会渲染出拼音字符而非中文原文（如 'kaiFaGongJu'
    // 而非'开发工具'）。拼音 key 命中时跳过段生成，仅让该字段其他原文 key 命中（若有）正常高亮，
    // 渲染层对无原文字段段时用 fallback 原文显示（SearchSuggest 已用 item.title/name 显示主标题）。
    if (match.key.endsWith('Py')) continue
    const label = keyMap[match.key] || match.key
    out[label] = _buildHighlightSegments(match.value || '', match.indices)
  }
  return out
}

// 组结果预算：混合搜索中组预分组数上限（Fuse limit / slice / 最终拼接上限 maxResults + 该值）。
// 与书签 maxResults 默认 8 区分；调整组建议条数只改此一处。
const GROUP_SUGGEST_LIMIT = 4

// ── searchWithHighlights 需要的 key 映射 ──
const BM_KEY_MAP = { title: 'title', url: 'url', notes: 'notes', username: 'username', attrNames: 'attrNames', titlePy: 'title', notesPy: 'notes' }
const GRP_KEY_MAP = { name: 'name', attrNames: 'attrNames', childTitle: 'childTitle', childUrl: 'childUrl', namePy: 'name', childTitlePy: 'childTitle' }

/**
 * 带高亮信息的混合搜索（书签 + 组），供 SearchSuggest 使用。
 * 复用统一搜索引擎缓存，避免双倍构建 Fuse 索引。
 */
export function searchWithHighlights(
  bookmarks: Bookmark[],
  groups: SiblingGroup[],
  query: string,
  bookmarkMap: Record<string, Bookmark>,
  customAttributes: CustomAttribute[],
  maxResults: number = 8,
  version = -1,
): SearchResultItem[] {
  if (!query.trim()) return []
  const q = query.trim()

  if (!_ensureBookmarkBase(bookmarks, customAttributes, version) || !_bmFuse) {
    // 降级：无高亮
    const bmIds = _fallbackBmIds(bookmarks, q, customAttributes)
    const bookmarkResults: SearchResultItem[] = bookmarks.filter(b => bmIds.has(b.id)).slice(0, maxResults).map(b => ({
      id: b.id, title: b.title, url: b.url, _highlights: {},
    }))
    // M10 修复：旧实现降级时仅处理书签并 return，从不调用组降级，导致 fuse.js/pinyin-pro
    // 分包加载失败时搜索建议和命令面板完全无法搜到任何组（与正常路径行为不一致）。
    // 同条件下 _ensureGroupBase 也会失败，但模块内已有现成的 _fallbackGrpIds（用 includes 搜组）。
    // 降级时调用 _fallbackGrpIds 构建组结果项与书签降级结果合并返回，保持降级与正常路径一致。
    const grpIds = _fallbackGrpIds(groups, q, bookmarkMap)
    const groupResults: SearchResultItem[] = groups.filter(g => grpIds.has(g.id)).slice(0, GROUP_SUGGEST_LIMIT).map(g => ({
      id: g.id, name: g.name, _isGroup: true,
      _displayTitle: g.name || '未命名组',
      bookmarkIds: g.bookmarkIds,
      _highlights: {},
    }))
    if (!groupResults.length) return bookmarkResults.slice(0, maxResults)
    if (!bookmarkResults.length) return groupResults.slice(0, maxResults)
    return [...groupResults, ...bookmarkResults].slice(0, maxResults + GROUP_SUGGEST_LIMIT)
  }
  const bmResults = _bmFuse.search(q, { limit: maxResults })

  const bookmarkResults: SearchResultItem[] = bmResults.map(r => ({
    id: r.item.id,
    title: (r.item as BookmarkSearchItem).title,
    url: (r.item as BookmarkSearchItem).url,
    _highlights: _extractHighlights(r as unknown as FuseResult, BM_KEY_MAP),
  }))

  if (!_ensureGroupBase(groups, bookmarkMap, customAttributes, version) || !_grpFuse) {
    return bookmarkResults.slice(0, maxResults)
  }
  const grpResults = _grpFuse.search(q, { limit: GROUP_SUGGEST_LIMIT })

  // O(1) 查找组 bookmarkIds，避免 map 内 find 导致 O(n²)
  const groupBmIdsMap = new Map<string, string[] | undefined>(
    groups.map(g => [g.id, g.bookmarkIds])
  )

  const groupResults: SearchResultItem[] = grpResults.map(r => ({
    id: r.item.id,
    name: (r.item as GroupSearchItem).name,
    _isGroup: true,
    _displayTitle: (r.item as GroupSearchItem).name || '未命名组',
    bookmarkIds: groupBmIdsMap.get(r.item.id),
    _highlights: _extractHighlights(r as unknown as FuseResult, GRP_KEY_MAP),
  }))

  if (!groupResults.length) return bookmarkResults.slice(0, maxResults)
  if (!bookmarkResults.length) return groupResults.slice(0, maxResults)
  return [...groupResults, ...bookmarkResults].slice(0, maxResults + GROUP_SUGGEST_LIMIT)
}

/**
 * 清空所有搜索缓存（拼音缓存 + Fuse 实例缓存）
 * 数据大量变更时调用
 */
export function clearSearchCache(): void {
  _pyCache.clear()
  _bmBaseRef = null; _bmBaseItems = []; _bmBaseAttrs = null; _bmFuse = null
  _grpBaseRef = null; _grpBaseItems = []; _grpBaseMap = null; _grpBaseAttrs = null; _grpFuse = null
}
