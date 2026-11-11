import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import AppNav from '../../components/shell/AppNav.vue'

function mountNav() {
  return mount(AppNav, { attachTo: document.body })
}

describe('AppNav 选中态滑块', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('有选中分类时只渲染一个滑块，且对读屏隐藏', async () => {
    const data = useDataStore()
    data.categories = [
      { id: 'all', name: '全部', icon: 'star', color: '#000', order: 0 },
      { id: 'cat_work', name: '工作', icon: 'folder', color: '#000', order: 1 },
    ] as never
    const w = mountNav()
    await nextTick()
    const pills = w.findAll('.rail-active-pill')
    expect(pills).toHaveLength(1)
    expect(pills[0].attributes('aria-hidden')).toBe('true')
    expect(w.find('.rail-item.active').exists()).toBe(true)
    // 首帧定位后才允许过渡，避免从 (0,0) 飞过来
    expect(w.classes()).toContain('is-pill-ready')
    w.unmount()
  })

  it('切换分类后滑块跟着新的选中项（同一时刻仍只有一个）', async () => {
    const data = useDataStore()
    data.categories = [
      { id: 'all', name: '全部', icon: 'star', color: '#000', order: 0 },
      { id: 'cat_work', name: '工作', icon: 'folder', color: '#000', order: 1 },
    ] as never
    const ui = useUIStore()
    const w = mountNav()
    await nextTick()

    ui.switchToBookmarksView('cat_work')
    await nextTick()
    expect(w.findAll('.rail-active-pill')).toHaveLength(1)
    expect(w.find('.rail-item.active').attributes('data-cat-id')).toBe('cat_work')

    ui.switchToAiView(false)
    await nextTick()
    expect(w.findAll('.rail-active-pill')).toHaveLength(1)
    expect(w.find('.rail-item.active').attributes('data-testid')).toBe('rail-item-ai')
    w.unmount()
  })

  it('没有任何选中项时不渲染滑块（例如 AI 入口被隐藏且不在书签视图）', async () => {
    const ui = useUIStore()
    ui.aiRailEnabled = false
    ui.activeView = 'ai'
    const w = mountNav()
    await nextTick()
    expect(w.find('.rail-item.active').exists()).toBe(false)
    expect(w.find('.rail-active-pill').exists()).toBe(false)
    w.unmount()
  })
})
