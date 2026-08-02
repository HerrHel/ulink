import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- addToGroupDirect 护栏（d1-68，useGroup.ts:136） ----
// 生产消费方双重：AddPopover.vue:166（弹窗「添加书签到组」） + useDragDrop.ts:446（拖书签落到组）
// 与 d1-64 addGroupRefToGroup 对称的普通书签版（add 组引用卡的姐妹函数）。
// 套 d1-64/d1-66/d1-67 已验证的 vi.mock 闭包 mock 范本（修正后的 useInlineCard.js 路径）。
//
// addToGroupDirect 读 dataStore.groupMap[tGid] / bookmarkMap[bmId] + 调 updateGroup；
// 调 EditorManager.get(tGid) 真 tiptap 实例 → ed 双分支（ed truthy 走 chain().insertContent(inlineCardHTML(bm)).run()
// / ed falsy 不走 insertContent，靠 saveGroupBody 兜底持久化）；末尾恒 saveGroupBody(tGid) + saveAppData() + toast('已添加到组')。
// saveGroupBody 是 useGroup.ts 同文件 export function 非跨模块 import 故无法 vi.mock，
// 靠 EditorManager.getContentHTML mock 返 null 让 saveGroupBody 内 editorHTML===null 守卫命中不调 updateGroup，
// 与 d1-66 removeGroupRef 同口径——避免 saveGroupBody 真实执行时 updateGroup 二次副作用污染断言。
//
// 注：直接在 EditorManager.get / getContentHTML 的 mock 实例上 mockReturnValue（不经模块级 vi.fn 间接），
// 避开 afterEach restoreAllMocks 与工厂闭包间接的双重泄漏坑（首轮踩出的 chain 返 undefined 经验修正）。

const mockData = {
  groupMap: {} as Record<string, any>,
  bookmarkMap: {} as Record<string, any>,
  updateGroup: vi.fn(),
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

// EditorManager 单例 mock：get / getContentHTML 在 beforeEach 里直接 mockReturnValue 控制分支
vi.mock('../../lib/editor.js', () => ({
  EditorManager: {
    get: vi.fn(),
    insertAtCoords: vi.fn(),
    deleteNode: vi.fn(),
    getContentHTML: vi.fn(),
  },
}))

vi.mock('../../composables/useInlineCard.js', () => ({
  // addToGroupDirect 仅在 ed truthy 分支调 inlineCardHTML(bm) 传给 ed.chain().insertContent
  // 返回固定可断言实体，避免 d1-64 首轮「真实渲染 SVG 污染断言」教训（mock 路径必须拦截到本模块）
  inlineCardHTML: vi.fn((bm: any) => `<inline-card data-bm-id="${bm?.id ?? ''}"></inline-card>`),
  groupRefCardHTML: vi.fn(),
}))

vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../../composables/ui/useIconPreview.js', () => ({
  previewIconUrl: vi.fn(),
  clearIcon: vi.fn(),
}))

vi.mock('../../utils.js', () => ({
  gid: vi.fn(() => 'GIDSTUB1'),
}))

import { addToGroupDirect } from '../../composables/domain/useGroup.js'
import { inlineCardHTML } from '../../composables/useInlineCard.js'
import { saveAppData } from '../../stores/app.js'
import { toast } from '../../lib/toast.js'
import { EditorManager } from '../../lib/editor.js'

function makeBookmark(overrides: Partial<any> = {}) {
  return {
    id: 'b1' as string,
    title: 'T',
    url: 'https://x.test',
    icon: '',
    username: '',
    password: '',
    notes: '',
    categoryId: 'cat1',
    parentId: null as any,
    order: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as any
}

function makeGroup(overrides: Partial<any> = {}) {
  return {
    id: 'g1' as string,
    name: '组1',
    categoryId: 'cat1',
    icon: '',
    order: 0,
    isExpanded: false,
    attributes: {},
    bookmarkIds: [] as string[],
    notes: '',
    useCount: 0,
    updatedAt: 0,
    ...overrides,
  } as any
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockData.groupMap = {}
  mockData.bookmarkMap = {}
  mockData.updateGroup = vi.fn()
  ;(saveAppData as any).mockReset()
  ;(toast as any).mockReset()
  ;(inlineCardHTML as any).mockReset()
  ;(inlineCardHTML as any).mockImplementation((bm: any) => `<inline-card data-bm-id="${bm?.id ?? ''}"></inline-card>`)
  ;(EditorManager.get as any).mockReset()
  ;(EditorManager.get as any).mockReturnValue(null) // 默认无编辑器实例
  ;(EditorManager.getContentHTML as any).mockReset()
  ;(EditorManager.getContentHTML as any).mockReturnValue(null) // saveGroupBody 静默守卫
})

