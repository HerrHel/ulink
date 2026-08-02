/**
 * openDetail 护栏（D1-88）
 *
 * 来源 useUI.ts:34-39：
 *   export function openDetail(bmId: string) {
 *     if (!bmId) return                                 // 空 bmId 早退守卫
 *     const ui = useUIStore()
 *     if (ui.detailCards.indexOf(bmId) === -1) ui.detailCards.push(bmId)  // 缺键才 push 去重幂等
 *     ui.panels.detail = true                           // 恒开详情面板（无 toggle 语义）
 *   }
 *
 * 认领来源：d1-87 pointer#1 明示下轮候选 useUI.ts `openDetail`（line 34，detail 卡位增量去重 push
 * + panels.detail 恒开 + 空 bmId 早退守卫编排护栏零直测，与 toggleDetailPanel 编排互补）。
 * 本轮跨 aggregate grep 确认 openDetail 真零护栏：全测试目录命中仅 toggleDetailPanel.test.ts:176
 * 注释间接承接（"模拟 openDetail 路径已 push 卡位"是 setup 前提非 openDetail 本身的护栏断言）
 * + useDragDrop.test.ts:53 mock 桩（vi.mock 跳过内部逻辑），无 openDetail.test.ts 真护栏文件。
 *
 * 生产消费方极活跃（与 d1-87 openAttrModal 生产零调用方截然不同）：BookmarkCard.vue/doOpenDetail
 * + openMenu + 右键 detail action、GroupCard.vue/`group:` 前缀、ContextMenu.vue DETAIL/VISIT 分支、
 * useDragDrop.ts:472、useApp.ts:52/69「查看详情」菜单项——是「打开详情面板」用户可见行为唯一编排入口，
 * 决定详情面板 detailCards 卡位栈内容 + panels.detail 开关。
 *
 * 护栏锁定五类高回归隐特性（与 d1-84 toggleDetailPanel 编排互补且语义独立）：
 *  1. 空 bmId 早退守卫——空串/null/undefined 入参恒 return 不 push、不误开面板。若未来误删 `if (!bmId) return`
 *     会让空串被 push 进 detailCards 即 detailCards 含空卡位 + 误开面板。
 *  2. 缺键才 push 去重幂等——`indexOf(bmId) === -1` 守卫锁「已存在的 bmId 不重复 push」。若未来误改成恒 push
 *     或删 indexOf 守卫会让 detailCards 出现重复 bmId 致详情面板渲染重复卡位 + 删除/操作误作用多张。
 *  3. 恒置 panels.detail=true 无 toggle 语义——openDetail 只开不关，与 toggleDetailPanel 的
 *     `if(已开)splice(0)关 else 开` 截然不同。若未来误加 toggle 语义会让打开详情面板反关掉（已开态再 openDetail 关）。
 *  4. 不波及 detailCards 顺序——已存在项原位不前移（indexOf===-1 守卫保证已存在项不重新 push 到末尾）。
 *  5. 不调 pushNavState——与 d1-84 toggleDetailPanel / d1-86 openCatModal / d1-87 openAttrModal
 *     同款 A2-011 pushNavState 差异：openDetail 编排不压导航栈（pushNavState 不在 openDetail 源码内）。
 *     这条与 toggleDetailPanel 进入分支恒调 pushNavState 形成核心区分——防未来误给 openDetail 加 pushNavState
 *     让多次打开详情污染浏览器后退历史。
 *
 * 与 d1-87 openAttrModal 同 setActivePinia + useUIStore 直读范本，但 openDetail 无 pushNavState 故
 * 不需 mock useKeyboardOps（减一个 mock 维度）。store 字段 shape：detailCards:string[] 初始 []、
 * panels.detail:boolean 初始 false（ui.ts:117/138-140）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { openDetail } from '../../composables/ui/useUI.js'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('openDetail — 详情面板卡位增量去重 push + panels.detail 恒开 + 空 bmId 早退守卫护栏（D1-88）', () => {
  it('A：正路径空 detailCards → push bmId + panels.detail 置 true', () => {
    const ui = useUIStore()
    ui.detailCards = []
    ui.panels.detail = false

    openDetail('b1')

    expect(ui.detailCards).toEqual(['b1'])
    expect(ui.panels.detail).toBe(true)
  })

  it('B：空 bmId 早退守卫——空串 入参恒 return 不 push + 不误开面板', () => {
    const ui = useUIStore()
    ui.detailCards = []
    ui.panels.detail = false

    openDetail('')

    // 空 bmId 早退：不 push 空串、不误开面板
    expect(ui.detailCards).toHaveLength(0)
    expect(ui.panels.detail).toBe(false)
  })

  it('C：空 bmId 早退守卫——null/undefined 入参同样恒 return 不 push + 不误开面板（!bmId 涵盖所有 falsy）', () => {
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
    openDetail('b1') // 重复打开同 bmId

    // indexOf===-1 守卫：已存在的 b1 不重复 push，detailCards 仍只 1 个
    expect(ui.detailCards).toEqual(['b1'])
    expect(ui.detailCards).toHaveLength(1)
    expect(ui.panels.detail).toBe(true)
  })

  it('E：不波及 detailCards 顺序——已存在项 indexOf!==-1 守卫原位不前移（已开 b1 后开 b2，再开 b1 不挪到末尾）', () => {
    const ui = useUIStore()
    ui.detailCards = []
    ui.panels.detail = false

    openDetail('b1')
    openDetail('b2')
    // detailCards = ['b1','b2']，顺序 = 打开顺序 FIFO

    openDetail('b1') // 再开 b1：已存在守卫命中，不重新 push，原位不动

    // 顺序仍 ['b1','b2']，b1 不被挪到末尾成 ['b2','b1']
    expect(ui.detailCards).toEqual(['b1', 'b2'])
    expect(ui.detailCards[0]).toBe('b1')
    expect(ui.detailCards[1]).toBe('b2')
  })

  it('F：恒置 panels.detail=true 无 toggle 语义——已开态再 openDetail 仍开（与 toggleDetailPanel toggle 语义截然不同）', () => {
    const ui = useUIStore()
    ui.detailCards = ['b1'] // 详情面板已开且已有卡位
    ui.panels.detail = true

    openDetail('b2') // 再次打开

    // panels.detail 恒 true（openDetail 只开不关，无 toggle 语义）
    // 与 toggleDetailPanel 的「已开且 detailCards 非空 → 关 (splice(0)+detail=false)」截然不同
    expect(ui.panels.detail).toBe(true)
    expect(ui.detailCards).toEqual(['b1', 'b2'])
  })

  it('G：openDetail 不波及兄弟 modal/batchMode/batchSelected 等顶层 UI 状态（纯 detail 面板编排不外溢）', () => {
    const ui = useUIStore()
    ui.modals.category = false
    ui.modals.attribute = false
    ui.modals.groupEdit = false
    ui.batchMode = false
    ui.batchSelected = []

    openDetail('b1')

    expect(ui.panels.detail).toBe(true)
    expect(ui.detailCards).toEqual(['b1'])
    // 不波及兄弟 modal（防误改为遍历开全部 modal）
    expect(ui.modals.category).toBe(false)
    expect(ui.modals.attribute).toBe(false)
    expect(ui.modals.groupEdit).toBe(false)
    // 不波及 batchMode/batchSelected 顶层状态
    expect(ui.batchMode).toBe(false)
    expect(ui.batchSelected).toHaveLength(0)
  })

  it('H：连续打开多 bmId 顺序保留 FIFO（push 顺序 = 打开顺序，详情面板卡位栈语义）', () => {
    const ui = useUIStore()
    ui.detailCards = []
    ui.panels.detail = false

    openDetail('b1')
    openDetail('b2')
    openDetail('b3')

    // 三张按打开顺序 FIFO 入栈，无乱序无去重（互不相同）
    expect(ui.detailCards).toEqual(['b1', 'b2', 'b3'])
    expect(ui.panels.detail).toBe(true)
  })
})
