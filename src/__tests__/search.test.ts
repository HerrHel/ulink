import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { searchBookmarkIds, searchGroupIds, searchWithHighlights, clearSearchCache, preloadSearchLibs } from '../lib/search.js'
import type { Bookmark, SiblingGroup, CustomAttribute } from '../types.js'

beforeAll(async () => {
  await preloadSearchLibs()
})

const EMPTY_ATTRS: CustomAttribute[] = []

const SAMPLE_BOOKMARKS: Bookmark[] = [
  { id: 'b1', title: 'GitHub', url: 'https://github.com', notes: '代码托管', username: 'user1', password: '', icon: '', categoryId: 'tools', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0 },
  { id: 'b2', title: 'MDN Web Docs', url: 'https://developer.mozilla.org', notes: 'Web 开发文档', username: '', password: '', icon: '', categoryId: 'dev', parentId: null, order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0 },
  { id: 'b3', title: 'Vue.js', url: 'https://vuejs.org', notes: '前端框架', username: '', password: '', icon: '', categoryId: 'dev', parentId: null, order: 2, useCount: 0, attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0 },
]

const SAMPLE_GROUPS: SiblingGroup[] = [
  { id: 'g1', name: '开发工具', categoryId: 'dev', icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: ['b1'], notes: '', updatedAt: 0, useCount: 0 },
  { id: 'g2', name: '学习资源', categoryId: 'edu', icon: '', order: 1, isExpanded: false, attributes: {}, bookmarkIds: ['b2', 'b3'], notes: '', updatedAt: 0, useCount: 0 },
]

const BOOKMARK_MAP: Record<string, Bookmark> = Object.fromEntries(SAMPLE_BOOKMARKS.map(b => [b.id, b]))

describe('searchBookmarkIds', () => {
  beforeEach(() => clearSearchCache())

  it('returns null for empty query', () => {
    expect(searchBookmarkIds(SAMPLE_BOOKMARKS, '', EMPTY_ATTRS)).toBeNull()
    expect(searchBookmarkIds(SAMPLE_BOOKMARKS, '  ', EMPTY_ATTRS)).toBeNull()
  })

  it('finds bookmarks by title', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'GitHub', EMPTY_ATTRS)
    expect(result).toBeInstanceOf(Set)
    expect(result!.has('b1')).toBe(true)
    expect(result!.has('b2')).toBe(false)
  })

  it('finds bookmarks by URL', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'vuejs', EMPTY_ATTRS)
    expect(result!.has('b3')).toBe(true)
  })

  it('finds bookmarks by notes', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, '代码', EMPTY_ATTRS)
    expect(result!.has('b1')).toBe(true)
  })

  it('finds bookmarks by username', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'user1', EMPTY_ATTRS)
    expect(result!.has('b1')).toBe(true)
  })

  it('multiple bookmarks can match same query', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'Web', EMPTY_ATTRS)
    expect(result!.has('b2')).toBe(true)
  })

  it('partial match works', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'Git', EMPTY_ATTRS)
    expect(result!.has('b1')).toBe(true)
  })

  it('returns empty set for no match', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'zzzznonexistent', EMPTY_ATTRS)
    expect(result!.size).toBe(0)
  })

  it('M21：中文标题可用拼音全拼/首字母搜到（titlePy 索引）', () => {
    // search.ts 把 titlePy/notesPy 作为 Fuse 搜索键，拼音匹配是中文搜索核心能力。
    // 组「开发工具」全拼 kaifa 命中；书签 b1 notes='代码托管' 全拼 daima 命中。
    const byGroupTitle = searchGroupIds(SAMPLE_GROUPS, 'kaifa', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(byGroupTitle!.has('g1')).toBe(true)
    const byNotesPy = searchBookmarkIds(SAMPLE_BOOKMARKS, 'daima', EMPTY_ATTRS)
    expect(byNotesPy!.has('b1')).toBe(true)
  })

  it('M21：书签标题拼音全拼命中 + 组 childTitlePy 命中', () => {
    // 「测试」→ ceshi；组 g2 子书签 Vue.js 用 childTitle 命中已有，这里加中文 title 书签
    const bms: Bookmark[] = [
      ...SAMPLE_BOOKMARKS,
      {
        id: 'b-ceshi', title: '测试文档', url: 'https://test.example', notes: '', username: '',
        password: '', icon: '', categoryId: 'dev', parentId: null, order: 9, useCount: 0,
        attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0,
      },
    ]
    const groups: SiblingGroup[] = [
      ...SAMPLE_GROUPS,
      {
        id: 'g-cs', name: '普通组', categoryId: 'dev', icon: '', order: 9, isExpanded: false,
        attributes: {}, bookmarkIds: ['b-ceshi'], notes: '', updatedAt: 0, useCount: 0,
      },
    ]
    const map = Object.fromEntries(bms.map(b => [b.id, b]))
    const byTitlePy = searchBookmarkIds(bms, 'ceshi', EMPTY_ATTRS)
    expect(byTitlePy!.has('b-ceshi')).toBe(true)
    // childTitlePy：子书签「测试文档」的拼音应让组被搜到
    const byChildPy = searchGroupIds(groups, 'ceshi', map, EMPTY_ATTRS)
    expect(byChildPy!.has('g-cs')).toBe(true)
  })

  it('L6：降级（库未就绪）下 attrNames 匹配照常生效', () => {
    // L6：fallback includes 应覆盖 attrNames 字段，与正常 Fuse 路径一致。
    // 正常路径能搜到勾选某属性名的书签，降级路径也应能。
    const attrs: CustomAttribute[] = [{ id: 'attr-rl', name: '需登录', type: 'boolean' }]
    const bms: Bookmark[] = [{
      id: 'bl', title: '普通标题', url: 'https://normal.com', notes: '', username: '', password: '',
      icon: '', categoryId: 'x', parentId: null, order: 0, useCount: 0, attributes: { 'attr-rl': true },
      isExpanded: false, createdAt: 0, updatedAt: 0,
    }]
    // 搜属性名「登录」应命中 bl（无论 fuse 是否就绪，降级路径也包含 attrNames）
    const result = searchBookmarkIds(bms, '登录', attrs)
    expect(result!.has('bl')).toBe(true)
    // 搜属性名片段也命中
    const frag = searchBookmarkIds(bms, '需登', attrs)
    expect(frag!.has('bl')).toBe(true)
  })
})

