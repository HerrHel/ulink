/**
 * openAttrModal 护栏（D1-87）
 *
 * 来源 useUI.ts:74-79：
 *   export function openAttrModal() {
 *     // A2-011：打开前 push 导航栈，浏览器后退可关
 *     const ui = useUIStore()
 *     if (!ui.modals.attribute) pushNavState()    // 仅「当前关 → opening」push，防重复打开重复入栈
 *     ui.modals.attribute = true
 *   }
 *
 * 认领来源：d1-86 openCatModal.test.ts:24 头部注释明确点名「与 toggleDetailPanel/openAttrModal 同款
 * A2-011 语义」——上轮把 openAttrModal 同款未测作为 pointer 留给本轮续锁。本轮跨 aggregate grep
 * 确认 openAttrModal 真零护栏（全测试目录命中仅 d1-86 注释提及 + useKeyboardOps.test.ts vi.mock 桩
 * 列出 closeAttrModal 作 restoreNavState 调用对象，但 mock 桩非 openAttrModal 真护栏）。
 *
 * 生产消费方（价值边界诚实记录）：openAttrModal 生产零调用方——grep src/ 仅命中 useUI.ts:74 定义行，
 * 无任何 Vue 组件消费（AttributeModal.vue 经 `store.modals.attribute = true` 直赋值绕过 pushNavState
 * 打开，AppNav/ContextMenu/SettingsPanel 均无 openAttrModal 触发点）。此与 d1-86 openCatModal
 * 不同（openCatModal 有 ContextMenu.vue:150/195 + AppNav.vue:111 三个生产消费方）。同 D1-1
 * autoMigratePassword / D3-1 口径「补护栏锁行为契约备未来接回 + 记待人工裁定」。
 *
 * 护栏锁定三类高回归隐特性（与 d1-84 toggleDetailPanel / d1-86 openCatModal 同源同款）：
 *  1. A2-011 pushNavState 顺序敏感守卫——仅「当前关、即将打开」push（让浏览器后退可关 modal）；
 *     「当前已开（重复触发打开）」时不 push 防重复入栈污染导航历史。若未来误删 `!ui.modals.attribute`
 *     守卫会恒 push 致重复触发「打开属性 modal」多次重复入栈，浏览器后退需多退几帧才能离开。
 *  2. 打开幂等——无论起始 modals.attribute 是 true 还是 false，调用后恒为 true。
 *  3. pushNavState 入参为空（无参调用）——pushNavState() 不传导航 state。
 *
 * 与 d1-86 openCatModal 同源 pushNavState mock 范本：useUI.ts 在 composables/ui/ 故 import
 * `'../interaction/useKeyboardOps.js'` 归一到 `src/composables/interaction/useKeyboardOps.js`，
 * 测试文件在 `src/__tests__/composables/` 故 vi.mock 路径按测试文件目录解析为
 * `'../../composables/interaction/useKeyboardOps.js'`（同 d1-84/d1-86 教训）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'

// pushNavState 来自 useKeyboardOps.js，护栏里桩成 vi.fn 计调用次数即可（不依赖真实 history.pushState）
// vi.mock 第一个参数按测试文件当前目录解析相对路径——useUI.ts 内 `import '../interaction/useKeyboardOps.js'`
// 归一到 `src/composables/interaction/useKeyboardOps.js`，故这里用相对测试文件目录的同款绝对化路径（同 d1-84/d1-86 教训）
const pushNavStateMock = vi.fn()
vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: (...args: unknown[]) => pushNavStateMock(...args),
}))

// useUI.ts 顶层 import 还未触发（vi.mock 提升），故 import 放 mock 之后
import { openAttrModal } from '../../composables/ui/useUI.js'

beforeEach(() => {
  setActivePinia(createPinia())
  pushNavStateMock.mockReset()
})

describe('openAttrModal — 属性 modal 打开 + A2-011 导航栈 push 顺序敏感守卫护栏（D1-87）', () => {
  it('A：当前关 → pushNavState 调一次（A2-011 opening push）+ modals.attribute 置 true', () => {
    const ui = useUIStore()
    ui.modals.attribute = false
    expect(pushNavStateMock).not.toHaveBeenCalled()

    openAttrModal()

    // A2-011：当前关、即将打开 → push 一次（让浏览器后退可关 modal）
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(pushNavStateMock).toHaveBeenCalledWith()
    expect(ui.modals.attribute).toBe(true)
  })

  it('B：当前已开（重复触发打开）→ pushNavState 不调（!modals.attribute 守卫短路）+ modals.attribute 仍 true', () => {
    const ui = useUIStore()
    ui.modals.attribute = true
    expect(pushNavStateMock).not.toHaveBeenCalled()

    openAttrModal()

    // A2-011 顺序敏感核心：当前已开 → 守卫短路不再 push，防重复入栈污染导航历史
    expect(pushNavStateMock).not.toHaveBeenCalled()
    // 打开幂等：仍是 true
    expect(ui.modals.attribute).toBe(true)
  })

  it('C：连续两次 openAttrModal（关→开→重复开）→ pushNavState 仅调一次（第一次 opening push、第二次守卫短路）', () => {
    const ui = useUIStore()
    ui.modals.attribute = false

    openAttrModal() // 关→开：push 一次 + attribute=true
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(ui.modals.attribute).toBe(true)

    openAttrModal() // 已开→「重复打开」：守卫 → 短路，不 push
    expect(pushNavStateMock).toHaveBeenCalledTimes(1) // 计数仍为 1，未增
    expect(ui.modals.attribute).toBe(true)
  })

  it('D：关后关→开→关 → 三次调用对照：仅第一次 push，二三次守卫短路零增 + 中间态 attribute 随调用置 true（不自行关）', () => {
    const ui = useUIStore()
    ui.modals.attribute = false

    openAttrModal() // 关→开：push 一次
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(ui.modals.attribute).toBe(true)

    // 手动置回 false 模拟外部关 modal（openAttrModal 本身只开不关，关经 closeAttrModal/popstate 路径）
    ui.modals.attribute = false
    openAttrModal() // 又关→开：再次 push
    expect(pushNavStateMock).toHaveBeenCalledTimes(2)
    expect(ui.modals.attribute).toBe(true)

    openAttrModal() // 已开→重复开：守卫短路，不 push
    expect(pushNavStateMock).toHaveBeenCalledTimes(2) // 仍为 2，第三次未增
    expect(ui.modals.attribute).toBe(true)
  })

  it('E：openAttrModal 之前预先 pushNavStateMock 被外部调过（模拟别处先开了 navStack）→ 本守卫仍按当前 modals.attribute 判定独立计 push', () => {
    const ui = useUIStore()
    ui.modals.attribute = false
    // 模拟外部已有别的 navStack 活动（如先开了 detail panel push 过一次）
    pushNavStateMock()

    openAttrModal() // attribute 当前关 → opening，本函数 push 一次
    expect(pushNavStateMock).toHaveBeenCalledTimes(2) // 1（外部预调）+ 1（本函数）
    expect(ui.modals.attribute).toBe(true)
  })

  it('F：openAttrModal 只置 modals.attribute，不波及兄弟 modal/panel/顶层 UI 状态', () => {
    const ui = useUIStore()
    ui.modals.category = false
    ui.modals.groupEdit = false
    ui.panels.detail = false
    ui.panels.rail = false

    openAttrModal()

    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    // 仅 attribute true，不波及兄弟 modal 字段（防误改为遍历开全部 modal）
    expect(ui.modals.attribute).toBe(true)
    expect(ui.modals.category).toBe(false)
    expect(ui.modals.groupEdit).toBe(false)
    // 不波及 panel 开关
    expect(ui.panels.detail).toBe(false)
    expect(ui.panels.rail ?? false).toBe(false)
    // 不波及 batchMode/batchSelected 等顶层 UI 状态
    expect(ui.batchMode).toBe(false)
    expect(ui.batchSelected).toHaveLength(0)
  })

  it('G：openAttrModal 不调 saveAppData / showConfirm / toast 等持久化与确认副作用（纯 UI modal 开关编排）', async () => {
    const ui = useUIStore()
    ui.modals.attribute = false

    openAttrModal()

    // 仅触发 pushNavState（A2-011 导航栈）+ 置 modals.attribute
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(ui.modals.attribute).toBe(true)
    // openAttrModal 源码全程无 saveAppData/showConfirm/toast 调用——护栏锁「纯 UI modal 开关无持久化副作用」
    // 与 d1-80 toggleBatchMode / d1-86 openCatModal 同款「纯 UI 状态切换无 saveAppData」契约口径
  })

  it('H：openAttrModal 不读改 detailCards（与 toggleDetailPanel 区分——开 modal 不涉及详情面板卡位）', () => {
    const ui = useUIStore()
    ui.modals.attribute = false
    ui.detailCards.push('b1', 'b2') // 预置详情面板卡位
    expect(ui.detailCards).toHaveLength(2)

    openAttrModal()

    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(ui.modals.attribute).toBe(true)
    // 开属性 modal 不触碰详情面板 detailCards 卡位（与 toggleDetailPanel 关分支 splice(0) 清空截然不同）
    expect(ui.detailCards).toHaveLength(2)
    expect(ui.detailCards[0]).toBe('b1')
    expect(ui.detailCards[1]).toBe('b2')
  })
})
