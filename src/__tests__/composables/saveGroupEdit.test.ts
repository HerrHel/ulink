import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store / EditorManager 桩（沿用 d1-72 closeGroupEdit / d1-73 editGroup 已验证的 vi.mock 闭包 mock 范本）----
// saveGroupEdit（useGroup.ts:323）直接读写：
//   geForm（模块级 export const reactive，本测试直接 import 置值断言，不 mock —— 与 d1-72/d1-73 同款 harness）
//   dataStore.groupMap（读 sg 早退守卫）
//   dataStore.updateGroup（固化 7 字段）
//   EditorManager.getContentHTML（取编辑器当前 HTML，可能 null）
//   saveAppData（持久化）
//   closeGroupEdit（同文件 export function，无法 vi.mock，会真跑 — discard:false 跳过回滚块，只清 geForm + 关 modal + lastFocusedEl.focus 恢复）
//   toast('组已更新')
//   uiStore.modals.groupEdit / editingGeId / lastFocusedEl（经 closeGroupEdit 清零/关闭/恢复）
//   ATTR_IS_GROUP（从 config/constants.js 真 import 常量，测试环境无副作用加载，不 mock）
// 故 mockUI 必须返回稳定引用对象（同 d1-72/d1-73 的 mockUI 口径），状态在调用间可见、可断言。
const mockData = {
  groupMap: {} as Record<string, any>,
  updateGroup: vi.fn((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  }),
}

// 稳定 mockUI 承载 saveGroupEdit 经 closeGroupEdit 读写的 ui 状态字段
const mockUI = {
  modals: { groupEdit: true } as Record<string, boolean>,
  editingGeId: 'g1' as string | null,
  lastFocusedEl: null as { focus: () => void } | null,
}

// EditorManager.getContentHTML 用可改 sequence 桩：默认返 null（不写 notes），可临时改返 HTML 串验 notes 写入分支
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
    silentSetContent: vi.fn(),
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

import { saveGroupEdit, geForm } from '../../composables/domain/useGroup.js'
import { ATTR_IS_GROUP } from '../../config/constants.js'
import { EditorManager } from '../../lib/editor.js'
import { saveAppData } from '../../stores/app.js'
import { toast } from '../../lib/toast.js'

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
  getContentHTMLReturn = null
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

