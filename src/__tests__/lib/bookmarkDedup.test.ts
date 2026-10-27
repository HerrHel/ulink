import { describe, it, expect } from 'vitest'
import { findBestParentBookmark, isUrlSuffixVariant, isExactDuplicate } from '../../lib/bookmarkDedup.js'
import type { Bookmark } from '../../types.js'

function makeBookmark(overrides: Partial<Bookmark>): Bookmark {
  return {
    id: 'bm_' + Math.random().toString(36).slice(2, 8),
    title: 'Test Bookmark',
    url: 'https://example.com',
    icon: '',
    username: '',
    password: '',
    notes: '',
    categoryId: 'cat_default',
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('findBestParentBookmark — 智能识别最匹配的父级书签', () => {
  it('同域名子路径匹配：现有根域名书签作为父级', () => {
    const parentBm = makeBookmark({ id: 'parent_1', title: 'GitHub', url: 'https://github.com' })
    const otherBm = makeBookmark({ id: 'other_1', title: 'Google', url: 'https://google.com' })
    const bookmarks = [otherBm, parentBm]

    const matched = findBestParentBookmark('https://github.com/vuejs/core', bookmarks)
    expect(matched).toBeDefined()
    expect(matched?.id).toBe('parent_1')
  })

  it('多级路径匹配：优先选择最长路径匹配的前缀', () => {
    const rootBm = makeBookmark({ id: 'bm_root', title: 'Example Root', url: 'https://example.com' })
    const blogBm = makeBookmark({ id: 'bm_blog', title: 'Example Blog', url: 'https://example.com/blog' })
    const newsBm = makeBookmark({ id: 'bm_news', title: 'Example News', url: 'https://example.com/news' })
    const bookmarks = [rootBm, blogBm, newsBm]

    // 应该匹配 bm_blog 而不是 bm_root
    const matched = findBestParentBookmark('https://example.com/blog/2026/article-1', bookmarks)
    expect(matched?.id).toBe('bm_blog')
  })

  it('子域名归属匹配：主站书签自动作为二级域名站点的父级', () => {
    const dockerRoot = makeBookmark({ id: 'bm_docker', title: 'Docker', url: 'https://docker.com' })
    const bookmarks = [dockerRoot]

    const matched = findBestParentBookmark('https://docs.docker.com/engine/install', bookmarks)
    expect(matched?.id).toBe('bm_docker')
  })

  it('同域名同路径完全重复时跳过（不构成父子关系）', () => {
    const existing = makeBookmark({ id: 'bm_exact', title: 'GitHub', url: 'https://github.com/' })
    const bookmarks = [existing]

    const matched = findBestParentBookmark('https://github.com', bookmarks)
    expect(matched).toBeNull()
  })

  it('排除已软删除的书签', () => {
    const deletedParent = makeBookmark({
      id: 'bm_del',
      title: 'GitHub Deleted',
      url: 'https://github.com',
      deletedAt: Date.now(),
    })
    const bookmarks = [deletedParent]

    const matched = findBestParentBookmark('https://github.com/vuejs/core', bookmarks)
    expect(matched).toBeNull()
  })

  it('排除本身就是子书签的条目（仅支持单层父子关系）', () => {
    const childBm = makeBookmark({
      id: 'bm_sub',
      title: 'GitHub Org',
      url: 'https://github.com/vuejs',
      parentId: 'bm_top',
    })
    const bookmarks = [childBm]

    const matched = findBestParentBookmark('https://github.com/vuejs/core', bookmarks)
    expect(matched).toBeNull()
  })

  it('排除自身 ID（编辑书签时避免将自身选为父级）', () => {
    const selfBm = makeBookmark({
      id: 'bm_self',
      title: 'GitHub',
      url: 'https://github.com',
    })
    const bookmarks = [selfBm]

    const matched = findBestParentBookmark('https://github.com/vuejs/core', bookmarks, 'bm_self')
    expect(matched).toBeNull()
  })

  it('输入非法或超短 URL 安全返回 null', () => {
    const parentBm = makeBookmark({ id: 'bm_1', url: 'https://github.com' })
    expect(findBestParentBookmark('', [parentBm])).toBeNull()
    expect(findBestParentBookmark('   ', [parentBm])).toBeNull()
    expect(findBestParentBookmark('abc', [parentBm])).toBeNull()
    expect(findBestParentBookmark('http://', [parentBm])).toBeNull()
    expect(findBestParentBookmark('not a valid url!@#$', [parentBm])).toBeNull()
  })
})

describe('bookmarkDedup 基础判定函数直测', () => {
  it('isUrlSuffixVariant 判定后缀变体', () => {
    expect(isUrlSuffixVariant('https://example.com', 'https://example.com/page')).toBe(true)
    expect(isUrlSuffixVariant('https://example.com/foo', 'https://example.com/foo/bar')).toBe(true)
    expect(isUrlSuffixVariant('https://example.com/foo', 'https://example.com/bar')).toBe(false)
    expect(isUrlSuffixVariant('https://a.com', 'https://b.com')).toBe(false)
  })

  it('isExactDuplicate 判定完全重复', () => {
    expect(isExactDuplicate('https://example.com', 'https://example.com/')).toBe(true)
    expect(isExactDuplicate('https://example.com/page', 'https://example.com/page')).toBe(true)
    expect(isExactDuplicate('https://example.com/page1', 'https://example.com/page2')).toBe(false)
  })
})
