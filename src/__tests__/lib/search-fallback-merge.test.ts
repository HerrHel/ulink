/**
 * search.ts searchWithHighlights 降级编排 + 正常合并分支补测
 *
 * 既有 search.test.ts 锁正常 Fuse 路径（beforeAll preloadSearchLibs 永就绪）
 * + searchHighlightSegments 锁高亮段纯函数 + pure-helpers 锁 _fallbackBmIds/_fallbackGrpIds。
 * 但 searchWithHighlights 内 **降级编排块（416-433）/正常三合并 return（461-463）/
 * 单组降级 return（446）从未直接触达**——既有测库永就绪不走降级、且构造的 query
 * 同时命中 bm+group 不分别锁「仅 bm / 仅 group / 合并」三种 return 分支。
 *
 * 本测补两类契约：
 *  ① 正常路径三合并分支（真实 Fuse）：query 仅命中 group 不命中 bm / 仅命中 bm 不命中 group /
 *     同时命中两者（合并 [...group, ...bookmark].slice(maxResults+GROUP_SUGGEST_LIMIT)）。
 *  ② 降级路径编排（vi.doMock 双拦 fuse.js/pinyin-pro reject + resetModules + 动态 import）：
 *     _ensureBookmarkBase 失败 → _fallbackBmIds + _fallbackGrpIds 双命中合并返回
 *     （M10 修复：旧实现降级仅 return 书签从不搜组——补回归门）、仅 bm 命中走 line 431、
 *     仅 group 命中走 line 432、_ensureGroupBase 单独失败走 line 446 return bookmarkResults.slice。
 *
 * 纯锁现状不改 search.ts 逻辑（高危 sync/data 守则外的 lib）。降级测用 vi.doMock 拦动态 import
 * reject 触发 ensureSearchLibs catch 设 FuseClass=null，参照 supabase.ts 第五十六轮 resetModules 范式。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { Bookmark, SiblingGroup, CustomAttribute } from '../../types.js'
import { searchWithHighlights, clearSearchCache, preloadSearchLibs } from '../../lib/search.js'

const EMPTY_ATTRS: CustomAttribute[] = []

function bm(p: Partial<Pick<Bookmark, 'id' | 'title' | 'url' | 'notes' | 'username'>>): Bookmark {
  return {
    id: p.id ?? 'b1', title: p.title ?? '', url: p.url ?? '', notes: p.notes ?? '',
    username: p.username ?? '', password: '', icon: '', categoryId: 'uncat', parentId: null,
    order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0,
  } as Bookmark
}
function grp(p: Partial<Pick<SiblingGroup, 'id' | 'name' | 'bookmarkIds'>>): SiblingGroup {
  return {
    id: p.id ?? 'g1', name: p.name ?? '', categoryId: 'uncat', icon: '', order: 0,
    isExpanded: false, attributes: {}, bookmarkIds: p.bookmarkIds ?? [], notes: '',
    updatedAt: 0, useCount: 0,
  } as SiblingGroup
}

// ── 正常路径三合并分支（真实 Fuse，beforeAll 预热） ──
describe('searchWithHighlights 正常路径三个合并 return 分支', () => {
  beforeAll(async () => {
    await preloadSearchLibs()
  })
  beforeEach(() => clearSearchCache())

  it('仅命中 group（query 不命中任何 bm/不含子项）→ return groupResults.slice(maxResults) 不含书签', () => {
    // group name 含独特词，确保该词不出现在任何 bookmark 的任何字段及组内子项
    const groups = [
      grp({ id: 'gx', name: 'QzxUniqueGrpOnly', bookmarkIds: ['bx-noise'] }),
      grp({ id: 'gy', name: '无关组名', bookmarkIds: ['b2'] }),
    ]
    const bookmarks = [
      bm({ id: 'bx-noise', title: '某某噪音文档', url: 'https://noise.example' }), // 不含 QzxUniqueGrpOnly
      bm({ id: 'b2', title: '其它书签', url: 'https://other.example' }),
    ]
    const map = Object.fromEntries(bookmarks.map(b => [b.id, b]))
    // 中文「无关组名」拼音对各 bookmark 文档不命中（确保仅 group 命中分支）
    const results = searchWithHighlights(bookmarks, groups, 'QzxUniqueGrpOnly', map, EMPTY_ATTRS, 8)
    expect(results.some(r => r._isGroup)).toBe(true)
    // 命中的应是 gx（QzxUniqueGrpOnly 含 query 子串）
    expect(results.find(r => r.id === 'gx')).toBeDefined()
    expect(results.find(r => r.id === 'gx')!._isGroup).toBe(true)
    // 不应有任何书签结果凑数
    const onlyBmCount = results.filter(r => !r._isGroup).length
    expect(onlyBmCount).toBe(0)
  })

  it('仅命中 bm（query 命中 bm.notes 而 group 不索引 childNotes）→ return bookmarkResults.slice(maxResults) group 空集', () => {
    // GROUP_KEYS 只含 name/attrNames/childTitle/childUrl/namePy/childTitlePy，**不含 childNotes**。
    // 故 query 命中 bm.notes 时，含该 bm 的 group 经 childTitle/childUrl 都不会被命中 → groupResults 空。
    const bookmarks = [
      bm({ id: 'bm-note', title: '普通标题', url: 'https://normal.example', notes: 'NotesOnlyTokenAAA' }),
    ]
    const groups = [
      grp({ id: 'gn', name: '某组', bookmarkIds: ['bm-note'] }),
    ]
    const map = Object.fromEntries(bookmarks.map(b => [b.id, b]))
    const results = searchWithHighlights(bookmarks, groups, 'NotesOnlyTokenAAA', map, EMPTY_ATTRS, 8)
    // bm 命中 notes
    expect(results.some(r => r.id === 'bm-note' && !r._isGroup)).toBe(true)
    // group 不被命中（groupResults 空 → return bookmarkResults.slice(maxResults)，不含组）
    expect(results.filter(r => r._isGroup)).toHaveLength(0)
  })

  it('同时命中 group 与 bm → 合并返回 [...groupResults, ...bookmarkResults].slice(maxResults+GROUP_SUGGEST_LIMIT) 且组在前', () => {
    // 用 query 前缀在 group name 与 bm title 各命中
    const bookmarks = [
      bm({ id: 'bm-jk', title: '飞机专用手册', url: 'https://feiji.example' }), // title 含「飞机」
    ]
    const groups = [
      grp({ id: 'g-jk', name: '飞机商务套件', bookmarkIds: ['bm-jk'] }), // name 含「飞机」
    ]
    const map = Object.fromEntries(bookmarks.map(b => [b.id, b]))
    const results = searchWithHighlights(bookmarks, groups, '飞机', map, EMPTY_ATTRS, 8)
    const groupRes = results.filter(r => r._isGroup)
    const bmRes = results.filter(r => !r._isGroup)
    expect(groupRes.length).toBeGreaterThanOrEqual(1)
    expect(bmRes.length).toBeGreaterThanOrEqual(1)
    // 组在书签前（合并顺序 [...group, ...bm]）
    const firstGroupIdx = results.findIndex(r => r._isGroup)
    const firstBmIdx = results.findIndex(r => !r._isGroup)
    expect(firstGroupIdx).toBeLessThan(firstBmIdx)
    expect(firstGroupIdx).toBeGreaterThanOrEqual(0)
    // 长度封顶 maxResults + GROUP_SUGGEST_LIMIT(4) = 12
    expect(results.length).toBeLessThanOrEqual(12)
  })
})

// ── 降级路径编排（vi.doMock 双拦 + resetModules） ──
// 锁 M10 修复：旧实现降级仅 return 书签不搜组；修复后降级同条件搜组并合并。
describe('searchWithHighlights 降级编排（fuse/pinyin 加载失败 → includes 降级）', () => {
  async function importDegradedSearch() {
    // 拦截两个动态 import 抛错 → ensureSearchLibs catch 设 _libsLoading=null、FuseClass 保 null
    vi.doMock('fuse.js', () => { throw new Error('fuse load failed (test)') })
    vi.doMock('pinyin-pro', () => { throw new Error('pinyin load failed (test)') })
    vi.resetModules()
    // 动态 import 拿到隔离模块实例（顶层 ensureSearchLibs 触发但 Promise reject）
    const mod = await import('../../lib/search.js')
    return mod
  }

  it('M10 降级修复：库加载失败时书签+组同时命中 → fallback 双结果合并返回（非仅书签）', async () => {
    const search = await importDegradedSearch()
    const bookmarks = [
      bm({ id: 'fb1', title: '降级命中BM', url: 'https://deg.example' }),
    ]
    const groups = [
      grp({ id: 'fg1', name: '降级命中组', bookmarkIds: ['fb1'] }),
    ]
    const map = Object.fromEntries(bookmarks.map(b => [b.id, b]))
    // query 「降级」同时命中 bm title 和 group name（includes 降级路径）
    const results = search.searchWithHighlights(bookmarks, groups, '降级', map, EMPTY_ATTRS, 8)
    // M10 修复：旧实现此处仅 return 书签，组被漏；修复后组与书签都返回
    const groupRes = results.filter(r => r._isGroup)
    const bmRes = results.filter(r => !r._isGroup)
    expect(groupRes.length).toBeGreaterThanOrEqual(1)
    expect(bmRes.length).toBeGreaterThanOrEqual(1)
    expect(groupRes.find(r => r.id === 'fg1')).toBeDefined()
    expect(bmRes.find(r => r.id === 'fb1')).toBeDefined()
    // 降级无高亮（_highlights 空对象）
    expect(bmRes[0]._highlights).toEqual({})
  })

  it('降级：仅 group 命中（无书签命中）→ return groupResults.slice(maxResults) 不含书签', async () => {
    const search = await importDegradedSearch()
    const bookmarks = [
      bm({ id: 'fb-noise', title: '噪音', url: 'https://noise.example' }), // 不含「仅组态」
    ]
    const groups = [
      grp({ id: 'fg-only', name: '仅组态势', bookmarkIds: ['fb-noise'] }),
    ]
    const map = Object.fromEntries(bookmarks.map(b => [b.id, b]))
    // query 「仅组态势」只命中 group name（书签 title/url/notes/username/attrNames 都不含）
    const results = search.searchWithHighlights(bookmarks, groups, '仅组态势', map, EMPTY_ATTRS, 8)
    const groupRes = results.filter(r => r._isGroup)
    const bmRes = results.filter(r => !r._isGroup)
    expect(groupRes.length).toBeGreaterThanOrEqual(1)
    expect(groupRes.find(r => r.id === 'fg-only')).toBeDefined()
    expect(bmRes.length).toBe(0)
    // 降级 group result 有 _displayTitle（name 或「未命名组」兜底）
    expect(groupRes.find(r => r.id === 'fg-only')!._displayTitle).toBe('仅组态势')
  })

  it('降级：仅 bm 命中（无 group 命中）→ return bookmarkResults.slice(maxResults) 不含组', async () => {
    const search = await importDegradedSearch()
    // 用 bm.username 独有命中（fallback 含 username）：group 不索引 child username → group 不命中
    const bookmarks = [
      bm({ id: 'fb-un', title: '普通', url: 'https://n.example', username: 'UnIQusernameTOKEN' }),
    ]
    const groups = [
      grp({ id: 'fg-un', name: '组名称不含该 token', bookmarkIds: ['fb-un'] }),
    ]
    const map = Object.fromEntries(bookmarks.map(b => [b.id, b]))
    const results = search.searchWithHighlights(bookmarks, groups, 'UnIQusernameTOKEN', map, EMPTY_ATTRS, 8)
    const bmRes = results.filter(r => !r._isGroup)
    expect(bmRes.find(r => r.id === 'fb-un')).toBeDefined()
    // group 不被 username 命中（fallback group 不索引 child username）
    expect(results.find(r => r._isGroup && r.id === 'fg-un')).toBeUndefined()
  })

  it('降级 group result 含原 bookmarkIds 精确透传（与正常路径 D2-2 一致）', async () => {
    const search = await importDegradedSearch()
    const bookmarks = [
      bm({ id: 'fb-td', title: '降级组透传', url: 'https://td.example' }),
      bm({ id: 'fb-td2', title: '第二', url: 'https://td2.example' }),
    ]
    const groups = [
      grp({ id: 'fg-td', name: '降级组透传分组', bookmarkIds: ['fb-td', 'fb-td2'] }),
    ]
    const map = Object.fromEntries(bookmarks.map(b => [b.id, b]))
    const results = search.searchWithHighlights(bookmarks, groups, '降级组透传', map, EMPTY_ATTRS, 8)
    const g = results.find(r => r.id === 'fg-td' && r._isGroup)
    expect(g).toBeDefined()
    expect(g!.bookmarkIds).toEqual(['fb-td', 'fb-td2'])
  })
})
