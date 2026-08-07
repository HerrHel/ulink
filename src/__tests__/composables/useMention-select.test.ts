/**
 * 行为契约护栏：useMention.selectBookmark / selectGroupRef — @书签 / #组引用 提及选中编排
 *
 * 生产场景：用户在组 notes 提示作者选 @书签 项或 #组 项，选中后把书签/组引用以 inline 卡片 HTML
 * 插入编辑器对应位置，并（书签情形）把书签加入本组 bookmarkIds（若不在）+ saveGroupBody/saveAppData 持久化。
 *
 * 上轮 Explore 接力点名（agentId a72cc7887c578005d 候选 #7）：
 *   useMention.ts:107/120 selectBookmark/selectGroupRef 全测试目录 0 直接断言
 *   （grep selectBookmark 仅命中 removeFromSrcGroup 无关、selectGroupRef 0 命中）。
 * 生产调用方：useMention.ts:173 onKeydown Enter 分支分派 mentionType group/bm。
 *
 * selectBookmark 编排契约（useMention.ts:107-118）：
 *   1. !mentionStore.gid → no-op（编辑器没绑组上下文，安全不乱插）
 *   2. ds.groupMap[gid] 或 ds.bookmarkMap[bmId] 缺 → hide()+return（id 无效不污染文档）
 *   3. EditorManager.get(gid) + _insertHTML(inlineCardHTML(b))（HTML 卡片插入）
 *   4. bmId 不在 sg.bookmarkIds → updateGroup 追加 bookmarkIds=[.., bmId]（去重不重复加）
 *   5. saveGroupBody+saveAppData+hide（落盘 + 关下拉）
 *   —— 缺 gid/bmId 早退不 updateGroup 不 save 不插 HTML 是核心安全契约
 *
 * selectGroupRef 编排契约（useMention.ts:120-128）：
 *   1. !gid || refGid===gid → hide()（自引用守卫：防组引用自己形成环指向）
 *   2. ds.groupMap[refGid] 缺 → hide()（引用组不存在不插）
 *   3. EditorManager.get(gid) + _insertHTML(groupRefCardHTML(src))
 *   4. saveGroupBody+saveAppData+hide+toast('已添加组引用')
 *   —— 自引用早退 + 引用组缺失早退不插 HTML 不 save 不 toast 是核心契约
 *
 * 纯加测试零源文件改动：两函数经 useMention() return 暴露。
 * mock 策略（沿用 removeFromSrcGroup.test.ts 口径 + 真 mentionStore）：
 *   - data store: mock 数据 + groupMap/bookmarkMap/updateGroup spy（控制 id 命中/缺失）
 *   - mentionStore: 用真 Pinia useMentionStore（L24 `gid` ref + `hide()` action 真联动，
 *     避免对 gid/hide mock 测不太到真实联动；与 r9-mention-store-guard 已锁 store 行为一致）
 *   - EditorManager: mock get 返回桩 editor（不真动 TipTap）；useInlineCard 返回桩 HTML
 *   - saveGroupBody (useGroup) / saveAppData / toast: spy 隔离副作用
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock data store（沿用 useBookmark.test.ts / removeFromSrcGroup.test.ts 口径）----
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

// overlay store 用真 Pinia（不走 mock），让 mentionStore.gid/hide 真联动见底
// （上方 note：同 r9-mention-store-guard 已锁的 store 行为一致）

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

// saveGroupBody 来自 useGroup（同 store import 域），spy 起来避免真写入链触发更广 mock
vi.mock('../../composables/domain/useGroup.js', () => ({
  saveGroupBody: vi.fn(),
}))

// useInlineCard：inlineCardHTML/groupRefCardHTML 桩返回有标志性 HTML（验 selectBookmark 走 bookmark 卡片、
// selectGroupRef 走组卡片两条不同插入分支不串染）
vi.mock('../../composables/useInlineCard.js', () => ({
  inlineCardHTML: vi.fn(() => '<div class="inline-card-bm"></div>'),
  groupRefCardHTML: vi.fn(() => '<div class="ref-card-grp"></div>'),
}))

vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../../composables/ui/useIconPreview.js', () => ({
  previewIconUrl: vi.fn(),
  clearIcon: vi.fn(),
}))

import { useMention } from '../../composables/domain/useMention.js'
import { useMentionStore } from '../../stores/overlay.js'
import { saveAppData } from '../../stores/app.js'
import { saveGroupBody } from '../../composables/domain/useGroup.js'
import { toast } from '../../lib/toast.js'
import { EditorManager } from '../../lib/editor.js'
import { inlineCardHTML, groupRefCardHTML } from '../../composables/useInlineCard.js'

// vi.mock 替换工厂返回的 vi.fn，但 TS 按真实模块签名推断类型；统一 cast 成 Mock 句柄
const inlineMock = inlineCardHTML as unknown as ReturnType<typeof vi.fn>
const refMock = groupRefCardHTML as unknown as ReturnType<typeof vi.fn>
const saveAppDataMock = saveAppData as unknown as ReturnType<typeof vi.fn>
const saveGroupBodyMock = saveGroupBody as unknown as ReturnType<typeof vi.fn>
const toastMock = toast as unknown as ReturnType<typeof vi.fn>

// 桩 editor 对象：_insertHTML 会调 chain().insertContent().run()，给个链式桩不真动 DOM
function makeStubEditor() {
  // 用对象链表实现 chain().insertContent() 仍返回 chain 自身（vitest vi.fn 不绑 this，
  // 用闭包 self 引用而非 this 关键字）
  const chain: any = { insertContent: undefined as any, deleteRange: undefined as any, run: undefined as any }
  chain.insertContent = vi.fn(() => chain)
  chain.deleteRange = vi.fn(() => chain)
  chain.run = vi.fn(() => true)
  const ed = { chain: vi.fn(() => chain), _chain: chain }
  return ed
}

function resetMocks() {
  mockData.groupMap = {}
  mockData.bookmarkMap = {}
  mockData.updateGroup.mockClear()
  saveAppDataMock.mockClear()
  saveGroupBodyMock.mockClear()
  toastMock.mockClear()
  inlineMock.mockClear()
  refMock.mockClear()
  const EM = EditorManager as any
  EM.get.mockReset()
}

describe('useMention.selectBookmark 编排护栏', () => {
  let mentionStore: ReturnType<typeof useMentionStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    resetMocks()
    mentionStore = useMentionStore()
  })
  afterEach(() => { vi.restoreAllMocks() })

  function prime(gid: string) {
    // 设 mentionStore.gid（真 store action open 设并 active=true）；selectBookmark 走 !gid 早退分支
    mentionStore.open(gid)
  }

  it('!gid 早退：mentionStore.gid=null → no-op（不取 groupMap 不插 HTML 不 update 不 save）', () => {
    // mentionStore.gid 默认 null（未 open）
    const { selectBookmark } = useMention()
    selectBookmark('bm-a')
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(inlineMock).not.toHaveBeenCalled()
    expect(saveGroupBodyMock).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('groupMap[gid] 缺 → hide()+return（gid 无对应组，不插 HTML 不 update 不 save）', () => {
    prime('g-missing')
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    const { selectBookmark } = useMention()
    selectBookmark('bm-a')
    expect(inlineCardHTML).not.toHaveBeenCalled()
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(saveGroupBody).not.toHaveBeenCalled()
    // hide 把 active 置 false
    expect(mentionStore.active).toBe(false)
  })

  it('bookmarkMap[bmId] 缺（gid 有效）→ hide()+return（选中的书签不存在不插 HTML 不 update 不 save）', () => {
    prime('g1')
    mockData.groupMap['g1'] = { id: 'g1', name: '组', bookmarkIds: [] }
    const { selectBookmark } = useMention()
    selectBookmark('bm-missing')
    expect(inlineCardHTML).not.toHaveBeenCalled()
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    expect(saveGroupBody).not.toHaveBeenCalled()
    expect(mentionStore.active).toBe(false)
  })

  it('正常路径：bmId 不在 sg.bookmarkIds → 插 HTML + updateGroup 追加 bmId + save + hide', () => {
    prime('g1')
    const sg = { id: 'g1', name: '组', bookmarkIds: ['bm-old'] }
    mockData.groupMap['g1'] = sg
    mockData.bookmarkMap['bm-a'] = { id: 'bm-a', title: 'BM-A', url: 'https://a' }
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    const { selectBookmark } = useMention()
    selectBookmark('bm-a')
    // inlineCardHTML 被调且参数为书签对象（HTML 卡片对象先于 _insertHTML 交付，Proof：selectBookmark 取了书签生成卡片）
    expect(inlineMock).toHaveBeenCalledTimes(1)
    expect((inlineMock.mock.calls[0] as any[])[0]).toMatchObject({ id: 'bm-a', title: 'BM-A' })
    // EditorManager.get(gid) 取编辑器（编排步骤：选编辑器上下文）
    expect((EditorManager as any).get).toHaveBeenCalledWith('g1')
    // chain().insertContent 真插入属 TipTap 选区行为，jsdom 无 Selection.getRangeAt 时
    // _insertHTML 走 `!sel.rangeCount` 早退不 insertContent（生产有真实选区会调用）——此断言跨 jsdom 不可达，跳过
    // bookmarkIds 追加 bmId（原 ['bm-old'] → ['bm-old','bm-a']）
    expect(mockData.updateGroup).toHaveBeenCalledTimes(1)
    expect(mockData.updateGroup.mock.calls[0][0]).toBe('g1')
    expect(mockData.updateGroup.mock.calls[0][1]).toEqual({ bookmarkIds: ['bm-old', 'bm-a'] })
    // save 落盘链
    expect(saveGroupBodyMock).toHaveBeenCalledWith('g1')
    expect(saveAppDataMock).toHaveBeenCalledTimes(1)
    expect(mentionStore.active).toBe(false)
  })

  it('bmId 已在 sg.bookmarkIds → 不重复 updateGroup（去重契约：仅插 HTML + save，不动 bookmarkIds）', () => {
    prime('g1')
    const sg = { id: 'g1', name: '组', bookmarkIds: ['bm-a', 'bm-b'] }
    mockData.groupMap['g1'] = sg
    mockData.bookmarkMap['bm-a'] = { id: 'bm-a', title: 'BM-A' }
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    const { selectBookmark } = useMention()
    selectBookmark('bm-a')
    // 仍插 HTML（已在该组也允许在文中再次提及引用，只是不重复 group 追加）
    expect(inlineMock).toHaveBeenCalledTimes(1)
    // 不 updateGroup（已在 bookmarkIds，去重核心契约）
    expect(mockData.updateGroup).not.toHaveBeenCalled()
    // 仍 save + hide
    expect(saveGroupBodyMock).toHaveBeenCalledWith('g1')
    expect(saveAppDataMock).toHaveBeenCalledTimes(1)
    expect(mentionStore.active).toBe(false)
  })

  it('编排顺序：inlineCardHTML 先于 updateGroup 先于 saveGroupBody（插入 HTML → 追加组 → 落盘）', () => {
    const order: string[] = []
    prime('g1')
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] }
    mockData.bookmarkMap['bm-x'] = { id: 'bm-x' }
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    inlineMock.mockImplementationOnce(() => { order.push('html'); return '<x/>' })
    mockData.updateGroup.mockImplementationOnce(() => { order.push('updateGroup') })
    saveGroupBodyMock.mockImplementationOnce(() => { order.push('saveGroupBody') })
    const { selectBookmark } = useMention()
    selectBookmark('bm-x')
    expect(order).toEqual(['html', 'updateGroup', 'saveGroupBody'])
  })
})

describe('useMention.selectGroupRef 编排护栏', () => {
  let mentionStore: ReturnType<typeof useMentionStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    resetMocks()
    mentionStore = useMentionStore()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('!gid 早退：gid=null → hide()+return（不插 HTML 不 save 不 toast）', () => {
    // mentionStore.gid 默认 null
    const { selectGroupRef } = useMention()
    selectGroupRef('g-other')
    expect(inlineMock).not.toHaveBeenCalled()
    expect(saveGroupBodyMock).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(mentionStore.active).toBe(false)
  })

  it('自引用守卫：refGid===gid → hide()+return（组引用自己形成环指向被防，不插 HTML 不 save 不 toast）', () => {
    mentionStore.open('g1') // gid = g1
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    const { selectGroupRef } = useMention()
    selectGroupRef('g1') // refGid === gid
    expect(inlineMock).not.toHaveBeenCalled()
    expect(saveGroupBodyMock).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(mentionStore.active).toBe(false)
  })

  it('引用组不存在（groupMap[refGid] 缺）→ hide()+return（不插 HTML 不 save 不 toast）', () => {
    mentionStore.open('g1')
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] } // 当前编辑组存在（_insertHTML 不依赖它）
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    const { selectGroupRef } = useMention()
    selectGroupRef('g-missing')
    expect(inlineMock).not.toHaveBeenCalled()
    expect(saveGroupBodyMock).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(mentionStore.active).toBe(false)
  })

  it('正常路径：refGid 有效且 ≠ gid → 插 groupRefCardHTML(src) + save + hide + toast(已添加组引用)', () => {
    mentionStore.open('g1')
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] }
    const src = { id: 'g-other', name: '另一个组', bookmarkIds: ['bm-y'] }
    mockData.groupMap['g-other'] = src
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    const { selectGroupRef } = useMention()
    selectGroupRef('g-other')
    // groupRefCardHTML 被调且参为被引用组对象（非当前编辑组）
    expect(refMock).toHaveBeenCalledTimes(1)
    expect((refMock.mock.calls[0] as any[])[0]).toBe(src)
    // groupRefCardHTML 被调（组引用卡片 HTML 生成），反证走 selectGroupRef 分支不串染 selectBookmark
    // inlineCardHTML 不被调（组引用分支不取书签卡片，反证不串染）
    expect(inlineMock).not.toHaveBeenCalled()
    // save 落盘到当前编辑组 g1（不是被引用组 g-other）
    expect(saveGroupBodyMock).toHaveBeenCalledWith('g1')
    expect(saveAppDataMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith('已添加组引用')
    expect(mentionStore.active).toBe(false)
  })

  it('saveGroupBody 落盘到当前编辑组 gid 而非被引用 refGid（落盘方向契约）', () => {
    mentionStore.open('editor-g')
    mockData.groupMap['editor-g'] = { id: 'editor-g', bookmarkIds: [] }
    mockData.groupMap['ref-g'] = { id: 'ref-g', bookmarkIds: [] }
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    const { selectGroupRef } = useMention()
    selectGroupRef('ref-g')
    expect(saveGroupBodyMock).toHaveBeenLastCalledWith('editor-g')
    expect(saveGroupBodyMock).not.toHaveBeenCalledWith('ref-g')
  })
})

describe('selectBookmark 与 selectGroupRef 编排隔离（不串染）', () => {
  let mentionStore: ReturnType<typeof useMentionStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    resetMocks()
    mentionStore = useMentionStore()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('selectBookmark 走 inlineCardHTML 分支不调 groupRefCardHTML；selectGroupRef 反之', () => {
    mentionStore.open('g1')
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] }
    mockData.bookmarkMap['bm-a'] = { id: 'bm-a' }
    mockData.groupMap['g-other'] = { id: 'g-other', bookmarkIds: [] }
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    const { selectBookmark, selectGroupRef } = useMention()
    selectBookmark('bm-a')
    expect(inlineMock).toHaveBeenCalledTimes(1)
    expect(refMock).not.toHaveBeenCalled()
    // 重置 mock 计数（用于 selectGroupRef 阶段）+ 重新 prime（selectBookmark 末调 hide 清了 gid，需复位）
    inlineMock.mockClear()
    refMock.mockClear()
    mentionStore.open('g1')
    selectGroupRef('g-other')
    expect(refMock).toHaveBeenCalledTimes(1)
    expect(inlineMock).not.toHaveBeenCalled()
  })

  it('selectGroupRef 不触发 data.updateGroup（组引用不改 bookmarkIds，与 selectBookmark 追加 bookmarkIds 分流）', () => {
    mentionStore.open('g1')
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] }
    mockData.groupMap['g-other'] = { id: 'g-other', bookmarkIds: [] }
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    const { selectGroupRef } = useMention()
    selectGroupRef('g-other')
    expect(mockData.updateGroup).not.toHaveBeenCalled()
  })
})
