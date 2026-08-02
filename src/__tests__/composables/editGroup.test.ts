import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store / pushNavState 桩（沿用 d1-64~d1-72 已验证的 vi.mock 闭包 mock 范本）----
// editGroup（useGroup.ts:259）直接读写：
//   geForm（模块级 export const reactive，本测试直接 import 置值断言，不 mock —— 与 d1-72 同款 harness）
//   uiStore.lastFocusedEl / editingGeId / modals.groupEdit
//   dataStore.groupMap（读 sg 八字段灌 geForm）
//   pushNavState
//   document.activeElement（jsdom 原生，测例内 appendChild+focus 设定）
// 注意：editGroup **不调** updateGroup / saveAppData / silentSetContent / EditorManager.get —— 仅灌 geForm + 设 ui 状态 + pushNavState + 开 modal。
// 故 mockUI 必须返回稳定引用对象（同 closeGroupEdit 的 mockUI 口径），状态在调用间可见、可断言。
const mockData = {
  groupMap: {} as Record<string, any>,
  updateGroup: vi.fn((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  }),
}

// 稳定 mockUI 承载 editGroup 直接读写的 ui 状态字段
const mockUI = {
  modals: { groupEdit: false } as Record<string, boolean>,
  editingGeId: null as string | null,
  lastFocusedEl: null as HTMLElement | null,
}

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

import { editGroup, geForm } from '../../composables/domain/useGroup.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'
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
  mockUI.modals.groupEdit = false
  mockUI.editingGeId = null
  mockUI.lastFocusedEl = null
  // geForm 是模块级 reactive，跨用例共享，每例前复位到「关闭态」初始
  geForm.id = ''
  geForm.name = ''
  geForm.catId = ''
  geForm.icon = ''
  geForm.attrs = {}
  geForm.iconPreviewVisible = false
  geForm.iconPreviewUrl = ''
  geForm.clearIconVisible = false
  geForm.bookmarkIds = []
  geForm._origBookmarkIds = []
  geForm._origNotes = ''
  // 清 jsdom activeElement：body 默认是 activeElement
  if (document && document.body) {
    // 移除上一测例可能 appendChild 的 focusable 元素
    Array.from(document.body.querySelectorAll('[data-focusable-test]')).forEach((el) => el.remove())
  }
}

