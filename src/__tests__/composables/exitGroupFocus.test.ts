import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store / EditorManager 桩（沿用 d1-64~d1-69 已验证的 vi.mock 闭包 mock 范本）----
// exitGroupFocus 直接读写 uiStore.focusedGroupId/searchQuery/_prevLayoutMode/layoutMode，
// 故 uiStore 必须返回稳定引用对象（同 d1-69 toggleGroupFocus 的 mockUI 口径），状态在调用间可见、可断言。
// saveGroupBody 是 useGroup.ts 同文件 export function 无法 vi.mock，靠 EditorManager.getContentHTML
// 返 null 让其内 `editorHTML===null` 守卫命中不调 updateGroup(notes)，从而把 saveGroupBody 当静默桩；
// E 有值用例临时把 getContentHTML 返 HTML 串验证 saveGroupBody(focusedGroupId) 真跑（updateGroup 收到 notes）。
const mockData = {
  groupMap: {} as Record<string, any>,
  updateGroup: vi.fn((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  }),
}

// 稳定 mockUI 承载 exitGroupFocus 直接读写的 4 个 ui 状态字段
const mockUI = {
  focusedGroupId: null as string | null,
  layoutMode: 'grid' as string,
  _prevLayoutMode: null as string | null,
  searchQuery: '' as string,
}

// EditorManager.getContentHTML 用可改 sequence 桩：默认返 null 让 saveGroupBody 静默，
// E-saveGroupBody 真执行用例临时改成返 HTML 串验证 saveGroupBody(focusedGroupId) 真执行写 notes 副作用。
let getContentHTMLReturn: string | null = null

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
    getContentHTML: vi.fn((_gid: string) => getContentHTMLReturn),
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

import { exitGroupFocus } from '../../composables/domain/useGroup.js'
import { saveAppData } from '../../stores/app.js'
import { EditorManager } from '../../lib/editor.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'

function makeGroup(overrides: Partial<any> = {}) {
  return {
    id: 't1',
    name: '目标组',
    categoryId: 'cat1',
    icon: '',
    order: 0,
    useCount: 0,
    isExpanded: false,
    attributes: {},
    bookmarkIds: [],
    notes: '',
    updatedAt: 0,
    ...overrides,
  }
}

function resetState() {
  mockData.groupMap = {}
  mockUI.focusedGroupId = null
  mockUI.layoutMode = 'grid'
  mockUI._prevLayoutMode = null
  mockUI.searchQuery = ''
  getContentHTMLReturn = null
  ;(EditorManager.get as any).mockClear?.()
  ;(EditorManager.getContentHTML as any).mockClear?.()
}

