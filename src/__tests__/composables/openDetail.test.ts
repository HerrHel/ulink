/**
 * openDetail 护栏（D1-88 / Option 2 辅助栏与 AI 侧边栏解耦）
 *
 * 来源 useUI.ts:
 *   export function openDetail(bmId: string) {
 *     if (!bmId) return
 *     const ui = useUIStore()
 *     if (ui.detailCards.indexOf(bmId) === -1) ui.detailCards.push(bmId)
 *   }
 *
 * 护栏锁定核心契约：
 *  1. 空 bmId 早退守卫——空串/null/undefined 入参恒 return 不 push。
 *  2. 缺键才 push 去重幂等——`indexOf(bmId) === -1` 守卫锁「已存在的 bmId 不重复 push」。
 *  3. 不波及 detailCards 顺序——已存在项原位不前移（FIFO 顺序保留）。
 *  4. 纯净解耦：不篡改 panels.detail，不误开/误关 AI 侧边栏（辅助栏与 AI 栏完全分离）。
 *  5. 不调 pushNavState——不污染浏览器后退历史。
 *  6. 不波及兄弟 modal/batchMode 等顶层 UI 状态。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { openDetail } from '../../composables/ui/useUI.js'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('openDetail — 暂存搁架卡位增量去重 push + 空 bmId 早退守卫（辅助栏与 AI 侧边栏解耦）', () => {
  it('A：正路径空 detailCards → push bmId，且不误触 panels.detail（AI 侧边栏保持独立）', () => {
    const ui = useUIStore()
    ui.detailCards = []
    ui.panels.detail = false

    openDetail('b1')

    expect(ui.detailCards).toEqual(['b1'])
    expect(ui.panels.detail).toBe(false)
  })

  it('B：空 bmId 早退守卫——空串 入参恒 return 不 push', () => {
    const ui = useUIStore()
    ui.detailCards = []
    ui.panels.detail = false

    openDetail('')

    expect(ui.detailCards).toHaveLength(0)
    expect(ui.panels.detail).toBe(false)
  })

  it('C：空 bmId 早退守卫——null/undefined 入参同样恒 return 不 push（!bmId 涵盖所有 falsy）', () => {
    const ui = useUIStore()
    ui.detailCards = []
    ui.panels.detail = false

    // @ts-expect-error 运行时 null 入参测试 !bmId 守卫对非 string 的兜底
    openDetail(null)
    // @ts-expect-error 运行时 undefined 入参测试 !bmId 守卫
    openDetail(undefined)

    expect(ui.detailCards).toHaveLength(0)
    expect(ui.panels.detail).toBe(false)
  })

  it('D：缺键才 push 去重幂等——同 bmId 第二次调用不重复 push（detailCards 不出现重复卡位）', () => {
    const ui = useUIStore()
    ui.detailCards = []
    ui.panels.detail = false

    openDetail('b1')
    openDetail('b1')

    expect(ui.detailCards).toEqual(['b1'])
    expect(ui.detailCards).toHaveLength(1)
  })

  it('E：不波及 detailCards 顺序——已存在项 indexOf!==-1 守卫原位不前移（FIFO 顺序保留）', () => {
    const ui = useUIStore()
    ui.detailCards = []

    openDetail('b1')
    openDetail('b2')
    openDetail('b1')

    expect(ui.detailCards).toEqual(['b1', 'b2'])
    expect(ui.detailCards[0]).toBe('b1')
    expect(ui.detailCards[1]).toBe('b2')
  })

  it('F：AI 侧边栏与暂存搁架完全解耦——openDetail 保持 panels.detail 原值不变', () => {
    const ui = useUIStore()
    ui.detailCards = ['b1']
    ui.panels.detail = true

    openDetail('b2')

    expect(ui.panels.detail).toBe(true)
    expect(ui.detailCards).toEqual(['b1', 'b2'])
  })

  it('G：openDetail 不波及兄弟 modal/batchMode/batchSelected 等顶层 UI 状态', () => {
    const ui = useUIStore()
    ui.modals.category = false
    ui.modals.attribute = false
    ui.modals.groupEdit = false
    ui.batchMode = false
    ui.batchSelected = []

    openDetail('b1')

    expect(ui.detailCards).toEqual(['b1'])
    expect(ui.modals.category).toBe(false)
    expect(ui.modals.attribute).toBe(false)
    expect(ui.modals.groupEdit).toBe(false)
    expect(ui.batchMode).toBe(false)
    expect(ui.batchSelected).toHaveLength(0)
  })

  it('H：连续打开多 bmId 顺序保留 FIFO（push 顺序 = 打开顺序，暂存搁架卡位栈语义）', () => {
    const ui = useUIStore()
    ui.detailCards = []

    openDetail('b1')
    openDetail('b2')
    openDetail('b3')

    expect(ui.detailCards).toEqual(['b1', 'b2', 'b3'])
  })

  it('I：移动端环境（ui.isMobile = true）：openDetail(bmId) 自动呼出 QuickLook 抽屉（不污染 detailCards）', () => {
    const ui = useUIStore()
    ui.isMobile = true
    ui.detailCards = []
    ui.modals.quickLook = false

    openDetail('b1')

    expect(ui.modals.quickLook).toBe(true)
    expect(ui.quickLookBmId).toBe('b1')
    expect(ui.detailCards).toHaveLength(0)
  })

  it('J：移动端环境组卡片（ui.isMobile = true && bmId 以 group: 开头）：呼出 QuickLook 抽屉（像书签一样展示组卡片速览）', () => {
    const ui = useUIStore()
    ui.isMobile = true
    ui.detailCards = []
    ui.modals.quickLook = false

    openDetail('group:g1')

    expect(ui.modals.quickLook).toBe(true)
    expect(ui.quickLookBmId).toBe('group:g1')
    expect(ui.detailCards).toHaveLength(0)
  })
})
