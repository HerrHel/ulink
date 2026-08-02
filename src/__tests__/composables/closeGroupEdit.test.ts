import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store / EditorManager 桩（沿用 d1-64~d1-71 已验证的 vi.mock 闭包 mock 范本）----
// closeGroupEdit 直接读写：
//   geForm（模块级 export const reactive，本测试直接 import 置值断言，不 mock）
//   uiStore.modals.groupEdit / editingGeId / lastFocusedEl
//   dataStore.groupMap / updateGroup
//   EditorManager.silentSetContent
//   saveAppData
// 故 uiStore 必须返回稳定引用对象（同 createGroup/toggleGroupFocus/closeAddBmPopover 的 mockUI 口径），状态在调用间可见、可断言。
const mockData = {
  groupMap: {} as Record<string, any>,
  updateGroup: vi.fn((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  }),
}

// 稳定 mockUI 承载 closeGroupEdit 直接读写的 ui 状态字段
const mockUI = {
  modals: { groupEdit: true } as Record<string, boolean>,
  editingGeId: 'g1' as string | null,
  lastFocusedEl: null as { focus: () => void } | null,
}

// EditorManager.silentSetContent 用可改 sequence 桩
let silentSetContentReturn = true
vi.mock('../../stores/data.js', () => ({
  useDataStore: vi.fn(() => mockData),
}))

vi.mock('../../stores/ui.js', () => ({
  useUIStore: vi.fn(() => mockUI),
}))

vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../lib/editor.js', () => ({
  EditorManager: {
    get: vi.fn(() => null),
    insertAtCoords: vi.fn(),
    deleteNode: vi.fn(),
    getContentHTML: vi.fn(() => null),
    silentSetContent: vi.fn((_gid: string, _html: string) => silentSetContentReturn),
  },
}))

vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../../composables/ui/useIconPreview.js', () => ({
  previewIconUrl: vi.fn(),
  clearIcon: vi.fn(),
}))

vi.mock('../../composables/useInlineCard.js', () => ({
  inlineCardHTML: vi.fn(() => '<div class="inline-card"></div>'),
  groupRefCardHTML: vi.fn((sg: any) => `<div class="ref-card" data-ref-gid="${sg?.id ?? ''}"></div>`),
}))

import { closeGroupEdit, geForm } from '../../composables/domain/useGroup.js'
import { EditorManager } from '../../lib/editor.js'
import { saveAppData } from '../../stores/app.js'

function makeGroup(overrides: Partial<any> = {}) {
  return {
    id: 'g1',
    name: '目标组',
    categoryId: 'cat1',
    icon: '',
    order: 0,
    useCount: 0,
    isExpanded: false,
    attributes: {},
    bookmarkIds: [] as string[],
    notes: '',
    updatedAt: 0,
    ...overrides,
  }
}

function resetState() {
  mockData.groupMap = {}
  mockData.updateGroup.mockClear()
  mockUI.modals.groupEdit = true
  mockUI.editingGeId = 'g1'
  mockUI.lastFocusedEl = null
  silentSetContentReturn = true
  // geForm 是模块级 reactive，跨用例共享，每例前复位到「打开编辑态」
  geForm.id = 'g1'
  geForm.name = '目标组'
  geForm.catId = 'cat1'
  geForm.icon = ''
  geForm.attrs = {}
  geForm.iconPreviewVisible = false
  geForm.iconPreviewUrl = ''
  geForm.clearIconVisible = false
  geForm.bookmarkIds = []
  geForm._origBookmarkIds = []
  geForm._origNotes = ''
}

