/**
 * 小宫格 = 图标启动器：BookmarkCard / GroupCard 在 CardGrid 注入 tileLayout=true 时
 * 渲染「图标 + 名字」瓦片，组渲染为 2×2 成员图标文件夹；未注入（辅助栏等复用场景）
 * 保持原卡片结构。根元素 .card[data-id] / .group-card[data-group-id] 不变，保证右键、
 * 拖拽、长按等按选择器挂的全局交互不受影响。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, h } from 'vue'

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const mocks = vi.hoisted(() => ({ openBookmark: vi.fn(), toggleGroupFocus: vi.fn() }))
vi.mock('../../composables/domain/useBookmark.js', () => ({
  openBmModal: vi.fn(), deleteBookmarkWithUndo: vi.fn(), addSub: vi.fn(), openBookmark: mocks.openBookmark,
}))
vi.mock('../../composables/domain/useGroup.js', () => ({
  editGroup: vi.fn(), toggleGroupFocus: mocks.toggleGroupFocus, saveGroupBody: vi.fn(), deleteGroup: vi.fn(),
}))
vi.mock('../../crypto.js', async (orig) => ({ ...(await orig() as any), decryptPasswordWithKey: vi.fn(async () => '') }))

import BookmarkCard from '../../components/cards/BookmarkCard.vue'
import GroupCard from '../../components/cards/GroupCard.vue'
import { provideTileLayout, tileHue } from '../../components/cards/tileLayout.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'

function bm(id: string, title: string, url: string, over: Record<string, unknown> = {}) {
  return { id, title, url, icon: '', username: '', password: '', notes: '', categoryId: 'c1', parentId: null, order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1, deletedAt: null, ...over }
}

function withTile(child: any, props: Record<string, unknown>, tile = true) {
  const Host = defineComponent({
    setup() {
      provideTileLayout(computed(() => tile))
      return () => h(child, props)
    },
  })
  return mount(Host, { global: { stubs: { GroupEditor: true, BrandLogo: true } } })
}

let ds: ReturnType<typeof useDataStore>
beforeEach(() => {
  vi.clearAllMocks()
  ds = useDataStore()
  ds.bookmarks = [
    bm('b1', 'Vue 官网', 'https://vuejs.org', { notes: '渐进式框架', pinnedAt: 5 }),
    bm('b2', 'GitHub', 'https://github.com'),
    bm('b3', '', 'https://example.com'),
  ] as any
  ds.siblingGroups = [{ id: 'g1', name: '前端', categoryId: 'c1', icon: '', order: 1, isExpanded: false, attributes: {}, bookmarkIds: ['b1', 'b2', 'b3'], notes: '', updatedAt: 1 }] as any
  ds.categories = [{ id: 'c1', name: 'C', icon: '', color: '' }] as any
  ds.customAttributes = []
  ;(ds as any)._syncMaps()
  const ui = useUIStore()
  ui.layoutMode = 'mini-grid'
  ui.batchMode = false
  ui.focusedGroupId = null
})

describe('小宫格图标启动器', () => {
  it('书签瓦片只渲染图标 + 名字，保留 .card[data-id] 根节点，悬停提示含域名与摘要', () => {
    const w = withTile(BookmarkCard, { bookmark: ds.bookmarks[0] })
    const root = w.find('.card')
    expect(root.classes()).toContain('card-tile')
    expect(root.attributes('data-id')).toBe('b1')
    expect(w.find('.tile-icon').exists()).toBe(true)
    expect(w.find('.tile-name').text()).toBe('Vue 官网')
    expect(w.find('.tile-badge-pin').exists()).toBe(true)
    expect(w.find('.card-foot').exists()).toBe(false)
    expect(w.find('.card-body').exists()).toBe(false)
    const tip = root.attributes('title') || ''
    expect(tip).toContain('vuejs.org')
    expect(tip).toContain('渐进式框架')
  })

  it('无标题时名字回退域名，首字母兜底按域名稳定取色', () => {
    const w = withTile(BookmarkCard, { bookmark: ds.bookmarks[2] })
    expect(w.find('.tile-name').text()).toBe('example.com')
    expect(w.find('.card-logo-fallback').text()).toBe('E')
    expect(w.find('.tile-icon').attributes('style')).toContain(`--tile-hue: ${tileHue('example.com')}`)
  })

  it('点击瓦片打开书签', async () => {
    const w = withTile(BookmarkCard, { bookmark: ds.bookmarks[1] })
    await w.find('.card').trigger('click')
    expect(mocks.openBookmark).toHaveBeenCalledTimes(1)
  })

  it('未注入 tileLayout（辅助栏等复用）保持原卡片结构', () => {
    const w = withTile(BookmarkCard, { bookmark: ds.bookmarks[0] }, false)
    expect(w.find('.card').classes()).not.toContain('card-tile')
    expect(w.find('.card-topline').exists()).toBe(true)
  })

  it('组渲染为文件夹：最多 4 个成员图标 + 成员数角标，点击进入组', async () => {
    const w = withTile(GroupCard, { group: ds.siblingGroups[0] })
    const root = w.find('.group-card')
    expect(root.classes()).toContain('card-tile')
    expect(root.attributes('data-group-id')).toBe('g1')
    expect(w.findAll('.tile-folder-cell')).toHaveLength(3)
    expect(w.find('.tile-badge-count').text()).toBe('3')
    expect(w.find('.tile-name').text()).toBe('前端')
    await root.trigger('click')
    expect(mocks.toggleGroupFocus).toHaveBeenCalledWith('g1')
  })

  it('tileHue 稳定且忽略 www. 与大小写', () => {
    expect(tileHue('www.Example.com')).toBe(tileHue('example.com'))
    expect(tileHue('a')).toBeGreaterThanOrEqual(0)
    expect(tileHue('a')).toBeLessThan(360)
  })
})
