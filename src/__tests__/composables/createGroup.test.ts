import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store / gid 桩（沿用 d1-64/d1-66 已验证的 vi.mock 闭包 mock 范本）----
// createGroup 读 dataStore.bookmarks/siblingGroups（算 max order）+ 调 addGroup；
// 读 uiStore.curCat（算 categoryId 兜底）；调 saveAppData + toast；调 utils.gid() 拼 id。
// 不读 EditorManager（无编辑器交互），但 useGroup.ts 顶层 import 了 editor.js 故仍需 mock 档位。
const mockData = {
  bookmarks: [] as any[],
  siblingGroups: [] as any[],
  addGroup: vi.fn(),
}

const mockUI = {
  curCat: 'all' as string,
}

// 用单调递增计数器让 gid() 可断言：每次调用返回序列的第 N 个固定串
let gidSeq = 0
const gidStubs = ['GIDSTUB1', 'GIDSTUB2', 'GIDSTUB3']

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

vi.mock('../../utils.js', () => ({
  // gid(): 真实实现是 nanoid(12)；mock 成序列串让 'sg_'+gid() 可断言非确定
  gid: vi.fn(() => {
    const stub = gidStubs[gidSeq % gidStubs.length]
    gidSeq += 1
    return stub
  }),
}))

import { createGroup } from '../../composables/domain/useGroup.js'
import { saveAppData } from '../../stores/app.js'
import { toast } from '../../lib/toast.js'
import { gid } from '../../utils.js'
import { CAT_ALL, CAT_UNCATEGORIZED, ATTR_IS_GROUP } from '../../config/constants.js'

