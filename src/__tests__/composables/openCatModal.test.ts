/**
 * openCatModal 护栏（D1-86）
 *
 * 来源 useUI.ts:60-63：
 *   export function openCatModal() {
 *     // A2-011：打开前 push 导航栈，浏览器后退可关
 *     const ui = useUIStore()
 *     if (!ui.modals.category) pushNavState()    // 仅「当前关 → opening」push，防重复打开重复入栈
 *     ui.modals.category = true
 *   }
 *
 * 生产消费方：
 *   - ContextMenu.vue:150 `if (action === ACTIONS.EDIT) openCatModal()`（右键分类「编辑」开 modal）
 *   - ContextMenu.vue:195 `if (action === ACTIONS.ADD_CAT) { openCatModal(); setTimeout(()=>focus newCatName) }`（右键分类「新增分类」开 modal）
 *   - AppNav.vue:111 `function openCatModalNav() { openCatModal() }`（导航栏「管理分类」按钮 onclick）
 *
 * 护栏锁定三类高回归隐特性：
 *  1. A2-011 pushNavState 顺序敏感守卫——仅「当前关、即将打开」push（让浏览器后退可关 modal）；
 *     「当前已开（重复点击打开）」时不 push 防重复入栈污染导航历史。若未来误删 `!ui.modals.category` 守卫
 *     会恒 push 致用户在 modal 已开时再触发「编辑/新增分类」多次重复入栈，浏览器后退需多退几帧才能离开。
 *  2. 打开幂等——无论起始 modals.category 是 true 还是 false，调用后恒为 true。
 *  3. pushNavState 入参为空（无参调用）——pushNavState() 不传导航 state，与 toggleDetailPanel/openAttrModal 同款 A2-011 语义。
 *
 * 与 d1-84 toggleDetailPanel 同源 pushNavState mock 范本：useUI.ts 在 composables/ui/ 故 import
 * `'../interaction/useKeyboardOps.js'` 归一到 `src/composables/interaction/useKeyboardOps.js`，
 * 测试文件在 `src/__tests__/composables/` 故 vi.mock 路径按测试文件目录解析为
 * `'../../composables/interaction/useKeyboardOps.js'`（同 d1-84 教训）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'

// pushNavState 来自 useKeyboardOps.js，护栏里桩成 vi.fn 计调用次数即可（不依赖真实 history.pushState）
// vi.mock 第一个参数按测试文件当前目录解析相对路径——useUI.ts 内 `import '../interaction/useKeyboardOps.js'`
// 归一到 `src/composables/interaction/useKeyboardOps.js`，故这里用相对测试文件目录的同款绝对化路径（同 d1-84 教训）
const pushNavStateMock = vi.fn()
vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: (...args: unknown[]) => pushNavStateMock(...args),
}))

// useUI.ts 顶层 import 还未触发（vi.mock 提升），故 import 放 mock 之后
import { openCatModal } from '../../composables/ui/useUI.js'

beforeEach(() => {
  setActivePinia(createPinia())
  pushNavStateMock.mockReset()
})

describe('openCatModal — 分类 modal 打开 + A2-011 导航栈 push 顺序敏感守卫护栏（D1-86）', () => {
  it('A：当前关 → pushNavState 调一次（A2-011 opening push）+ modals.category 置 true', () => {
    const ui = useUIStore()
    ui.modals.category = false
    expect(pushNavStateMock).not.toHaveBeenCalled()

    openCatModal()

    // A2-011：当前关、即将打开 → push 一次（让浏览器后退可关 modal）
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(pushNavStateMock).toHaveBeenCalledWith()
    expect(ui.modals.category).toBe(true)
  })

  it('B：当前已开（重复触发打开）→ pushNavState 不调（!modals.category 守卫短路）+ modals.category 仍 true', () => {
    const ui = useUIStore()
    ui.modals.category = true
    expect(pushNavStateMock).not.toHaveBeenCalled()

    openCatModal()

    // A2-011 顺序敏感核心：当前已开 → 守卫短路不再 push，防重复入栈污染导航历史
    expect(pushNavStateMock).not.toHaveBeenCalled()
    // 打开幂等：仍是 true
    expect(ui.modals.category).toBe(true)
  })

  it('C：连续两次 openCatModal（关→开→重复开）→ pushNavState 仅调一次（第一次 opening push、第二次守卫短路）', () => {
    const ui = useUIStore()
    ui.modals.category = false

    openCatModal() // 关→开：push 一次 + category=true
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(ui.modals.category).toBe(true)

    openCatModal() // 已开→「重复打开」：守卫 → 短路，不 push
    expect(pushNavStateMock).toHaveBeenCalledTimes(1) // 计数仍为 1，未增
    expect(ui.modals.category).toBe(true)
  })

  it('D：关后关→开→关 pathname → 三次调用对照：仅第一次 push，二三次守卫短路零增', () => {
    const ui = useUIStore()
    ui.modals.category = false

    openCatModal()
    openCatModal()
    openCatModal()

    // 第一次关→开 push 一次；第二第三次「已开重复打开」守卫 → 短路不再 push
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(ui.modals.category).toBe(true)
  })

  it('E：先 openCatModal 再手动 close 后再 openCatModal（关→开→手动关→再开）→ pushNavState 调两次（每次「关→开」opening 各 push 一次）', () => {
    const ui = useUIStore()
    ui.modals.category = false

    openCatModal() // 关→开：push #1
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)

    // 模拟外部 closeCatModal() 关闭（直接置 false 同 closeCatModal 一行实现语义）
    ui.modals.category = false

    openCatModal() // 再次关→开：push #2（守卫看到当前关 → opening push）
    expect(pushNavStateMock).toHaveBeenCalledTimes(2)
    expect(ui.modals.category).toBe(true)
  })

  it('F：openCatModal 不波及其他 modal/open 开关（仅改 modals.category，其余 modals 字段维持原 false）', () => {
    const ui = useUIStore()
    // 起始：所有 modals 关（默认 pinia 初始态）
    expect(ui.modals.category).toBe(false)

    openCatModal()

    // 仅 category true，不波及兄弟 modal 字段（防误改为遍历开全部 modal）
    expect(ui.modals.category).toBe(true)
    // 不波及 panel 开关
    expect(ui.panels.detail).toBe(false)
    expect(ui.panels.rail ?? false).toBe(false)
    // 不波及 batchMode/batchSelected 等顶层 UI 状态
    expect(ui.batchMode).toBe(false)
    expect(ui.batchSelected).toHaveLength(0)
  })

  it('G：openCatModal 不调 saveAppData / showConfirm / toast 等持久化与确认副作用（纯 UI modal 开关编排）', async () => {
    const ui = useUIStore()
    ui.modals.category = false

    openCatModal()

    // 仅触发 pushNavState（A2-011 导航栈）+ 置 modals.category
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(ui.modals.category).toBe(true)
    // openCatModal 源码全程无 saveAppData/showConfirm/toast 调用——护栏锁「纯 UI modal 开关无持久化副作用」
    // 与 d1-80 toggleBatchMode 同款「纯 UI 状态切换无 saveAppData」契约口径
  })

  it('H：openCatModal 不读改 detailCards（与 toggleDetailPanel 区分——开 modal 不涉及详情面板卡位）', () => {
    const ui = useUIStore()
    ui.modals.category = false
    ui.detailCards.push('b1', 'b2') // 预置详情面板卡位
    expect(ui.detailCards).toHaveLength(2)

    openCatModal()

    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(ui.modals.category).toBe(true)
    // 开分类 modal 不触碰详情面板 detailCards 卡位（与 toggleDetailPanel 关分支 splice(0) 清空截然不同）
    expect(ui.detailCards).toHaveLength(2)
    expect(ui.detailCards[0]).toBe('b1')
    expect(ui.detailCards[1]).toBe('b2')
  })
})
