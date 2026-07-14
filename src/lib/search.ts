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
const _pyCache = new Map<string, string>()
const _PY_CACHE_MAX = 10000

function _toPy(text: string): string {
  if (!text) return ''
  let cached = _pyCache.get(text)
  if (cached !== undefined) return cached
  if (!pinyinFn) { ensureSearchLibs(); return '' }
  // 防止缓存无限增长：超限时清空
  if (_pyCache.size >= _PY_CACHE_MAX) _pyCache.clear()
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

function _buildBookmarkSearchItems(
  bookmarks: Bookmark[],
  customAttributes: CustomAttribute[],
): BookmarkSearchItem[] {
  const attrNameMap = new Map(customAttributes.map(a => [a.id, a.name]))
  return bookmarks.map(b => {
    const attrNames = Object.keys(b.attributes || {})
      .filter(k => b.attributes[k])
      .map(k => attrNameMap.get(k) || '')
      .filter(Boolean)
      .join(' ')
    return {
      id: b.id,
      title: b.title || '',
      url: b.url || '',
      notes: b.notes || '',
      username: b.username || '',
      attrNames,
      titlePy: _toPy(b.title || ''),
      notesPy: _toPy(b.notes || ''),
    }
  })
}

function _buildGroupSearchItems(
  groups: SiblingGroup[],
  bookmarkMap: Record<string, Bookmark>,
  customAttributes: CustomAttribute[],
): GroupSearchItem[] {
  const attrNameMap = new Map(customAttributes.map(a => [a.id, a.name]))
  return groups.map(g => {
    const attrNames = Object.keys(g.attributes || {})
      .filter(k => g.attributes[k])
      .map(k => attrNameMap.get(k) || '')
      .filter(Boolean)
      .join(' ')
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
      attrNames,
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

/** 库未就绪时的 includes 降级（无拼音） */
function _fallbackBmIds(bookmarks: Bookmark[], query: string): Set<string> {
  const q = query.trim().toLowerCase()
  return new Set(
    bookmarks
      .filter(b =>
        (b.title || '').toLowerCase().includes(q) ||
        (b.url || '').toLowerCase().includes(q) ||
        (b.notes || '').toLowerCase().includes(q) ||
        (b.username || '').toLowerCase().includes(q)
      )
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
    return _fallbackBmIds(bookmarks, query)
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
    const label = keyMap[match.key] || match.key
    out[label] = _buildHighlightSegments(match.value || '', match.indices)
  }
  return out
}

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
    const ids = _fallbackBmIds(bookmarks, q)
    return bookmarks.filter(b => ids.has(b.id)).slice(0, maxResults).map(b => ({
      id: b.id, title: b.title, url: b.url, _highlights: {},
    }))
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
  const grpResults = _grpFuse.search(q, { limit: 4 })

  const groupResults: SearchResultItem[] = grpResults.map(r => ({
    id: r.item.id,
    name: (r.item as GroupSearchItem).name,
    _isGroup: true,
    _displayTitle: (r.item as GroupSearchItem).name || '未命名组',
    bookmarkIds: groups.find(g => g.id === r.item.id)?.bookmarkIds,
    _highlights: _extractHighlights(r as unknown as FuseResult, GRP_KEY_MAP),
  }))

  if (!groupResults.length) return bookmarkResults.slice(0, maxResults)
  if (!bookmarkResults.length) return groupResults.slice(0, maxResults)
  return [...groupResults, ...bookmarkResults].slice(0, maxResults + 4)
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
