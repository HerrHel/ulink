import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store / EditorManager 桩（沿用 d1-64 addGroupRefToGroup.test.ts 已验证的 vi.mock 闭包口径）----
// removeGroupRef 不读 dataStore.groupMap（与 add 不同——add 需 src/sg），但同文件 saveGroupBody 真实执行
// 依赖 useDataStore + EditorManager.getContentHTML，故仍需 mock dataStore 供 saveGroupBody 真实跑用。
const mockData = {
  groupMap: {} as Record<string, any>,
  updateGroup: vi.fn((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  }),
}

const editorMock = {
  get: vi.fn<(gid: string) => any>(() => null),
  insertAtCoords: vi.fn(),
  deleteNode: vi.fn(),
  getContentHTML: vi.fn<(gid: string) => string | null>(() => null),
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

vi.mock('../../lib/editor.js', () => ({
  EditorManager: {
    get: (gid: string) => editorMock.get(gid),
    insertAtCoords: (gid: string, html: string, x: number, y: number) =>
      editorMock.insertAtCoords(gid, html, x, y),
    deleteNode: (gid: string, ...rest: any[]) => editorMock.deleteNode(gid, ...rest),
    getContentHTML: (gid: string) => editorMock.getContentHTML(gid),
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

import { removeGroupRef } from '../../composables/domain/useGroup.js'
import { saveAppData } from '../../stores/app.js'

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

describe('removeGroupRef — 移除组内组引用卡的双分支对称契约护栏（D1-66）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockData.groupMap = {}
    mockData.updateGroup.mockReset()
    editorMock.get.mockReset()
    editorMock.get.mockReturnValue(null) // 默认 ed falsy
    editorMock.insertAtCoords.mockReset()
    editorMock.deleteNode.mockReset()
    editorMock.getContentHTML.mockReset()
    editorMock.getContentHTML.mockReturnValue(null) // saveGroupBody 真实执行时静默（editorHTML===null 不调 updateGroup）
    vi.mocked(saveAppData).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('①ed truthy → EditorManager.deleteNode(targetGid,"data-ref-gid",refGid) 调一次 + saveAppData 调一次', () => {
    mockData.groupMap = { t1: makeGroup({ id: 't1' }) }
    editorMock.get.mockReturnValue({}) // ed truthy
    removeGroupRef('t1', 'r1')
    expect(editorMock.deleteNode).toHaveBeenCalledTimes(1)
    expect(editorMock.deleteNode).toHaveBeenCalledWith('t1', 'data-ref-gid', 'r1')
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('②ed falsy（无编辑器实例）→ deleteNode 零调 + saveAppData 仍调一次（无 early return，与 add 的 !src 短路语义不同）', () => {
    mockData.groupMap = { t1: makeGroup({ id: 't1' }) }
    editorMock.get.mockReturnValue(null) // ed falsy
    removeGroupRef('t1', 'r1')
    expect(editorMock.deleteNode).not.toHaveBeenCalled()
    // 关键契约：removeGroupRef 无前置 src/sg 守卫，ed falsy 不 early return，
    // 末尾 saveGroupBody+saveAppData 恒执行（与 addGroupRefToGroup 的 !src early return 区分）
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('③deleteNode 入参顺序锁定：第3参数严格是 refGid，不与第1参数 targetGid 混淆', () => {
    mockData.groupMap = { t1: makeGroup({ id: 't1' }) }
    editorMock.get.mockReturnValue({})
    removeGroupRef('targetGroup', 'refGroup')
    expect(editorMock.deleteNode).toHaveBeenCalledTimes(1)
    const args = editorMock.deleteNode.mock.calls[0]
    expect(args[0]).toBe('targetGroup') // 1st = targetGid
    expect(args[1]).toBe('data-ref-gid') // 2nd = attr 名
    expect(args[2]).toBe('refGroup') // 3rd = refGid（删哪个引用卡）
  })

  it('④saveGroupBody 真实执行静默性：ed truthy 但 getContentHTML→null 时 saveGroupBody 跑但不调 updateGroup（不副作用污染 notes）', () => {
    mockData.groupMap = { t1: makeGroup({ id: 't1', notes: '原始笔记' }) }
    editorMock.get.mockReturnValue({})
    editorMock.getContentHTML.mockReturnValue(null) // saveGroupBody 内 editorHTML===null 守卫
    removeGroupRef('t1', 'r1')
    // saveGroupBody 真实执行：sg 命中但 editorHTML===null → 不调 updateGroup，notes 不被污染
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(mockData.groupMap.t1.notes).toBe('原始笔记')
    expect(editorMock.deleteNode).toHaveBeenCalledTimes(1)
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('⑤ed truthy 且 getContentHTML 返非 null → saveGroupBody 走 updateGroup(notes) 路径（证 saveGroupBody 真实执行且与 deleteNode 串联）', () => {
    mockData.groupMap = { t1: makeGroup({ id: 't1', notes: '旧' }) }
    editorMock.get.mockReturnValue({})
    editorMock.getContentHTML.mockReturnValue(('<p>新 HTML</p>' as any))
    removeGroupRef('t1', 'r1')
    // deleteNode 先调（删引用卡）
    expect(editorMock.deleteNode).toHaveBeenCalledWith('t1', 'data-ref-gid', 'r1')
    // saveGroupBody 真实执行后调 updateGroup(notes=新HTML)——证 saveGroupBody 与 deleteNode 串联，
    // 且 updateGroup 入参顺序 (gid, {notes}) 正确
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('t1', { notes: '<p>新 HTML</p>' })
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('⑥ed falsy 且 getContentHTML 返非 null + sg 命中 → saveGroupBody 走 updateGroup(notes)，deleteNode 仍零调（双分支共用 saveGroupBody 落盘）', () => {
    mockData.groupMap = { t1: makeGroup({ id: 't1', notes: '旧' }) }
    editorMock.get.mockReturnValue(null) // ed falsy → 无 deleteNode
    editorMock.getContentHTML.mockReturnValue(('<span>同步笔记</span>' as any))
    removeGroupRef('t1', 'r1')
    expect(editorMock.deleteNode).not.toHaveBeenCalled()
    // ed falsy 分支 saveGroupBody 仍真实执行：getContentHTML 非 null → updateGroup(notes)
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.groupMap.t1.notes).toBe('<span>同步笔记</span>')
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('⑦targetGid 与 refGid 同值（删自身引用卡）→ 非短路，仍 deleteNode 一次 + saveAppData 一次', () => {
    mockData.groupMap = { t1: makeGroup({ id: 't1' }) }
    editorMock.get.mockReturnValue({})
    removeGroupRef('t1', 't1') // 自删引用
    expect(editorMock.deleteNode).toHaveBeenCalledTimes(1)
    expect(editorMock.deleteNode).toHaveBeenCalledWith('t1', 'data-ref-gid', 't1')
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('⑧saveGroupBody 内 sg 不命中（targetGid 不在 groupMap）→ saveGroupBody 早退不调 updateGroup，末尾 saveAppData 仍调一次', () => {
    mockData.groupMap = {} // targetGid 无 sg
    editorMock.get.mockReturnValue({})
    editorMock.getContentHTML.mockReturnValue(('<p>x</p>' as any))
    removeGroupRef('missing', 'r1')
    // saveGroupBody: ds.groupMap['missing'] undefined → 早退，不调 updateGroup
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    // deleteNode 仍调（其 if(ed) 不依赖 sg）
    expect(editorMock.deleteNode).toHaveBeenCalledTimes(1)
    expect(editorMock.deleteNode).toHaveBeenCalledWith('missing', 'data-ref-gid', 'r1')
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })
})
