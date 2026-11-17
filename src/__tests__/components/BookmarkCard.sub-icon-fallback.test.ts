/**
 * BookmarkCard — 子书签图标加载失败的回退链
 * 验收点：子书签图标加载失败 → 先换父书签（本卡片）的图标 → 父图标也失败再降级首字母占位；
 * 之后不再反复切换（防 error 事件死循环）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// jsdom 无 ResizeObserver；useCardOverflow 挂载时 new ResizeObserver
if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

vi.mock('../../composables/domain/useBookmark.js', () => ({
  openBmModal: vi.fn(),
  deleteBookmarkWithUndo: vi.fn(),
  addSub: vi.fn(),
  openBookmark: vi.fn(),
}))
vi.mock('../../composables/ui/useUI.js', () => ({ openDetail: vi.fn(), openQuickLook: vi.fn() }))
vi.mock('../../composables/domain/useAttrFilter.js', () => ({ toggleAttrFilter: vi.fn() }))
vi.mock('../../lib/preview.js', () => ({ bookmarkPreview: vi.fn(() => '') }))
vi.mock('../../lib/toast.js', () => ({ toast: vi.fn() }))
vi.mock('../../composables/ui/useInlineEdit.js', () => ({ useInlineEdit: () => ({ startEditing: vi.fn() }) }))
vi.mock('../../composables/domain/useDeadLinkChecker.js', () => ({
  useDeadLinkChecker: () => ({ isUnconfirmed: () => false, getResult: () => null, isDead: () => false, isBlocked: () => false } as any),
}))

import BookmarkCard from '../../components/cards/BookmarkCard.vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { favicon, faviconInitials } from '../../utils.js'
import type { Bookmark } from '../../types.js'

function makeBm(over: Partial<Bookmark>): Bookmark {
  return {
    id: 'x', title: 'X', url: 'https://x.test', icon: '', username: '', password: '', notes: '',
    categoryId: 'c1', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false,
    createdAt: 1, updatedAt: 1, deletedAt: null, ...over,
  } as Bookmark
}

const PARENT_URL = 'https://www.deepseek.com/'
const CHILD_URL = 'https://chat.deepseek.com/'

function mountWithChild(parentOver: Partial<Bookmark> = {}, childOver: Partial<Bookmark> = {}) {
  const parent = makeBm({ id: 'p', title: 'DeepSeek', url: PARENT_URL, ...parentOver })
  const child = makeBm({ id: 'c', title: '开始对话', url: CHILD_URL, parentId: 'p', ...childOver })
  const ds = useDataStore()
  ds.bookmarks = [parent, child]
  ds.categories = [{ id: 'c1', name: 'C', icon: '', color: '' }] as any
  ds.customAttributes = []
  ;(ds as any)._syncMaps()
  const w = mount(BookmarkCard, { props: { bookmark: parent } })
  const img = w.find('.sub-sites .group-inline-card img')
  return { w, img, parent, child }
}

beforeEach(() => {
  const ui = useUIStore()
  ui.searchQuery = ''
  ui.layoutMode = 'grid'
  ui.batchMode = false
})

describe('BookmarkCard — 子书签图标回退父书签图标', () => {
  it('初始渲染用子书签自己的图标', () => {
    const { img } = mountWithChild()
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe(favicon(CHILD_URL))
  })

  it('子书签图标加载失败：回退为父书签图标', async () => {
    const { img } = mountWithChild()
    await img.trigger('error')
    expect(img.attributes('src')).toBe(favicon(PARENT_URL))
    expect((img.element as HTMLImageElement).dataset.fallback).toBe('parent')
  })

  it('父书签设了自定义图标时，回退用的是这个自定义图标', async () => {
    const { img } = mountWithChild({ icon: 'https://cdn.test/whale.png' })
    await img.trigger('error')
    expect(img.attributes('src')).toBe('https://cdn.test/whale.png')
  })

  it('父图标也加载失败：降级首字母占位，之后不再切换', async () => {
    const { img } = mountWithChild()
    await img.trigger('error')
    await img.trigger('error')
    const initials = faviconInitials('开始对话')
    expect(img.attributes('src')).toBe(initials)
    expect((img.element as HTMLImageElement).dataset.fallback).toBe('initials')
    await img.trigger('error')
    expect(img.attributes('src')).toBe(initials)
  })

  it('子书签与父书签图标地址相同时不做无意义重试，直接降级首字母占位', async () => {
    const { img } = mountWithChild({}, { url: 'https://www.deepseek.com/usage' })
    expect(img.attributes('src')).toBe(favicon(PARENT_URL))
    await img.trigger('error')
    expect(img.attributes('src')).toBe(faviconInitials('开始对话'))
  })
})
