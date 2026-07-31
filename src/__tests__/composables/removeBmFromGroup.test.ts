import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store 实例（沿用 removeFromSrcGroup.test.ts 口径）----
const mockData = {
  groupMap: {} as Record<string, any>,
  bookmarkMap: {} as Record<string, any>,
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

// toast / toastWithUndo / showConfirm 直放 spy（沿用 d1-60 removeFromSrcGroup.test.ts 口径），
// 便于断言调用 + 捕获 toastWithUndo 第二参（undo 函数）手动触发以测 undo 契约
vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))

// EditorManager mock：直放 spy（沿用 d1-60 removeFromSrcGroup.test.ts 口径），
// get 默认 null，undo 路径里 mockReturnValue(fakeEd) 动态切带 descendants/chain 的伪编辑器
vi.mock('../../lib/editor.js', () => ({
  EditorManager: {
    get: vi.fn(() => null),
    deleteNode: vi.fn(),
    getContentHTML: vi.fn(() => null),
  },
}))

vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../../composables/ui/useIconPreview.js', () => ({
  previewIconUrl: vi.fn(),
  clearIcon: vi.fn(),
}))

vi.mock('../../useInlineCard.js', () => ({
  inlineCardHTML: vi.fn((bm: any) => `<div class="inline-card" data-bm-id="${bm?.id}"></div>`),
  groupRefCardHTML: vi.fn(() => '<div class="ref-card"></div>'),
}))

import { removeBmFromGroup } from '../../composables/domain/useGroup.js'
import { EditorManager } from '../../lib/editor.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { toast, toastWithUndo } from '../../lib/toast.js'

// 伪 editor：descendants 遍历调 cb、chain().insertContent().run() 链式捕获 html
function makeFakeEditor(hasCard: boolean, capture: { html: string | null }) {
  const descendants = (cb: (node: any) => void) => {
    if (hasCard) {
      cb({ type: { name: 'inlineCard' }, attrs: { 'data-bm-id': 'bm-a' } })
    }
    // 无 card 时不调 cb
  }
  return {
    state: { doc: { descendants } },
    chain: () => ({ insertContent: (html: string) => ({ run: () => { capture.html = html } }) }),
  }
}

function makeGroup(overrides: Partial<any> = {}) {
  return {
    id: 'g1',
    name: '组一',
    categoryId: 'uncategorized',
    bookmarkIds: ['bm-a', 'bm-b', 'bm-c'] as string[],
    notes: '<p>原</p>',
    ...overrides,
  }
}

function makeBookmark(overrides: Partial<any> = {}) {
  return {
    id: 'bm-a',
    title: '书签A',
    url: 'https://a.example.com',
    ...overrides,
  }
}

function resetMocks() {
  mockData.groupMap = {}
  mockData.bookmarkMap = {}
  mockData.updateGroup.mockReset()
  mockData.updateGroup.mockImplementation((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  })
  vi.mocked(toast).mockReset()
  vi.mocked(toastWithUndo).mockReset()
  ;(EditorManager.get as any).mockReset()
  ;(EditorManager.get as any).mockReturnValue(null)
  ;(EditorManager.deleteNode as any).mockReset()
  ;(EditorManager.getContentHTML as any).mockReset()
  ;(EditorManager.getContentHTML as any).mockReturnValue(null)
  vi.mocked(saveAppData).mockClear()
  vi.mocked(debouncedSaveAppData).mockClear()
}

