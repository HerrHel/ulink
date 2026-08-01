/**
 * useUI 顶层关闭薄包装护栏合集（D1-107）
 *
 * 来源 useUI.ts：
 *   line 20: export function closeRail() { useUIStore().panels.rail = false }
 *   line 66: export function closeCatModal() { useUIStore().modals.category = false }
 *   line 80: export function closeAttrModal() { useUIStore().modals.attribute = false }
 *   line 85: export function hideSettingsMenu() { useUIStore().panels.settings = false }
 *   line 86: export function hideAddDropdown() { useUIStore().overlays.addDropdown = false }
 *
 * 认领来源：d1-89 pointer#1 明示下轮候选「useUI.ts 剩余 export 逐函数深度法续挖——
 * closeCatModal/closeAttrModal/hideSettingsMenu/hideAddDropdown 单行薄包装护栏价值偏低
 * 但零护栏可领锁口可少抽 4-6 编排用例」。本轮跨 aggregate grep 确认五者真零本体护栏：
 *   closeCatModal / closeAttrModal 在 openCatModal.test.ts:109 / openAttrModal.test.ts:103
 *     仅作 setup 模拟「手动置回 false 模拟外部关 modal」（直赋值 ui.modals.category=false
 *     而非调用 closeCatModal 本体），非本体护栏断言；useKeyboardOps.test.ts 全五者是
 *     vi.mock 桩（vi.fn 跳过内部逻辑，仅验证 restoreNavState 调用关系）；closeRail 在
 *     realBugFixes.test.ts:61 是 incidental setup 触发（restoreNavState 流程里被调用，非护栏
 *     断言）。hideSettingsMenu / hideAddDropdown 完全零本体真实调用护栏。
 *
 * 生产消费方活跃（虽函数体单行但用户可见行为承载）：
 *   closeRail — ContextMenu/useKeyboardOps 全局快捷键 handler 关闭侧栏
 *   closeCatModal — restoreNavState popstate 关闭分类 modal（浏览器后退关 modal）
 *   closeAttrModal — restoreNavState popstate 关闭属性 modal
 *   hideSettingsMenu — useKeyboardOps 全局快捷键关闭设置菜单 + ContextMenu 右键分流
 *   hideAddDropdown — useKeyboardOps 全局快捷键 handler 关闭 add 下拉 + 全局 click 防误触发
 *
 * 护栏核心价值统一锁定（五函数同型同款纯 UI 字面关闭编排）：
 *  1. 只动自己一个目标 UI 字段且 = false 字面赋值（非 toggle、非条件赋值）——
 *     closeRail 写 panels.rail=false / closeCatModal 写 modals.category=false /
 *     closeAttrModal 写 modals.attribute=false / hideSettingsMenu 写 panels.settings=false /
 *     hideAddDropdown 写 overlays.addDropdown=false。若未来误改成 toggle 语义会让「关闭」反开；
 *     若误改成条件赋值（如 `if (ui.xxx) ui.xxx=false`）会破坏 malignant 「无守卫恒关」幂等契约。
 *  2. 恒关幂等——起始 true（开态）调用后 false、起始 false（已关）仍 false，二次调用仍 false 不抖。
 *  3. 不波及兄弟 UI 状态字段——只动自己一个目标字段，不把兄弟 modal/panel/overlay 字段连同关掉。
 *     这是关键防回归线：若未来误改为「遍历关全部 dashboard modal/panel/overlay 的 resetAll 函数」
 *     会让用户点「关闭设置」连带误关正在开的死链/feedback 弹窗；每函数护栏「兄弟字段维持 true」逐函数直锁。
 *  4. 无副作用——不调 saveAppData（不挑剔化）、不调 pushNavState（不压导航栈）、不调 toast（不弹提示）。
 *     与 deleteCategory(含 showConfirm+saveAppData)/openCatModal(含 A2-011 pushNavState)/openAttrModal
 *     形成核心区分。防未来误加副作用让纯关闭编排变成会话/导航/提示的复合操作。
 *
 * guardian 用真 setActivePinia + useUIStore 直读（五函数仅写 uiStore 单字段，无跨 store/无 toast/
 * 无 pushNavState 副作用，故不需 mock 任何外部依赖；比 d1-86 openCatModal 减 pushNavState mock 一维，
 * 比 d1-89 deleteCategory 减 saveAppData/showConfirm/toast 副作用桩全维）。每个用例 beforeEach 重置
 * Pinia 后 setUp 把目标字段 + 兄弟字段都置 true 模拟「全开 dashboard」态，调用对应关闭函数后断言：
 * 目标字段 → false（恒关幂等）+ 兄弟字段 → 维持 true（不波及）+ 无副作用。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { saveAppData } from '../../stores/app.js'
import {
  closeRail,
  closeCatModal,
  closeAttrModal,
  hideSettingsMenu,
  hideAddDropdown,
} from '../../composables/ui/useUI.js'

// saveAppData 副作用桩：护栏要断言五函数「不调 saveAppData」预定义 mock 在模块加载期就位
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn() }))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

/**
 * setupAllOpen 模拟「全开 dashboard」态：把所有 modal/panel/overlay 关键字置 true，
 * 调用关闭函数后断言兄弟字段维持真证「不波及兄弟」。
 */