afterEach(() => {
  vi.clearAllMocks()
})

function makeEditorChain() {
  // 真实 tiptap 链式：ed.chain() 返回 ChainableEditor，其 .insertContent() 与 .run()
  // 等方法各自返回同一 chain 实例供继续链。故 chainLink 同时持 insertContent + run 且都返自身。
  // （首轮 vi.fn() 默认返 undefined 致 `.run()` 在 undefined 上报 run-undefined——probe 抓出此真实链式语义）
  const chainInsertContent = vi.fn()
  const run = vi.fn()
  const chainLink = {
    insertContent: chainInsertContent,
    run,
  }
  chainInsertContent.mockReturnValue(chainLink)
  return { chain: vi.fn(() => chainLink), chainInsertContent, run }
}

describe('addToGroupDirect (useGroup.ts:136)', () => {
  it('sg 不存在 → 早退，零副作用（不调 updateGroup/saveAppData/toast/inlineCardHTML）', () => {
    addToGroupDirect('b1', 'g_missing')
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(EditorManager.get).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
    expect(inlineCardHTML).not.toHaveBeenCalled()
  })

  it('书签已在组内（indexOf !== -1）→ toast("书签已在组内", false) + return 早退，无 updateGroup/insertContent/saveAppData', () => {
    mockData.groupMap = { g1: makeGroup({ bookmarkIds: ['b1'] }) }
    mockData.bookmarkMap = { b1: makeBookmark() }
    addToGroupDirect('b1', 'g1')
    expect(toast).toHaveBeenCalledWith('书签已在组内', false)
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(EditorManager.get).not.toHaveBeenCalled()
    expect(inlineCardHTML).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('bookmarkMap 缺该 bm（!bm 守卫）→ return 无副作用（即使 sg 存在且 bm 不在组内也不追加/createCard/持久化）', () => {
    mockData.groupMap = { g1: makeGroup({ bookmarkIds: [] }) }
    // 故意不把 b1 放进 bookmarkMap
    addToGroupDirect('b1', 'g1')
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(EditorManager.get).not.toHaveBeenCalled()
    expect(inlineCardHTML).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalledWith('已添加到组')
    expect(saveAppData).not.toHaveBeenCalled()
    // 关键隐特性直锁：!bm 守卫在 indexOf 通过之后 → indexOf!==-1 但 bm 缺失仍早退；
    // 若未来误删 !bm 守卫，undefined 会传给 inlineCardHTML(bm=undefined) 渲染成 bmid=空 inline card 注入组，无测试告警
  })

  it('正路径：updateGroup 追加 bmId 到末位（bookmarkIds: [...sg.bookmarkIds, bmId]）非覆盖替换', () => {
    mockData.groupMap = { g1: makeGroup({ bookmarkIds: ['old1', 'old2'] }) }
    mockData.bookmarkMap = { b1: makeBookmark() }
    addToGroupDirect('b1', 'g1')
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', {
      bookmarkIds: ['old1', 'old2', 'b1'],
    })
  })

  it('ed truthy → ed.chain().insertContent(inlineCardHTML(bm)).run() 链式三调 + saveGroupBody + saveAppData + toast("已添加到组")', () => {
    const { chain, chainInsertContent, run } = makeEditorChain()
    ;(EditorManager.get as any).mockReturnValue({ chain })
    mockData.groupMap = { g1: makeGroup({ bookmarkIds: [] }) }
    mockData.bookmarkMap = { b1: makeBookmark() }
    addToGroupDirect('b1', 'g1')
    expect(chain).toHaveBeenCalledTimes(1) // chain() 链入口调一次
    // insertContent 入参是 inlineCardHTML(bm) 渲染实体（含 data-bm-id=b1，非空串）
    const cardHTML = chainInsertContent.mock.calls[0][0]
    expect(cardHTML).toContain('data-bm-id="b1"')
    expect(inlineCardHTML).toHaveBeenCalledTimes(1)
    expect(inlineCardHTML).toHaveBeenCalledWith(mockData.bookmarkMap.b1)
    expect(run).toHaveBeenCalledTimes(1) // run() 末尾触发
    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('已添加到组')
  })

  it('ed falsy（无编辑器实例）→ inlineCardHTML 不被调用（inlineCardHTML 仅 ed truthy 分支求值）+ updateGroup 仅追加点一次 + saveAppData + toast("已添加到组")', () => {
    ;(EditorManager.get as any).mockReturnValue(null)
    mockData.groupMap = { g1: makeGroup({ bookmarkIds: [] }) }
    mockData.bookmarkMap = { b1: makeBookmark() }
    addToGroupDirect('b1', 'g1')
    // 关键契约直锁：inlineCardHTML(bm) 在 `if (ed) ed.chain().insertContent(inlineCardHTML(bm)).run()` 内，
    // ed falsy 时整条 if 不求值，inlineCardHTML 不被调用（短路未渲染）
    expect(inlineCardHTML).not.toHaveBeenCalled()
    // updateGroup 仅正路径追加点一次，saveGroupBody 静默（getContentHTML→null）不二次写 notes
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['b1'] })
    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('已添加到组')
  })

  it('saveGroupBody 串联静默：getContentHTML→null 时 saveGroupBody 跑（sg 命中）但 updateGroup 不带 notes 二次污染', () => {
    const { chain } = makeEditorChain()
    ;(EditorManager.get as any).mockReturnValue({ chain })
    ;(EditorManager.getContentHTML as any).mockReturnValue(null) // saveGroupBody 静默守卫命中
    mockData.groupMap = { g1: makeGroup({ bookmarkIds: [] }) }
    mockData.bookmarkMap = { b1: makeBookmark() }
    addToGroupDirect('b1', 'g1')
    // 仅正路径追加点 updateGroup 一次，saveGroupBody 不二次 updateGroup 写 notes
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['b1'] })
    // 任何时候 updateGroup 入参都不带 notes 键（证 saveGroupBody 静默不污染）
    for (const call of mockData.updateGroup.mock.calls) {
      const patch = call[1] as any
      expect(patch).not.toHaveProperty('notes')
    }
  })

  it('连续调不同 bmId 各自独立：updateGroup mock 真改 sg.bookmarkIds 增量 append 后第二次基于已更新数组无状态残留', () => {
    mockData.updateGroup.mockImplementation((_gid: string, patch: any) => {
      mockData.groupMap[_gid] = { ...mockData.groupMap[_gid], ...patch }
    })
    mockData.groupMap = { g1: makeGroup({ bookmarkIds: [] }) }
    mockData.bookmarkMap = { b1: makeBookmark(), b2: makeBookmark({ id: 'b2' }) }
    addToGroupDirect('b1', 'g1')
    expect(mockData.groupMap.g1.bookmarkIds).toEqual(['b1'])
    addToGroupDirect('b2', 'g1')
    // 第二次基于已 append 的 ['b1'] 再 append b2 → ['b1','b2']，非从 [] 重置
    expect(mockData.groupMap.g1.bookmarkIds).toEqual(['b1', 'b2'])
    expect(mockData.updateGroup).toHaveBeenCalledTimes(2)
    expect(mockData.updateGroup).toHaveBeenNthCalledWith(2, 'g1', { bookmarkIds: ['b1', 'b2'] })
    expect(saveAppData).toHaveBeenCalledTimes(2)
  })
})