describe('removeBmFromGroup', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetMocks()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('sg 不存在 → 直接 return，零副作用（无 updateGroup/deleteNode/toast）', () => {
    removeBmFromGroup('bm-a', 'g-missing')
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(EditorManager.deleteNode).not.toHaveBeenCalled()
    expect(vi.mocked(toastWithUndo)).not.toHaveBeenCalled()
    expect(vi.mocked(toast)).not.toHaveBeenCalled()
  })

  it('idx < 0（bmId 不在组 bookmarkIds 内）→ 直接 return，零副作用', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-b', 'bm-c'] })
    removeBmFromGroup('bm-not-in-group', 'g1')
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(EditorManager.deleteNode).not.toHaveBeenCalled()
    expect(vi.mocked(toastWithUndo)).not.toHaveBeenCalled()
  })

  it('idx≥0 但 bookmarkMap 无该 bm → 主路径仍执行删除（bm 缺失非短路守卫）', () => {
    // 关键隐特性：源码 const bm = ds.bookmarkMap[bmId] 后无 !bm 短路，主路径仍执行
    ;(EditorManager.get as any).mockReturnValue({} as any) // ed truthy 使 deleteNode 被调
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a', 'bm-b'] })
    removeBmFromGroup('bm-a', 'g1')
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-b'] })
    expect(EditorManager.deleteNode).toHaveBeenCalledWith('g1', 'data-bm-id', 'bm-a')
    expect(vi.mocked(toastWithUndo)).toHaveBeenCalled()
  })

  it('正路径：updateGroup 滤除目标 idx 保留其余（filter 而非错删末项）', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a', 'bm-b', 'bm-c'] })
    removeBmFromGroup('bm-b', 'g1')
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-c'] })
  })

  it('删除首项 idx=0：filter 正确删首项非错删末项（防 indexOf/filter 索引偏移）', () => {
    ;(EditorManager.get as any).mockReturnValue({} as any) // ed truthy
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a', 'bm-b', 'bm-c'] })
    removeBmFromGroup('bm-a', 'g1')
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-b', 'bm-c'] })
    expect(EditorManager.deleteNode).toHaveBeenCalledWith('g1', 'data-bm-id', 'bm-a')
  })

  it('关键隐特性：无编辑器实例时（get 返 null）deleteNode 不被调（ed falsy 短路）', () => {
    // 源码 const ed = EditorManager.get; if (ed) deleteNode —— ed falsy 则 deleteNode 不调
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] })
    removeBmFromGroup('bm-a', 'g1')
    expect(EditorManager.get).toHaveBeenCalledWith('g1')
    expect(EditorManager.get).toHaveReturnedWith(null)
    expect(EditorManager.deleteNode).not.toHaveBeenCalled()
  })

  it('正路径：editor 存在时（get 返 truthy）deleteNode 被调，lookup 参数为 bmId 原（不 slice）', () => {
    ;(EditorManager.get as any).mockReturnValue({} as any) // ed truthy
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] })
    removeBmFromGroup('bm-a', 'g1')
    expect(EditorManager.get).toHaveBeenCalledWith('g1')
    expect(EditorManager.deleteNode).toHaveBeenCalledWith('g1', 'data-bm-id', 'bm-a')
  })

  it('正路径：toastWithUndo 被调用且首参为中文消息，第二参是 undo 函数', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] })
    removeBmFromGroup('bm-a', 'g1')
    expect(vi.mocked(toastWithUndo)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toastWithUndo).mock.calls[0][0]).toBe('已从组移除')
    expect(typeof vi.mocked(toastWithUndo).mock.calls[0][1]).toBe('function')
  })

  it('正路径：saveAppData 在主路径被调（持久化）', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] })
    vi.mocked(saveAppData).mockClear()
    removeBmFromGroup('bm-a', 'g1')
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('DATA-9：undo 回调写回的 idsBefore 是删除前完整快照（防不可变替换后闭包 sg 仍是旧引用致双 id）', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a', 'bm-b', 'bm-c'] })
    removeBmFromGroup('bm-b', 'g1')
    // 主路径已 update 把 bookmarkIds 改为 ['bm-a','bm-c']（mock Object.assign 真改 sg）
    expect(mockData.groupMap['g1'].bookmarkIds).toEqual(['bm-a', 'bm-c'])
    const undoFn = vi.mocked(toastWithUndo).mock.calls[0][1] as () => void
    undoFn()
    // undo 写回 idsBefore.slice() = ['bm-a','bm-b','bm-c']，而非当前 sg.bookmarkIds
    expect(mockData.updateGroup).toHaveBeenLastCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-b', 'bm-c'] })
    // DATA-9 关键：若 undo 用 splice 当前 sg 会产生双 id，快照写回不会
    expect(mockData.groupMap['g1'].bookmarkIds).toEqual(['bm-a', 'bm-b', 'bm-c'])
  })

  it('undo 回调：editor 不存在（currentEd null）时不重插卡片但仍 saveGroupBody 写 survival 回调', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] })
    mockData.bookmarkMap['bm-a'] = makeBookmark()
    removeBmFromGroup('bm-a', 'g1')
    const undoFn = vi.mocked(toastWithUndo).mock.calls[0][1] as () => void
    // undo 内再次 get('g1') 仍返 null（beforeEach reset 后默认 null），故不重插
    undoFn()
    expect(mockData.updateGroup).toHaveBeenLastCalledWith('g1', { bookmarkIds: ['bm-a'] })
  })

  it('undo 回调：editor 存在但 hasCard=true（卡片已在）→ 不重插防重复', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] })
    mockData.bookmarkMap['bm-a'] = makeBookmark()
    removeBmFromGroup('bm-a', 'g1')
    const capture: { html: string | null } = { html: null }
    ;(EditorManager.get as any).mockReturnValue(makeFakeEditor(true, capture))
    const undoFn = vi.mocked(toastWithUndo).mock.calls[0][1] as () => void
    undoFn()
    // hasCard=true 故 descendants 找到卡片，不 insertContent
    expect(capture.html).toBeNull()
  })

  it('undo 回调：editor 存在且 hasCard=false（卡片不在）→ insertContent 重插 inlineCardHTML', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] })
    mockData.bookmarkMap['bm-a'] = makeBookmark()
    removeBmFromGroup('bm-a', 'g1')
    const capture: { html: string | null } = { html: null }
    ;(EditorManager.get as any).mockReturnValue(makeFakeEditor(false, capture))
    const undoFn = vi.mocked(toastWithUndo).mock.calls[0][1] as () => void
    undoFn()
    expect(capture.html).not.toBeNull()
    // inlineCardHTML 被 mock 成 <div class="inline-card" data-bm-id="bm-a"></div>
    expect(capture.html).toContain('inline-card')
    expect(capture.html).toContain('bm-a')
  })

  it('undo 回调：bm 缺失（bookmarkMap 无该 id）→ 不重插（bm falsy 短路）', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] })
    // bookmarkMap 不含 bm-a（bm 缺失）
    removeBmFromGroup('bm-a', 'g1')
    const capture: { html: string | null } = { html: null }
    ;(EditorManager.get as any).mockReturnValue(makeFakeEditor(false, capture))
    const undoFn = vi.mocked(toastWithUndo).mock.calls[0][1] as () => void
    undoFn()
    // bm falsy 故 if (currentEd && bm) 短路，不 insertContent
    expect(capture.html).toBeNull()
  })

  it('undo 回调：恢复后调用 saveGroupBody + debouncedSaveAppData + toast("已恢复")', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] })
    mockData.bookmarkMap['bm-a'] = makeBookmark()
    removeBmFromGroup('bm-a', 'g1')
    const undoFn = vi.mocked(toastWithUndo).mock.calls[0][1] as () => void
    undoFn()
    // saveGroupBody 内部调了 getContentHTML('g1')
    expect(EditorManager.getContentHTML).toHaveBeenCalledWith('g1')
    // toast('已恢复') 被调
    expect(vi.mocked(toast)).toHaveBeenCalledWith('已恢复')
  })

  it('多次独立调同 tGid 不同 bmId：各自独立无状态残留（mock Object.assign 真改 sg）', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a', 'bm-b'] })
    removeBmFromGroup('bm-a', 'g1')
    expect(mockData.groupMap['g1'].bookmarkIds).toEqual(['bm-b'])
    mockData.groupMap['g2'] = makeGroup({ id: 'g2', bookmarkIds: ['x', 'bm-b', 'z'] })
    removeBmFromGroup('bm-b', 'g2')
    expect(mockData.groupMap['g2'].bookmarkIds).toEqual(['x', 'z'])
    // g1 不受 g2 操作影响
    expect(mockData.groupMap['g1'].bookmarkIds).toEqual(['bm-b'])
  })
})
