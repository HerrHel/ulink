/**
 * useDragDropStaging.test.ts — 暂存区卡片拖拽全功能交互测试
 * 覆盖：
 * 1. 拖出暂存与普通卡片交换位置
 * 2. 拖出暂存移入笔记（正文 / 卡片 / 头部）
 * 3. 拖出暂存移入分类侧栏
 * 4. 暂存区内相互重排
 * 5. 拖到空白区域移出暂存
 * 6. 拖到暂存区底板保持暂存
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PAYLOAD_KEY, DRAG_SRC_DETAIL } from '../../config/constants.js'

const mocks = vi.hoisted(() => ({
  bookmarkMap: {} as Record<string, any>,
  groupMap: {} as Record<string, any>,
  customCardOrder: null as { id: string }[] | null,
  detailCards: [] as string[],
  markDirty: vi.fn(),
  updateBookmark: vi.fn(),
  updateGroup: vi.fn(),
  toast: vi.fn(),
  addToGroupDirect: vi.fn(),
  insertAtCoords: vi.fn(),
}))

vi.mock('../../stores/data.js', () => ({
  useDataStore: () => ({
    get bookmarkMap() { return mocks.bookmarkMap },
    get groupMap() { return mocks.groupMap },
    get _customCardOrder() { return mocks.customCardOrder },
    set _customCardOrder(v) { mocks.customCardOrder = v },
    categories: [
      { id: 'cat_tech', name: '技术' },
      { id: 'cat_work', name: '工作' },
    ],
    categoryMap: {
      cat_tech: { id: 'cat_tech', name: '技术' },
      cat_work: { id: 'cat_work', name: '工作' },
    },
    _markDirty: mocks.markDirty,
    updateBookmark: mocks.updateBookmark,
    updateGroup: mocks.updateGroup,
  }),
}))

vi.mock('../../stores/ui.js', () => ({
  useUIStore: () => ({
    get detailCards() { return mocks.detailCards },
    set detailCards(v) { mocks.detailCards = v },
    saveUIState: vi.fn(),
    isDraggingCard: false,
    batchMode: false,
  }),
}))

vi.mock('../../lib/toast.js', () => ({
  toast: mocks.toast,
}))

vi.mock('../../composables/domain/useGroup.js', () => ({
  saveGroupBody: vi.fn(),
  syncGroupBookmarks: vi.fn(),
  addToGroupDirect: mocks.addToGroupDirect,
  addGroupRefToGroup: vi.fn(),
  removeFromSrcGroup: vi.fn(),
}))

vi.mock('../../composables/useInlineCard.js', () => ({
  inlineCardHTML: (bm: any) => `<div class="group-inline-card" data-bm-id="${bm.id}"></div>`,
  groupRefCardHTML: (grp: any) => `<div class="group-ref-card" data-ref-gid="${grp.id}"></div>`,
}))

vi.mock('../../composables/ui/useUI.js', () => ({ openDetail: vi.fn() }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))

vi.mock('../../lib/editor.js', () => ({
  EditorManager: {
    get: () => ({}),
    insertAtCoords: mocks.insertAtCoords,
    getContentHTML: () => '<p></p>',
  },
}))

import { _onDragStart, _onDragOver, _onDrop, _onDragEnd } from '../../composables/interaction/useDragDrop.js'

function createDragEvent(type: string, data: Record<string, any> = {}, target: HTMLElement | null = null): DragEvent {
  const dt = {
    data: { ...data },
    setData: (k: string, v: string) => { dt.data[k] = v },
    getData: (k: string) => dt.data[k] || '',
    effectAllowed: 'move',
    setDragImage: vi.fn(),
  }
  const evt = new Event(type, { bubbles: true, cancelable: true }) as any
  evt.dataTransfer = dt
  evt.clientX = 100
  evt.clientY = 100
  if (target) {
    Object.defineProperty(evt, 'target', { value: target, configurable: true })
  }
  return evt as DragEvent
}

describe('useDragDropStaging — 暂存区拖出与拖拽交互完整闭环', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    mocks.bookmarkMap = {}
    mocks.groupMap = {}
    mocks.customCardOrder = null
    mocks.detailCards = []
    vi.clearAllMocks()
    _onDragEnd()
  })

  it('1. 暂存卡片拖入主网格书签卡片：两卡互换位置，并从暂存区剔除', () => {
    const stagedBm = { id: 'bm_staged', order: 10, parentId: null }
    const targetBm = { id: 'bm_target', order: 20, parentId: null }
    mocks.bookmarkMap = { bm_staged: stagedBm, bm_target: targetBm }
    mocks.detailCards = ['bm_staged', 'bm_other']

    // DOM 构建
    const sidebar = document.createElement('div')
    sidebar.id = 'edgeStagingSidebar'
    const stagedWrap = document.createElement('div')
    stagedWrap.className = 'staged-card-row detail-card-wrap'
    stagedWrap.dataset.bmId = 'bm_staged'
    stagedWrap.dataset.didx = '0'
    sidebar.appendChild(stagedWrap)

    const targetCard = document.createElement('div')
    targetCard.className = 'card'
    targetCard.dataset.id = 'bm_target'
    document.body.appendChild(sidebar)
    document.body.appendChild(targetCard)

    // dragstart
    const startEvt = createDragEvent('dragstart', {}, stagedWrap)
    _onDragStart(startEvt)

    // dragover 悬停于目标卡片
    const overEvt = createDragEvent('dragover', {}, targetCard)
    _onDragOver(overEvt)

    // drop 释放
    const payload = { type: 'bm', id: 'bm_staged', srcGid: DRAG_SRC_DETAIL }
    const dropEvt = createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, targetCard)
    _onDrop(dropEvt)

    // 断言：order 已交换
    expect(stagedBm.order).toBe(20)
    expect(targetBm.order).toBe(10)
    expect(mocks.markDirty).toHaveBeenCalledWith('bm_staged', 'bm_target')

    // 断言：从暂存区剔除
    expect(mocks.detailCards).toEqual(['bm_other'])
  })

  it('2. 暂存区子书签拖入主网格顶层卡片：解除 parentId 并交换位置，从暂存区剔除', () => {
    const stagedSubBm = { id: 'bm_sub', order: 5, parentId: 'parent_1' }
    const targetBm = { id: 'bm_top', order: 30, parentId: null }
    mocks.bookmarkMap = { bm_sub: stagedSubBm, bm_top: targetBm }
    mocks.detailCards = ['bm_sub']

    const targetCard = document.createElement('div')
    targetCard.className = 'card'
    targetCard.dataset.id = 'bm_top'
    document.body.appendChild(targetCard)

    const payload = { type: 'bm', id: 'bm_sub', srcGid: DRAG_SRC_DETAIL }
    _onDragOver(createDragEvent('dragover', {}, targetCard))
    _onDrop(createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, targetCard))

    // parentId 置空
    expect(mocks.updateBookmark).toHaveBeenCalledWith('bm_sub', { parentId: null })
    expect(stagedSubBm.order).toBe(30)
    expect(targetBm.order).toBe(5)
    expect(mocks.detailCards).toEqual([])
  })

  it('3. 暂存卡片拖入笔记正文：嵌入笔记，更新 bookmarkIds，并从暂存区剔除', () => {
    const stagedBm = { id: 'bm_staged', order: 1 }
    const group = { id: 'grp_1', bookmarkIds: [] }
    mocks.bookmarkMap = { bm_staged: stagedBm }
    mocks.groupMap = { grp_1: group }
    mocks.detailCards = ['bm_staged']

    const groupBody = document.createElement('div')
    groupBody.className = 'group-body'
    groupBody.dataset.gid = 'grp_1'
    document.body.appendChild(groupBody)

    const payload = { type: 'bm', id: 'bm_staged', srcGid: DRAG_SRC_DETAIL }
    _onDragOver(createDragEvent('dragover', {}, groupBody))
    _onDrop(createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, groupBody))

    expect(mocks.insertAtCoords).toHaveBeenCalled()
    expect(mocks.updateGroup).toHaveBeenCalledWith('grp_1', { bookmarkIds: ['bm_staged'] })
    expect(mocks.detailCards).toEqual([])
  })

  it('4. 暂存卡片拖入笔记卡片：加入笔记，并从暂存区剔除', () => {
    const stagedBm = { id: 'bm_staged', order: 1 }
    mocks.bookmarkMap = { bm_staged: stagedBm }
    mocks.detailCards = ['bm_staged']

    const groupCard = document.createElement('div')
    groupCard.className = 'card group-card'
    groupCard.dataset.groupId = 'grp_target'
    document.body.appendChild(groupCard)

    const payload = { type: 'bm', id: 'bm_staged', srcGid: DRAG_SRC_DETAIL }
    _onDragOver(createDragEvent('dragover', {}, groupCard))
    _onDrop(createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, groupCard))

    expect(mocks.addToGroupDirect).toHaveBeenCalledWith('bm_staged', 'grp_target')
    expect(mocks.detailCards).toEqual([])
  })

  it('5. 暂存卡片拖入分类导航栏项：更新 categoryId 并从暂存区剔除', () => {
    const stagedBm = { id: 'bm_staged', categoryId: 'cat_tech' }
    mocks.bookmarkMap = { bm_staged: stagedBm }
    mocks.detailCards = ['bm_staged']

    const railItem = document.createElement('div')
    railItem.className = 'rail-item'
    railItem.dataset.catId = 'cat_work'
    document.body.appendChild(railItem)

    const payload = { type: 'bm', id: 'bm_staged', srcGid: DRAG_SRC_DETAIL }
    _onDragOver(createDragEvent('dragover', {}, railItem))
    _onDrop(createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, railItem))

    expect(mocks.updateBookmark).toHaveBeenCalledWith('bm_staged', { categoryId: 'cat_work' })
    expect(mocks.detailCards).toEqual([])
  })

  it('6. 暂存笔记组拖入分类导航栏项：更新组 categoryId 并从暂存区剔除', () => {
    const stagedGrp = { id: 'grp_1', categoryId: 'cat_tech' }
    mocks.groupMap = { grp_1: stagedGrp }
    mocks.detailCards = ['group:grp_1']

    const railItem = document.createElement('div')
    railItem.className = 'rail-item'
    railItem.dataset.catId = 'cat_work'
    document.body.appendChild(railItem)

    const payload = { type: 'group', id: 'group:grp_1', srcGid: DRAG_SRC_DETAIL }
    _onDragOver(createDragEvent('dragover', {}, railItem))
    _onDrop(createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, railItem))

    expect(mocks.updateGroup).toHaveBeenCalledWith('grp_1', { categoryId: 'cat_work' })
    expect(mocks.detailCards).toEqual([])
  })

  it('7. 暂存区内互相拖拽重排：在侧边栏内调整顺序，不离开暂存区', () => {
    mocks.detailCards = ['bm_1', 'bm_2', 'bm_3']

    const sidebar = document.createElement('div')
    sidebar.id = 'edgeStagingSidebar'

    const item1 = document.createElement('div')
    item1.className = 'detail-card-wrap'
    item1.dataset.bmId = 'bm_1'
    item1.dataset.didx = '0'

    const item3 = document.createElement('div')
    item3.className = 'detail-card-wrap'
    item3.dataset.bmId = 'bm_3'
    item3.dataset.didx = '2'

    sidebar.appendChild(item1)
    sidebar.appendChild(item3)
    document.body.appendChild(sidebar)

    // dragstart bm_1
    _onDragStart(createDragEvent('dragstart', {}, item1))

    // dragover item3
    _onDragOver(createDragEvent('dragover', {}, item3))

    // drop onto item3
    const payload = { type: 'bm', id: 'bm_1', srcGid: DRAG_SRC_DETAIL }
    _onDrop(createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, item3))

    // 索引 0 与 2 互换
    expect(mocks.detailCards).toEqual(['bm_3', 'bm_2', 'bm_1'])
  })

  it('8. 暂存卡片拖入空白画布（拖出暂存）：从暂存区剔除并弹出提示', () => {
    mocks.detailCards = ['bm_1', 'bm_2']

    const grid = document.createElement('div')
    grid.id = 'cardGrid'
    document.body.appendChild(grid)

    const payload = { type: 'bm', id: 'bm_1', srcGid: DRAG_SRC_DETAIL }
    _onDragOver(createDragEvent('dragover', {}, grid))
    _onDrop(createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, grid))

    expect(mocks.detailCards).toEqual(['bm_2'])
    expect(mocks.toast).toHaveBeenCalled()
  })

  it('9. 暂存卡片拖至暂存侧边栏底板（未落在卡片上）：保持在暂存区不被剔除', () => {
    mocks.detailCards = ['bm_1', 'bm_2']

    const sidebar = document.createElement('div')
    sidebar.id = 'edgeStagingSidebar'
    document.body.appendChild(sidebar)

    const payload = { type: 'bm', id: 'bm_1', srcGid: DRAG_SRC_DETAIL }
    _onDragOver(createDragEvent('dragover', {}, sidebar))
    _onDrop(createDragEvent('drop', { [PAYLOAD_KEY]: JSON.stringify(payload) }, sidebar))

    expect(mocks.detailCards).toEqual(['bm_1', 'bm_2'])
  })
})