function setupAllOpen() {
  const ui = useUIStore()
  ui.panels.rail = true
  ui.panels.settings = true
  ui.panels.detail = true
  ui.modals.category = true
  ui.modals.attribute = true
  ui.overlays.addDropdown = true
  ui.overlays.addPopover = true
  ui.overlays.deadLinks = true
  ui.overlays.feedback = true
  return ui
}

describe('closeRail — panels.rail 字面关闭 + 不波及兄弟 + 无副作用护栏（D1-107）', () => {
  it('A：起始 rail=true → 调用后 panels.rail=false', () => {
    const ui = setupAllOpen()
    closeRail()
    expect(ui.panels.rail).toBe(false)
  })
  it('B：恒关幂等——起始 rail=false 调用仍 false（无 toggle 反开）', () => {
    const ui = setupAllOpen()
    ui.panels.rail = false
    closeRail()
    expect(ui.panels.rail).toBe(false)
  })
  it('C：连续两次仍 false 不抖（恒关幂等无副作用累积）', () => {
    const ui = setupAllOpen()
    closeRail()
    closeRail()
    expect(ui.panels.rail).toBe(false)
  })
  it('D：不波及兄弟——只动 panels.rail，兄弟 panels.settings/modals.category/overlays.x 维持 true', () => {
    const ui = setupAllOpen()
    closeRail()
    expect(ui.panels.settings).toBe(true)
    expect(ui.modals.category).toBe(true)
    expect(ui.modals.attribute).toBe(true)
    expect(ui.overlays.addDropdown).toBe(true)
  })
  it('E：无副作用——不调 saveAppData（纯 UI 字段关闭不挑剔化）', () => {
    setupAllOpen()
    closeRail()
    expect(saveAppData).not.toHaveBeenCalled()
  })
})

describe('closeCatModal — modals.category 字面关闭 + 不波及兄弟 + 无副作用护栏（D1-107）', () => {
  it('A：起始 category=true → 调用后 modals.category=false', () => {
    const ui = setupAllOpen()
    closeCatModal()
    expect(ui.modals.category).toBe(false)
  })
  it('B：恒关幂等——起始 category=false 调用仍 false（无 toggle 反开，与 openCatModal 恒开互补）', () => {
    const ui = setupAllOpen()
    ui.modals.category = false
    closeCatModal()
    expect(ui.modals.category).toBe(false)
  })
  it('C：不波及兄弟——只动 modals.category，兄弟 modals.attribute/panels.settings/rail/overlays.x 维持 true', () => {
    const ui = setupAllOpen()
    closeCatModal()
    expect(ui.modals.attribute).toBe(true)
    expect(ui.panels.settings).toBe(true)
    expect(ui.panels.rail).toBe(true)
    expect(ui.overlays.addDropdown).toBe(true)
  })
  it('D：无副作用——不调 saveAppData（与 deleteCategory 编排含 saveAppData 形成核心区分）', () => {
    setupAllOpen()
    closeCatModal()
    expect(saveAppData).not.toHaveBeenCalled()
  })
})

