/**
 * ExtPanelCurrentPage — 本站回想（扩展侧边栏当前页卡片下方「你在这个网站存过 N 条」）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

const openBookmark = vi.fn()
vi.mock('../../composables/domain/useBookmark.js', () => ({ openBookmark: (...a: unknown[]) => openBookmark(...a) }))
vi.mock('../../composables/useExtPanel.js', () => ({ openPanelSave: vi.fn() }))

import ExtPanelCurrentPage from '../../components/shell/ExtPanelCurrentPage.vue'
import { useExtPanelStore } from '../../stores/extPanel.js'
import { useDataStore } from '../../stores/data.js'
import { setLocale, loadLocale } from '../../i18n/index.js'
import type { Bookmark } from '../../types.js'

function makeBm(over: Partial<Bookmark>): Bookmark {
  return {
    id: 'x', title: 'X', url: 'https://x.test', icon: '', username: '', password: '', notes: '',
    categoryId: 'c1', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false,
    createdAt: 1, updatedAt: 1, deletedAt: null, ...over,
  } as Bookmark
}

function setup(bookmarks: Bookmark[], tabUrl: string, matchedId: string | null = null) {
  const ds = useDataStore()
  ds.bookmarks = bookmarks
  const store = useExtPanelStore()
  store.active = true
  store.tab = { url: tabUrl, title: 'Page', description: '', selection: '', icon: '' }
  store.matchedId = matchedId
  return { w: mount(ExtPanelCurrentPage), store }
}

beforeEach(() => {
  openBookmark.mockReset()
  setLocale('zh-CN')
})

describe('ExtPanelCurrentPage 本站回想', () => {
  it('当前网站没有存过任何书签时不显示', () => {
    const { w } = setup([makeBm({ id: 'a', url: 'https://other.com/' })], 'https://github.com/x')
    expect(w.find('[data-testid="lv-ext-site-recall"]').exists()).toBe(false)
  })

  it('列出同站书签与备注摘要，排除当前页本身，点击即打开', async () => {
    const cur = makeBm({ id: 'cur', url: 'https://github.com/x' })
    const docs = makeBm({ id: 'docs', title: 'GitHub Docs', url: 'https://docs.github.com/', notes: '<p>查 Actions 语法</p>' })
    const { w } = setup([cur, docs], 'https://github.com/x', 'cur')
    const box = w.find('[data-testid="lv-ext-site-recall"]')
    expect(box.text()).toContain('你在 github.com 还存过 1 条')
    const items = w.findAll('[data-testid="lv-ext-site-item"]')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('GitHub Docs')
    expect(items[0].text()).toContain('查 Actions 语法')
    await items[0].trigger('click')
    expect(openBookmark).toHaveBeenCalledWith(expect.objectContaining({ id: 'docs' }))
  })

  it('超过 3 条时折叠，可展开与收起', async () => {
    const list = [1, 2, 3, 4, 5].map(i => makeBm({ id: 'b' + i, url: 'https://github.com/' + i }))
    const { w } = setup(list, 'https://github.com/new')
    expect(w.text()).toContain('你在 github.com 存过 5 条')
    expect(w.findAll('[data-testid="lv-ext-site-item"]')).toHaveLength(3)
    const toggle = w.find('[data-testid="lv-ext-site-toggle"]')
    expect(toggle.text()).toBe('展开其余 2 条')
    await toggle.trigger('click')
    expect(w.findAll('[data-testid="lv-ext-site-item"]')).toHaveLength(5)
    expect(toggle.text()).toBe('收起')
  })

  it('切换到别的网站时自动收起', async () => {
    const list = [1, 2, 3, 4].map(i => makeBm({ id: 'b' + i, url: 'https://github.com/' + i }))
      .concat([1, 2, 3, 4].map(i => makeBm({ id: 'g' + i, url: 'https://gitlab.com/' + i })))
    const { w, store } = setup(list, 'https://github.com/new')
    await w.find('[data-testid="lv-ext-site-toggle"]').trigger('click')
    expect(w.findAll('[data-testid="lv-ext-site-item"]')).toHaveLength(4)
    store.tab = { url: 'https://gitlab.com/new', title: 'Page', description: '', selection: '', icon: '' }
    await w.vm.$nextTick()
    expect(w.findAll('[data-testid="lv-ext-site-item"]')).toHaveLength(3)
  })

  it('英文界面按单复数显示', async () => {
    setLocale('en-US')
    await loadLocale('en-US')
    const { w } = setup([makeBm({ id: 'a', url: 'https://github.com/a' })], 'https://github.com/x')
    expect(w.find('.ext-site-head').text()).toBe('You saved 1 page on github.com')
  })
})
