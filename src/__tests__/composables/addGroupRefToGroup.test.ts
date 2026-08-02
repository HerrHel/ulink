import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store / EditorManager 桩（沿用 useBookmark.test.ts / removeFromSrcGroup.test.ts vi.mock 闭包口径）----
const mockData = {
  groupMap: {} as Record<string, any>,
  updateGroup: vi.fn((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  }),
}

// 链式调用 mock：ed.chain().insertContent(html).run()
const chainFns: any = {
  insertContent: vi.fn(function (this: any, _html: string) { return this }),
  run: vi.fn(function (this: any) { return this }),
}
const chain = vi.fn(() => chainFns)
const edInstance = { chain }

const editorMock = {
  get: vi.fn<(gid: string) => any>(() => null),
  insertAtCoords: vi.fn(),
  deleteNode: vi.fn(),
  getContentHTML: vi.fn(() => null),
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
    getContentHTML: () => editorMock.getContentHTML(),
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

import { addGroupRefToGroup } from '../../composables/domain/useGroup.js'
import { saveAppData } from '../../stores/app.js'

function makeGroup(overrides: Partial<any> = {}) {
  return {
    id: 'g1',
    name: '组一',
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

const REF_HTML_R1 = '<div class="ref-card" data-ref-gid="r1"></div>'

describe('addGroupRefToGroup — 拖组引用到目标组的分支契约护栏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockData.groupMap = {}
    mockData.updateGroup.mockReset()
    editorMock.get.mockReset()
    editorMock.get.mockReturnValue(null)
    editorMock.insertAtCoords.mockReset()
    editorMock.deleteNode.mockReset()
    editorMock.getContentHTML.mockReset()
    editorMock.getContentHTML.mockReturnValue(null)
    chainFns.insertContent.mockReset()
    chainFns.insertContent.mockImplementation(function (this: any, _html: string) { return this })
    chainFns.run.mockReset()
    chainFns.run.mockImplementation(function (this: any) { return this })
    chain.mockReset()
    chain.mockReturnValue(chainFns)
    vi.mocked(saveAppData).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('①!src 短路 return：saveAppData/updateGroup/insertAtCoords/deleteNode 全零调', () => {
    addGroupRefToGroup('r1', 't1', 10, 20) // groupMap 空 → refGid='r1' src 找不到
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(editorMock.insertAtCoords).not.toHaveBeenCalled()
    expect(editorMock.deleteNode).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('②ed truthy + clientX/Y present → insertAtCoords 分支（生产 useDragDrop 走此路）', () => {
    mockData.groupMap = { r1: makeGroup({ id: 'r1', name: '引用源' }) }
    editorMock.get.mockReturnValue(edInstance)
    addGroupRefToGroup('r1', 't1', 10, 20)
    expect(editorMock.insertAtCoords).toHaveBeenCalledTimes(1)
    expect(editorMock.insertAtCoords).toHaveBeenCalledWith('t1', expect.stringContaining('ref-card'), 10, 20)
    // 不应走 ed.chain().insertContent 路径
    expect(chain).not.toHaveBeenCalled()
  })

  it('③ed truthy + clientX/Y undefined → ed.chain().insertContent(html).run() 分支（AddPopover 走此路）', () => {
    mockData.groupMap = { r1: makeGroup({ id: 'r1', name: '引用源' }) }
    editorMock.get.mockReturnValue(edInstance)
    addGroupRefToGroup('r1', 't1') // 不带 clientX/Y
    expect(chain).toHaveBeenCalledTimes(1)
    expect(chainFns.insertContent).toHaveBeenCalledTimes(1)
    expect(chainFns.insertContent).toHaveBeenCalledWith(expect.stringContaining('ref-card'))
    expect(chainFns.run).toHaveBeenCalledTimes(1)
    // 不应走 insertAtCoords
    expect(editorMock.insertAtCoords).not.toHaveBeenCalled()
  })

  it('④ed falsy（无编辑器实例）+ sg truthy → updateGroup notes 拼接 fallback 分支（审计 HIGH 关注点）', () => {
    mockData.groupMap = {
      r1: makeGroup({ id: 'r1', name: '引用源' }),
      t1: makeGroup({ id: 't1', name: '目标组', notes: '已有笔记' }),
    }
    editorMock.get.mockReturnValue(null) // ed falsy
    addGroupRefToGroup('r1', 't1', 10, 20) // clientX 有无不影响 ed falsy 分支（不取 clientY）
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    const [gidArg, changesArg] = mockData.updateGroup.mock.calls[0]
    expect(gidArg).toBe('t1')
    // notes 拼接：(sg.notes||'') + refHtml —— refHtml 来自 groupRefCardHTML mock 返回 stub
    expect(changesArg).toEqual({ notes: '已有笔记' + REF_HTML_R1 })
    // 不应走任一编辑器分支
    expect(editorMock.insertAtCoords).not.toHaveBeenCalled()
    expect(chain).not.toHaveBeenCalled()
  })

  it('⑤ed falsy + sg falsy（目标组不存在）→ return 不动 notes 无副作用', () => {
    mockData.groupMap = { r1: makeGroup({ id: 'r1', name: '引用源' }) } // target t1 不存在
    editorMock.get.mockReturnValue(null)
    addGroupRefToGroup('r1', 't1', 10, 20)
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(editorMock.insertAtCoords).not.toHaveBeenCalled()
    expect(chain).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('⑥ed falsy notes 拼接保留 sg.notes||"" 兜底：sg.notes 缺失仍拼上 refHtml（不抛 TypeError）', () => {
    mockData.groupMap = {
      r1: makeGroup({ id: 'r1', name: '引用源' }),
      t1: makeGroup({ id: 't1', name: '目标组', notes: undefined }),
    }
    editorMock.get.mockReturnValue(null)
    addGroupRefToGroup('r1', 't1')
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    const [, changesArg] = mockData.updateGroup.mock.calls[0]
    expect(changesArg).toEqual({ notes: '' + REF_HTML_R1 })
  })

  it('⑦ed truthy 分支最后调 saveAppData（ed 分支走 saveGroupBody 后 fallthrough）', () => {
    mockData.groupMap = { r1: makeGroup({ id: 'r1', name: '引用源' }) }
    editorMock.get.mockReturnValue(edInstance)
    addGroupRefToGroup('r1', 't1', 5, 5)
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('⑧ed falsy 分支 updateGroup 后 fallthrough 调 saveAppData', () => {
    mockData.groupMap = {
      r1: makeGroup({ id: 'r1', name: '引用源' }),
      t1: makeGroup({ id: 't1', name: '目标组', notes: 'x' }),
    }
    editorMock.get.mockReturnValue(null)
    addGroupRefToGroup('r1', 't1')
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('⑨!src 分支不调 saveAppData（短路后无 fallthrough），即使 ed truthy', () => {
    mockData.groupMap = {} // refGid 无 src
    editorMock.get.mockReturnValue(edInstance) // 即使 ed truthy，!src 优先 return
    addGroupRefToGroup('missing', 't1', 1, 2)
    expect(saveAppData).not.toHaveBeenCalled()
    expect(editorMock.insertAtCoords).not.toHaveBeenCalled()
    expect(chain).not.toHaveBeenCalled()
  })

  it('⑩ed falsy + sg truthy 的 updateGroup 写入 store：再次调用基于已更新 notes 增量拼接', () => {
    mockData.groupMap = {
      r1: makeGroup({ id: 'r1', name: '引用源' }),
      t1: makeGroup({ id: 't1', name: '目标组', notes: 'a' }),
    }
    editorMock.get.mockReturnValue(null)
    addGroupRefToGroup('r1', 't1')
    expect(mockData.groupMap.t1.notes).toBe('a' + REF_HTML_R1)
    // 第二次调用应基于已更新 notes（updateGroup mock 真改 sg.notes）拼接增量
    addGroupRefToGroup('r1', 't1')
    expect(mockData.groupMap.t1.notes).toBe('a' + REF_HTML_R1 + REF_HTML_R1)
    expect(mockData.updateGroup).toHaveBeenCalledTimes(2)
  })

  it('⑪同一 src=r1 在 ed truthy 与 ed falsy 双分支共用 groupRefCardHTML(src) 渲染同一引用卡', () => {
    mockData.groupMap = {
      r1: makeGroup({ id: 'r1', name: '引用源' }),
      t1: makeGroup({ id: 't1', name: '目标组', notes: '' }),
    }
    // ed truthy 路径渲染 r1（insertAtCoords 收到 data-ref-gid="r1"）
    editorMock.get.mockReturnValue(edInstance)
    addGroupRefToGroup('r1', 't1', 3, 4)
    expect(editorMock.insertAtCoords).toHaveBeenCalledWith('t1', expect.stringContaining('data-ref-gid="r1"'), 3, 4)
    // 切到 ed falsy 路径同样渲染 r1（updateGroup notes 含 data-ref-gid="r1"）
    editorMock.get.mockReturnValue(null)
    mockData.updateGroup.mockClear()
    addGroupRefToGroup('r1', 't1')
    const [, changesArg] = mockData.updateGroup.mock.calls[0]
    expect(changesArg.notes).toContain('data-ref-gid="r1"')
  })
})
