import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store 实例（沿用 useBookmark.test.ts:1-54 口径）----
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
  inlineCardHTML: vi.fn(() => '<div class="inline-card"></div>'),
  groupRefCardHTML: vi.fn(() => '<div class="ref-card"></div>'),
}))

import { removeFromSrcGroup } from '../../composables/domain/useGroup.js'
import { EditorManager } from '../../lib/editor.js'

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

function resetMocks() {
  mockData.groupMap = {}
  mockData.updateGroup.mockClear()
  const EM = EditorManager as any
  EM.get.mockReset()
  EM.get.mockReturnValue(null)
  EM.deleteNode.mockClear()
  EM.getContentHTML.mockReset()
  EM.getContentHTML.mockReturnValue(null)
}

describe('removeFromSrcGroup', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetMocks()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('srcGid 空 → false 且不触发任何副作用', () => {
    expect(removeFromSrcGroup('', 'bm-a')).toBe(false)
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(EditorManager.deleteNode).not.toHaveBeenCalled()
    expect(EditorManager.getContentHTML).not.toHaveBeenCalled()
  })

  it('bmId 空 → false 且不触发任何副作用', () => {
    mockData.groupMap['g1'] = makeGroup()
    expect(removeFromSrcGroup('g1', '')).toBe(false)
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(EditorManager.deleteNode).not.toHaveBeenCalled()
    expect(EditorManager.getContentHTML).not.toHaveBeenCalled()
  })

  it('srcGid 对应组不存在 → false 且无 updateGroup/deleteNode（saveGroupBody 也 short-circuit）', () => {
    expect(removeFromSrcGroup('nope', 'bm-a')).toBe(false)
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(EditorManager.deleteNode).not.toHaveBeenCalled()
  })

  it('非 ref 且 bookmarkIds 不含 bmId → idx<0 → false，无 updateGroup/deleteNode/saveGroupBody', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a', 'bm-b'] })
    expect(removeFromSrcGroup('g1', 'bm-missing')).toBe(false)
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(EditorManager.deleteNode).not.toHaveBeenCalled()
    expect(EditorManager.getContentHTML).not.toHaveBeenCalled()
  })

  it('非 ref 且 bookmarkIds 含 bmId → 删 bmId 后 updateGroup(bookmarkIds) + deleteNode + saveGroupBody → true', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a', 'bm-b', 'bm-c'] })
    ;(EditorManager as any).get.mockReturnValue({} as any)
    ;(EditorManager as any).getContentHTML.mockReturnValue('<p>新</p>')
    expect(removeFromSrcGroup('g1', 'bm-b')).toBe(true)
    // updateGroup 调 2 次：第一次 filter 删 bmId，第二次 saveGroupBody 写 notes
    expect(mockData.updateGroup).toHaveBeenCalledTimes(2)
    expect(mockData.updateGroup).toHaveBeenNthCalledWith(1, 'g1', { bookmarkIds: ['bm-a', 'bm-c'] })
    expect(mockData.updateGroup).toHaveBeenNthCalledWith(2, 'g1', { notes: '<p>新</p>' })
    expect(EditorManager.deleteNode).toHaveBeenCalledTimes(1)
    expect(EditorManager.deleteNode).toHaveBeenCalledWith('g1', 'data-bm-id', 'bm-b')
  })

  it('非 ref 且 EditorManager.get() 返 null（无编辑器实例）→ deleteNode 不调，仍 true', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] })
    ;(EditorManager as any).get.mockReturnValue(null as any)
    expect(removeFromSrcGroup('g1', 'bm-a')).toBe(true)
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: [] })
    expect(EditorManager.deleteNode).not.toHaveBeenCalled()
  })

  it('非 ref bookmarkIds 含 bmId 但 EditorManager.getContentHTML 返 null → saveGroupBody 不二次 updateGroup 写 notes（notes 不被覆盖清空）', () => {
    mockData.groupMap['g1'] = makeGroup({ notes: '<p>莫清</p>', bookmarkIds: ['bm-a'] })
    ;(EditorManager as any).get.mockReturnValue({} as any)
    ;(EditorManager as any).getContentHTML.mockReturnValue(null)
    expect(removeFromSrcGroup('g1', 'bm-a')).toBe(true)
    // 仅一条 updateGroup（删 bmId），saveGroupBody 因 editorHTML===null 不再写 notes
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: [] })
    // notes 未被覆盖
    expect(mockData.groupMap['g1'].notes).toBe('<p>莫清</p>')
  })

  it('ref（bmId="ref:xxx"）即使组里无该 ref → 无 idx 守卫，直接 deleteNode(data-ref-gid, xxx)+saveGroupBody → true（隐特性）', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] }) // 组里不含 'ref:xxx'
    ;(EditorManager as any).get.mockReturnValue({} as any)
    ;(EditorManager as any).getContentHTML.mockReturnValue('<p>新</p>')
    expect(removeFromSrcGroup('g1', 'ref:xxx')).toBe(true)
    // ref 分支不 updateGroup(bookmarkIds)，仅 saveGroupBody 的 notes updateGroup
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { notes: '<p>新</p>' })
    expect(EditorManager.deleteNode).toHaveBeenCalledWith('g1', 'data-ref-gid', 'xxx')
  })

  it('ref 的 ref-gid 正确 slice 去 "ref:" 前缀 = bmId.slice(4) 作为 deleteNode lookupId', () => {
    mockData.groupMap['g1'] = makeGroup()
    ;(EditorManager as any).get.mockReturnValue({} as any)
    removeFromSrcGroup('g1', 'ref:g7')
    expect(EditorManager.deleteNode).toHaveBeenCalledWith('g1', 'data-ref-gid', 'g7')
  })

  it('非 ref 的 deleteNode 第二参 lookupId = bmId 原（不 slice）', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-special'] })
    ;(EditorManager as any).get.mockReturnValue({} as any)
    removeFromSrcGroup('g1', 'bm-special')
    expect(EditorManager.deleteNode).toHaveBeenCalledWith('g1', 'data-bm-id', 'bm-special')
  })

  it('saveGroupBody：sg 存在且 getContentHTML 非 null → updateGroup notes 入参值匹配 editorHTML', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a'] })
    ;(EditorManager as any).get.mockReturnValue({} as any)
    ;(EditorManager as any).getContentHTML.mockReturnValue('<div>editor 内容</div>')
    removeFromSrcGroup('g1', 'bm-a')
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { notes: '<div>editor 内容</div>' })
  })

  it('updateGroup 删 bmId 时只删目标项保留其余（filter 入参正确）', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a', 'bm-b', 'bm-c', 'bm-d'] })
    ;(EditorManager as any).get.mockReturnValue(null as any)
    removeFromSrcGroup('g1', 'bm-c')
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-b', 'bm-d'] })
  })

  it('多次调同 srcGid 不同 bmId → 各自独立，无状态残留', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a', 'bm-b'] })
    ;(EditorManager as any).get.mockReturnValue(null as any)
    expect(removeFromSrcGroup('g1', 'bm-a')).toBe(true)
    // 由于 updateGroup mock 真改 sg.bookmarkIds（Object.assign），第二次基于已删后数组
    expect(removeFromSrcGroup('g1', 'bm-b')).toBe(true)
    expect(mockData.groupMap['g1'].bookmarkIds).toEqual([])
  })

  it('删除首项（idx=0）时 filter 正确删首项非错删末项', () => {
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-a', 'bm-b', 'bm-c'] })
    ;(EditorManager as any).get.mockReturnValue(null as any)
    expect(removeFromSrcGroup('g1', 'bm-a')).toBe(true)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-b', 'bm-c'] })
  })
})
