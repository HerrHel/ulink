/**
 * 回归护栏：搜索框搜索 → CardGrid ReferenceError: bookmark is not defined。
 *
 * 根因：BookmarkCard.vue script setup 中 hlTitle / hlNotes 两个 computed 裸引用 `bookmark`
 * 而非 `props.bookmark`。script setup 的 JS 代码不做模板作用域别名解析（模板里的 `bookmark`
 * 由编译器映射到 props，script 里的裸 `bookmark` 则直接 ReferenceError）。
 * 因 computed 惰性求值，只有 searchQuery 非空、模板 `<span v-if="searchQuery" v-html="hlTitle">`
 * 读取 hlTitle 时才触发——所以「一搜索就炸」，平时正常。
 *
 * tsc --noEmit 不解析 .vue 文件（需 vue-tsc），vite build 仅转译不做类型检查，故 typecheck 与
 * build 均放行该错误，只能组件挂载级测试捕捉。修复：两处裸 `bookmark` → `props.bookmark`。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import BookmarkCard from '../../components/cards/BookmarkCard.vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'

// jsdom 无 ResizeObserver；useCardOverflow 模块级单例挂载时 `new ResizeObserver` → polyfill
if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const bm = {
  id: 'b1',
  title: 'Hello Vue World',
  url: 'https://vue.test',
  icon: '',
  username: '',
  password: '',
  notes: 'note about vue',
  categoryId: 'c1',
  parentId: null,
  order: 1,
  useCount: 0,
  attributes: {},
  isExpanded: false,
  createdAt: 1,
  updatedAt: 100,
  deletedAt: null,
} as any

describe('BookmarkCard 搜索高亮渲染（组件级回归）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const ds = useDataStore()
    ds.bookmarks = [bm]
    ds.categories = [{ id: 'c1', name: 'C', icon: '', color: '' }] as any
    ;(ds as any)._syncMaps()
  })

  it('searchQuery 非空时渲染高亮 mark，不抛 ReferenceError（回归：裸 bookmark 引用）', () => {
    const ui = useUIStore()
    ui.searchQuery = 'vue'
    const wrapper = mount(BookmarkCard, { props: { bookmark: bm } })
    const mark = wrapper.find('mark.card-hl')
    expect(mark.exists()).toBe(true)
    // hlRegex 为 gi（不区分大小写），'vue' 命中标题/域名/笔记中的 'Vue'
    expect(mark.text()).toBe('Vue')
  })

  it('searchQuery 为空时不渲染高亮 mark，标题原文展示', () => {
    const wrapper = mount(BookmarkCard, { props: { bookmark: bm } })
    expect(wrapper.find('mark.card-hl').exists()).toBe(false)
    expect(wrapper.text()).toContain('Hello Vue World')
  })
})
