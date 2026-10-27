import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { PAYLOAD_KEY } from '../../config/constants.js'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { _onDragStart, _onDragOver, _onDrop, _onDragEnd } from '../../composables/interaction/useDragDrop.js'
import { getDragHintText } from '../../lib/dragHint.js'

function createDragEvent(type: string, data: Record<string, string> = {}, target?: Element): DragEvent {
  const store = { ...data }
  const dataTransfer = {
    setData: (k: string, v: string) => { store[k] = v },
    getData: (k: string) => store[k] || '',
    setDragImage: vi.fn(),
    types: Object.keys(store),
  }
  const event = new Event(type, { bubbles: true, cancelable: true }) as any
  event.dataTransfer = dataTransfer
  if (target) {
    Object.defineProperty(event, 'target', { value: target, enumerable: true })
  }
  return event as DragEvent
}

describe('useDragDropAi — 卡片与笔记拖拽投掷到 AI 对话框交互测试', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('1. 悬停提示：拖拽书签或笔记到 #detailPanel 或顶栏 AI 按钮，提示「由 AI 读取」', () => {
    const detailPanel = document.createElement('div')
    detailPanel.id = 'detailPanel'
    document.body.appendChild(detailPanel)

    const toggleBtn = document.createElement('button')
    toggleBtn.id = 'btnToggleDetail'
    document.body.appendChild(toggleBtn)

    expect(getDragHintText(detailPanel, { type: 'bm', id: 'bm_1' })).toBe('由 AI 读取书签')
    expect(getDragHintText(detailPanel, { type: 'group', id: 'group:sg_1' })).toBe('由 AI 读取笔记')
    expect(getDragHintText(toggleBtn, { type: 'bm', id: 'bm_1' })).toBe('由 AI 读取书签')
    expect(getDragHintText(toggleBtn, { type: 'group', id: 'group:sg_1' })).toBe('由 AI 读取笔记')
  })

  it('2. 拖拽悬停：在 #detailPanel 悬停时自动添加 chat-drop-active 高亮样式', () => {
    const detailPanel = document.createElement('div')
    detailPanel.id = 'detailPanel'
    document.body.appendChild(detailPanel)

    const e = createDragEvent('dragover', {}, detailPanel)
    _onDragOver(e)

    expect(detailPanel.classList.contains('chat-drop-active')).toBe(true)
  })

  it('3. 投掷书签卡片：落入 #detailPanel 时自动关联至 ui.aiAttachedCards 并触发 toast 提示', () => {
    const ui = useUIStore()
    const ds = useDataStore()

    ds.bookmarks.push({
      id: 'bm_fe',
      title: 'React 官方网站',
      url: 'https://react.dev',
      order: 1,
    } as any)

    const detailPanel = document.createElement('div')
    detailPanel.id = 'detailPanel'
    document.body.appendChild(detailPanel)

    const payload = { type: 'bm' as const, id: 'bm_fe' }
    const dropEvent = createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, detailPanel)
    _onDrop(dropEvent)

    expect(ui.aiAttachedCards).toEqual([{ type: 'bm', id: 'bm_fe' }])
  })

  it('4. 投掷笔记卡片：落入顶栏 AI 按钮时自动展开侧边栏并附加笔记到对话框', () => {
    const ui = useUIStore()
    const ds = useDataStore()
    ui.panels.detail = false

    ds.siblingGroups.push({
      id: 'sg_arch',
      name: '系统架构演进笔记',
      notes: '<p>架构设计原则</p>',
      bookmarkIds: [],
      order: 1,
      categoryId: '',
      icon: '',
      isExpanded: false,
      attributes: {},
      updatedAt: Date.now(),
      useCount: 0,
    })

    const toggleBtn = document.createElement('button')
    toggleBtn.id = 'btnToggleDetail'
    document.body.appendChild(toggleBtn)

    const payload = { type: 'group' as const, id: 'group:sg_arch' }
    const dropEvent = createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, toggleBtn)
    _onDrop(dropEvent)

    // 自动展开 AI 侧边栏
    expect(ui.panels.detail).toBe(true)
    // 笔记 id 前缀 group: 自动脱壳
    expect(ui.aiAttachedCards).toEqual([{ type: 'group', id: 'sg_arch' }])
  })

  it('5. 去重机制：重复拖入同一张卡片不会产生重复引用', () => {
    const ui = useUIStore()
    ui.attachCardToAi('bm', 'bm_1')
    ui.attachCardToAi('bm', 'bm_1')
    expect(ui.aiAttachedCards.length).toBe(1)

    ui.attachCardToAi('group', 'group:sg_1')
    ui.attachCardToAi('group', 'sg_1')
    expect(ui.aiAttachedCards.length).toBe(2)
  })

  it('6. 移除与清空：支持单项剔除与一键清空附件', () => {
    const ui = useUIStore()
    ui.attachCardToAi('bm', 'bm_1')
    ui.attachCardToAi('group', 'sg_2')

    ui.removeAiAttachedCard('bm_1')
    expect(ui.aiAttachedCards).toEqual([{ type: 'group', id: 'sg_2' }])

    ui.clearAiAttachedCards()
    expect(ui.aiAttachedCards).toEqual([])
  })

  it('7. 拖拽分类到 AI 工作台：支持从导航栏拖拽分类直接落入 #aiWorkspace', () => {
    const ui = useUIStore()
    const ds = useDataStore()

    ds.categories.push({
      id: 'cat_work',
      name: '工作开发',
      icon: 'folder',
      color: '#4285f4',
      order: 1,
    })

    const aiWorkspace = document.createElement('div')
    aiWorkspace.id = 'aiWorkspace'
    aiWorkspace.className = 'ai-workspace'
    document.body.appendChild(aiWorkspace)

    // 1. 悬停提示：AI 工作台不显示多余悬浮文字，保持极简呼吸感
    const payload = { type: 'cat' as const, id: 'cat_work' }
    expect(getDragHintText(aiWorkspace, payload)).toBe('')

    // 2. 拖拽落入
    const dropEvent = createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, aiWorkspace)
    _onDrop(dropEvent)

    expect(ui.aiAttachedCards).toEqual([{ type: 'cat', id: 'cat_work' }])
  })

  it('8. 从暂存架拖拽卡片到 AI 工作台：支持将暂存区卡片拖入 #aiWorkspace，且保留在暂存区', () => {
    const ui = useUIStore()
    const ds = useDataStore()

    ds.bookmarks.push({
      id: 'bm_staged_1',
      title: '暂存工具书签',
      url: 'https://example.com/tool',
      order: 1,
    } as any)

    ui.detailCards = ['bm_staged_1'] // 处于暂存架中

    const aiWorkspace = document.createElement('div')
    aiWorkspace.id = 'aiWorkspace'
    aiWorkspace.className = 'ai-workspace'
    document.body.appendChild(aiWorkspace)

    // 来自暂存架的卡片带有 srcGid: '__detail__'
    const payload = { type: 'bm' as const, id: 'bm_staged_1', srcGid: '__detail__' }
    const dropEvent = createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, aiWorkspace)
    _onDrop(dropEvent)

    // 成功关联至 AI
    expect(ui.aiAttachedCards).toEqual([{ type: 'bm', id: 'bm_staged_1' }])
    // 依然保留在暂存架中，未被意外移除
    expect(ui.detailCards).toContain('bm_staged_1')
  })

  it('9. 拖拽分类不应激活暂存架：ui.isDraggingCard 保持 false，暂存侧边栏不自动弹出', () => {
    const ui = useUIStore()
    ui.isDraggingCard = false
    document.body.classList.remove('is-dragging-card')

    const rItem = document.createElement('button')
    rItem.className = 'rail-item'
    rItem.setAttribute('draggable', 'true')
    rItem.dataset.catId = 'cat_work'
    document.body.appendChild(rItem)

    const dragStartEvent = createDragEvent('dragstart', {}, rItem)
    _onDragStart(dragStartEvent)

    // 分类不是卡片，isDraggingCard 必须保持 false，body 不带 is-dragging-card 类
    expect(ui.isDraggingCard).toBe(false)
    expect(document.body.classList.contains('is-dragging-card')).toBe(false)

    rItem.remove()
    _onDragEnd()
  })
})