describe('searchGroupIds', () => {
  beforeEach(() => clearSearchCache())

  it('returns null for empty query', () => {
    expect(searchGroupIds(SAMPLE_GROUPS, '', BOOKMARK_MAP, EMPTY_ATTRS)).toBeNull()
  })

  it('finds groups by name', () => {
    const result = searchGroupIds(SAMPLE_GROUPS, '开发工具', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(result!.has('g1')).toBe(true)
  })

  it('finds groups by child bookmark title', () => {
    const result = searchGroupIds(SAMPLE_GROUPS, 'GitHub', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(result!.has('g1')).toBe(true)
  })

  it('finds groups by child bookmark URL', () => {
    const result = searchGroupIds(SAMPLE_GROUPS, 'vuejs', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(result!.has('g2')).toBe(true)
  })

  it('returns empty set for no match', () => {
    const result = searchGroupIds(SAMPLE_GROUPS, 'zzzznonexistent', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(result!.size).toBe(0)
  })
})

describe('searchWithHighlights', () => {
  beforeEach(() => clearSearchCache())

  it('returns empty array for empty query', () => {
    expect(searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, '', BOOKMARK_MAP, EMPTY_ATTRS)).toEqual([])
  })

  it('returns results with highlights for matching bookmarks', () => {
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, 'GitHub', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(results.length).toBeGreaterThan(0)
    const gh = results.find(r => r.id === 'b1')
    expect(gh).toBeDefined()
    expect(gh!._highlights).toBeDefined()
  })

  it('returns results with highlights for matching groups', () => {
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, '学习', BOOKMARK_MAP, EMPTY_ATTRS)
    const g = results.find(r => r.id === 'g2')
    expect(g).toBeDefined()
    expect(g!._isGroup).toBe(true)
  })

  it('respects maxResults param', () => {
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, 'a', BOOKMARK_MAP, EMPTY_ATTRS, 2)
    expect(results.length).toBeLessThanOrEqual(6)
  })

  it('returns empty for no match', () => {
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, 'zzzznonexistent', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(results).toEqual([])
  })

  it('M8：拼音命中时不输出拼音串作高亮段（避免建议项显示拼音乱码）', () => {
    // M8 根因：拼音字段映射 titlePy->'title'，query 只命中拼音索引时 match.value 是拼音串
    // （如 'kaiFaGongJu'），_buildHighlightSegments 用拼音串作 text 生成段，建议项渲染拼音字符
    // 而非中文原文。修复：拼音 key 命中时跳过段生成，渲染层用 fallback 原文显示。
    // 用拼音搜中文标题——命中后检查 title 段不含拼音拉丁字母串。
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, 'kaifa', BOOKMARK_MAP, EMPTY_ATTRS)
    // 至少命中「开发工具」组或「代码托管」书签
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      const segs = r._highlights.title || r._highlights.name || []
      const allText = segs.map(s => s.text).join('')
      // 不应出现整段拉丁拼音串（aa-zz 大量连续拉丁字符的拼音）
      expect(/[a-zA-Z]{6,}/.test(allText)).toBe(false)
    }
  })
})

describe('clearSearchCache', () => {
  it('clears all caches (runs without error)', () => {
    searchBookmarkIds(SAMPLE_BOOKMARKS, 'GitHub', EMPTY_ATTRS)
    searchGroupIds(SAMPLE_GROUPS, '开发', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(() => clearSearchCache()).not.toThrow()
  })
})
