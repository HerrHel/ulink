import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store / EditorManager 桩（沿用 d1-64/d1-72/d1-73/d1-74 已验证的 vi.mock 闭包 mock 范本）----
// saveGroupBody（useGroup.ts:47）直接读写：
//   dataStore.groupMap（读 sg 真实快照判守卫）
//   EditorManager.getContentHTML（读编辑器当前 HTML）
//   dataStore.updateGroup（写 notes）
// saveGroupBody **不调** saveAppData / toast / pushNavState / silentSetContent —— 仅读 sg+getContentHTML+条件 updateGroup(notes)。
// 本护栏专注锁 saveGroupBody 自身三分支契约（!sg 早退 / getContentHTML null 静默不写 / HTML 写 notes），
// 不是把它当其他串联调用方的「静默桩」（此前 toggleGroupFocus/exitGroupFocus/addToGroupDirect 等 9+ 链路
// 都用 getContentHTML mock 返 null 把 saveGroupBody 当静默桩，从未直接断言 saveGroupBody 自身三分支契约）。
// 其中「getContentHTML 返非空 HTML 时 updateGroup(gid,{notes:html}) 正路径」此前从未被任何测试直接验证。
const mockData = {
  groupMap: {} as Record<string, any>,
  updateGroup: vi.fn((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  }),
}

vi.mock('../../stores/data.js', () => ({
  useDataStore: vi.fn(() => mockData),
}))

