/**
 * deleteCategory / deleteAttribute 护栏（D1-89）
 *
 * 来源 useUI.ts:68-82：
 *   export async function deleteCategory(id: string) {
 *     if (id === CAT_ALL || id === CAT_UNCATEGORIZED) { toast('无法删除默认分类', false); return }
 *     const ok = await showConfirm('确认删除此分类？')
 *     if (ok) { useDataStore().deleteCategory(id); saveAppData() }
 *   }
 *   export function deleteAttribute(id: string) { useDataStore().deleteAttribute(id); saveAppData() }
 *
 * 认领来源：d1-88 pointer#1 明示 useUI.ts 剩余 export 逐函数深度法续挖候选——
 * deleteCategory/deleteAttribute 编排（showConfirm 前吸烟守卫 + T 删除存盘 saveAppData）有欠度，
 * 与 d1-48 createCategory 同处理补算可续领。本轮跨 aggregate grep 确认这两 composable 编排函数
 * 真零护栏：全测试目录命中仅 data.test.ts store 层 deleteCategory/deleteAttribute（不同函数——
 * data.ts:601/644 的 store action 仅软删+迁移，无 showConfirm/无 toast/无默认分类守卫）与
 * realBugFixes.test.ts 本地桩类型签名，无 useUI composable 编排真护栏文件。
 *
 * 生产消费方活跃：ContextMenu.vue:157/170 右键「删除」action 唯一编排入口（CategoryModal.vue:128 /
 * AttributeModal.vue:71 走 app.ts facade deleteCategory/deleteAttribute 同款）——是「右键删除分类/属性」
 * 用户可见行为唯一承载，直接决定「默认分类受保护不删 + 二次确认 + 删后存盘」与「属性无条件直删 + 存盘」
 * 两条删除编排契约是否正确执行。
 *
 * 护栏锁定两类高回归隐特性：
 *  deleteCategory（async）：
 *   1. 默认分类守卫——id===CAT_ALL('all') 或 id===CAT_UNCATEGORIZED('uncategorized') 短路：
 *      toast('无法删除默认分类', false)（ok=false 失败提示语义）+ return，不弹确认、不删、不存盘。
 *      若未来误删这条守卫会让用户右键「全部」「未分类」时直接弹确认框、确认后被软删，破坏内置分类保护。
 *   2. 确认守卫——await showConfirm，用户取消（ok falsy）则不调 dataStore.deleteCategory + 不调 saveAppData。
 *      防「取消仍删」安全契约破坏——若未来误改成不 await 或恒删会让用户取消后仍删除分类。
 *   3. 守卫短路不弹确认——默认分类命中时 showConfirm 零调（守卫在 confirm 之前 short-circuit）。
 *   4. 编排顺序——showConfirm 先 await、resolve(true) 后才 dataStore.deleteCategory(id)、再 saveAppData。
 *  deleteAttribute（同步）：
 *   5. 无 confirm 守卫——不调 showConfirm（与 deleteCategory 的核心语义差异直锁：属性无需二次确认，
 *      若未来误给 deleteAttribute 加 showConfirm 会改变属性删除的 outward-facing 行为）。
 *   6. 无 toast——不调 toast（与 deleteCategory 默认分类守卫不同：属性无内置保护分支）。
 *   7. 任意 id 直删——含 'all' 也照删 dataStore.deleteAttribute（属性 id 无内置保护，与 deleteCategory 守卫差异直锁）。
 *   8. 不调 pushNavState——删除编排不压导航栈（与 openCatModal/openAttrModal A2-011 pushNavState 不同）。
 *
 * 与 d1-69 toggleGroupFocus 同款 vi.mock 闭包 mock 范本（mockData 稳定引用 + 可改 sequence 的
 * ConfirmReturn 桩控制确认/取消两分支 + toast/saveAppData/pushNavState 桩），deleteCategory/deleteAttribute
 * 体不读写 uiStore 故 setActivePinia 仅供 useActionSheetStore 等 useUI.ts 顶部 import 解析正常，spy
 * 直接断言 data store 委托 + saveAppData + toast + showConfirm 调用情况。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock data store / 可改 sequence 的 showConfirm 桩 ----
// deleteCategory/deleteAttribute 委托 data store 的同名 action（data.ts:601/644 store 层，
// 与本 composable 编排层不同），故 mockData.deleteCategory/deleteAttribute 为 vi.fn 观测委托是否被调。
// showConfirm 需在用例间控制 resolve(true|false)（确认/取消两分支），用模块级 ConfirmReturn 桩。
const mockData = {
  deleteCategory: vi.fn(),
  deleteAttribute: vi.fn(),
}

let ConfirmReturn: boolean = true

vi.mock('../../stores/data.js', () => ({
  useDataStore: vi.fn(() => mockData),
}))

vi.mock('../../stores/ui.js', () => ({
  useUIStore: vi.fn(() => ({})),
}))

vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(ConfirmReturn)),
}))

vi.mock('../../stores/actionSheet.js', () => ({
  useActionSheetStore: vi.fn(() => ({ showActions: vi.fn() })),
}))

vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: vi.fn(),
}))

import { saveAppData } from '../../stores/app.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'
import { deleteCategory, deleteAttribute } from '../../composables/ui/useUI.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'

beforeEach(() => {
  setActivePinia(createPinia())
  mockData.deleteCategory.mockClear()
  mockData.deleteAttribute.mockClear()
  ;(saveAppData as any).mockClear()
  ;(toast as any).mockClear()
  ;(showConfirm as any).mockClear()
  ;(pushNavState as any).mockClear()
  ConfirmReturn = true
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('deleteCategory — 默认分类守卫 + 二次确认 + 删后存盘护栏（D1-89）', () => {
  it('A：正路径 showConfirm 确认 → 调 dataStore.deleteCategory + saveAppData 各一次、无 toast', async () => {
    await deleteCategory('cat1')

    expect(showConfirm).toHaveBeenCalledTimes(1)
    expect(showConfirm).toHaveBeenCalledWith('确认删除此分类？')
    expect(mockData.deleteCategory).toHaveBeenCalledTimes(1)
    expect(mockData.deleteCategory).toHaveBeenCalledWith('cat1')
    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()
  })

  it('B：默认分类守卫 id===CAT_ALL → toast 失败提示 + return，不弹确认/不删/不存盘', async () => {
    await deleteCategory(CAT_ALL)

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('无法删除默认分类', false)
    expect(showConfirm).not.toHaveBeenCalled()
    expect(mockData.deleteCategory).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('C：默认分类守卫 id===CAT_UNCATEGORIZED → toast 失败提示 + return，不弹确认/不删/不存盘', async () => {
    await deleteCategory(CAT_UNCATEGORIZED)

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('无法删除默认分类', false)
    expect(showConfirm).not.toHaveBeenCalled()
    expect(mockData.deleteCategory).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('D：用户取消确认（showConfirm resolve(false)）→ 不调 dataStore.deleteCategory + 不调 saveAppData', async () => {
    ConfirmReturn = false

    await deleteCategory('cat2')

    expect(showConfirm).toHaveBeenCalledTimes(1)
    expect(mockData.deleteCategory).not.toHaveBeenCalled()
    expect(saveAppData).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('E：默认分类守卫短路在前——id===CAT_ALL 时 showConfirm 零调（守卫在 confirm 之前 short-circuit）', async () => {
    await deleteCategory(CAT_ALL)

    expect(showConfirm).not.toHaveBeenCalled()
  })

  it('F：toast 第二参数 ok=false 锁失败提示语义——「无法删除默认分类」是失败提示非成功提示', async () => {
    await deleteCategory(CAT_UNCATEGORIZED)

    expect(toast).toHaveBeenCalledWith('无法删除默认分类', false)
  })

  it('G：编排顺序——showConfirm 先 await、resolve(true) 后才 deleteCategory 再 saveAppData', async () => {
    const callOrder: string[] = []
    // 全部用 Once 一次性覆盖，自动回落到工厂实现，无需手动复位（restoreAllMocks 对 vi.mock 工厂 vi.fn 不生效）
    ;(showConfirm as any).mockImplementationOnce(() => { callOrder.push('showConfirm'); return Promise.resolve(true) })
    mockData.deleteCategory.mockImplementationOnce(() => { callOrder.push('deleteCategory') })
    ;(saveAppData as any).mockImplementationOnce(() => { callOrder.push('saveAppData') })

    await deleteCategory('cat3')

    expect(callOrder).toEqual(['showConfirm', 'deleteCategory', 'saveAppData'])
  })
})

describe('deleteAttribute — 无 confirm 守卫 + 直删 + 存盘护栏（D1-89）', () => {
  it('H：正路径 → 直接调 dataStore.deleteAttribute + saveAppData 各一次、无 toast', () => {
    deleteAttribute('a1')

    expect(mockData.deleteAttribute).toHaveBeenCalledTimes(1)
    expect(mockData.deleteAttribute).toHaveBeenCalledWith('a1')
    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  it('I：无 confirm 守卫——不调 showConfirm（与 deleteCategory 的核心语义差异直锁）', () => {
    deleteAttribute('a1')

    expect(showConfirm).not.toHaveBeenCalled()
  })

  it('J：无 toast——不调 toast（与 deleteCategory 默认分类守卫不同，属性无内置保护分支）', () => {
    deleteAttribute('a1')

    expect(toast).not.toHaveBeenCalled()
  })

  it('K：任意 id 直删——含 CAT_ALL 也照删 deleteAttribute（属性 id 无内置保护，与 deleteCategory 守卫差异直锁）', () => {
    deleteAttribute(CAT_ALL)

    expect(mockData.deleteAttribute).toHaveBeenCalledTimes(1)
    expect(mockData.deleteAttribute).toHaveBeenCalledWith(CAT_ALL)
    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()
    expect(showConfirm).not.toHaveBeenCalled()
  })

  it('L：不调 pushNavState——删除编排不压导航栈（与 openCatModal/openAttrModal A2-011 pushNavState 不同）', () => {
    deleteAttribute('a1')

    expect(pushNavState).not.toHaveBeenCalled()
  })
})