describe('closeAttrModal — modals.attribute 字面关闭 + 不波及兄弟 + 无副作用护栏（D1-107）', () => {
  it('A：起始 attribute=true → 调用后 modals.attribute=false', () => {
    const ui = setupAllOpen()
    closeAttrModal()
    expect(ui.modals.attribute).toBe(false)
  })
  it('B：恒关幂等——起始 attribute=false 调用仍 false（无 toggle 反开，与 openAttrModal 恒开互补）', () => {
    const ui = setupAllOpen()
    ui.modals.attribute = false
    closeAttrModal()
    expect(ui.modals.attribute).toBe(false)
  })
  it('C：不波及兄弟——只动 modals.attribute，兄弟 modals.category/panels.x/rail/overlays.x 维持 true', () => {
    const ui = setupAllOpen()
    closeAttrModal()
    expect(ui.modals.category).toBe(true)
    expect(ui.panels.settings).toBe(true)
    expect(ui.panels.rail).toBe(true)
    expect(ui.overlays.addDropdown).toBe(true)
  })
  it('D：无副作用——不调 saveAppData（与 deleteAttribute 编排含 saveAppData 形成核心区分）', () => {
    setupAllOpen()
    closeAttrModal()
    expect(saveAppData).not.toHaveBeenCalled()
  })
})

describe('hideSettingsMenu — panels.settings 字面关闭 + 不波及兄弟 + 无副作用护栏（D1-107）', () => {
  it('A：起始 settings=true → 调用后 panels.settings=false', () => {
    const ui = setupAllOpen()
    hideSettingsMenu()
    expect(ui.panels.settings).toBe(false)
  })
  it('B：恒关幂等——起始 settings=false 调用仍 false（无 toggle 反开）', () => {
    const ui = setupAllOpen()
    ui.panels.settings = false
    hideSettingsMenu()
    expect(ui.panels.settings).toBe(false)
  })
  it('C：不波及兄弟——只动 panels.settings，兄弟 panels.rail/modals.x/overlays.x 维持 true', () => {
    const ui = setupAllOpen()
    hideSettingsMenu()
    expect(ui.panels.rail).toBe(true)
    expect(ui.modals.category).toBe(true)
    expect(ui.modals.attribute).toBe(true)
    expect(ui.overlays.addDropdown).toBe(true)
  })
  it('D：无副作用——不调 saveAppData', () => {
    setupAllOpen()
    hideSettingsMenu()
    expect(saveAppData).not.toHaveBeenCalled()
  })
})

describe('hideAddDropdown — overlays.addDropdown 字面关闭 + 不波及兄弟 + 无副作用护栏（D1-107）', () => {
  it('A：起始 addDropdown=true → 调用后 overlays.addDropdown=false', () => {
    const ui = setupAllOpen()
    hideAddDropdown()
    expect(ui.overlays.addDropdown).toBe(false)
  })
  it('B：恒关幂等——起始 addDropdown=false 调用仍 false（无 toggle 反开）', () => {
    const ui = setupAllOpen()
    ui.overlays.addDropdown = false
    hideAddDropdown()
    expect(ui.overlays.addDropdown).toBe(false)
  })
  it('C：不波及兄弟——只动 overlays.addDropdown，兄弟 overlays.addPopover/deadLinks/feedback 维持 true', () => {
    const ui = setupAllOpen()
    hideAddDropdown()
    expect(ui.overlays.addPopover).toBe(true)
    expect(ui.overlays.deadLinks).toBe(true)
    expect(ui.overlays.feedback).toBe(true)
    expect(ui.panels.settings).toBe(true)
  })
  it('D：无副作用——不调 saveAppData', () => {
    setupAllOpen()
    hideAddDropdown()
    expect(saveAppData).not.toHaveBeenCalled()
  })
})