describe('exitGroupFocus — 聚焦组无条件退出：focusedGroupId 守卫 + searchQuery 恒清 + layout 恢复链契约护栏（D1-70）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetState()
    ;(saveAppData as any).mockClear()
    ;(pushNavState as any).mockClear()
    mockData.updateGroup.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('A. focusedGroupId 无值守卫：不调 saveGroupBody/saveAppData，但仍清 searchQuery + 设 focusedGroupId=null（守卫只包 saveGroupBody+saveAppData 不包清搜索词与设 null）', () => {
    mockUI.focusedGroupId = null
    mockUI.searchQuery = 'leftover-query'

    exitGroupFocus()

    // 无值守卫：saveAppData 不调（无组可保存）
    expect(saveAppData).not.toHaveBeenCalled()
    // 但 searchQuery 仍恒清（无守卫）—— 关键隐特性直锁
    expect(mockUI.searchQuery).toBe('')
    // focusedGroupId 恒置 null（即使本就 null）
    expect(mockUI.focusedGroupId).toBe(null)
    // 无 _prevLayoutMode → 不改 layoutMode
    expect(mockUI.layoutMode).toBe('grid')
  })

  it('B. focusedGroupId 有值时：saveGroupBody 静默 + saveAppData 调一次 + 清 searchQuery + focusedGroupId=null', () => {
    const sg = makeGroup({ id: 't1', notes: '原始 notes' })
    mockData.groupMap = { t1: sg }
    // 模拟已聚焦态：focusedGroupId=t1、_prevLayoutMode 已快照某布局
    mockUI.focusedGroupId = 't1'
    mockUI._prevLayoutMode = 'list'
    mockUI.layoutMode = 'focus'
    mockUI.searchQuery = 'old-query'

    exitGroupFocus()

    // focusedGroupId 有值 → saveAppData 调一次（saveGroupBody 静默因 getContentHTML=null 不调 updateGroup notes）
    expect(saveAppData).toHaveBeenCalledTimes(1)
    // focusedGroupId 置 null
    expect(mockUI.focusedGroupId).toBe(null)
    // searchQuery 恒清（无 prev!==focusedGroupId 守卫，与 toggleGroupFocus 退出分支的关键差异）
    expect(mockUI.searchQuery).toBe('')
    // saveGroupBody 静默：focusedGroupId=t1 命中 groupMap 但 getContentHTML=null → updateGroup 不带 notes
    expect(mockData.updateGroup).not.toHaveBeenCalled()
  })

  it('C. searchQuery 恒清无守卫：focusedGroupId 本就 null 且 searchQuery 非空时仍清空（与 toggleGroupFocus `prev!==focusedGroupId` 守卫的关键差异——exit 无条件退出恒清）', () => {
    // 关键场景：当前未聚焦任何组（focusedGroupId=null），但 searchQuery 残留某搜索词
    // toggleGroupFocus(null) 时 prev(null)===新(null)→守卫命中不清搜索词；
    // exitGroupFocus 恒清无守卫 → 退出聚焦时即使未聚焦也清残留搜索词（防键盘 Esc 退出聚焦场景旧搜索词残留）
    mockUI.focusedGroupId = null
    mockUI.searchQuery = 'stale-after-exit'

    exitGroupFocus()

    expect(mockUI.searchQuery).toBe('')
  })

  it('D. _prevLayoutMode 有值时恢复 layoutMode + 清空 _prevLayoutMode（退出回到原布局链）', () => {
    const sg = makeGroup({ id: 't1' })
    mockData.groupMap = { t1: sg }
    // 模拟进入聚焦态后的状态：聚焦时布局已切到 focus，_prevLayoutMode 快照原布局 list
    mockUI.focusedGroupId = 't1'
    mockUI.layoutMode = 'focus'
    mockUI._prevLayoutMode = 'list'
    mockUI.searchQuery = 'x'

    exitGroupFocus()

    // _prevLayoutMode 有值 → layoutMode 恢复为快照值 'list'
    expect(mockUI.layoutMode).toBe('list')
    // _prevLayoutMode 清空
    expect(mockUI._prevLayoutMode).toBe(null)
    // focusedGroupId 置 null
    expect(mockUI.focusedGroupId).toBe(null)
  })

  it('E. _prevLayoutMode 无值时不改 layoutMode（异常/漂移态守卫 `if(_prevLayoutMode)` 真实行为直锁）', () => {
    const sg = makeGroup({ id: 't1' })
    mockData.groupMap = { t1: sg }
    // 异常态：已聚焦但 _prevLayoutMode 缺失（如直接被外部置 null 或漂移）
    mockUI.focusedGroupId = 't1'
    mockUI.layoutMode = 'focus'
    mockUI._prevLayoutMode = null

    exitGroupFocus()

    // _prevLayoutMode 无值 → layoutMode 不改（保持 'focus'）
    expect(mockUI.layoutMode).toBe('focus')
    // _prevLayoutMode 仍 null
    expect(mockUI._prevLayoutMode).toBe(null)
    // 但 focusedGroupId 仍恒置 null
    expect(mockUI.focusedGroupId).toBe(null)
  })

  it('F. saveGroupBody 真执行：getContentHTML 返非 null HTML 时 updateGroup 收到 notes（saveGroupBody 非静默分支）', () => {
    const sg = makeGroup({ id: 't1', notes: '原始' })
    mockData.groupMap = { t1: sg }
    mockUI.focusedGroupId = 't1'
    mockUI.searchQuery = 'q'
    // 临时把 getContentHTML 改成返 HTML 串让 saveGroupBody 走 updateGroup(notes) 路径
    getContentHTMLReturn = '<p>编辑后 notes</p>'

    exitGroupFocus()

    // saveGroupBody(t1) 真跑：getContentHTML 返 HTML → updateGroup(t1, {notes: HTML}) 调一次
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('t1', expect.objectContaining({ notes: '<p>编辑后 notes</p>' }))
    // saveAppData 仍调一次
    expect(saveAppData).toHaveBeenCalledTimes(1)
    // EditorManager.getContentHTML 收到 focusedGroupId 't1'（saveGroupBody 内 EditorManager.getContentHTML(gid) 入参）
    expect(EditorManager.getContentHTML).toHaveBeenCalledWith('t1')
  })

  it('G. focusedGroupId=null 时 saveGroupBody 完全不调（EditorManager.getContentHTML 零调，证守卫在前不空跑）', () => {
    mockUI.focusedGroupId = null
    mockUI.searchQuery = ''
    getContentHTMLReturn = '<p>should-not-be-used</p>'

    exitGroupFocus()

    // 无值守卫在前 → saveGroupBody 零调 → EditorManager.getContentHTML 零调
    expect(EditorManager.getContentHTML).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
    expect(mockData.updateGroup).not.toHaveBeenCalled()
  })

  it('H. 不调 pushNavState（exitGroupFocus 与 toggleGroupFocus 进入分支差异——退出聚焦不压导航栈）', () => {
    // exitGroupFocus 源码无 pushNavState 调用；toggleGroupFocus 进入分支恒 pushNavState。
    // 此对照直锁 exit 退出聚焦不污染导航历史——Esc 退出后浏览器后退不应回到聚焦态（
    // 若未来误给 exitGroupFocus 加 pushNavState 会让 Esc 退出后浏览器后退键意外重新进入聚焦）。
    const sg = makeGroup({ id: 't1' })
    mockData.groupMap = { t1: sg }
    mockUI.focusedGroupId = 't1'
    mockUI.searchQuery = 'q'

    exitGroupFocus()

    // exitGroupFocus 源码全程无 pushNavState 调用 → 零调直锁（对照 toggleGroupFocus 进入分支恒调一次）
    expect(pushNavState).not.toHaveBeenCalled()
  })

  it('I. 连续两次 exitGroupFocus 幂等：第一次退出后第二次聚焦态已 null，第二次走无值守卫零副作用', () => {
    const sg = makeGroup({ id: 't1' })
    mockData.groupMap = { t1: sg }
    mockUI.focusedGroupId = 't1'
    mockUI.searchQuery = 'first'

    exitGroupFocus()

    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(mockUI.focusedGroupId).toBe(null)
    expect(mockUI.searchQuery).toBe('')

    // 第二次：focusedGroupId 已 null，searchQuery 已空
    mockUI.searchQuery = '' // 已清
    ;(saveAppData as any).mockClear()

    exitGroupFocus()

    // lockedGroupId 无值守卫 → 第二次零 saveAppData
    expect(saveAppData).not.toHaveBeenCalled()
    // 仍恒清 searchQuery、恒置 null（幂等）
    expect(mockUI.searchQuery).toBe('')
    expect(mockUI.focusedGroupId).toBe(null)
  })
})
