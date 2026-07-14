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
})

describe('clearSearchCache', () => {
  it('clears all caches (runs without error)', () => {
    searchBookmarkIds(SAMPLE_BOOKMARKS, 'GitHub', EMPTY_ATTRS)
    searchGroupIds(SAMPLE_GROUPS, '开发', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(() => clearSearchCache()).not.toThrow()
  })
})
