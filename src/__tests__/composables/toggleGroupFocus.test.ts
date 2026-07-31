import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store / EditorManager 桩（沿用 d1-64~d1-68 已验证的 vi.mock 闭包 mock 范本）----
// toggleGroupFocus 直接读写 uiStore.focusedGroupId/layoutMode/_prevLayoutMode/searchQuery，
// 故 uiStore 必须返回稳定引用对象（同 createGroup.test.ts 的 mockUI 口径），状态在调用间可见、可断言。
// saveGroupBody 是 useGroup.ts 同文件 export function 无法 vi.mock，靠 EditorManager.getContentHTML
// 返 null 让其内 `editorHTML===null` 守卫命中不调 updateGroup(notes)，从而把 saveGroupBody 当静默桩；
// 切组态单独一条用例把 getContentHTML 返 HTML 串验证 saveGroupBody(prev) 真跑（updateGroup 收到 notes）。
const mockData = {
  groupMap: {} as Record<string, any>,
  updateGroup: vi.fn((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  }),
}

// 稳定 mockUI 承载 toggleGroupFocus 直接读写的 4 个 ui 状态字段
const mockUI = {
  focusedGroupId: null as string | null,
  layoutMode: 'grid' as string,
  _prevLayoutMode: null as string | null,
  searchQuery: '' as string,
}

// EditorManager.getContentHTML 用可改 sequence 桩：默认返 null 让 saveGroupBody 静默，
// D-cutsave 用例临时改成返 HTML 串验证 saveGroupBody(prev) 真执行写 notes 副作用。
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

import { toggleGroupFocus } from '../../composables/domain/useGroup.js'
import { saveAppData } from '../../stores/app.js'
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
}

