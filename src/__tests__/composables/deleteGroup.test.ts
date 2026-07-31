import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store / 桩（沿用 d1-72 closeGroupEdit 已验证的 vi.mock 闭包 mock 范本）----
// useGroup composable 的 deleteGroup(dGid, skipConfirm?) async 编排直接读写：
//   dataStore.groupMap / dataStore.deleteGroup（软删）/ dataStore.restoreGroup（undo 回滚）
//   uiStore.focusedGroupId
//   saveAppData / debouncedSaveAppData
//   toast / toastWithUndo（undo 回调捕获）/ showConfirm（可改 sequence 返 true/false）
// 故 mockData 必须返稳定引用对象（同 closeGroupEdit/toggleGroupFocus mockUI/mockData 口径），状态在调用间可见可断言。

const mockData = {
  groupMap: {} as Record<string, any>,
  deleteGroup: vi.fn(),
  restoreGroup: vi.fn(),
}

// 稳定 mockUI 承载 deleteGroup 直接读写的 ui 状态字段
const mockUI = {
  focusedGroupId: null as string | null,
}

// showConfirm 返回值可改 sequence（默认 true）
let showConfirmReturn = true
// toastWithUndo 捕获的 undo 回调，供测试手动触发以验证其编排
let capturedUndo: ((...args: any[]) => void) | null = null

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
  toastWithUndo: vi.fn((msg: string, undo: (...args: any[]) => void) => {
    capturedUndo = undo
  }),
  showConfirm: vi.fn(() => Promise.resolve(showConfirmReturn)),
}))

// useGroup.ts 顶层 import 了 pushNavState / EditorManager / inlineCardHTML 等（同文件其他函数用），
// 本测试虽不直接调它们，但模块图加载需 mock 避免真 TipTap/supabase 副作用（同 closeGroupEdit.test 范本）。
vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: vi.fn(),
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

vi.mock('../../composables/ui/useIconPreview.js', () => ({
  previewIconUrl: vi.fn(),
  clearIcon: vi.fn(),
}))

vi.mock('../../composables/useInlineCard.js', () => ({
  inlineCardHTML: vi.fn(() => '<div class="inline-card"></div>'),
  groupRefCardHTML: vi.fn((sg: any) => `<div class="ref-card" data-ref-gid="${sg?.id ?? ''}"></div>`),
}))

import { deleteGroup } from '../../composables/domain/useGroup.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'

function makeGroup(overrides: Partial<any> = {}) {
  return {
    id: 'g1',
    name: '目标组',
    categoryId: 'cat1',
    bookmarkIds: [] as string[],
    ...overrides,
  }
}

