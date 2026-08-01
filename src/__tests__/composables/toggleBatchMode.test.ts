/**
 * toggleBatchMode 进入/退出批量模式编排护栏（D1-80）
 *
 * test(d1-80): toggleBatchMode 是「进入/退出批量模式」用户可见行为唯一承载——
 * 右键菜单「多选」(ContextMenu.vue:142/193)、工具栏批量按钮 (FilterBar.vue:58)、
 * Esc 键盘快捷键退出批量 (useKeyboardOps.ts:180) 三处生产消费方。
 *
 * 编排契约（从 useBatch.ts:14-29 静态读源锁真实行为）：
 *  1. toggle 切换 ui.batchMode（!ui.batchMode）
 *  2. batchSelected.splice(0) —— 进入和退出都清空选中（关键隐特性）
 *  3. A4-003：只在退出批量（!ui.batchMode 为 true）时调 useBatchMoveStore().hide()
 *     关 batchMove 浮层，进入时不调（顺序敏感防取消/Esc 后残留浮层）
 *  4. 不持久化 isExpanded=false（设计契约——注释详述退出后 isExpanded 自然恢复，
 *     批量模式期间「视觉不展开」由渲染层 computed 压制；护栏锁无 updateBookmark/
 *     updateGroup 副作用外溢，证不抹除用户展开态）
 *  5. if (ui.focusedGroupId) nextTick(() => { ui.focusedGroupId = null }) ——
 *     进入批量时若正聚焦某组，异步清焦点 null（nextTick 异步分支）
 *
 * 纯加测试零源文件改动：toggleBatchMode 已 export useBatch.ts:14 无需改源。
 * 延续 d1-69 toggleGroupFocus 已验证的 vi.mock 闭包范本（mockUI 稳定引用对象 +
 * useBatchMoveStore mock spy + setActivePinia 复位 + nextTick await）。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

// ---- 模块级可改 mock store（延续 d1-69 vi.mock 闭包范本）----
// toggleBatchMode 直接读写 uiStore.batchMode/batchSelected/focusedGroupId 三字段，
// 故 uiStore 必须返回稳定引用对象（同 d1-69 mockUI 口径），状态在调用间可见、可断言。
// toggleBatchMode 调 useBatchMoveStore().hide()，mock 成可断言 spy 对象。

// 稳定 mockUI 承载 toggleBatchMode 直接读写的 3 个 ui 状态字段
// batchSelected 必须是真数组（可 splice(0) 清空）
const mockUI = {
  batchMode: false as boolean,
  batchSelected: [] as string[],
  focusedGroupId: null as string | null,
}

// useBatchMoveStore mock spy：show/hide 可断言调用次数（A4-003 退出 vs 进入对照核心）
const mockBatchMoveShow = vi.fn()
const mockBatchMoveHide = vi.fn()

vi.mock('../../stores/data.js', () => ({
  // useBatch.ts 顶部 import useDataStore（collectSubIds 用），toggleBatchMode 不调
  // 但 import 期需有桩；mockData 含 updateBookmark/updateGroup 用于「不持久化」断言
  useDataStore: vi.fn(() => mockData),
}))

const mockData = {
  updateBookmark: vi.fn(),
  updateGroup: vi.fn(),
}

vi.mock('../../stores/ui.js', () => ({
  useUIStore: vi.fn(() => mockUI),
}))

vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))

vi.mock('../../stores/overlay.js', () => ({
  useBatchMoveStore: vi.fn(() => ({ show: mockBatchMoveShow, hide: mockBatchMoveHide })),
}))

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../lib/collectSubIds.js', () => ({
  collectDescendantIds: vi.fn(() => []),
}))

import { toggleBatchMode } from '../../composables/domain/useBatch.js'
import { saveAppData } from '../../stores/app.js'
import { useBatchMoveStore } from '../../stores/overlay.js'

describe('toggleBatchMode 进入/退出批量模式编排', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // 复位 mockUI 三字段到进入态前的干净基线
    mockUI.batchMode = false
    mockUI.batchSelected = []
    mockUI.focusedGroupId = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('A 进入正路径：batchMode 取反为 true，选中清空，不关浮层，聚焦异步清 null', async () => {
    mockUI.batchMode = false
    mockUI.batchSelected = ['b1', 'group:g1']
    mockUI.focusedGroupId = 'g2'

    toggleBatchMode()

    expect(mockUI.batchMode).toBe(true)
    // 进入也清空选中（splice(0) 两向都清，关键隐特性）
    expect(mockUI.batchSelected).toEqual([])
    expect(mockUI.batchSelected.length).toBe(0)
    // 进入不关浮层（A4-003：只有退出时 !ui.batchMode 才 hide）
    expect(mockBatchMoveHide).not.toHaveBeenCalled()
    // 聚焦异步清（await nextTick 后才生效）
    expect(mockUI.focusedGroupId).toBe('g2')
    await nextTick()
    expect(mockUI.focusedGroupId).toBe(null)
  })

  it('B 退出正路径：batchMode 取反为 false，选中清空，关浮层，聚焦异步清 null', async () => {
    mockUI.batchMode = true
    mockUI.batchSelected = ['b9', 'group:g7']
    mockUI.focusedGroupId = 'g5'

    toggleBatchMode()

    expect(mockUI.batchMode).toBe(false)
    expect(mockUI.batchSelected).toEqual([])
    // 退出关浮层（A4-003 核心契约：取消/Esc 后不残留 batchMove 浮层）
    expect(mockBatchMoveHide).toHaveBeenCalledTimes(1)
    expect(mockUI.focusedGroupId).toBe('g5')
    await nextTick()
    expect(mockUI.focusedGroupId).toBe(null)
  })

  it('C A4-003 退出关浮层 / 进入不关：对照顺序敏感锁定', async () => {
    // 先进入：false -> true，不关浮层
    mockUI.batchMode = false
    toggleBatchMode()
    expect(mockUI.batchMode).toBe(true)
    expect(mockBatchMoveHide).not.toHaveBeenCalled()

    // 再退出：true -> false，关浮层一次
    toggleBatchMode()
    expect(mockUI.batchMode).toBe(false)
    expect(mockBatchMoveHide).toHaveBeenCalledTimes(1)
  })

  it('D 进入/退出都清空选中：splice(0) 双向清空的隐特性直锁', () => {
    // 进入清空
    mockUI.batchMode = false
    mockUI.batchSelected = ['b1', 'b2', 'group:g1', 'group:g2']
    toggleBatchMode()
    expect(mockUI.batchSelected).toEqual([])
    expect(mockUI.batchMode).toBe(true)

    // 退出也清空（重建选中再退出）
    mockUI.batchSelected = ['b3', 'b4']
    toggleBatchMode()
    expect(mockUI.batchSelected).toEqual([])
    expect(mockUI.batchMode).toBe(false)
  })

  it('E focusedGroupId 守卫：无聚焦时不进 nextTick 分支，不改值不抛', async () => {
    mockUI.batchMode = false
    mockUI.focusedGroupId = null

    expect(() => toggleBatchMode()).not.toThrow()

    expect(mockUI.batchMode).toBe(true)
    // 守卫 if(ui.focusedGroupId) 不进，nextTick 内不执行
    await nextTick()
    expect(mockUI.focusedGroupId).toBe(null)
  })

  it('F focusedGroupId 异步清 null via nextTick：进入时聚焦真存在才异步清', async () => {
    mockUI.batchMode = false
    mockUI.focusedGroupId = 'focused-group-1'

    toggleBatchMode()
    // 同步阶段 focusedGroupId 仍为原值
    expect(mockUI.focusedGroupId).toBe('focused-group-1')
    // 异步 nextTick 后清 null
    await nextTick()
    expect(mockUI.focusedGroupId).toBe(null)
  })

  it('G 不持久化 isExpanded：toggleBatchMode 全程不调 updateBookmark/updateGroup（设计契约）', async () => {
    mockUI.batchMode = false
    mockUI.batchSelected = ['b1']
    mockUI.focusedGroupId = 'g1'

    toggleBatchMode()
    await nextTick()

    // 批量模式进入/退出皆不抹除展开态——视觉不展开由渲染层 computed 压制，
    // 若误改为 updateBookmark/updateGroup({isExpanded:false}) 会持久化抹除用户展开态 + 污染同步队列
    expect(mockData.updateBookmark).not.toHaveBeenCalled()
    expect(mockData.updateGroup).not.toHaveBeenCalled()
  })

  it('H 不调 saveAppData：纯 UI 状态切换无持久化副作用（与 batchDelete/batchMoveToCat 对照）', async () => {
    mockUI.batchMode = false
    mockUI.batchSelected = ['b1']
    mockUI.focusedGroupId = 'g1'

    toggleBatchMode()
    await nextTick()

    // 批量模式切换无 saveAppData（batchDelete/batchMoveToCat 才调 saveAppData）
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('I 连续 toggle 幂等往返：false->true->false 一轮往返，结束 batchMode=false + hide 调一次 + 聚焦清 null', async () => {
    mockUI.batchMode = false
    mockUI.batchSelected = []
    mockUI.focusedGroupId = 'gf'

    // 第一次：进入
    toggleBatchMode()
    expect(mockUI.batchMode).toBe(true)
    expect(mockBatchMoveHide).not.toHaveBeenCalled()
    await nextTick()
    expect(mockUI.focusedGroupId).toBe(null)

    // 重建焦点 + 选中后第二次：退出
    mockUI.focusedGroupId = 'gf2'
    mockUI.batchSelected = ['bx']
    toggleBatchMode()
    expect(mockUI.batchMode).toBe(false)
    expect(mockUI.batchSelected).toEqual([])
    expect(mockBatchMoveHide).toHaveBeenCalledTimes(1)
    await nextTick()
    expect(mockUI.focusedGroupId).toBe(null)

    // useBatchMoveStore 仅在退出那次被 hide 一次，进入那次未 hide
    expect(useBatchMoveStore).toHaveBeenCalled()
  })
})