describe('toggleGroupFocus — 聚焦组 toggle 切换 + prev 保存 + useCount 递增 + layout 快照恢复契约护栏（D1-69）', () => {
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

  it('A. 首次进入：prev=null 不保存前一组，进入后 focusedGroupId 设 tGid + useCount+1 + pushNavState + _prevLayoutMode 快照 + searchQuery 清空', () => {
    const sg = makeGroup({ id: 't1', useCount: 0 })
    mockData.groupMap = { t1: sg }
    const beforeLayout = 'grid'
    mockUI.layoutMode = beforeLayout
    mockUI.searchQuery = 'stale-query'

    toggleGroupFocus('t1')

    // prev=null → saveAppData 不调（无前组可保存）
    expect(saveAppData).not.toHaveBeenCalled()
    // entering=true（null!==tGid）
    expect(mockUI.focusedGroupId).toBe('t1')
    // sg 命中 → updateGroup(tGid, {useCount: 1})
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('t1', expect.objectContaining({ useCount: 1 }))
    // 进入分支恒 pushNavState
    expect(pushNavState).toHaveBeenCalledTimes(1)
    // _prevLayoutMode 快照当前 layoutMode（进入时未被改变，仍 'grid'）
    expect(mockUI._prevLayoutMode).toBe(beforeLayout)
    // prev(null)!==tGid 't1' → searchQuery 清空
    expect(mockUI.searchQuery).toBe('')
  })

  it('B. 同 id 再点退出：prev=tGid 调 saveGroupBody(prev)+saveAppData，focusedGroupId 设 null，不 updateGroup/pushNavState，_prevLayoutMode 恢复 layout 并清空，searchQuery 清空', () => {
    const sg = makeGroup({ id: 't1', useCount: 3 })
    mockData.groupMap = { t1: sg }
    // 模拟已聚焦态：focusedGroupId=t1、_prevLayoutMode 已快照某布局
    mockUI.focusedGroupId = 't1'
    mockUI._prevLayoutMode = 'list'
    mockUI.layoutMode = 'focus' // 进入聚焦态后布局可能已切到 focus
    mockUI.searchQuery = 'old'

    toggleGroupFocus('t1')

    // prev=t1 有值 → saveAppData 调一次（saveGroupBody 静默因 getContentHTML=null 不调 updateGroup notes）
    expect(saveAppData).toHaveBeenCalledTimes(1)
    // entering=false（t1===t1）→ focusedGroupId 设 null
    expect(mockUI.focusedGroupId).toBe(null)
    // 退出分支不 updateGroup（sg useCount 不再递增）
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    // 退出分支不 pushNavState
    expect(pushNavState).not.toHaveBeenCalled()
    // _prevLayoutMode 恢复 layoutMode 为快照值 'list' 并清空
    expect(mockUI.layoutMode).toBe('list')
    expect(mockUI._prevLayoutMode).toBe(null)
    // prev(t1)!==null → searchQuery 清空
    expect(mockUI.searchQuery).toBe('')
  })

  it('C. 切组：prev=gA → gB，saveAppData 调一次，entering=true，focusedGroupId=gB，gB.useCount+1，pushNavState，_prevLayoutMode 覆盖快照，searchQuery 清空', () => {
    const gA = makeGroup({ id: 'gA', useCount: 7 })
    const gB = makeGroup({ id: 'gB', useCount: 2 })
    mockData.groupMap = { gA, gB }
    mockUI.focusedGroupId = 'gA'
    mockUI._prevLayoutMode = 'grid' // 之前聚焦 gA 时快照过
    mockUI.layoutMode = 'focus'
    mockUI.searchQuery = 'filter'

    toggleGroupFocus('gB')

    // prev=gA → saveAppData 调一次
    expect(saveAppData).toHaveBeenCalledTimes(1)
    // entering=true（gA!==gB）
    expect(mockUI.focusedGroupId).toBe('gB')
    // gB 命中 → updateGroup(gB, {useCount: 3})
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('gB', expect.objectContaining({ useCount: 3 }))
    // 进入分支 pushNavState
    expect(pushNavState).toHaveBeenCalledTimes(1)
    // _prevLayoutMode 重新快照当前 layoutMode='focus'（覆盖之前的 'grid'）
    expect(mockUI._prevLayoutMode).toBe('focus')
    // prev(gA)!==gB → searchQuery 清空
    expect(mockUI.searchQuery).toBe('')
    // gA.useCount 不被递增（updateGroup 只 gB 一次，未碰 gA）
    expect(gA.useCount).toBe(7)
  })

  it('D. 进入聚焦但 groupMap 缺 sg：updateGroup 不调，但仍 pushNavState + _prevLayoutMode 快照 + focusedGroupId 设 tGid（聚焦态生效，useCount 不增）', () => {
    mockData.groupMap = {} // 缺 sg

    toggleGroupFocus('ghost')

    // sg 缺失 → updateGroup 不调
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    // 但聚焦态仍生效
    expect(mockUI.focusedGroupId).toBe('ghost')
    // 进入分支 pushNavState 仍调（与 sg 是否存在无关）
    expect(pushNavState).toHaveBeenCalledTimes(1)
    // _prevLayoutMode 仍快照
    expect(mockUI._prevLayoutMode).toBe('grid')
  })

  it('E. useCount 递增三边界：0→1 / 已有值 5→6 / undefined(NaN 真值守卫)→1（`(sg.useCount||0)+1` 隐兜底）', () => {
    // 0 → 1
    const sg0 = makeGroup({ id: 'c0', useCount: 0 })
    mockData.groupMap = { c0: sg0 }
    toggleGroupFocus('c0')
    expect(sg0.useCount).toBe(1)
    expect(mockData.updateGroup).toHaveBeenLastCalledWith('c0', expect.objectContaining({ useCount: 1 }))

    // 重置后 5 → 6
    resetState()
    ;(pushNavState as any).mockClear()
    ;(saveAppData as any).mockClear()
    mockData.updateGroup.mockClear()
    const sg5 = makeGroup({ id: 'c5', useCount: 5 })
    mockData.groupMap = { c5: sg5 }
    toggleGroupFocus('c5')
    expect(sg5.useCount).toBe(6)
    expect(mockData.updateGroup).toHaveBeenLastCalledWith('c5', expect.objectContaining({ useCount: 6 }))

    // 重置后 undefined → 1（旧数据 group 缺 useCount 字段的隐兜底）
    resetState()
    ;(pushNavState as any).mockClear()
    ;(saveAppData as any).mockClear()
    mockData.updateGroup.mockClear()
    const sgUndef = makeGroup({ id: 'cu' })
    delete (sgUndef as any).useCount
    mockData.groupMap = { cu: sgUndef }
    toggleGroupFocus('cu')
    expect(sgUndef.useCount).toBe(1)
    expect(mockData.updateGroup).toHaveBeenLastCalledWith('cu', expect.objectContaining({ useCount: 1 }))
  })

  it('F. layout 快照恢复 + 清空完整链：进入时 grid → _prevLayoutMode=grid，改 layoutMode=list，同 id 再点退出 → layoutMode 恢复 grid + _prevLayoutMode 清 null', () => {
    const sg = makeGroup({ id: 't1', useCount: 0 })
    mockData.groupMap = { t1: sg }
    mockUI.layoutMode = 'grid'

    // 进入：快照 grid
    toggleGroupFocus('t1')
    expect(mockUI._prevLayoutMode).toBe('grid')
    expect(mockUI.focusedGroupId).toBe('t1')

    // 模拟聚焦态期间用户改了布局
    mockUI.layoutMode = 'list'

    // 同 id 再点退出：恢复 grid、清 _prevLayoutMode
    toggleGroupFocus('t1')
    expect(mockUI.layoutMode).toBe('grid')
    expect(mockUI._prevLayoutMode).toBe(null)
    expect(mockUI.focusedGroupId).toBe(null)
  })

  it('G. 退出态 _prevLayoutMode 为空时不改 layoutMode（异常/漂移态退出口径），但 focusedGroupId 仍恒设 null', () => {
    const sg = makeGroup({ id: 't1', useCount: 0 })
    mockData.groupMap = { t1: sg }
    // 构造异常态：已聚焦 t1 但 _prevLayoutMode 丢失（漂移）
    mockUI.focusedGroupId = 't1'
    mockUI._prevLayoutMode = null
    const keepLayout = 'focus'
    mockUI.layoutMode = keepLayout

    toggleGroupFocus('t1')

    // entering=false → focusedGroupId 设 null（恒执行，与 _prevLayoutMode 无关）
    expect(mockUI.focusedGroupId).toBe(null)
    // _prevLayoutMode falsy → else 分支不改 layoutMode（保持原样不误清成 undefined）
    expect(mockUI.layoutMode).toBe(keepLayout)
    // 仍调 saveAppData（prev 有值）
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('H. searchQuery 清空守卫 `prev !== focusedGroupId`：进入(prev=null→t1)、退出(prev=t1→null)、切组(prev=t1→g2) 三态焦点真变都清；唯一不清是 prev===新焦点（无意义 null 入参边界）', () => {
    const sg = makeGroup({ id: 't1', useCount: 0 })
    const g2 = makeGroup({ id: 'g2', useCount: 0 })
    mockData.groupMap = { t1: sg, g2 }

    // 进入：prev=null !== t1 → 清
    mockUI.searchQuery = 'enter-query'
    toggleGroupFocus('t1')
    expect(mockUI.searchQuery).toBe('')

    // 切组：prev=t1 !== g2 → 清
    mockUI.searchQuery = 'switch-query'
    toggleGroupFocus('g2')
    expect(mockUI.searchQuery).toBe('')

    // 退出（同 id 再点 g2）：prev=g2 !== null → 清
    mockUI.searchQuery = 'exit-query'
    toggleGroupFocus('g2')
    expect(mockUI.searchQuery).toBe('')

    // 边界：prev=null 入参=null → entering=false（null!==null 为 false）→ focusedGroupId 设 null
    // → prev(null)===新(null) → 不清（守卫真实行为直锁，防未来误改为恒清）
    resetState()
    ;(pushNavState as any).mockClear()
    ;(saveAppData as any).mockClear()
    mockData.updateGroup.mockClear()
    mockUI.focusedGroupId = null
    mockUI.searchQuery = 'keep-query'
    toggleGroupFocus(null as any)
    expect(mockUI.focusedGroupId).toBe(null)
    expect(mockUI.searchQuery).toBe('keep-query') // 不清——焦点未真变
  })

  it('saveGroupBody.prev 调用验证：切组态 + getContentHTML 返 HTML → updateGroup 第一次 args=(gA,{notes:html}) 证 saveGroupBody(gA) 真跑写 notes', () => {
    const gA = makeGroup({ id: 'gA', useCount: 0, notes: 'old-notes' })
    const gB = makeGroup({ id: 'gB', useCount: 0 })
    mockData.groupMap = { gA, gB }
    mockUI.focusedGroupId = 'gA'
    // 让 EditorManager.getContentHTML 返 HTML → saveGroupBody(gA) 真执行写 notes
    getContentHTMLReturn = '<p>editor snapshot</p>'

    toggleGroupFocus('gB')

    // updateGroup 至少两次：先 saveGroupBody(gA,{notes}) 再 toggleGroup(gB,{useCount+1})
    const calls = mockData.updateGroup.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    // 第一次：saveGroupBody(gA) → updateGroup('gA', {notes: '<p>editor snapshot</p>'})
    expect(calls[0][0]).toBe('gA')
    expect(calls[0][1]).toEqual(expect.objectContaining({ notes: '<p>editor snapshot</p>' }))
    // 第二次（或最后一次）：toggleGroupFocus 进入分支 updateGroup('gB', {useCount: 1})
    const lastCall = calls[calls.length - 1]
    expect(lastCall[0]).toBe('gB')
    expect(lastCall[1]).toEqual(expect.objectContaining({ useCount: 1 }))
    // 证 saveGroupBody(gA) 真执行并写 notes，gA.notes 被更新
    expect(gA.notes).toBe('<p>editor snapshot</p>')
  })

  it('saveAppData 仅 prev 有值时调：进入态(0)、退出态(1)、切组态(1) 三联对照锁 prev 守卫', () => {
    const sg = makeGroup({ id: 't1', useCount: 0 })
    const gB = makeGroup({ id: 'gB', useCount: 0 })
    mockData.groupMap = { t1: sg, gB }

    // 进入态 prev=null → saveAppData 不调
    toggleGroupFocus('t1')
    expect(saveAppData).not.toHaveBeenCalled()

    // 切组态 prev=t1→gB → saveAppData 调一次
    toggleGroupFocus('gB')
    expect(saveAppData).toHaveBeenCalledTimes(1)

    // 退出态 prev=gB→null（同 id 再点 gB）→ saveAppData 调第二次
    toggleGroupFocus('gB')
    expect(saveAppData).toHaveBeenCalledTimes(2)
  })
})