describe('saveGroupEdit — 保存组编辑：双早退守卫 + 7 字段固化含 name||未命名 + ATTR_IS_GROUP 强写 + notes null 跳过 + 快照同步 + saveAppData + closeGroupEdit({discard:false}) 收尾 + toast 契约护栏（D1-74，延续 d1-72/d1-73 geForm harness）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetState()
    ;(saveAppData as any).mockClear()
    ;(toast as any).mockClear()
    ;(EditorManager.getContentHTML as any).mockClear()
    ;(EditorManager.silentSetContent as any).mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ===== 双早退守卫（!gId / !sg）=====

  it('A. !gId 早退：geForm.id 空串 → 零副作用（不调 updateGroup/saveAppData/getContentHTML/closeGroupEdit 收尾链不读 sg，但 gId 空时 closeGroupEdit 收尾不在 saveGroupEdit 内直接驱动——验 saveGroupEdit 自身不调任何动作为主）', () => {
    geForm.id = ''
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    saveGroupEdit()
    // saveGroupEdit 在 !gId 处直接 return，updateGroup/saveAppData/getContentHTML 全零调
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
    expect(EditorManager.getContentHTML).not.toHaveBeenCalled()
  })

  it('B. !sg 早退：gId 命中但 groupMap 缺该组 → 零副作用（不调 updateGroup/saveAppData/getContentHTML）', () => {
    geForm.id = 'ghost'
    mockData.groupMap = {} // sg 缺失
    saveGroupEdit()
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
    expect(EditorManager.getContentHTML).not.toHaveBeenCalled()
  })

  // ===== 正路径 7 字段固化 =====

  it('C. 正路径全字段固化：geForm 草稿 7 字段经 updateGroup 写入 + getContentHTML 取编辑器 HTML（非 null）写 notes + updatedAt 为正整数', () => {
    getContentHTMLReturn = '<p>编辑器当前 HTML</p>'
    const sg = makeGroup({ id: 'g1', name: '旧名', notes: '<p>旧 notes</p>', updatedAt: 1000 })
    mockData.groupMap = { g1: sg }
    // geForm 草稿态（用户改过的表单值）
    geForm.name = '  新组名  ' // 含两端空格验 trim
    geForm.catId = 'cat2'
    geForm.icon = '  icon-1  '
    geForm.attrs = { attr_a: true, attr_b: true }
    geForm.bookmarkIds = ['b1', 'b2', 'b3']
    saveGroupEdit()
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    const [idArg, changesArg] = (mockData.updateGroup as any).mock.calls[0]
    expect(idArg).toBe('g1')
    // 7 字段固化
    expect(changesArg.name).toBe('新组名') // trim 生效
    expect(changesArg.categoryId).toBe('cat2')
    expect(changesArg.icon).toBe('icon-1') // trim 生效
    expect(changesArg.bookmarkIds).toEqual(['b1', 'b2', 'b3'])
    expect(changesArg.bookmarkIds).not.toBe(geForm.bookmarkIds) // 浅拷贝独立
    expect(changesArg.notes).toBe('<p>编辑器当前 HTML</p>')
    expect(changesArg.updatedAt).toBeGreaterThan(1000) // Date.now() > 旧 updatedAt
    expect(typeof changesArg.updatedAt).toBe('number')
  })

  it('D. ATTR_IS_GROUP 强写 true：attributes 即使不含 ATTR_IS_GROUP 也强写，含 ATTR_IS_GROUP:false 也被覆盖成 true', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    geForm.attrs = { attr_a: true } // 不含 ATTR_IS_GROUP
    saveGroupEdit()
    const changesArg = (mockData.updateGroup as any).mock.calls[0][1]
    expect(changesArg.attributes).toEqual({ attr_a: true, [ATTR_IS_GROUP]: true })
    // 第二轮：attrs 已含 ATTR_IS_GROUP:false，应被覆盖成 true
    resetState()
    const sg2 = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg2 }
    geForm.id = 'g1'
    geForm.attrs = { attr_a: true, [ATTR_IS_GROUP]: false } // 显式 false
    saveGroupEdit()
    const changesArg2 = (mockData.updateGroup as any).mock.calls[0][1]
    expect(changesArg2.attributes).toEqual({ attr_a: true, [ATTR_IS_GROUP]: true })
  })

  it('E. attributes 浅拷贝独立：updateGroup 写入的 attributes 是 geForm.attrs 的浅拷贝，改 store 的 attributes 不反向写回 geForm.attrs', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    geForm.attrs = { attr_a: true }
    saveGroupEdit()
    const changesArg = (mockData.updateGroup as any).mock.calls[0][1]
    // 写入的 attributes 与 geForm.attrs 内容等但非同引用
    expect(changesArg.attributes).toEqual({ attr_a: true, [ATTR_IS_GROUP]: true })
    expect(changesArg.attributes).not.toBe(geForm.attrs) // 浅拷贝独立对象
    // 验 attributes 内键独立：改写入对象的某键不回写 geForm.attrs
    changesArg.attributes.attr_a = false
    expect(geForm.attrs.attr_a).toBe(true) // geForm.attrs 不被反向污染
  })

  it('F. name 兜底：geForm.name.trim() 为空串/纯空格 → "未命名" 兜底', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    geForm.name = '   ' // 纯空格
    saveGroupEdit()
    const changesArg = (mockData.updateGroup as any).mock.calls[0][1]
    expect(changesArg.name).toBe('未命名')
    // 第二轮：空串
    resetState()
    const sg2 = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg2 }
    geForm.id = 'g1'
    geForm.name = ''
    saveGroupEdit()
    const changesArg2 = (mockData.updateGroup as any).mock.calls[0][1]
    expect(changesArg2.name).toBe('未命名')
  })

  it('G. notes null 跳过：getContentHTML 返 null → updateGroup changes 不含 notes 键（条件 spread 跳过），不写空 notes 覆盖原 notes', () => {
    // 默认 getContentHTMLReturn 为 null
    const sg = makeGroup({ id: 'g1', notes: '<p>保留原 notes</p>' })
    mockData.groupMap = { g1: sg }
    saveGroupEdit()
    const changesArg = (mockData.updateGroup as any).mock.calls[0][1]
    expect(changesArg).not.toHaveProperty('notes') // 条件 spread 跳过，不写 notes 键
    expect(sg.notes).toBe('<p>保留原 notes</p>') // 原 notes 不被覆盖
  })

  it('H. getContentHTML 入参直锁：被调用时入参为 geForm.id（gId），非其他 gid', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    geForm.id = 'g1'
    saveGroupEdit()
    expect(EditorManager.getContentHTML).toHaveBeenCalledTimes(1)
    expect((EditorManager.getContentHTML as any).mock.calls[0][0]).toBe('g1')
  })

  // ===== 快照同步（saveGroupEdit line 341-342 回写 geForm._orig*，但随后 closeGroupEdit({discard:false}) 清零）=====

  it('I. saveAppData 调一次：正路径保存后持久化触发一次', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    saveGroupEdit()
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('J. closeGroupEdit({discard:false}) 收尾链：保存后关 modal（modals.groupEdit=false）+ 清 editingGeId + 清 geForm 草稿 id/bookmarkIds/_origBookmarkIds/_origNotes', () => {
    getContentHTMLReturn = '<p>新 HTML</p>'
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    geForm.bookmarkIds = ['b1', 'b2']
    geForm._origBookmarkIds = ['old']
    geForm._origNotes = '<p>old</p>'
    saveGroupEdit()
    // closeGroupEdit({discard:false}) 收尾：discard=false 跳过回滚块，直接清 geForm + 关 modal
    expect(mockUI.modals.groupEdit).toBe(false)
    expect(mockUI.editingGeId).toBe(null)
    expect(geForm.id).toBe('')
    expect(geForm.bookmarkIds).toEqual([])
    expect(geForm._origBookmarkIds).toEqual([])
    expect(geForm._origNotes).toBe('')
    // discard:false 不调 silentSetContent（跳过整个回滚块）
    expect(EditorManager.silentSetContent).not.toHaveBeenCalled()
  })

  it('K. closeGroupEdit({discard:false}) 不触发 updateGroup 二次调用：discard=false 跳过回滚块，整个链路 updateGroup 仅 saveGroupEdit 自身那一次', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1'], notes: '<p>orig</p>' })
    mockData.groupMap = { g1: sg }
    saveGroupEdit()
    // saveGroupEdit 自身调一次 updateGroup，closeGroupEdit({discard:false}) 跳过回滚块不再调
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
  })

  it('L. toast("组已更新") 收尾：保存成功后弹一次中文 toast', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    saveGroupEdit()
    expect(toast).toHaveBeenCalledTimes(1)
    expect((toast as any).mock.calls[0][0]).toBe('组已更新')
  })

  // ===== lastFocusedEl 焦点恢复链（saveGroupEdit → closeGroupEdit({discard:false}) → lastFocusedEl.focus()）=====

  it('M. lastFocusedEl 焦点恢复：mockUI.lastFocusedEl 非 null 时，保存流程末尾 closeGroupEdit({discard:false}) 调用它 focus() 并清 lastFocusedEl', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    const focusSpy = vi.fn()
    ;(mockUI as any).lastFocusedEl = { focus: focusSpy }
    saveGroupEdit()
    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(mockUI.lastFocusedEl).toBe(null) // 恢复后清空
  })

  it('N. lastFocusedEl 为 null 时不抛：未设 lastFocusedEl（打开前焦点为 body）时保存流程不抛错', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    mockUI.lastFocusedEl = null
    expect(() => saveGroupEdit()).not.toThrow()
  })

  // ===== 不触碰非相关 ui 状态（saveGroupEdit 经 closeGroupEdit 只动 modals.groupEdit/editingGeId/lastFocusedEl）=====

  it('O. 不波及其他 overlay/状态：saveGroupEdit 全程不动 modals 其他子键外的状态（mockUI 仅承 3 字段，无外溢）', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    saveGroupEdit()
    // mockUI 模型下仅 modals.groupEdit/editingGeId/lastFocusedEl 被动，无其他字段外溢可断
    expect(mockUI.modals.groupEdit).toBe(false)
    expect(mockUI.editingGeId).toBe(null)
    expect(mockUI.lastFocusedEl).toBe(null)
  })

  // ===== 边界：ATTR_IS_GROUP 常量真值确认（来自 config/constants.js 真 import）=====

  it('P. ATTR_IS_GROUP 常量导出真值：从 config/constants.js 真 import 的 ATTR_IS_GROUP 是定义的真字符串常量（非 undefined），保证 attributes 强写键真实存在', () => {
    expect(ATTR_IS_GROUP).toBeTruthy()
    expect(typeof ATTR_IS_GROUP).toBe('string')
  })
})