describe('closeGroupEdit — 取消组编辑：discard 守卫 + notes/ids 变更检测双分支 + EditorManager 回滚 + saveAppData + geForm 清零 + 焦点恢复契约护栏（D1-72）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetState()
    ;(saveAppData as any).mockClear()
    ;(EditorManager.silentSetContent as any).mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ===== discard 守卫（discard !== false 为真；显式 {discard:false} 跳过整个回滚块）=====

  it('A. discard 默认（无参）：gId 命中且 sg.notes/ids 均未变仅草稿列表变了 → else-if 分支只 silentSetContent 回滚编辑器节点，不调 updateGroup/saveAppData', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1', 'b2'], notes: '<p>orig</p>' })
    mockData.groupMap = { g1: sg }
    // 打开时快照
    geForm._origBookmarkIds = ['b1', 'b2']
    geForm._origNotes = '<p>orig</p>'
    // store 未写但草稿 bookmarkIds 变了（用户在 UI 草稿里增删但未触发 updateGroup）
    geForm.bookmarkIds = ['b1', 'b2', 'b3']

    closeGroupEdit()

    // store notes/ids 与 orig 一致 → notesChanged=false, idsChanged=false
    // 但 geForm.bookmarkIds.length(3) !== _origBookmarkIds.length(2) → else-if 命中 → silentSetContent(g1, origNotes)
    expect(EditorManager.silentSetContent).toHaveBeenCalledTimes(1)
    expect(EditorManager.silentSetContent).toHaveBeenCalledWith('g1', '<p>orig</p>')
    // updateGroup 不调（store 未写脏）
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    // saveAppData 不调（else-if 分支不持久化）
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('B. discard 显式 false（saveGroupEdit 保存后路径）：跳过整个回滚块，不调 silentSetContent/updateGroup/saveAppData，仅清 geForm + 关 modal', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1'], notes: '<p>changed</p>' })
    mockData.groupMap = { g1: sg }
    geForm._origBookmarkIds = ['b1']
    geForm._origNotes = '<p>orig</p>'
    // 故意让 store 已写脏（notes 变了）—— 验证 discard:false 不回滚
    sg.notes = '<p>changed</p>'
    geForm.bookmarkIds = ['b1', 'b2']

    closeGroupEdit({ discard: false })

    // discard=false → 整个 if (discard && gId) 块跳过
    expect(EditorManager.silentSetContent).not.toHaveBeenCalled()
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
    // 但末尾清理恒执行
    expect(mockUI.modals.groupEdit).toBe(false)
    expect(mockUI.editingGeId).toBe(null)
    expect(geForm.id).toBe('')
    expect(geForm.bookmarkIds).toEqual([])
    expect(geForm._origBookmarkIds).toEqual([])
    expect(geForm._origNotes).toBe('')
  })

  it('C. discard=true 但 gId 为空（未真正进入编辑）：gId falsy → 跳过回滚块，仅清 geForm + 关 modal', () => {
    geForm.id = '' // 未进入编辑态
    mockData.groupMap = { g1: makeGroup({ id: 'g1' }) }

    closeGroupEdit() // discard 默认 true

    // if (discard && gId) → gId='' falsy → 块跳过
    expect(EditorManager.silentSetContent).not.toHaveBeenCalled()
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
    expect(mockUI.modals.groupEdit).toBe(false)
    expect(mockUI.editingGeId).toBe(null)
    expect(geForm.id).toBe('')
  })

  // ===== 回滚块：sg 缺失 =====

  it('D. discard=true 且 gId 有值但 groupMap 缺 sg：if(sg) 守卫跳过回滚，不调 silentSetContent/updateGroup/saveAppData，清 geForm', () => {
    mockData.groupMap = {} // sg 缺失
    geForm.id = 'ghost'

    closeGroupEdit()

    expect(EditorManager.silentSetContent).not.toHaveBeenCalled()
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
    expect(mockUI.modals.groupEdit).toBe(false)
    expect(geForm.id).toBe('')
  })

  // ===== 变更检测：notes 变 / ids 变 / 双变 =====

  it('E. notes 变（ids 未变）：updateGroup 回滚 bookmarkIds+notes 到 _orig，silentSetContent 回滚编辑器，saveAppData 持久化', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1', 'b2'], notes: '<p>user edited</p>' })
    mockData.groupMap = { g1: sg }
    geForm._origBookmarkIds = ['b1', 'b2']
    geForm._origNotes = '<p>orig notes</p>'
    // store notes 被写脏（如编辑器 onUpdate），ids 未变
    sg.notes = '<p>user edited</p>'

    closeGroupEdit()

    // notesChanged=true, idsChanged=false → if (||) 命中
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', {
      bookmarkIds: ['b1', 'b2'],
      notes: '<p>orig notes</p>',
    })
    expect(EditorManager.silentSetContent).toHaveBeenCalledWith('g1', '<p>orig notes</p>')
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('F. ids 变（notes 未变）：bookmarkIds 长度变 → updateGroup 回滚 + silentSetContent + saveAppData', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1', 'b2', 'b3'], notes: '<p>same</p>' })
    mockData.groupMap = { g1: sg }
    geForm._origBookmarkIds = ['b1', 'b2']
    geForm._origNotes = '<p>same</p>'
    // store bookmarkIds 被写脏（草稿增删已落地 store），notes 未变
    // 长度 3 !== 2 → idsChanged=true

    closeGroupEdit()

    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', {
      bookmarkIds: ['b1', 'b2'],
      notes: '<p>same</p>',
    })
    expect(EditorManager.silentSetContent).toHaveBeenCalledWith('g1', '<p>same</p>')
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('G. ids 变但长度相同（顺序/内容变逐项检测）：长度等但某项 id 不同 → idsChanged=true 触发回滚', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1', 'bX'], notes: '<p>n</p>' })
    mockData.groupMap = { g1: sg }
    geForm._origBookmarkIds = ['b1', 'b2']
    geForm._origNotes = '<p>n</p>'
    // 长度都 2, 但第 2 项 bX !== b2 → some() 命中

    closeGroupEdit()

    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', {
      bookmarkIds: ['b1', 'b2'],
      notes: '<p>n</p>',
    })
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('H. notes/ids 均未变且草稿 length 也未变 → 两个回滚分支都不命中，不调 silentSetContent/updateGroup/saveAppData', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1', 'b2'], notes: '<p>orig</p>' })
    mockData.groupMap = { g1: sg }
    geForm._origBookmarkIds = ['b1', 'b2']
    geForm._origNotes = '<p>orig</p>'
    geForm.bookmarkIds = ['b1', 'b2'] // 草稿与 orig 同长

    closeGroupEdit()

    expect(EditorManager.silentSetContent).not.toHaveBeenCalled()
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
    expect(mockUI.modals.groupEdit).toBe(false)
  })

  // ===== 空安全：sg.notes/bookmarkIds 缺省 + _orig 缺省的 || 兜底不抛 =====

  it('I. sg.notes 缺省(undefined) 与 _origNotes 缺省(空串) 经 || 归一比较：notesChanged=true 回滚', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1'], notes: undefined as unknown as string })
    mockData.groupMap = { g1: sg }
    geForm._origBookmarkIds = ['b1']
    geForm._origNotes = 'orig' // sg.notes||'' = '', _orig||'' = 'orig' → 不同

    closeGroupEdit()

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', {
      bookmarkIds: ['b1'],
      notes: 'orig',
    })
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('J. sg.bookmarkIds 缺省(undefined) 与 _origBookmarkIds 长度等但逐项比较安全：idsChanged=true', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: undefined as unknown as string[], notes: 'n' })
    mockData.groupMap = { g1: sg }
    geForm._origBookmarkIds = ['b1']
    geForm._origNotes = 'n'
    // sg.bookmarkIds||[] = [], length 0 !== 1 → idsChanged=true

    closeGroupEdit()

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', {
      bookmarkIds: ['b1'],
      notes: 'n',
    })
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  // ===== 焦点恢复（L8：Esc 路径也走 closeGroupEdit，统一恢复焦点）=====

  it('K. lastFocusedEl 有值：调用 lastFocusedEl.focus() 恢复焦点后清空 lastFocusedEl', () => {
    const focusSpy = vi.fn()
    mockUI.lastFocusedEl = { focus: focusSpy } as any
    mockData.groupMap = { g1: makeGroup({ id: 'g1' }) }
    geForm._origBookmarkIds = []
    geForm._origNotes = ''

    closeGroupEdit()

    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(mockUI.lastFocusedEl).toBe(null)
  })

  it('L. lastFocusedEl 为 null：不抛 TypeError，lastFocusedEl 保持 null', () => {
    mockUI.lastFocusedEl = null
    mockData.groupMap = { g1: makeGroup({ id: 'g1' }) }

    expect(() => closeGroupEdit()).not.toThrow()
    expect(mockUI.lastFocusedEl).toBe(null)
  })

  it('M. focus() 抛错被 catch 吞掉不外泄：lastFocusedEl 仍被清空，函数正常完成关 modal', () => {
    mockUI.lastFocusedEl = { focus: () => { throw new Error('元素已卸载') } } as any
    mockData.groupMap = { g1: makeGroup({ id: 'g1' }) }

    expect(() => closeGroupEdit()).not.toThrow()
    expect(mockUI.lastFocusedEl).toBe(null)
    expect(mockUI.modals.groupEdit).toBe(false)
  })

  // ===== geForm 草稿清零（末尾恒执行不依赖 discard）=====

  it('N. geForm 草稿所有字段归零：id/bookmarkIds/_origBookmarkIds/_origNotes 清空（discard:false 路径也清）', () => {
    mockData.groupMap = { g1: makeGroup({ id: 'g1', bookmarkIds: ['b1', 'b2'], notes: 'n' }) }
    geForm._origBookmarkIds = ['b1', 'b2']
    geForm._origNotes = 'n'
    geForm.bookmarkIds = ['b1', 'b2']

    closeGroupEdit({ discard: false })

    expect(geForm.id).toBe('')
    expect(geForm.bookmarkIds).toEqual([])
    expect(geForm._origBookmarkIds).toEqual([])
    expect(geForm._origNotes).toBe('')
  })

  // ===== modals/编辑态原子重置 =====

  it('O. modals.groupEdit=false + editingGeId=null 原子重置（discard 回滚路径末尾恒执行）', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1'], notes: 'dirty' })
    mockData.groupMap = { g1: sg }
    geForm._origBookmarkIds = ['b1']
    geForm._origNotes = 'clean'
    mockUI.modals.groupEdit = true
    mockUI.editingGeId = 'g1'

    closeGroupEdit()

    expect(mockUI.modals.groupEdit).toBe(false)
    expect(mockUI.editingGeId).toBe(null)
  })

  // ===== 防扩权/不波及兄弟姐妹 =====

  it('P. closeGroupEdit 不触碰非相关 ui 状态：不动 layoutMode/focusedGroupId/searchQuery/其他 overlay', () => {
    mockData.groupMap = { g1: makeGroup({ id: 'g1' }) }
    ;(mockUI as any).layoutMode = 'focus'
    ;(mockUI as any).focusedGroupId = 'g1'
    ;(mockUI as any).searchQuery = 'abc'
    ;(mockUI as any)._prevLayoutMode = 'grid'
    mockUI.modals.groupEdit = true
    // 确认这些字段进入 mockUI 后 closeGroupEdit 不改它们
    const beforeLayout = (mockUI as any).layoutMode
    const beforeFocused = (mockUI as any).focusedGroupId
    const beforeQuery = (mockUI as any).searchQuery
    const beforePrev = (mockUI as any)._prevLayoutMode

    closeGroupEdit()

    expect((mockUI as any).layoutMode).toBe(beforeLayout)
    expect((mockUI as any).focusedGroupId).toBe(beforeFocused)
    expect((mockUI as any).searchQuery).toBe(beforeQuery)
    expect((mockUI as any)._prevLayoutMode).toBe(beforePrev)
  })

  // ===== 幂等性 =====

  it(`Q. 连续两次调用幂等：第二次已 geForm.id 空串跳回滚块，清零仍执行不抛不外溢`, () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1'], notes: 'orig' })
    mockData.groupMap = { g1: sg }
    geForm._origBookmarkIds = ['b1']
    geForm._origNotes = 'orig'
    sg.notes = 'dirty'

    closeGroupEdit()
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    // 第二次：geForm.id 已 '' → 跳回滚
    closeGroupEdit()
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockUI.modals.groupEdit).toBe(false)
    expect(geForm.id).toBe('')
  })
})
