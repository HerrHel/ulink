import { describe, it, expect } from 'vitest'
import { runAmbientGroomingScan } from '../../lib/ai/ambientGrooming.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { Bookmark, Category, SiblingGroup } from '../../types.js'

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

function mockCategory(partial: Partial<Category>): Category {
  return {
    id: partial.id || 'cat1',
    name: partial.name || 'Category 1',
    icon: '',
    color: '#000000',
    order: partial.order ?? 1,
    ...partial,
  } as Category
}

describe('ambientGrooming', () => {
  it('returns no insights for a clean balanced library', () => {
    const bookmarks: Bookmark[] = [
      mockBookmark({
        id: 'b1',
        title: 'Bookmark 1',
        url: 'https://example.com/1',
        categoryId: 'cat1',
      }),
    ]
    const categories: Category[] = [
      mockCategory({ id: 'cat1', name: 'Work' }),
    ]
    const groups: SiblingGroup[] = []

    const insights = runAmbientGroomingScan({ bookmarks, groups, categories })
    expect(insights).toEqual([])
  })

  it('triggers inbox overflow insight when >= 8 uncategorized bookmarks exist', () => {
    const bookmarks: Bookmark[] = Array.from({ length: 9 }, (_, i) =>
      mockBookmark({
        id: `uncat_${i}`,
        title: `Uncategorized ${i}`,
        url: `https://example.com/u${i}`,
        categoryId: CAT_UNCATEGORIZED,
        order: i,
      }),
    )

    const insights = runAmbientGroomingScan({ bookmarks, groups: [], categories: [] })
    const inboxInsight = insights.find((i) => i.type === 'inbox')

    expect(inboxInsight).toBeDefined()
    expect(inboxInsight?.count).toBe(9)
    expect(inboxInsight?.suggestedActionCommand).toBe('/inbox')
  })

  it('triggers category drift insight when category has >= 25 bookmarks', () => {
    const categories: Category[] = [
      mockCategory({ id: 'cat_large', name: 'Machine Learning' }),
    ]
    const bookmarks: Bookmark[] = Array.from({ length: 26 }, (_, i) =>
      mockBookmark({
        id: `b_large_${i}`,
        title: `ML Paper ${i}`,
        url: `https://arxiv.org/abs/${i}`,
        categoryId: 'cat_large',
        order: i,
      }),
    )

    const insights = runAmbientGroomingScan({ bookmarks, groups: [], categories })
    const driftInsight = insights.find((i) => i.type === 'drift')

    expect(driftInsight).toBeDefined()
    expect(driftInsight?.count).toBe(26)
    expect(driftInsight?.targetCategoryId).toBe('cat_large')
    expect(driftInsight?.suggestedActionCommand).toContain('/pack Machine Learning')
  })

  it('does NOT trigger drift when a category has < 25 top-level cards, even with 100+ sub-bookmarks', () => {
    const categories: Category[] = [
      mockCategory({ id: 'cat_entertainment', name: '娱乐' }),
    ]
    // 10 顶层卡片
    const topBookmarks: Bookmark[] = Array.from({ length: 10 }, (_, i) =>
      mockBookmark({
        id: `bm_top_${i}`,
        title: `娱乐卡片 ${i}`,
        url: `https://ent.example.com/${i}`,
        categoryId: 'cat_entertainment',
        parentId: null,
      }),
    )
    // 104 个从属于第一张卡片的子书签
    const subBookmarks: Bookmark[] = Array.from({ length: 104 }, (_, i) =>
      mockBookmark({
        id: `bm_sub_${i}`,
        title: `子书签 ${i}`,
        url: `https://ent.example.com/sub/${i}`,
        categoryId: 'cat_entertainment',
        parentId: 'bm_top_0',
      }),
    )

    const insights = runAmbientGroomingScan({
      bookmarks: [...topBookmarks, ...subBookmarks],
      groups: [],
      categories,
    })
    const driftInsight = insights.find((i) => i.type === 'drift')

    // 严苛红线：子书签不参与分类卡片计数，总计 10 < 25，绝不误触发分类臃肿拆分！
    expect(driftInsight).toBeUndefined()
  })

  it('counts top-level sibling groups in category drift total', () => {
    const categories: Category[] = [
      mockCategory({ id: 'cat_hybrid', name: '综合' }),
    ]
    // 20 顶层书签 + 5 个组 = 25
    const bookmarks: Bookmark[] = Array.from({ length: 20 }, (_, i) =>
      mockBookmark({
        id: `bm_hyb_${i}`,
        title: `书签 ${i}`,
        url: `https://example.com/${i}`,
        categoryId: 'cat_hybrid',
      }),
    )
    const groups: SiblingGroup[] = Array.from({ length: 5 }, (_, i) => ({
      id: `grp_${i}`,
      name: `组 ${i}`,
      categoryId: 'cat_hybrid',
      bookmarkIds: [],
      createdAt: 1000,
      updatedAt: 1000,
    } as unknown as SiblingGroup))

    const insights = runAmbientGroomingScan({ bookmarks, groups, categories })
    const driftInsight = insights.find((i) => i.type === 'drift')

    expect(driftInsight).toBeDefined()
    expect(driftInsight?.count).toBe(25)
  })

  it('triggers vague bookmarks insight when >= 3 untitled or raw url cards exist', () => {
    const bookmarks: Bookmark[] = [
      mockBookmark({
        id: 'v1',
        title: 'https://example.com/raw1',
        url: 'https://example.com/raw1',
      }),
      mockBookmark({
        id: 'v2',
        title: '未命名书签',
        url: 'https://example.com/raw2',
      }),
      mockBookmark({
        id: 'v3',
        title: '',
        url: 'https://example.com/raw3',
      }),
    ]

    const insights = runAmbientGroomingScan({ bookmarks, groups: [], categories: [] })
    const vagueInsight = insights.find((i) => i.type === 'vague')

    expect(vagueInsight).toBeDefined()
    expect(vagueInsight?.count).toBe(3)
  })

  it('triggers duplicates insight when duplicate URLs are detected', () => {
    const bookmarks: Bookmark[] = [
      mockBookmark({
        id: 'd1',
        title: 'Github Repo',
        url: 'https://github.com/foo/bar',
        categoryId: 'cat1',
        createdAt: 1000,
        updatedAt: 1000,
      }),
      mockBookmark({
        id: 'd2',
        title: 'Github Repo Duplicate',
        url: 'https://github.com/foo/bar/',
        categoryId: 'cat2',
        createdAt: 2000,
        updatedAt: 2000,
      }),
      mockBookmark({
        id: 'd3',
        title: 'Another Duplicate',
        url: 'https://github.com/foo/bar?ref=home',
        categoryId: 'cat3',
        createdAt: 3000,
        updatedAt: 3000,
      }),
    ]

    const insights = runAmbientGroomingScan({ bookmarks, groups: [], categories: [] })
    const dupsInsight = insights.find((i) => i.type === 'duplicates')

    expect(dupsInsight).toBeDefined()
    expect(dupsInsight?.suggestedActionCommand).toBe('/dedup')
  })
})
