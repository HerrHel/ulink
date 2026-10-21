import { describe, it, expect, beforeEach } from 'vitest'
import { findSerendipityMatches } from '../../lib/ai/serendipityEngine.js'
import { evolvingGraph } from '../../lib/ai/evolvingGraph.js'
import type { Bookmark } from '../../types.js'

function mockBookmark(partial: Partial<Bookmark>): Bookmark {
  return {
    id: partial.id || 'b_test',
    title: partial.title || 'Test Bookmark',
    url: partial.url || 'https://example.com',
    username: '',
    password: '',
    notes: partial.notes || '',
    icon: '',
    categoryId: partial.categoryId || 'cat1',
    parentId: null,
    order: partial.order ?? 1,
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: partial.updatedAt ?? Date.now(),
    ...partial,
  } as Bookmark
}

describe('serendipityEngine', () => {
  beforeEach(() => {
    evolvingGraph.clear()
  })

  it('returns empty array when target has minimal tokens or library is empty', () => {
    const target = mockBookmark({
      id: 'b1',
      title: 'a',
      url: 'https://example.com',
      categoryId: 'cat1',
    })
    const matches = findSerendipityMatches(target, [])
    expect(matches).toEqual([])
  })

  it('excludes bookmarks from the same domain or identical url', () => {
    const now = Date.now()
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

    const target = mockBookmark({
      id: 'b1',
      title: 'Vue 3 Composition API Guide',
      url: 'https://vuejs.org/guide/composition-api',
      categoryId: 'cat1',
      createdAt: now,
      updatedAt: now,
    })

    const sameDomain = mockBookmark({
      id: 'b2',
      title: 'Vue 3 Reactivity in Depth Guide',
      url: 'https://vuejs.org/guide/reactivity',
      categoryId: 'cat1',
      createdAt: thirtyDaysAgo,
      updatedAt: thirtyDaysAgo,
    })

    const matches = findSerendipityMatches(target, [sameDomain])
    expect(matches).toHaveLength(0)
  })

  it('detects cross-domain serendipity match and applies temporal boost', () => {
    const now = Date.now()
    const fortyDaysAgo = now - 40 * 24 * 60 * 60 * 1000

    const target = mockBookmark({
      id: 'b1',
      title: 'Rust Memory Safety and Concurrency Patterns',
      url: 'https://blog.rust-lang.org/safe-concurrency',
      categoryId: 'cat_rust',
      createdAt: now,
      updatedAt: now,
    })

    const candidateOld = mockBookmark({
      id: 'b2',
      title: 'Concurrency Patterns and Memory Management in Go',
      url: 'https://golang.org/blog/concurrency-patterns',
      categoryId: 'cat_go',
      createdAt: fortyDaysAgo,
      updatedAt: fortyDaysAgo,
    })

    const matches = findSerendipityMatches(target, [candidateOld], {
      minDaysAgo: 10,
      minScore: 0.15,
    })

    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].candidate.id).toBe('b2')
    expect(matches[0].daysAgo).toBeGreaterThanOrEqual(39)
    expect(matches[0].serendipityScore).toBeGreaterThan(matches[0].similarity)
  })
})
