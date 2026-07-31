import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store 实例（沿用 removeBmFromGroup.test.ts 口径）----
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

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))

// EditorManager mock：直放 spy（沿用 removeBmFromGroup.test.ts 口径）
// get 默认 null（走 DOM fallback 路径），动态 mockReturnValue 切带 descendants 的伪编辑器
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

// d1-64 教训：mock 路径用 '../../composables/useInlineCard.js'（解析到 src/composables/useInlineCard.js）
// 本 chunk syncGroupBookmarks 不消费 inlineCardHTML/groupRefCardHTML 返回内容，但模块顶层 import 需 mock 避副作用
vi.mock('../../composables/useInlineCard.js', () => ({
  inlineCardHTML: vi.fn((bm: any) => `<div class="inline-card" data-bm-id="${bm?.id}"></div>`),
  groupRefCardHTML: vi.fn(() => '<div class="ref-card"></div>'),
}))

import { syncGroupBookmarks } from '../../composables/domain/useGroup.js'
import { EditorManager } from '../../lib/editor.js'
import { saveAppData } from '../../stores/app.js'

// 伪 editor：state.doc.descendants 遍历调 cb（喂一组伪 inlineCard node）
function makeFakeEditorFromNodes(nodes: Array<{ 'data-bm-id': string }>) {
  const descendants = (cb: (node: any) => void) => {
    for (const n of nodes) {
      cb({ type: { name: 'inlineCard' }, attrs: n })
    }
  }
  return { state: { doc: { descendants } } } as any
}

function makeGroup(overrides: Partial<any> = {}) {
  return {
    id: 'g1',
    name: '组一',
    categoryId: 'uncategorized',
    bookmarkIds: [] as string[],
    notes: '<p>原</p>',
    ...overrides,
  }
}

function makeBookmark(overrides: Partial<any> = {}) {
  return {
    id: 'bm-a',
    title: '书签A',
    url: 'https://a.example.com',
    deletedAt: null as string | null,
    ...overrides,
  }
}

// 构造 DOM fallback 路径所需的真实 jsdom 节点（sgBody_<gid> + .group-inline-card[data-bm-id] 卡片）
function mountDomCards(gid: string, bmIds: Array<{ 'data-bm-id': string; class?: string }>) {
  document.body.innerHTML = ''
  const body = document.createElement('div')
  body.id = 'sgBody_' + gid
  for (const c of bmIds) {
    const span = document.createElement('span')
    span.setAttribute('data-bm-id', c['data-bm-id'])
    span.className = 'group-inline-card' + (c.class ? ' ' + c.class : '')
    body.appendChild(span)
  }
  document.body.appendChild(body)
  return body
}

function resetMocks() {
  mockData.groupMap = {}
  mockData.bookmarkMap = {}
  mockData.updateGroup.mockReset()
  mockData.updateGroup.mockImplementation((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  })
  ;(EditorManager.get as any).mockReset()
  ;(EditorManager.get as any).mockReturnValue(null)
  ;(EditorManager.deleteNode as any).mockReset()
  ;(EditorManager.getContentHTML as any).mockReset()
  ;(EditorManager.getContentHTML as any).mockReturnValue(null)
  vi.mocked(saveAppData).mockClear()
  document.body.innerHTML = ''
}