function makeBookmark(overrides: Partial<any> = {}) {
  return {
    id: 'b1',
    title: '',
    url: '',
    icon: '',
    username: '',
    password: '',
    notes: '',
    categoryId: 'cat1',
    parentId: null as any,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeGroup(overrides: Partial<any> = {}) {
  return {
    id: 'sg_existing1',
    name: '已有组',
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

describe('createGroup — 新建组的三路 categoryId 解析 + order 公式 + id/attrs 契约护栏（D1-67）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockData.bookmarks = []
    mockData.siblingGroups = []
    mockData.addGroup.mockReset()
    mockUI.curCat = 'all'
    gidSeq = 0
    vi.mocked(saveAppData).mockReset()
    vi.mocked(toast).mockReset()
    vi.mocked(gid).mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('①catId 显式传入 → categoryId=catId（优先于 ui.curCat）', () => {
    mockUI.curCat = 'someOtherCat'
    const id = createGroup('explicitCat')
    const added = mockData.addGroup.mock.calls[0][0]
    expect(added.categoryId).toBe('explicitCat')
    expect(id).toBe('sg_' + added.id.replace(/^sg_/, ''))
  })

  it('②catId 未传 + ui.curCat===CAT_ALL → categoryId=CAT_UNCATEGORIZED（"全部分类"语境兜底）', () => {
    mockUI.curCat = CAT_ALL
    createGroup()
    const added = mockData.addGroup.mock.calls[0][0]
    expect(added.categoryId).toBe(CAT_UNCATEGORIZED)
  })

  it('③catId 未传 + ui.curCat!==CAT_ALL → categoryId=ui.curCat', () => {
    mockUI.curCat = 'work'
    createGroup()
    const added = mockData.addGroup.mock.calls[0][0]
    expect(added.categoryId).toBe('work')
  })

  it('④order=Math.max(maxBmOrder,maxGrpOrder)+1 —— maxBmOrder 用 b.parentId?m 过滤子书签（只看顶层 bookmark order）', () => {
    // 顶层书签 order=5；子书签（有 parentId）order=1000 但被 b.parentId?m 过滤掉不入 maxBmOrder
    mockData.bookmarks = [makeBookmark({ id: 'top', order: 5, parentId: null })]
    // 捷径：用 makeBookmark 但改 parentId 制造子书签高 order（应被忽略）
    mockData.bookmarks.push(makeBookmark({ id: 'child', order: 1000, parentId: 'top' }))
    mockData.siblingGroups = [makeGroup({ id: 'sg_e', order: 3 })]
    createGroup()
    const added = mockData.addGroup.mock.calls[0][0]
    // maxBmOrder=5（顶层 top；child 的 1000 因 parentId 被跳过）/ maxGrpOrder=3 → max+1 = 6
    expect(added.order).toBe(6)
  })

  it('⑤空数据集 → max=-1+1=0（bookmarks 与 siblingGroups 均空）', () => {
    mockData.bookmarks = []
    mockData.siblingGroups = []
    createGroup()
    const added = mockData.addGroup.mock.calls[0][0]
    expect(added.order).toBe(0)
  })

  it('⑥id="sg_"+gid() 前缀 + 唯一（gid mock 序列）+ 顶层 bookmark order 高于 group 时取 bookmark max', () => {
    mockData.bookmarks = [makeBookmark({ id: 'top', order: 50 })]
    mockData.siblingGroups = [makeGroup({ id: 'sg_e', order: 10 })]
    const id = createGroup()
    const added = mockData.addGroup.mock.calls[0][0]
    // 取 maxBmOrder=50 / maxGrpOrder=10 → 51（顶层 bookmark 胜出）
    expect(added.order).toBe(51)
    expect(added.id).toBe('sg_' + gidStubs[0])
    expect(id).toBe('sg_' + gidStubs[0])
    expect(gid).toHaveBeenCalledTimes(1)
  })

  it('⑦attributes={ATTR_IS_GROUP:true} 内置组标记位（防未来误改/漏设让组被当普通书签列）', () => {
    createGroup()
    const added = mockData.addGroup.mock.calls[0][0]
    expect(added.attributes).toEqual({ [ATTR_IS_GROUP]: true })
  })

  it('⑧maxGrpOrder 不过滤 deletedAt——软删组也算入 max 计算（真实行为直锁，防未来误改为只看未删组）', () => {
    // 现存 max 组 order=8 但它是软删组（deletedAt 非空）
    mockData.siblingGroups = [makeGroup({ id: 'sg_deleted', order: 8, deletedAt: 1700000000000 })]
    mockData.bookmarks = [makeBookmark({ id: 'top', order: 2 })]
    createGroup()
    const added = mockData.addGroup.mock.calls[0][0]
    // maxBmOrder=2 / maxGrpOrder=8（软删组也算，已删组仍占 order 位）→ max+1 = 9
    expect(added.order).toBe(9)
  })

  it('⑨副作用链：调 ds.addGroup(新组对象) + saveAppData + toast("组已创建") 各一次', () => {
    const id = createGroup()
    expect(mockData.addGroup).toHaveBeenCalledTimes(1)
    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('组已创建')
    // addGroup 入参是一个完整 SiblingGroup 对象
    const added = mockData.addGroup.mock.calls[0][0]
    expect(added).toEqual(expect.objectContaining({
      id,
      name: '',
      icon: '',
      isExpanded: false,
      bookmarkIds: [],
      notes: '',
      useCount: 0,
    }))
    // updatedAt 是 Date.now() 数值（mock 计数器未 freeze 时间，用类型断言）
    expect(typeof added.updatedAt).toBe('number')
  })

  it('⑩返回值 === addGroup 入参的 .id（下游用此 id 立即打开编辑）', () => {
    const id = createGroup()
    const added = mockData.addGroup.mock.calls[0][0]
    expect(id).toBe(added.id)
    // 形态：sg_ 前缀 + gid() 串
    expect(id.startsWith('sg_')).toBe(true)
  })

  it('⑪连续新建多个组——gid() 每次递增序列不同，order 基于当前 store（新组未入 store 故仍按旧 max 算次序）', () => {
    // 关键隐特性：createGroup 算 max 是从 ds.bookmarks/siblingGroups 读，调 addGroup 后 mockData.bookmarks/siblingGroups
    // 并未更新（addGroup 只是 mock 桩不真改数组），故连续两次 createGroup 的 order 不递增而同 base max+1。
    // 锁此真实行为：addGroup mock 不回写 store，createGroup 不自己 push，故 order 公式 base 不含新组自己。
    mockData.siblingGroups = [makeGroup({ id: 'sg_e', order: 4 })]
    const id1 = createGroup()
    const id2 = createGroup()
    const added1 = mockData.addGroup.mock.calls[0][0]
    const added2 = mockData.addGroup.mock.calls[1][0]
    expect(added1.order).toBe(5) // max(4)+1
    expect(added2.order).toBe(5) // 同 base（新组未回写 store 故 max 仍 4）
    // gid() 序列两次不同
    expect(id1).toBe('sg_' + gidStubs[0])
    expect(id2).toBe('sg_' + gidStubs[1])
    expect(added1.id).not.toBe(added2.id)
  })

  it('⑫子书签 order 恰为现存最大但属子书签 → 不应顶替成 maxBmOrder（parentId 过滤真实生效边界）', () => {
    // 顶层 bookmark order=3；另有一条「顶层」其 order=3 但 parentId=0（falsy 非 null）—— 0 是 falsy
    // b.parentId ? m 的判定：parentId=0（falsy） → 视为顶层参与计算（与 parentId=null 同态，0 也是 falsy）
    mockData.bookmarks = [
      makeBookmark({ id: 'top', order: 3, parentId: null }),
      makeBookmark({ id: 'topZero', order: 999, parentId: 0 }), // parentId=0 falsy → 视为顶层，order 999 参与
    ]
    mockData.siblingGroups = []
    createGroup()
    const added = mockData.addGroup.mock.calls[0][0]
    // parentId=0 是 falsy → b.parentId ? m : ... 走 else 分支，order=999 参与计算 → maxBmOrder=999 → 1000
    expect(added.order).toBe(1000)
  })
})