describe('deleteGroup (composable)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockData.groupMap = {}
    mockData.deleteGroup = vi.fn()
    mockData.restoreGroup = vi.fn()
    mockUI.focusedGroupId = null
    showConfirmReturn = true
    capturedUndo = null
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ① !sg 短路 return：groupMap 缺命中全程不调任何 spy（store.deleteGroup/saveAppData/toastWithUndo/showConfirm）
  it('① groupMap 缺 sg 短路 return 不调任何副作用', async () => {
    mockData.groupMap = {} // 无 g1
    await deleteGroup('g1', true)

    expect(mockData.deleteGroup).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
    expect(toastWithUndo).not.toHaveBeenCalled()
    expect(showConfirm).not.toHaveBeenCalled()
    // 返回 undefined（void 短路）
    // 注意：!sg 守卫在 await showConfirm 之前，故即使 skipConfirm=false 也不弹确认
    showConfirmReturn = false
    await deleteGroup('missing', false)
    expect(showConfirm).not.toHaveBeenCalled()
  })

  // ② skipConfirm=true（truthy）直走 doDelete 不弹确认 showConfirm 零调
  it('② skipConfirm=true 直 doDelete 不弹 showConfirm', async () => {
    mockData.groupMap = { g1: makeGroup() }
    mockUI.focusedGroupId = 'gX' // ≠ g1 聚焦态不动证
    await deleteGroup('g1', true)

    expect(showConfirm).not.toHaveBeenCalled()
    expect(mockData.deleteGroup).toHaveBeenCalledTimes(1)
    expect(mockData.deleteGroup).toHaveBeenCalledWith('g1')
    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(toastWithUndo).toHaveBeenCalledTimes(1)
  })

  // ③ skipConfirm=false（falsy）+ showConfirm reject(false) 用户点取消 → 不 doDelete
  it('③ skipConfirm=false + showConfirm false 用户取消不删除', async () => {
    mockData.groupMap = { g1: makeGroup() }
    showConfirmReturn = false
    await deleteGroup('g1', false)

    expect(showConfirm).toHaveBeenCalledTimes(1)
    expect(mockData.deleteGroup).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
    expect(toastWithUndo).not.toHaveBeenCalled()
  })

  // ③b skipConfirm 显式 undefined（缺省）走 showConfirm 分支（同 ③语义，证 skipConfirm 默认 falsy）
  it('③b skipConfirm 省略默认走 showConfirm 分支', async () => {
    mockData.groupMap = { g1: makeGroup({ name: '组A' }) }
    showConfirmReturn = false
    await deleteGroup('g1') // skipConfirm 省略

    expect(showConfirm).toHaveBeenCalledTimes(1)
    // showConfirm 入参含组名
    expect(showConfirm).toHaveBeenCalledWith('确认删除组「组A」？')
    expect(mockData.deleteGroup).not.toHaveBeenCalled()
  })

  // ④ skipConfirm=false + showConfirm confirm(true) → doDelete
  it('④ skipConfirm=false + showConfirm true 用户确认 → doDelete', async () => {
    mockData.groupMap = { g1: makeGroup({ name: '组A' }) }
    showConfirmReturn = true
    await deleteGroup('g1', false)

    expect(showConfirm).toHaveBeenCalledTimes(1)
    expect(showConfirm).toHaveBeenCalledWith('确认删除组「组A」？')
    expect(mockData.deleteGroup).toHaveBeenCalledTimes(1)
    expect(mockData.deleteGroup).toHaveBeenCalledWith('g1')
    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(toastWithUndo).toHaveBeenCalledTimes(1)
  })

  // ⑤ doDelete 顺序契约：ds.deleteGroup 先调，再 saveAppData，再 toastWithUndo
  it('⑤ doDelete 调用顺序 store.deleteGroup → saveAppData → toastWithUndo', async () => {
    mockData.groupMap = { g1: makeGroup() }
    await deleteGroup('g1', true)

    const deleteCall = mockData.deleteGroup.mock.invocationCallOrder[0]
    const saveCall = (saveAppData as any).mock.invocationCallOrder[0]
    const toastCall = (toastWithUndo as any).mock.invocationCallOrder[0]
    expect(deleteCall).toBeLessThan(saveCall)
    expect(saveCall).toBeLessThan(toastCall)
  })

  // ⑥ 聚焦态清理：ui.focusedGroupId===dGid 时置 null；≠dGid 时不动
  it('⑥a focusedGroupId===dGid 时清 null', async () => {
    mockData.groupMap = { g1: makeGroup() }
    mockUI.focusedGroupId = 'g1'
    await deleteGroup('g1', true)
    expect(mockUI.focusedGroupId).toBeNull()
  })

  it('⑥b focusedGroupId≠dGid 时聚焦态不动', async () => {
    mockData.groupMap = { g1: makeGroup() }
    mockUI.focusedGroupId = 'other'
    await deleteGroup('g1', true)
    expect(mockUI.focusedGroupId).toBe('other')
  })

  it('⑥c focusedGroupId 本就 null 时删 g1 不误改其他态（仍 null 非变 undefined）', async () => {
    mockData.groupMap = { g1: makeGroup() }
    mockUI.focusedGroupId = null
    await deleteGroup('g1', true)
    expect(mockUI.focusedGroupId).toBeNull()
  })

  // ⑦ toastWithUndo：第一参 '已删除组' 文案 + 第二参 undo 回调 fn 注册，
  //    手动触发 undo 回调证其编排（ds.restoreGroup + debouncedSaveAppData + toast('组已恢复')）
  it('⑦a toastWithUndo 文案「已删除组」且捕获 undo 回调', async () => {
    mockData.groupMap = { g1: makeGroup() }
    await deleteGroup('g1', true)

    expect(toastWithUndo).toHaveBeenCalledTimes(1)
    expect((toastWithUndo as any).mock.calls[0][0]).toBe('已删除组')
    expect(typeof capturedUndo).toBe('function')
  })

  it('⑦b undo 回调触发：restoreGroup + debouncedSaveAppData + toast「组已恢复」', async () => {
    mockData.groupMap = { g1: makeGroup() }
    await deleteGroup('g1', true)
    expect(capturedUndo).not.toBeNull()
    ;(capturedUndo as any)()

    expect(mockData.restoreGroup).toHaveBeenCalledTimes(1)
    expect(mockData.restoreGroup).toHaveBeenCalledWith('g1')
    expect(debouncedSaveAppData).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('组已恢复')
  })

  it('⑦c undo 回调 restoreGroup 入参恒为 dGid（闭包绑定删除时的 gid 非后续变量）', async () => {
    mockData.groupMap = { g1: makeGroup(), g2: makeGroup({ id: 'g2', name: '组B' }) }
    await deleteGroup('g2', true)
    ;(capturedUndo as any)()
    expect(mockData.restoreGroup).toHaveBeenCalledWith('g2')
  })

  // ⑧ sg.name 空（''/undefined/null）→ 确认弹窗用「未命名」兜底
  it('⑧a sg.name 空串 → 确认弹窗「未命名」兜底', async () => {
    mockData.groupMap = { g1: makeGroup({ name: '' }) }
    showConfirmReturn = true
    await deleteGroup('g1', false)
    expect(showConfirm).toHaveBeenCalledWith('确认删除组「未命名」？')
    // 确认后仍正常删除
    expect(mockData.deleteGroup).toHaveBeenCalledTimes(1)
  })

  it('⑧b sg.name undefined → 确认弹窗「未命名」兜底', async () => {
    mockData.groupMap = { g1: makeGroup({ name: undefined }) }
    showConfirmReturn = true
    await deleteGroup('g1', false)
    expect(showConfirm).toHaveBeenCalledWith('确认删除组「未命名」？')
  })

  it('⑧c sg.name 有值 → 确认弹窗用真实组名非兜底', async () => {
    mockData.groupMap = { g1: makeGroup({ name: '开发工具' }) }
    showConfirmReturn = true
    await deleteGroup('g1', false)
    expect(showConfirm).toHaveBeenCalledWith('确认删除组「开发工具」？')
  })

  // ⑨ doDelete 完整副作用集：skipConfirm=true 路径 doDelete 调用后 (deleteGroup+saveAppData+toastWithUndo+聚焦清理) 全发生一次
  it('⑨ skipConfirm=true 路径 doDelete 副作用集各调恰好一次', async () => {
    mockData.groupMap = { g1: makeGroup() }
    mockUI.focusedGroupId = 'g1'
    await deleteGroup('g1', true)

    expect(mockData.deleteGroup).toHaveBeenCalledTimes(1)
    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(toastWithUndo).toHaveBeenCalledTimes(1)
    expect(mockUI.focusedGroupId).toBeNull()
  })

  // ⑩ 连续两次删除不同组：各副作用独立叠加，undo 回调闭包绑定各自 gid 不串台
  it('⑩ 连续删除两组：副作用各 2 次 + 最后捕获的 undo 回调属 g2', async () => {
    mockData.groupMap = {
      g1: makeGroup({ id: 'g1', name: 'A' }),
      g2: makeGroup({ id: 'g2', name: 'B' }),
    }
    await deleteGroup('g1', true)
    const undo1 = capturedUndo
    await deleteGroup('g2', true)
    const undo2 = capturedUndo

    expect(mockData.deleteGroup).toHaveBeenCalledTimes(2)
    expect(mockData.deleteGroup).toHaveBeenNthCalledWith(1, 'g1')
    expect(mockData.deleteGroup).toHaveBeenNthCalledWith(2, 'g2')
    expect(saveAppData).toHaveBeenCalledTimes(2)
    expect(toastWithUndo).toHaveBeenCalledTimes(2)
    // capturedUndo 在第二次调用后被覆盖为 g2 的回调
    ;(undo1 as any)()
    expect(mockData.restoreGroup).toHaveBeenCalledWith('g1')
    ;(undo2 as any)()
    expect(mockData.restoreGroup).toHaveBeenCalledWith('g2')
    expect(mockData.restoreGroup).toHaveBeenCalledTimes(2)
  })
})