describe('syncGroupBookmarks', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  // ====== sg 不存在守卫 ======
  it('sg 不存在 → 直接 return，零副作用（无 updateGroup/saveAppData）', () => {
    syncGroupBookmarks('g-missing')
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
  })

  // ====== ed 路径（tiptap descendants） ======
  it('ed 路径：有编辑器实例遍历 inlineCard node，updateGroup 写入收集到的 bmIds', () => {
    ;(EditorManager.get as any).mockReturnValue(
      makeFakeEditorFromNodes([{ 'data-bm-id': 'bm-a' }, { 'data-bm-id': 'bm-b' }])
    )
    mockData.groupMap['g1'] = makeGroup()
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })
    mockData.bookmarkMap['bm-b'] = makeBookmark({ id: 'bm-b' })
    vi.mocked(saveAppData).mockClear()

    syncGroupBookmarks('g1')

    expect(EditorManager.get).toHaveBeenCalledWith('g1')
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-b'] })
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('ed 路径：A5-005 过滤——bookmarkMap 中不存在的 bmid 不入 ids（防悬空 id）', () => {
    ;(EditorManager.get as any).mockReturnValue(
      makeFakeEditorFromNodes([
        { 'data-bm-id': 'bm-a' },
        { 'data-bm-id': 'bm-ghost' }, // 不在 bookmarkMap
        { 'data-bm-id': 'bm-b' },
      ])
    )
    mockData.groupMap['g1'] = makeGroup()
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })
    mockData.bookmarkMap['bm-b'] = makeBookmark({ id: 'bm-b' })
    // 注意：bm-ghost 不放入 bookmarkMap

    syncGroupBookmarks('g1')

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-b'] })
  })

  it('ed 路径：A5-005 过滤——软删（deletedAt 非空）的 bookmark 不入 ids', () => {
    ;(EditorManager.get as any).mockReturnValue(
      makeFakeEditorFromNodes([
        { 'data-bm-id': 'bm-a' },
        { 'data-bm-id': 'bm-soft' }, // 软删
        { 'data-bm-id': 'bm-b' },
      ])
    )
    mockData.groupMap['g1'] = makeGroup()
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })
    mockData.bookmarkMap['bm-soft'] = makeBookmark({ id: 'bm-soft', deletedAt: '2026-01-01' })
    mockData.bookmarkMap['bm-b'] = makeBookmark({ id: 'bm-b' })

    syncGroupBookmarks('g1')

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-b'] })
  })

  it('ed 路径：seen dedup——同一 bmid 多个 inlineCard node 只入一次（防 id 重复）', () => {
    ;(EditorManager.get as any).mockReturnValue(
      makeFakeEditorFromNodes([
        { 'data-bm-id': 'bm-a' },
        { 'data-bm-id': 'bm-a' }, // 重复同 id
        { 'data-bm-id': 'bm-a' }, // 再重复
        { 'data-bm-id': 'bm-b' },
      ])
    )
    mockData.groupMap['g1'] = makeGroup()
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })
    mockData.bookmarkMap['bm-b'] = makeBookmark({ id: 'bm-b' })

    syncGroupBookmarks('g1')

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-b'] })
  })

  it('ed 路径：无任何 inlineCard node → updateGroup 写空 ids 而非跳过 updateGroup', () => {
    ;(EditorManager.get as any).mockReturnValue(makeFakeEditorFromNodes([]))
    mockData.groupMap['g1'] = makeGroup({ bookmarkIds: ['bm-legacy'] })

    syncGroupBookmarks('g1')

    // 真实行为：updateGroup 仍被调用写入空数组（清空），saveAppData 被调
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: [] })
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('ed 路径：非 inlineCard 类型的 node 被忽略（仅采 inlineCard node attrs）', () => {
    ;(EditorManager.get as any).mockReturnValue({
      state: {
        doc: {
          descendants: (cb: (node: any) => void) => {
            cb({ type: { name: 'paragraph' }, attrs: {} }) // 非 inlineCard
            cb({ type: { name: 'inlineCard' }, attrs: { 'data-bm-id': 'bm-a' } })
            cb({ type: { name: 'heading' }, attrs: {} }) // 非 inlineCard
          },
        },
      },
    } as any)
    mockData.groupMap['g1'] = makeGroup()
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })

    syncGroupBookmarks('g1')

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a'] })
  })

  it("ed 路径关键隐特性：inlineCard node 缺 data-bm-id（attr==''）时走 bmid truthy 守卫不算 bm 不入 ids", () => {
    // 源码：const bmid = node.attrs['data-bm-id']; const bm = bmid ? ds.bookmarkMap[bmid] : null;
    // bmid 为 undefined/'' 时 bm=null 不入 ids
    ;(EditorManager.get as any).mockReturnValue(
      makeFakeEditorFromNodes([
        { 'data-bm-id': '' as any }, // 空 attr
        { 'data-bm-id': 'bm-a' },
      ])
    )
    mockData.groupMap['g1'] = makeGroup()
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })

    syncGroupBookmarks('g1')

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a'] })
  })

  // ====== DOM fallback 路径 ======
  it('DOM 路径：无编辑器实例（get 返 null）时走 document.getElementById', () => {
    // 默认 EditorManager.get 返 null
    mockData.groupMap['g1'] = makeGroup()
    mountDomCards('g1', [
      { 'data-bm-id': 'bm-a' },
      { 'data-bm-id': 'bm-b' },
    ])
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })
    mockData.bookmarkMap['bm-b'] = makeBookmark({ id: 'bm-b' })

    syncGroupBookmarks('g1')

    expect(EditorManager.get).toHaveBeenCalledWith('g1')
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-b'] })
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('DOM 路径：getElementById 找不到 sgBody_<gid> 节点 → 直接 return，无 updateGroup/saveAppData', () => {
    // 源码：const el = document.getElementById('sgBody_' + gid); if (!el) return;
    mockData.groupMap['g1'] = makeGroup()
    // 不挂任何 DOM 节点

    syncGroupBookmarks('g-no-dom')

    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('DOM 路径：A5-005 过滤——软删 bookmark 排除不入 ids', () => {
    mockData.groupMap['g1'] = makeGroup()
    mountDomCards('g1', [
      { 'data-bm-id': 'bm-a' },
      { 'data-bm-id': 'bm-soft' },
      { 'data-bm-id': 'bm-b' },
    ])
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })
    mockData.bookmarkMap['bm-soft'] = makeBookmark({ id: 'bm-soft', deletedAt: '2026-01-01' })
    mockData.bookmarkMap['bm-b'] = makeBookmark({ id: 'bm-b' })

    syncGroupBookmarks('g1')

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-b'] })
  })

  it('DOM 路径：bookmarkMap 不存在的 bmid 排除不入 ids（防悬空 id）', () => {
    mockData.groupMap['g1'] = makeGroup()
    mountDomCards('g1', [
      { 'data-bm-id': 'bm-a' },
      { 'data-bm-id': 'bm-ghost' }, // bookmarkMap 无
      { 'data-bm-id': 'bm-b' },
    ])
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })
    mockData.bookmarkMap['bm-b'] = makeBookmark({ id: 'bm-b' })

    syncGroupBookmarks('g1')

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-b'] })
  })

  it("DOM 路径关键独有契约：ref: 前缀的引用卡 id 排除（ed 路径不查 ref:，仅 DOM 路径查 indexOf !== 0）", () => {
    // 源码 DOM 路径：if (bmid && bmid.indexOf('ref:') !== 0 && !seen2[bmid]) —— ref: 开头跳过
    // ed 路径无此排除（ed 路径的 inlineCard node 只承载真实书签 id，引用卡是另一 node 类型）
    mockData.groupMap['g1'] = makeGroup()
    mountDomCards('g1', [
      { 'data-bm-id': 'bm-a' },
      { 'data-bm-id': 'ref:r1' }, // 引用卡，应排除
      { 'data-bm-id': 'bm-b' },
    ])
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })
    mockData.bookmarkMap['bm-b'] = makeBookmark({ id: 'bm-b' })
    // ref:r1 即便误入 bookmarkMap 也应被 ref: 排除（防 ref 卡串入 bookmarkIds）
    mockData.bookmarkMap['ref:r1'] = makeBookmark({ id: 'ref:r1' })

    syncGroupBookmarks('g1')

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-b'] })
  })

  it('DOM 路径：seen2 dedup——同 bmid 多张卡片只入一次', () => {
    mockData.groupMap['g1'] = makeGroup()
    mountDomCards('g1', [
      { 'data-bm-id': 'bm-a' },
      { 'data-bm-id': 'bm-a' }, // 重复
      { 'data-bm-id': 'bm-b' },
      { 'data-bm-id': 'bm-b' }, // 重复
    ])
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })
    mockData.bookmarkMap['bm-b'] = makeBookmark({ id: 'bm-b' })

    syncGroupBookmarks('g1')

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a', 'bm-b'] })
  })

  it('DOM 路径：sgBody 无任何 group-inline-card 卡片 → updateGroup 写空 ids 而非跳过', () => {
    mockData.groupMap['g-empty'] = makeGroup({ id: 'g-empty', bookmarkIds: ['bm-legacy'] })
    // 挂匹配 gid 的空 body（无卡片子元素）
    document.body.innerHTML = ''
    const b = document.createElement('div')
    b.id = 'sgBody_g-empty'
    document.body.appendChild(b)

    syncGroupBookmarks('g-empty')

    expect(mockData.updateGroup).toHaveBeenCalledWith('g-empty', { bookmarkIds: [] })
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('DOM 路径：仅 ref: 卡片无真实卡片 → updateGroup 写空 ids（ref 全排除）', () => {
    mockData.groupMap['g1'] = makeGroup()
    mountDomCards('g1', [
      { 'data-bm-id': 'ref:r1' },
      { 'data-bm-id': 'ref:r2' },
    ])

    syncGroupBookmarks('g1')

    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: [] })
  })

  // ====== 顺序契约 ======
  it('两路径末尾均调 saveAppData（持久化触发）（sg 存在且 el 存在/ ed 存在场景）', () => {
    // ed 路径
    ;(EditorManager.get as any).mockReturnValue(
      makeFakeEditorFromNodes([{ 'data-bm-id': 'bm-a' }])
    )
    mockData.groupMap['g-ed'] = makeGroup({ id: 'g-ed' })
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })
    vi.mocked(saveAppData).mockClear()
    syncGroupBookmarks('g-ed')
    expect(saveAppData).toHaveBeenCalledTimes(1)

    // DOM 路径
    resetMocks()
    mockData.groupMap['g-dom'] = makeGroup({ id: 'g-dom' })
    mountDomCards('g-dom', [{ 'data-bm-id': 'bm-a' }])
    mockData.bookmarkMap['bm-a'] = makeBookmark({ id: 'bm-a' })
    vi.mocked(saveAppData).mockClear()
    syncGroupBookmarks('g-dom')
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })
})