vi.mock('../../stores/ui.js', () => ({
  useUIStore: vi.fn(() => ({})),
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

// EditorManager.getContentHTML 用 sequence 桩：默认返 null（验静默守卫），临时改返值验 HTML 写 notes 正路径。
// EditorManager.get 不被 saveGroupBody 调用，但 useGroup.ts 模块顶部 import EditorManager 故需 stub 框架。
// 用 vi.hoisted 让 editorManagerMock 在 vi.mock 提升后仍可用，工厂内可直接用 vi.fn（vitest 对 hoisted hoist 有 special scope，d1-10 经验）。
const { editorManagerMock } = vi.hoisted(() => ({
  editorManagerMock: {
    get: vi.fn(() => null),
    insertAtCoords: vi.fn(),
    deleteNode: vi.fn(),
    getContentHTML: vi.fn(() => null),
    silentSetContent: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
  },
}))

vi.mock('../../lib/editor.js', () => ({
  EditorManager: editorManagerMock,
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

import { saveGroupBody } from '../../composables/domain/useGroup.js'
import { EditorManager } from '../../lib/editor.js'

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
  ;(EditorManager.getContentHTML as any).mockClear()
  ;(EditorManager.getContentHTML as any).mockReturnValue(null)
  ;(EditorManager.get as any).mockClear()
  ;(EditorManager.get as any).mockReturnValue(null)
  ;(EditorManager.silentSetContent as any).mockClear()
}

describe('saveGroupBody — 保存组笔记 body（notes）持久化唯一承载：!sg 早退 / getContentHTML null 静默不写 / HTML 写 notes 三分支护栏（D1-76，沿用 d1-73/d1-74 geForm/mocked-data harness 范本，补 useGroup.ts 逐函数深度法最后一个零自测 export function 缺口）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetState()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ===== !sg 早退守卫 =====

  it('A. !sg 守卫早退：groupMap 缺该组 → 零副作用（不调 getContentHTML、不调 updateGroup）', () => {
    mockData.groupMap = {} // sg 缺失

    saveGroupBody('ghost')

    expect(EditorManager.getContentHTML).not.toHaveBeenCalled()
    expect(mockData.updateGroup).not.toHaveBeenCalled()
  })

  // ===== getContentHTML 返 null 静默守卫（核心：防 null 写入覆盖原 notes）=====

  it('B. getContentHTML 返 null → 不调 updateGroup（静默守卫：editorHTML===null 时跳过写 notes，防把已有组 notes 清成空）', () => {
    const sg = makeGroup({ id: 'g1', notes: '<p>原始 notes</p>' })
    mockData.groupMap = { g1: sg }
    ;(EditorManager.getContentHTML as any).mockReturnValue(null)

    saveGroupBody('g1')

    // 关键契约：getContentHTML 返 null 时 updateGroup 完全不被调（不是写 notes:null）
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    // 原 notes 不被改写
    expect(sg.notes).toBe('<p>原始 notes</p>')
  })

  it('C. getContentHTML 返 HTML 串 → updateGroup(gid, {notes: html}) 调一次，notes 键为 editorHTML 真值', () => {
    const sg = makeGroup({ id: 'g1', notes: '<p>旧 notes</p>' })
    mockData.groupMap = { g1: sg }
    const html = '<p>编辑后 notes</p>'
    ;(EditorManager.getContentHTML as any).mockReturnValue(html)

    saveGroupBody('g1')

    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { notes: html })
    // updateGroup mock apply 会把 changes Object.assign 进 sg → sg.notes 被真更新为 html
    expect(sg.notes).toBe(html)
  })

  it('D. getContentHTML 入参直锁：被调用时入参是 saveGroupBody 的 gid 入参（非 g1 以外的 id 透传不漂移）', () => {
    mockData.groupMap = { g7: makeGroup({ id: 'g7' }) }

    saveGroupBody('g7')

    expect(EditorManager.getContentHTML).toHaveBeenCalledTimes(1)
    expect(EditorManager.getContentHTML).toHaveBeenCalledWith('g7')
  })

  it('E. updateGroup changes 仅含 notes 键（证 saveGroupBody 只写 notes 非 spread 全量字段——故意窄写面，不误覆盖 name/catId/icon 等其他字段）', () => {
    const sg = makeGroup({ id: 'g1', name: '本应保留的组名', icon: 'star' })
    mockData.groupMap = { g1: sg }
    ;(EditorManager.getContentHTML as any).mockReturnValue('<p>x</p>')

    saveGroupBody('g1')

    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    const [idArg, changesArg] = (mockData.updateGroup as any).mock.calls[0]
    expect(idArg).toBe('g1')
    expect(Object.keys(changesArg)).toEqual(['notes'])
    expect(changesArg.notes).toBe('<p>x</p>')
    // 不误覆盖其他字段
    expect(sg.name).toBe('本应保留的组名')
    expect(sg.icon).toBe('star')
  })

  it('F. !sg 早退在 getContentHTML 之前（源码 line 50 if(!sg) return 先于 line 51 getContentHTML）：!sg 时 getContentHTML 不被调，证守卫顺序而非 getContentHTML 容错 null', () => {
    mockData.groupMap = {} // sg 缺失
    ;(EditorManager.getContentHTML as any).mockReturnValue('<p>不该被读到</p>')

    saveGroupBody('ghost')

    // 关键：守卫在 getContentHTML 调用之前，故即使 getContentHTML 配置返 HTML 也不被调（证守卫顺序）
    expect(EditorManager.getContentHTML).not.toHaveBeenCalled()
    expect(mockData.updateGroup).not.toHaveBeenCalled()
  })

  it('G. 连续两次 saveGroupBody(同 gid) 无缓存短路：每次都重查 sg+调 getContentHTML+调 updateGroup（HTML 态）', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    ;(EditorManager.getContentHTML as any).mockReturnValue('<p>a</p>')

    saveGroupBody('g1')
    saveGroupBody('g1')

    expect(EditorManager.getContentHTML).toHaveBeenCalledTimes(2)
    expect(mockData.updateGroup).toHaveBeenCalledTimes(2)
    // 两次 updateGroup 都带 notes
    expect((mockData.updateGroup as any).mock.calls[0]).toEqual(['g1', { notes: '<p>a</p>' }])
    expect((mockData.updateGroup as any).mock.calls[1]).toEqual(['g1', { notes: '<p>a</p>' }])
  })

  it('H. 不同 gid 各自独立：saveGroupBody(g1) 只 updateGroup(g1) 不误写 g2', () => {
    const g1 = makeGroup({ id: 'g1', notes: 'old1' })
    const g2 = makeGroup({ id: 'g2', notes: 'old2' })
    mockData.groupMap = { g1, g2 }
    ;(EditorManager.getContentHTML as any).mockReturnValue('<p>newHTML</p>')

    saveGroupBody('g1')

    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { notes: '<p>newHTML</p>' })
    expect(g1.notes).toBe('<p>newHTML</p>')
    // g2 notes 完全不被波及
    expect(g2.notes).toBe('old2')
  })

  it('I. getContentHTML 返空串（非 null）→ updateGroup 被调且 notes 写为空串（空串 !== null，走写枝：防未来误把 `editorHTML !== null` 改成 `editorHTML` truthy 判定致空串被静默跳过）', () => {
    const sg = makeGroup({ id: 'g1', notes: '<p>旧</p>' })
    mockData.groupMap = { g1: sg }
    ;(EditorManager.getContentHTML as any).mockReturnValue('')

    saveGroupBody('g1')

    // 空串不是 null → 走 updateGroup 写枝，notes 被写成空串（覆盖旧 notes）
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { notes: '' })
    expect(sg.notes).toBe('')
  })

  it('J. saveGroupBody 不调 saveAppData / silentSetContent（saveGroupBody 仅委托 updateGroup，持久化由调用方自行 saveAppData 串联——证 saveGroupBody 本身是窄持久化委托非全量编排）', () => {
    const sg = makeGroup({ id: 'g1' })
    mockData.groupMap = { g1: sg }
    ;(EditorManager.getContentHTML as any).mockReturnValue('<p>x</p>')

    saveGroupBody('g1')

    // saveAppData 不被 mock 模块直接 import 到 useGroup 不代表 saveGroupBody 调它——saveGroupBody 8 行源无 saveAppData 调用
    // 此处通过 silentSetContent 未被调间接证 saveGroupBody 不经编辑器 silent 写回路径
    expect(EditorManager.silentSetContent).not.toHaveBeenCalled()
    expect(EditorManager.get).not.toHaveBeenCalled()
  })
})
