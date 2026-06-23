/**
 * search.ts — Fuse.js 模糊搜索 + 拼音支持
 * 提供书签和组的统一搜索能力，替换原 data.ts 中的暴力 includes 匹配。
 */
import Fuse from 'fuse.js'
import { pinyin } from 'pinyin-pro'
import type { Bookmark, SiblingGroup, CustomAttribute } from '../types.js'

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
  item: any
  refIndex: number
  score?: number
  matches?: Array<{
    key?: string
    value?: string
    indices: ReadonlyArray<readonly [number, number]>
  }>
}

// ── 拼音缓存（避免同一条目重复计算）──
const _pyCache = new Map<string, string>()

function _toPy(text: string): string {
  if (!text) return ''
  let cached = _pyCache.get(text)
  if (cached !== undefined) return cached
  cached = pinyin(text, { toneType: 'none', type: 'array' }).join('')
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

// ── Fuse 实例缓存（避免每次 getter 调用都重建索引）──
let _bmCacheRef: Bookmark[] | null = null
let _bmCacheFuse: Fuse<BookmarkSearchItem> | null = null
let _bmCacheItems: BookmarkSearchItem[] = []

let _grpCacheRef: SiblingGroup[] | null = null
let _grpCacheFuse: Fuse<GroupSearchItem> | null = null
let _grpCacheItems: GroupSearchItem[] = []

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
): Set<string> | null {
  if (!query.trim()) return null
  if (bookmarks !== _bmCacheRef) {
    _bmCacheItems = _buildBookmarkSearchItems(bookmarks, customAttributes)
    _bmCacheFuse = new Fuse(_bmCacheItems, { ...FUSE_OPTIONS, keys: BOOKMARK_KEYS })
    _bmCacheRef = bookmarks
  }
  const results = _bmCacheFuse!.search(query.trim())
  return new Set(results.map(r => r.item.id))
}

/**
 * 模糊搜索组，返回匹配的 ID 集合。
 * 同时匹配组名、属性名、组内书签标题/URL。
 * query 为空时返回 null（表示无需过滤）。
 * 内部缓存 Fuse 实例，同一 groups 数组引用不重复构建。
 */
export function searchGroupIds(
  groups: SiblingGroup[],
  query: string,
  bookmarkMap: Record<string, Bookmark>,
  customAttributes: CustomAttribute[],
): Set<string> | null {
  if (!query.trim()) return null
  if (groups !== _grpCacheRef) {
    _grpCacheItems = _buildGroupSearchItems(groups, bookmarkMap, customAttributes)
    _grpCacheFuse = new Fuse(_grpCacheItems, { ...FUSE_OPTIONS, keys: GROUP_KEYS })
    _grpCacheRef = groups
  }
  const results = _grpCacheFuse!.search(query.trim())
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

// ── searchWithHighlights 专用缓存 ──
let _hlBmCacheRef: Bookmark[] | null = null
let _hlBmCacheFuse: Fuse<BookmarkSearchItem> | null = null
let _hlGrpCacheRef: SiblingGroup[] | null = null
let _hlGrpCacheFuse: Fuse<GroupSearchItem> | null = null

const BM_KEY_MAP = { title: 'title', url: 'url', notes: 'notes', username: 'username', attrNames: 'attrNames', titlePy: 'title', notesPy: 'notes' }
const GRP_KEY_MAP = { name: 'name', attrNames: 'attrNames', childTitle: 'childTitle', childUrl: 'childUrl', namePy: 'name', childTitlePy: 'childTitle' }

/**
 * 带高亮信息的混合搜索（书签 + 组），供 SearchSuggest 使用。
 * 内部缓存 Fuse 实例，同一数据引用不重复构建。
 */
export function searchWithHighlights(
  bookmarks: Bookmark[],
  groups: SiblingGroup[],
  query: string,
  bookmarkMap: Record<string, Bookmark>,
  customAttributes: CustomAttribute[],
  maxResults: number = 8,
): SearchResultItem[] {
  if (!query.trim()) return []
  const q = query.trim()

  if (bookmarks !== _hlBmCacheRef) {
    const bmItems = _buildBookmarkSearchItems(bookmarks, customAttributes)
    _hlBmCacheFuse = new Fuse(bmItems, { ...FUSE_OPTIONS, keys: BOOKMARK_KEYS })
    _hlBmCacheRef = bookmarks
  }
  const bmResults = _hlBmCacheFuse!.search(q, { limit: maxResults })

  const bookmarkResults: SearchResultItem[] = bmResults.map(r => ({
    id: r.item.id,
    title: (r.item as BookmarkSearchItem).title,
    url: (r.item as BookmarkSearchItem).url,
    _highlights: _extractHighlights(r as any, BM_KEY_MAP),
  }))

  if (groups !== _hlGrpCacheRef) {
    const grpItems = _buildGroupSearchItems(groups, bookmarkMap, customAttributes)
    _hlGrpCacheFuse = new Fuse(grpItems, { ...FUSE_OPTIONS, keys: GROUP_KEYS })
    _hlGrpCacheRef = groups
  }
  const grpResults = _hlGrpCacheFuse!.search(q, { limit: 4 })

  const groupResults: SearchResultItem[] = grpResults.map(r => ({
    id: r.item.id,
    name: (r.item as GroupSearchItem).name,
    _isGroup: true,
    _displayTitle: (r.item as GroupSearchItem).name || '未命名组',
    bookmarkIds: groups.find(g => g.id === r.item.id)?.bookmarkIds,
    _highlights: _extractHighlights(r as any, GRP_KEY_MAP),
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
  _bmCacheRef = null; _bmCacheFuse = null; _bmCacheItems = []
  _grpCacheRef = null; _grpCacheFuse = null; _grpCacheItems = []
  _hlBmCacheRef = null; _hlBmCacheFuse = null
  _hlGrpCacheRef = null; _hlGrpCacheFuse = null
}
