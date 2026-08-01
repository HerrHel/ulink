/**
 * toggleDetailPanel 护栏（D1-84）
 *
 * 来源 useUI.ts:23-32：
 *   export function toggleDetailPanel() {
 *     const ui = useUIStore()
 *     if (!ui.panels.detail) pushNavState()        // A2-011：仅当前关 → opening 才 push 导航栈，浏览器后退可关面板
 *     if (ui.panels.detail || ui.detailCards.length > 0) {  // 当前开 OR detailCards 非空 → 关闭分支
 *       ui.panels.detail = false
 *       ui.detailCards.splice(0)
 *     } else {
 *       ui.panels.detail = true                     // 全空 → 打开
 *     }
 *   }
 *
 * 生产消费方：App.vue:12 `@toggle-detail="toggleDetailPanel"`（头部详情面板开关按钮事件唯一承载）。
 *
 * 护栏锁定三类高回归隐特性：
 *  1. A2-011 pushNavState 顺序敏感——仅「当前关、即将打开」时 push（让浏览器后退关闭面板）；
 *     「当前开、即将关闭」时不 push。若未来误删 `!ui.panels.detail` 守卫，会双向 push 导致后退多退一帧。
 *  2. 关闭/打开双分支判定 `detail || detailCards.length > 0`——即便 panels.detail 已 false 但 detailCards
 *     仍残留项时也走关闭分支清空，防 detailCards 悬空卡位。若误改成单 `detail` 会让残留 detailCards 不被清。
 *  3. close 分支 splice(0) 真清空 detailCards——防漏 splice 致面板隐藏后内部仍持旧卡位。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'

// pushNavState 来自 useKeyboardOps.js，护栏里桩成 vi.fn 计调用次数即可（不依赖真实 history.pushState）
// 注意：vi.mock 第一个参数按测试文件当前目录解析相对路径——useUI.ts 内 `import '...interaction/useKeyboardOps.js'`
// 归一到 `src/composables/interaction/useKeyboardOps.js`，故这里用相对测试文件目录的同款绝对化路径
const pushNavStateMock = vi.fn()
vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: (...args: unknown[]) => pushNavStateMock(...args),
}))

// useUI.ts 顶层 import 还未触发（vi.mock 提升），故 import 放 mock 之后
import { toggleDetailPanel } from '../../composables/ui/useUI.js'

beforeEach(() => {
  setActivePinia(createPinia())
  pushNavStateMock.mockReset()
})

describe('toggleDetailPanel — 详情面板开/关 + A2-011 导航栈 push 顺序敏感护栏（D1-84）', () => {
  it('A：当前关 + detailCards 空 → pushNavState 调一次 + else 分支 panels.detail=true、splice 不untouched', () => {
    const ui = useUIStore()
    // arrange：起始关闭态 + 空 detailCards
    ui.panels.detail = false
    ui.detailCards.splice(0)
    expect(ui.detailCards).toHaveLength(0)

    toggleDetailPanel()

    // A2-011：当前关即将打开 → push 一次
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(pushNavStateMock).toHaveBeenCalledWith()
    // else 分支：打开
    expect(ui.panels.detail).toBe(true)
    // 关闭分支未走，detailCards 仍空
    expect(ui.detailCards).toHaveLength(0)
  })

  it('B：当前关 + detailCards 非空 → pushNavState 调一次（!detail 守卫命中）+ 关闭分支（detail=false + splice 清空）', () => {
    const ui = useUIStore()
    ui.panels.detail = false
    ui.detailCards.push('b1', 'b2')
    expect(ui.detailCards).toHaveLength(2)

    toggleDetailPanel()

    // A2-011：当前关 → push 一次（即便是详情面板带残留卡位的「关闭」语义也 push，因守卫只看 panels.detail）
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    // detail || length>0 真命中（右操作数 length>0）→ 关闭分支
    expect(ui.panels.detail).toBe(false)
    // splice(0) 清空
    expect(ui.detailCards).toHaveLength(0)
  })

  it('C：当前开 → pushNavState 不调（!detail 守卫短路）+ 关闭分支（detail=false + splice 清空）', () => {
    const ui = useUIStore()
    ui.panels.detail = true
    ui.detailCards.push('b1', 'b2', 'b3')
    expect(ui.detailCards).toHaveLength(3)

    toggleDetailPanel()

    // A2-011 核心：当前开 → 不 push（关闭不应入导航栈）
    expect(pushNavStateMock).not.toHaveBeenCalled()
    // 关闭分支
    expect(ui.panels.detail).toBe(false)
    expect(ui.detailCards).toHaveLength(0)
  })

  it('D：A2-011 push 顺序敏感对照——closure: 关时 push / 开时不 push（B vs C 行为差异直锁）', () => {
    const ui = useUIStore()
    // 关 → 打开（push 1 次）
    ui.panels.detail = false
    ui.detailCards.splice(0)
    toggleDetailPanel()
    const pushesAfterOpen = pushNavStateMock.mock.calls.length
    expect(pushesAfterOpen).toBe(1)

    // 开 → 关闭（不再 push）
    toggleDetailPanel()
    expect(pushNavStateMock.mock.calls.length).toBe(pushesAfterOpen) // 仍 1，关闭不 push
    expect(ui.panels.detail).toBe(false)
    expect(ui.detailCards).toHaveLength(0)
  })

  it('E：close 分支 splice(0) 真清空 detailCards——多卡位时一次性清零', () => {
    const ui = useUIStore()
    ui.panels.detail = true
    ui.detailCards.push('a', 'b', 'c', 'd', 'e')
    expect(ui.detailCards).toHaveLength(5)

    toggleDetailPanel()

    expect(ui.panels.detail).toBe(false)
    expect(ui.detailCards).toHaveLength(0)
    // 内容真清空不只是缩短 length
    expect(ui.detailCards).toEqual([])
  })

  it('F：关闭分支双条件 or——detail=false 但 detailCards 非空 仍走关闭分支（右操作数 length>0 救场）', () => {
    const ui = useUIStore()
    // 关键边界：panels.detail=false 但 detailCards 有残留（数据自恢复中间态/异常态）
    ui.panels.detail = false
    ui.detailCards.push('residual1', 'residual2')
    expect(ui.detailCards).toHaveLength(2)

    toggleDetailPanel()

    // detail || length>0 —— 左 false 右 true → true 走关闭分支
    expect(ui.panels.detail).toBe(false)
    expect(ui.detailCards).toHaveLength(0) // splice 清掉残留
    // 此场景其实也 push 了（B 已锁），本用例聚焦关闭分支判定不被简化成单 detail
  })

  it('G：连续 toggle 全空往返——关→开→关 push 两次（两 opening 各 push），关闭分支清零贯穿', () => {
    const ui = useUIStore()
    ui.panels.detail = false
    ui.detailCards.splice(0)

    // 第一次：关→开
    toggleDetailPanel()
    expect(ui.panels.detail).toBe(true)
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)

    // 第二次：开→关
    toggleDetailPanel()
    expect(ui.panels.detail).toBe(false)
    expect(ui.detailCards).toHaveLength(0)
    expect(pushNavStateMock).toHaveBeenCalledTimes(1) // 关闭不 push

    // 第三次：关→开（又 push 一次）
    toggleDetailPanel()
    expect(ui.panels.detail).toBe(true)
    expect(pushNavStateMock).toHaveBeenCalledTimes(2)
  })

  it('H：纯打开 else 分支不调 splice——detailCards 保持空（与关闭分支 splice 形成对照）', () => {
    const ui = useUIStore()
    // 唯一走 else 分支的态：detail=false 且 detailCards 空
    ui.panels.detail = false
    ui.detailCards.splice(0)
    const beforeLen = ui.detailCards.length

    toggleDetailPanel()

    expect(ui.panels.detail).toBe(true) // else 打开分支
    // 打开分支不调 splice → 若未来误把 splice 提到外层（不分分支）会让 detailCards 被误清
    expect(ui.detailCards).toHaveLength(beforeLen)
  })

  it('I：纯往返打开→关闭——openDetail 推卡位后 toggle 关闭真清空 detailCards 与 panels.detail', () => {
    const ui = useUIStore()
    ui.panels.detail = false
    ui.detailCards.splice(0)

    // 模拟详情面板已被打开并填了 3 张卡位（openDetail 路径：panels.detail=true + push bmId）
    ui.panels.detail = true
    ui.detailCards.push('bm1', 'bm2', 'bm3')
    pushNavStateMock.mockReset() // 复位以隔离打开阶段的 push 历史，聚焦关闭 toggle

    // 用户点头部 toggle 关闭详情面板
    toggleDetailPanel()

    expect(pushNavStateMock).not.toHaveBeenCalled() // 关闭不 push
    expect(ui.panels.detail).toBe(false)
    expect(ui.detailCards).toHaveLength(0)
  })
})
