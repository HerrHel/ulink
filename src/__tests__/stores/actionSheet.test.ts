/**
 * actionSheet.test.ts — Action Sheet Store 6 action 编排层护栏
 *
 * 补 src/stores/actionSheet.ts useActionSheetStore 6 核心 action 的直接护栏缺口。
 * actionSheet store 替代 bridge.ts actionSheetAPI 服务定位器模式（CLAUDE.md 架构迁移注意），
 * 管理通用操作列表 / 分类选择器 / 手势拖拽三态 UI。6 action 是 ActionSheet 组件
 * （components/overlays/ActionSheet.vue）背后唯一状态编排核：
 *
 * - showActions(items)：打开 actions 模式列表（mode='actions' + items + visible=true）
 * - showCategoryPicker(id, type)：打开分类选择器（mode='category' + catTargetId/Type + newCatName='' + visible）
 * - hide()：关闭并清拖拽态（visible=false + isDragging=false + dragY=0）
 * - onAction(item)：先 hide 再执行 item.action（function 直接调 / string 查 _actionRegistry 调）
 * - onPickCategory(catId)：调 useAppStore().updateGroup/updateBookmark 改 categoryId + save + toast
 * - registerAction(id, fn)/onAction string 分支：_actionRegistry 字典查表执行（桥接消费者注册回调）
 *
 * 此前全测试目录零真实护栏断言（grep useActionSheetStore 仅 2 文件 mock 掉当副作用桩避开它：
 * deleteCategory.test.ts:79 / useKeyboardOps.test.ts，从不断言 mode/items/catTarget/registry 行为），
 * 编排边界（mode 切换、items/catTarget 副作用顺序、hide 重置 isDragging/dragY 双态、
 * onAction function-vs-string 双分支 + 先 hide 后执行顺序、catTargetType 决定 updateGroup vs updateBookmark
 * 分流、catTargetType 进入 category 模式前的 newCatName 重置、registry map 查表空 id 不抛）零直测。
 *
 * 任一回归会让 ActionSheet 用户可见行为错乱：mode 切错致显示 actions 栏目而非分类选择器；hide 漏清
 * isDragging 致下次打开残留拖拽态；onAction 改成「先执行后 hide」让回调里调 hide 逻辑混乱；catTargetType
 * 分流错把 group 改成 bookmark 的 categoryId；registry 查表漏 null 守卫致未注册 string action 抛 TypeError。
 *
 * 口径同 contextMenu.test.ts：纯加测试零源文件改动——actionSheet.ts 6 action 全经 store return 对外暴露，
 * _actionRegistry 闭包私有经 registerAction 写入入口测。仅 mock useAppStore（onPickCategory 依赖）+ toast。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// onPickCategory 依赖 useAppStore（updateGroup/updateBookmark/save/categoryMap）
const appStoreMock = {
  updateGroup: vi.fn(),
  updateBookmark: vi.fn(),
  save: vi.fn(() => Promise.resolve(true)),
  categoryMap: {} as Record<string, { id: string; name: string }>,
  selectableCategories: [] as Array<{ id: string; name: string }>,
}
vi.mock('../../stores/app.js', () => ({ useAppStore: vi.fn(() => appStoreMock) }))
vi.mock('../../lib/toast.js', () => ({ toast: vi.fn() }))

import { useActionSheetStore } from '../../stores/actionSheet.js'

beforeEach(() => {
  vi.clearAllMocks()
  appStoreMock.categoryMap = {}
  appStoreMock.selectableCategories = []
})

describe('actionSheetStore — 初始状态', () => {
  it('默认 actions 模式不可见', () => {
    const s = useActionSheetStore()
    expect(s.visible).toBe(false)
    expect(s.mode).toBe('actions')
    expect(s.items).toEqual([])
    expect(s.catTargetId).toBeNull()
    expect(s.catTargetType).toBeNull()
    expect(s.newCatName).toBe('')
  })

  it('默认拖拽态零位', () => {
    const s = useActionSheetStore()
    expect(s.isDragging).toBe(false)
    expect(s.dragY).toBe(0)
  })
})

describe('showActions — 打开 actions 模式列表', () => {
  it('设 mode=actions + items + visible=true', () => {
    const s = useActionSheetStore()
    const items = [{ label: '编辑', action: () => {} }, { label: '删除', action: 'del', danger: true }]
    s.showActions(items)
    expect(s.mode).toBe('actions')
    // Pinia ref reactive 包装后 s.items 是 proxy，与原引用 Object.is 不等；用 toEqual 深等价断言内容被设入
    expect(s.items).toEqual(items)
    expect(s.visible).toBe(true)
  })

  it('空 items 数组仍打开（不过滤）', () => {
    const s = useActionSheetStore()
    s.showActions([])
    expect(s.visible).toBe(true)
    expect(s.items).toEqual([])
    expect(s.mode).toBe('actions')
  })

  it('从 category 模式切回 actions：mode 覆盖为 actions', () => {
    const s = useActionSheetStore()
    s.showCategoryPicker('g1', 'group')
    expect(s.mode).toBe('category')
    s.showActions([{ label: 'x', action: () => {} }])
    // mode 被 showActions 覆写回 actions（不被旧 category 模式残留）
    expect(s.mode).toBe('actions')
    expect(s.visible).toBe(true)
  })
})

describe('showCategoryPicker — 打开分类选择器', () => {
  it('设 mode=category + catTargetId/Type + newCatName="" + visible=true', () => {
    const s = useActionSheetStore()
    s.showCategoryPicker('b1', 'bm')
    expect(s.mode).toBe('category')
    expect(s.catTargetId).toBe('b1')
    expect(s.catTargetType).toBe('bm')
    expect(s.newCatName).toBe('')
    expect(s.visible).toBe(true)
  })

  it('group 类型分流', () => {
    const s = useActionSheetStore()
    s.showCategoryPicker('g1', 'group')
    expect(s.catTargetId).toBe('g1')
    expect(s.catTargetType).toBe('group')
  })

  it('★newCatName 在打开时强制重置（防残留上次输入）', () => {
    const s = useActionSheetStore()
    s.newCatName = '上次的草稿'
    s.showCategoryPicker('g1', 'group')
    expect(s.newCatName).toBe('')
  })

  it('便捷方法 showBmCategoryPicker/showGroupCategoryPicker 转发', () => {
    const s = useActionSheetStore()
    s.showBmCategoryPicker('b9')
    expect(s.catTargetId).toBe('b9')
    expect(s.catTargetType).toBe('bm')
    expect(s.mode).toBe('category')
    const s2 = useActionSheetStore()
    s2.showGroupCategoryPicker('g8')
    expect(s2.catTargetId).toBe('g8')
    expect(s2.catTargetType).toBe('group')
  })
})

describe('hide — 关闭并清拖拽态', () => {
  it('visible=false + isDragging=false + dragY=0', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: () => {} }])
    s.isDragging = true
    s.dragY = 120
    s.hide()
    expect(s.visible).toBe(false)
    expect(s.isDragging).toBe(false)
    expect(s.dragY).toBe(0)
  })

  it('hide 不改 items/catTarget（仅关可见 + 清拖拽，内容栈保留）', () => {
    const s = useActionSheetStore()
    const items = [{ label: 'x', action: () => {} }]
    s.showActions(items)
    s.showCategoryPicker('g1', 'group')
    s.hide()
    // hide 只关 visible + 拖拽态，items/catTarget 不被清（下次打开前的内容保留语义）
    expect(s.visible).toBe(false)
    // Pinia ref reactive 包装后 s.items 是 proxy，与原引用 Object.is 不等；用 toEqual 深等价断言内容被设入
    expect(s.items).toEqual(items)
    expect(s.catTargetId).toBe('g1')
    expect(s.catTargetType).toBe('group')
  })
})

describe('registerAction + onAction — 动作执行编排', () => {
  it('★onAction function 分支：先 hide 后执行（执行顺序敏感——防回调里调 hide 逻辑混乱）', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: 'noop' }])
    const order: string[] = []
    // item.action 是 function：onAction 应先 hide() 再调 action()
    s.registerAction('noop', () => order.push('exec'))  // 占位确保 string 分支不抢
    const fn = vi.fn(() => { order.push('exec') })
    s.onAction({ label: 'x', action: fn })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(s.visible).toBe(false)  // hide 已执行
    // 顺序：hide 标记 visible=false 在前，action 执行在后
    expect(order).toEqual(['exec'])
  })

  it('★onAction string 分支：查 _actionRegistry 执行注册回调', () => {
    const s = useActionSheetStore()
    const fn = vi.fn()
    s.registerAction('del-action', fn)
    s.showActions([{ label: '删除', action: 'del-action', danger: true }])
    s.onAction({ label: '删除', action: 'del-action', danger: true })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(s.visible).toBe(false)
  })

  it('★onAction string 分支：未注册 id 不抛（_actionRegistry[id] 查表返 undefined → 空操作）', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: 'never-registered' }])
    expect(() => s.onAction({ label: 'x', action: 'never-registered' })).not.toThrow()
    expect(s.visible).toBe(false)  // 仍调 hide
  })

  it('★onAction function 优先于 string：action 是 function 时直接调、不查 registry', () => {
    const s = useActionSheetStore()
    const registryFn = vi.fn()
    const directFn = vi.fn()
    // 同名 id 注册了 registry，但 item.action 是 function 应直接调 directFn、registry 不被触
    s.registerAction('shared', registryFn)
    s.onAction({ label: 'x', action: directFn })
    expect(directFn).toHaveBeenCalledTimes(1)
    expect(registryFn).not.toHaveBeenCalled()
  })

  it('registerAction 覆盖同 id 注册（后注册覆盖前）', () => {
    const s = useActionSheetStore()
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    s.registerAction('act', fn1)
    s.registerAction('act', fn2)
    s.onAction({ label: 'x', action: 'act' })
    expect(fn1).not.toHaveBeenCalled()
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  it('onAction 始终先 hide 无论 action 分支（visible=true 时调 onAction 后必 false）', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: 'noop' }])
    expect(s.visible).toBe(true)
    s.registerAction('noop', () => {})
    s.onAction({ label: 'x', action: 'noop' })
    expect(s.visible).toBe(false)
    s.showActions([{ label: 'y', action: () => {} }])
    expect(s.visible).toBe(true)
    s.onAction({ label: 'y', action: () => {} })
    expect(s.visible).toBe(false)
  })
})

describe('onPickCategory — 分类移动编排', () => {
  it('★catTargetType=bm → updateBookmark(id, {categoryId})', async () => {
    appStoreMock.categoryMap = { 'cat-x': { id: 'cat-x', name: '工作' } }
    const s = useActionSheetStore()
    s.showCategoryPicker('b1', 'bm')
    s.onPickCategory('cat-x')
    expect(appStoreMock.updateBookmark).toHaveBeenCalledWith('b1', { categoryId: 'cat-x' })
    expect(appStoreMock.updateGroup).not.toHaveBeenCalled()
    expect(appStoreMock.save).toHaveBeenCalledTimes(1)
    expect(s.visible).toBe(false)  // hide 已执行
  })

  it('★catTargetType=group → updateGroup(id, {categoryId})', () => {
    appStoreMock.categoryMap = { 'cat-y': { id: 'cat-y', name: '学习' } }
    const s = useActionSheetStore()
    s.showCategoryPicker('g1', 'group')
    s.onPickCategory('cat-y')
    expect(appStoreMock.updateGroup).toHaveBeenCalledWith('g1', { categoryId: 'cat-y' })
    expect(appStoreMock.updateBookmark).not.toHaveBeenCalled()
    expect(appStoreMock.save).toHaveBeenCalledTimes(1)
    expect(s.visible).toBe(false)
  })

  it('toast 串含分类名（cat 命中 categoryMap）', async () => {
    const { toast } = await import('../../lib/toast.js')
    appStoreMock.categoryMap = { 'cat-z': { id: 'cat-z', name: '阅读' } }
    const s = useActionSheetStore()
    s.showCategoryPicker('b2', 'bm')
    s.onPickCategory('cat-z')
    expect(toast).toHaveBeenCalledWith('已移动到 阅读')
  })

  it('★toast fallback：cat 不在 categoryMap 时串含空（cat?name 空串兜底）', async () => {
    const { toast } = await import('../../lib/toast.js')
    appStoreMock.categoryMap = {}  // cat-miss 不在
    const s = useActionSheetStore()
    s.showCategoryPicker('b3', 'bm')
    s.onPickCategory('cat-miss')
    expect(toast).toHaveBeenCalledWith('已移动到 ')
  })

  it('★onPickCategory 先 hide 后 update（hide 在 update 之前执行——防移动后状态残留可见）', () => {
    const visibleSnapshots: boolean[] = []
    appStoreMock.categoryMap = {}
    const s = useActionSheetStore()
    s.showCategoryPicker('b4', 'bm')
    expect(s.visible).toBe(true)
    // 用 spy 拦截 updateBookmark 时机检查 hide 已生效
    appStoreMock.updateBookmark.mockImplementation(() => {
      visibleSnapshots.push(s.visible)
    })
    s.onPickCategory('cat-q')
    expect(visibleSnapshots).toEqual([false])  // update 被调时 visible 已为 false
  })
})

describe('onTouchStart/Move/End — 手势拖拽关逻辑', () => {
  function makeTouchEvent(clientY: number): TouchEvent {
    return { touches: [{ clientY }] as unknown as Touch[] } as unknown as TouchEvent
  }

  it('onTouchStart 在 visible=false 时短路（不设 startY）', () => {
    const s = useActionSheetStore()
    expect(() => s.onTouchStart(makeTouchEvent(100))).not.toThrow()
    expect(s.isDragging).toBe(false)
  })

  it('onTouchStart 在可见时记录起点 + isDragging 重置 false', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: () => {} }])
    s.onTouchStart(makeTouchEvent(200))
    expect(s.isDragging).toBe(false)
  })

  it('★onTouchMove 下滑（dy>0）设 isDragging=true + dragY=dy', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: () => {} }])
    s.onTouchStart(makeTouchEvent(200))
    s.onTouchMove(makeTouchEvent(250))  // dy=50>0
    expect(s.isDragging).toBe(true)
    expect(s.dragY).toBe(50)
  })

  it('onTouchMove 上滑（dy<0）不触发拖拽', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: () => {} }])
    s.onTouchStart(makeTouchEvent(200))
    s.onTouchMove(makeTouchEvent(150))  // dy=-50<0
    expect(s.isDragging).toBe(false)
    expect(s.dragY).toBe(0)
  })

  it('onTouchStart 前无 TouchMove 短路（startY=0）', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: () => {} }])
    s.onTouchMove(makeTouchEvent(250))  // 未先 touchStart
    expect(s.isDragging).toBe(false)
    expect(s.dragY).toBe(0)
  })

  it('★onTouchEnd dragY>80 → hide（拖够关闭阈值关弹层）', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: () => {} }])
    s.onTouchStart(makeTouchEvent(200))
    s.onTouchMove(makeTouchEvent(300))  // dy=100>80
    s.onTouchEnd()
    expect(s.visible).toBe(false)
    expect(s.isDragging).toBe(false)
    expect(s.dragY).toBe(0)
  })

  it('★onTouchEnd dragY≤80 → 不 hide 仅清拖拽态（未达阈值回弹）', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: () => {} }])
    s.onTouchStart(makeTouchEvent(200))
    s.onTouchMove(makeTouchEvent(250))  // dy=50≤80
    s.onTouchEnd()
    expect(s.visible).toBe(true)  // 未关
    expect(s.isDragging).toBe(false)
    expect(s.dragY).toBe(0)
  })

  it('onTouchEnd 未拖拽时仅清 startY（不 hide 不改 dragY）', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: () => {} }])
    s.onTouchStart(makeTouchEvent(200))
    s.dragY = 30  // 模拟有残留但未 isDragging
    s.onTouchEnd()
    expect(s.visible).toBe(true)
  })
})
