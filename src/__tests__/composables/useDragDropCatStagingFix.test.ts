import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { PAYLOAD_KEY } from '../../config/constants.js'
import { _onDragStart, _onDragOver, _onDrop } from '../../composables/interaction/useDragDrop.js'
import EdgeStagingSidebar from '../../components/shell/EdgeStagingSidebar.vue'
import type { Bookmark } from '../../types.js'

function createDragEvent(type: string, data: Record<string, string> = {}, target?: Element): DragEvent {
  const store: Record<string, string> = { ...data }
  const evt = new Event(type, { bubbles: true, cancelable: true }) as any
  evt.dataTransfer = {
    setData: (k: string, v: string) => { store[k] = v },
    getData: (k: string) => store[k] || '',
    effectAllowed: 'all',
    dropEffect: 'none',
    setDragImage: vi.fn(),
  }
  if (target) {
    Object.defineProperty(evt, 'target', { value: target })
  }
  return evt as DragEvent
}

describe('useDragDrop & EdgeStagingSidebar — 分类拖拽收起与背景框重叠修复验证', () => {
  beforeEach(() => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()
    ui.detailCards = []
    ui.isDraggingCard = false
    ui.isMobile = false
    ds.categories = [
      { id: 'cat_work', name: '工作', icon: 'briefcase', color: '#3b82f6', order: 0 },
      { id: 'cat_fun', name: '娱乐', icon: 'game', color: '#10b981', order: 1 },
    ]
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('1. 书签拖入分类导航栏后，即便丢失原生 dragend 事件，_onDrop 也必须立刻将 isDraggingCard 复位为 false', () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm = {
      id: 'bm_1',
      title: '测试书签',
      url: 'https://example.com',
      categoryId: 'cat_work',
      order: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Bookmark
    // 直接放入 state
    ds.bookmarks = [bm]

    // 模拟开始拖拽书签
    const cardEl = document.createElement('div')
    cardEl.className = 'card'
    cardEl.dataset.id = 'bm_1'
    document.body.appendChild(cardEl)

    _onDragStart(createDragEvent('dragstart', {}, cardEl))
    expect(ui.isDraggingCard).toBe(true)

    // 拖向另一个分类项
    const railItem = document.createElement('div')
    railItem.className = 'rail-item'
    railItem.dataset.catId = 'cat_fun'
    document.body.appendChild(railItem)

    const payload = { type: 'bm', id: 'bm_1', srcGid: null }
    _onDragOver(createDragEvent('dragover', {}, railItem))

    // 触发 drop（即使此时没有触发原生 dragend）
    _onDrop(createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, railItem))

    // 核心断言：isDraggingCard 必须已被同步复位为 false，不再遗留为 true 导致暂存架无法收起
    expect(ui.isDraggingCard).toBe(false)
    expect(document.body.classList.contains('is-dragging-card')).toBe(false)
  })

  it('2. 暂存架为空且拖拽卡片时：只渲染轻量放置靶点，大面板绝不被渲染（杜绝背后露框 bug）', async () => {
    const ui = useUIStore()
    ui.detailCards = []
    ui.isDraggingCard = true

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    // 只有轻量空态放置小框展示
    expect(wrapper.find('.edge-staging-drop-zone.empty-state').exists()).toBe(true)
    // 大面板绝不渲染，防止遮挡在其前方
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(false)

    wrapper.unmount()
  })

  it('3. 暂存架有卡片且拖拽卡片时：展示大面板，轻量放置靶点绝不被渲染（彻底互斥无遮挡）', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm = {
      id: 'bm_staged',
      title: '暂存书签',
      url: 'https://example.com',
      categoryId: 'cat_work',
      order: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_staged']
    ui.isDraggingCard = true

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    // 大面板展示已有卡片与内置放置槽
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(true)
    // 外部小框绝不被渲染，消除重叠露出隐患
    expect(wrapper.find('.edge-staging-drop-zone.empty-state').exists()).toBe(false)

    wrapper.unmount()
  })
})