describe('editGroup — 打开组编辑：sg 八字段灌 geForm 草稿+快照 + lastFocusedEl 记录 + pushNavState + 开 modal 契约护栏（D1-73，延续 d1-72 geForm harness）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetState()
    ;(saveAppData as any).mockClear()
    ;(pushNavState as any).mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
    if (document && document.body) {
      Array.from(document.body.querySelectorAll('[data-focusable-test]')).forEach((el) => el.remove())
    }
  })

  // ===== !sg 早退守卫 =====

  it('A. !sg 守卫早退：groupMap 缺该组 → 零副作用（不灌 geForm、不 pushNavState、不开 modal、不记 lastFocusedEl）', () => {
    mockData.groupMap = {} // sg 缺失

    editGroup('ghost')

    expect(geForm.id).toBe('')
    expect(mockUI.editingGeId).toBe(null)
    expect(mockUI.modals.groupEdit).toBe(false)
    expect(pushNavState).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
  })

  // ===== 八字段灌 geForm：name/catId/icon 字段兜底 =====

  it('B. 正路径全字段灌入：sg 全字段存在 → geForm 8 字段逐一镜像 sg', () => {
    const sg = makeGroup({
      id: 'g1', name: '我的组', categoryId: 'catX', icon: 'star',
      attributes: { a1: true, a2: false }, bookmarkIds: ['b1', 'b2'], notes: '<p>hi</p>',
    })
    mockData.groupMap = { g1: sg }

    editGroup('g1')

    expect(geForm.id).toBe('g1')
    expect(geForm.name).toBe('我的组')
    expect(geForm.catId).toBe('catX')
    expect(geForm.icon).toBe('star')
    expect(geForm.iconPreviewUrl).toBe('star')
    expect(geForm.iconPreviewVisible).toBe(true)
    expect(geForm.clearIconVisible).toBe(true)
    expect(geForm.bookmarkIds).toEqual(['b1', 'b2'])
    expect(geForm._origBookmarkIds).toEqual(['b1', 'b2'])
    expect(geForm._origNotes).toBe('<p>hi</p>')
    expect(mockUI.editingGeId).toBe('g1')
    expect(mockUI.modals.groupEdit).toBe(true)
  })

  it('C. name fallback：sg.name 为空串 → geForm.name = sg.name || "" = ""', () => {
    const sg = makeGroup({ id: 'g1', name: '' })
    mockData.groupMap = { g1: sg }

    editGroup('g1')

    expect(geForm.name).toBe('')
  })

  it('D. categoryId fallback：sg.categoryId 缺失(undefined) → geForm.catId = sg.categoryId || "" = ""', () => {
    const sg = makeGroup({ id: 'g1' })
    // 故意删 categoryId 模拟旧数据缺失
    delete (sg as any).categoryId
    mockData.groupMap = { g1: sg }

    editGroup('g1')

    expect(geForm.catId).toBe('') // sg.categoryId || '' 兜底，不致 undefined 漏入 geForm
  })

  it('E. icon falsy 双取反：sg.icon 为空串/false/undefined → iconPreviewVisible=false / clearIconVisible=false / iconPreviewUrl=""', () => {
    // 空串 case
    const sg1 = makeGroup({ id: 'g1', icon: '' })
    mockData.groupMap = { g1: sg1 }
    editGroup('g1')
    expect(geForm.iconPreviewVisible).toBe(false)
    expect(geForm.clearIconVisible).toBe(false)
    expect(geForm.iconPreviewUrl).toBe('')

    // icon 为 truthy → 双取反 true
    mockData.groupMap = { g1: makeGroup({ id: 'g1', icon: 'encryption-stack' }) }
    editGroup('g1')
    expect(geForm.iconPreviewVisible).toBe(true)
    expect(geForm.clearIconVisible).toBe(true)
    expect(geForm.iconPreviewUrl).toBe('encryption-stack')
  })

  // ===== attrs 浅拷贝独立性（核心隐特性：改 geForm.attrs 不反向污染 sg.attributes）=====

  it('F. attrs 浅拷贝独立：geForm.attrs = sg.attributes ? {...sg.attributes} : {} → 后续改 geForm.attrs 不影响 sg.attributes 原引用', () => {
    const origAttrs = { a1: true, a2: false }
    const sg = makeGroup({ id: 'g1', attributes: origAttrs })
    mockData.groupMap = { g1: sg }

    editGroup('g1')

    // 灌入后 geForm.attrs 内容等 sg.attributes
    expect(geForm.attrs).toEqual(origAttrs)
    // 但不是同一引用（浅拷贝）
    expect(geForm.attrs).not.toBe(sg.attributes)
    // 核心契约：改 geForm.attrs 不反向污染 sg.attributes
    geForm.attrs.newKey = true
    expect((sg.attributes as any).newKey).toBeUndefined()
  })

  it('G. attributes 缺失兜底：sg.attributes 为 undefined → geForm.attrs = {} 空对象不抛', () => {
    const sg = makeGroup({ id: 'g1' })
    delete (sg as any).attributes
    mockData.groupMap = { g1: sg }

    editGroup('g1')

    expect(geForm.attrs).toEqual({})
  })

  // ===== bookmarkIds 草稿与 _orig 快照双拷贝独立性 =====

  it('H. bookmarkIds 草稿与 _origBookmarkIds 双拷贝独立：geForm.bookmarkIds 与 _origBookmarkIds 是两个独立浅拷贝，改其一不影响另一个或 sg.bookmarkIds', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1', 'b2'] })
    mockData.groupMap = { g1: sg }

    editGroup('g1')

    // 内容等原
    expect(geForm.bookmarkIds).toEqual(['b1', 'b2'])
    expect(geForm._origBookmarkIds).toEqual(['b1', 'b2'])
    // 三个是独立引用
    expect(geForm.bookmarkIds).not.toBe(sg.bookmarkIds)
    expect(geForm._origBookmarkIds).not.toBe(sg.bookmarkIds)
    expect(geForm.bookmarkIds).not.toBe(geForm._origBookmarkIds)
    // 改草稿不污染 _orig 快照（cancel 时 closeGroupEdit 靠 _orig 回滚）
    geForm.bookmarkIds.push('b3')
    expect(geForm._origBookmarkIds).toEqual(['b1', 'b2'])
    expect(sg.bookmarkIds).toEqual(['b1', 'b2'])
  })

  it('I. bookmarkIds 缺失兜底：sg.bookmarkIds undefined → [...(sg.bookmarkIds||[])] = [] 不抛', () => {
    const sg = makeGroup({ id: 'g1' })
    delete (sg as any).bookmarkIds
    mockData.groupMap = { g1: sg }

    editGroup('g1')

    expect(geForm.bookmarkIds).toEqual([])
    expect(geForm._origBookmarkIds).toEqual([])
  })

  // ===== _origNotes 快照 =====

  it('J. _origNotes 快照：sg.notes || "" 兜底，sg.notes 缺失 → _origNotes="" 不致 undefined 污染 closeGroupEdit 比较', () => {
    const sg = makeGroup({ id: 'g1', notes: '<p>原始笔记</p>' })
    mockData.groupMap = { g1: sg }
    editGroup('g1')
    expect(geForm._origNotes).toBe('<p>原始笔记</p>')

    // notes 缺失兜底
    const sg2 = makeGroup({ id: 'g1' })
    delete (sg2 as any).notes
    mockData.groupMap = { g1: sg2 }
    editGroup('g1')
    expect(geForm._origNotes).toBe('') // sg.notes || '' 兜底
  })

  // ===== lastFocusedEl 记录（L8 焦点恢复链上游）=====

  it('K. lastFocusedEl 记录 document.activeElement：调 editGroup 前先 focus 一个测试元素，editGroup 应捕获为 ui.lastFocusedEl 供 closeGroupEdit 恢复', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    // jsdom：appendChild + focus 让 document.activeElement 指向该元素
    const btn = document.createElement('button')
    btn.setAttribute('data-focusable-test', '1')
    document.body.appendChild(btn)
    btn.focus()
    expect(document.activeElement).toBe(btn) // 前置确认 jsdom activeElement 已设

    editGroup('g1')

    // L8：editGroup 把打开前焦点存入 ui.lastFocusedEl，closeGroupEdit 末尾 focus() 恢复
    expect(mockUI.lastFocusedEl).toBe(btn)
  })

  it('L. editingGeId 设为 eGid：editGroup 后 ui.editingGeId === 入参 id（下游判「是否正在编辑某组」的唯一标记）', () => {
    const sg = makeGroup({ id: 'g7' })
    mockData.groupMap = { g7: sg }

    editGroup('g7')

    expect(mockUI.editingGeId).toBe('g7')
  })

  // ===== 副作用编排：pushNavState + 开 modal + 不调持久化 =====

  it('M. pushNavState 调一次 + modals.groupEdit=true 开模态 + 不调 updateGroup/saveAppData/silentSetContent（editGroup 纯灌入无持久化）', () => {
    const sg = makeGroup({ id: 'g1', bookmarkIds: ['b1'], notes: '<p>n</p>' })
    mockData.groupMap = { g1: sg }

    editGroup('g1')

    expect(pushNavState).toHaveBeenCalledTimes(1)
    expect(mockUI.modals.groupEdit).toBe(true)
    // editGroup 不调任何持久化/编辑器写（灌 geForm 是 UI reactive 状态非持久化）
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('N. 连续编辑不同组：第二次 editGroup 灌入新 sg 覆盖 geForm 旧草稿，无残留上一组状态', () => {
    const sg1 = makeGroup({ id: 'g1', name: '一组', bookmarkIds: ['b1'], notes: '<p>1</p>', icon: 'star' })
    mockData.groupMap = { g1: sg1, g2: makeGroup({ id: 'g2', name: '二组', bookmarkIds: ['b2'], notes: '<p>2</p>' }) }

    editGroup('g1')
    expect(geForm.id).toBe('g1')
    expect(geForm.name).toBe('一组')
    expect(geForm.bookmarkIds).toEqual(['b1'])

    editGroup('g2')
    // geForm 完全切到 g2，无 g1 草稿残留
    expect(geForm.id).toBe('g2')
    expect(geForm.name).toBe('二组')
    expect(geForm.bookmarkIds).toEqual(['b2'])
    expect(geForm._origNotes).toBe('<p>2</p>')
    expect(geForm.icon).toBe('') // g2 无 icon 覆盖 g1 的 star
    expect(mockUI.editingGeId).toBe('g2')
  })
})
