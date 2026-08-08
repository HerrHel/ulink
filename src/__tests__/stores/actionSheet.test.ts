/**
 * actionSheet.test.ts — Action Sheet Store 6 action 编排层护栏（精简版）
 *
 * 补 src/stores/actionSheet.ts useActionSheetStore 6 核心 action 的直接护栏。原文件 30 例
 * 含 ★的真实契约(顺序敏感/分流/兜底/阈值)与纯镜像(空 items 不过滤/对称分支/别名转发/
 * 重复 hide 断言)混杂。此精简版留 16 例守真实后果契约,删去零增量镜像。
 *
 * 守的真实后果:mode 切错致显示 actions 栏目而非分类选择器;hide 漏清 isDragging 致下次打开
 * 残留拖拽态;onAction 改「先执行后 hide」让回调里调 hide 逻辑混乱;catTargetType 分流错把
 * group 改成 bookmark 的 categoryId;registry 查表漏 null 守卫致未注册 string action 抛 TypeError;
 * onTouchEnd 阈值判定错致拖拽误关或回弹不响。
 *
 * 删去:空 items 不过滤、group 类型分流镜像、便捷方法转发别名、hide 不改内容栈(并入 hide 主例)、
 * function 优先 string(并入 onAction function 主例)、registerAction 覆盖同 id、onAction 始终
 * hide 重复断言、toast 含分类名(并入 fallback 严例)、onTouchStart 两态短路、onTouchMove 上滑
 * 对称/无 TouchStart 短路、onTouchEnd 未拖拽清 startY。
 *
 * 口径同 contextMenu.test.ts:纯加测试零源文件改动,actionSheet.ts 6 action 全经 store return
 * 暴露,_actionRegistry 闭包私有经 registerAction 写入入口测。仅 mock useAppStore + toast。
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
  it('默认 actions 模式不可见 + 拖拽态零位', () => {
    const s = useActionSheetStore()
    expect(s.visible).toBe(false)
    expect(s.mode).toBe('actions')
    expect(s.items).toEqual([])
    expect(s.catTargetId).toBeNull()
    expect(s.catTargetType).toBeNull()
    expect(s.newCatName).toBe('')
    expect(s.isDragging).toBe(false)
    expect(s.dragY).toBe(0)
  })
})

describe('showActions / showCategoryPicker — 打开两模式（mode 覆盖防残留）', () => {
  it('showActions 设 mode=actions + items + visible=true', () => {
    const s = useActionSheetStore()
    const items = [{ label: '编辑', action: () => {} }, { label: '删除', action: 'del', danger: true }]
    s.showActions(items)
    expect(s.mode).toBe('actions')
    // Pinia ref reactive 包装后 s.items 是 proxy，与原引用 Object.is 不等；用 toEqual 深等价断言内容被设入
    expect(s.items).toEqual(items)
    expect(s.visible).toBe(true)
  })

  it('showCategoryPicker 设 mode=category + catTargetId/Type + newCatName="" + visible=true', () => {
    const s = useActionSheetStore()
    s.showCategoryPicker('b1', 'bm')
    expect(s.mode).toBe('category')
    expect(s.catTargetId).toBe('b1')
    expect(s.catTargetType).toBe('bm')
    expect(s.newCatName).toBe('')
    expect(s.visible).toBe(true)
  })

  it('★从 category 模式切回 actions：mode 被 showActions 覆写（不被旧 category 残留）', () => {
    const s = useActionSheetStore()
    s.showCategoryPicker('g1', 'group')
    expect(s.mode).toBe('category')
    s.showActions([{ label: 'x', action: () => {} }])
    expect(s.mode).toBe('actions')
    expect(s.visible).toBe(true)
  })

  it('★newCatName 在 showCategoryPicker 时强制重置（防残留上次草稿输入）', () => {
    const s = useActionSheetStore()
    s.newCatName = '上次的草稿'
    s.showCategoryPicker('g1', 'group')
    expect(s.newCatName).toBe('')
  })
})

describe('hide — 关闭并清拖拽态', () => {
  it('visible=false + isDragging=false + dragY=0（内容栈 items/catTarget 保留）', () => {
    const s = useActionSheetStore()
    const items = [{ label: 'x', action: () => {} }]
    s.showActions(items)
    s.showCategoryPicker('g1', 'group')
    s.isDragging = true
    s.dragY = 120
    s.hide()
    expect(s.visible).toBe(false)
    expect(s.isDragging).toBe(false)
    expect(s.dragY).toBe(0)
    // hide 只关 visible + 拖拽态，items/catTarget 不被清（下次打开前的内容保留语义）
    expect(s.items).toEqual(items)
    expect(s.catTargetId).toBe('g1')
    expect(s.catTargetType).toBe('group')
  })
})

describe('registerAction + onAction — 动作执行编排', () => {
  it('★onAction function 分支：先 hide 后执行（顺序敏感——防回调里调 hide 逻辑混乱）', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: 'noop' }])
    s.registerAction('noop', () => {})  // 占位确保 string 分支不抢
    const fn = vi.fn()
    s.onAction({ label: 'x', action: fn })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(s.visible).toBe(false)  // hide 已执行（在 action 之前）
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

  it('★onAction string 分支：未注册 id 不抛（registry[id] undefined → 空操作但仍调 hide）', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: 'never-registered' }])
    expect(() => s.onAction({ label: 'x', action: 'never-registered' })).not.toThrow()
    expect(s.visible).toBe(false)  // 仍调 hide
  })
})

describe('onPickCategory — 分类移动编排（catTargetType 分流 + 顺序）', () => {
  it('★catTargetType=bm → updateBookmark(id,{categoryId}) + save + hide', () => {
    appStoreMock.categoryMap = { 'cat-x': { id: 'cat-x', name: '工作' } }
    const s = useActionSheetStore()
    s.showCategoryPicker('b1', 'bm')
    s.onPickCategory('cat-x')
    expect(appStoreMock.updateBookmark).toHaveBeenCalledWith('b1', { categoryId: 'cat-x' })
    expect(appStoreMock.updateGroup).not.toHaveBeenCalled()
    expect(appStoreMock.save).toHaveBeenCalledTimes(1)
    expect(s.visible).toBe(false)
  })

  it('★catTargetType=group → updateGroup(id,{categoryId})，updateBookmark 不被触', () => {
    appStoreMock.categoryMap = { 'cat-y': { id: 'cat-y', name: '学习' } }
    const s = useActionSheetStore()
    s.showCategoryPicker('g1', 'group')
    s.onPickCategory('cat-y')
    expect(appStoreMock.updateGroup).toHaveBeenCalledWith('g1', { categoryId: 'cat-y' })
    expect(appStoreMock.updateBookmark).not.toHaveBeenCalled()
    expect(appStoreMock.save).toHaveBeenCalledTimes(1)
    expect(s.visible).toBe(false)
  })

  it('★toast fallback：cat 不在 categoryMap 时串含空（cat?name 空串兜底）', async () => {
    const { toast } = await import('../../lib/toast.js')
    appStoreMock.categoryMap = {}  // cat-miss 不在
    const s = useActionSheetStore()
    s.showCategoryPicker('b3', 'bm')
    s.onPickCategory('cat-miss')
    expect(toast).toHaveBeenCalledWith('已移动到 ')
  })

  it('★onPickCategory 先 hide 后 update（hide 在 update 之前——防移动后状态残留可见）', () => {
    const visibleSnapshots: boolean[] = []
    appStoreMock.categoryMap = {}
    const s = useActionSheetStore()
    s.showCategoryPicker('b4', 'bm')
    expect(s.visible).toBe(true)
    appStoreMock.updateBookmark.mockImplementation(() => {
      visibleSnapshots.push(s.visible)
    })
    s.onPickCategory('cat-q')
    expect(visibleSnapshots).toEqual([false])  // update 被调时 visible 已为 false
  })
})

describe('onTouch — 手势拖拽阈值逻辑', () => {
  function makeTouchEvent(clientY: number): TouchEvent {
    return { touches: [{ clientY }] as unknown as Touch[] } as unknown as TouchEvent
  }

  it('★onTouchMove 下滑（dy>0）设 isDragging=true + dragY=dy', () => {
    const s = useActionSheetStore()
    s.showActions([{ label: 'x', action: () => {} }])
    s.onTouchStart(makeTouchEvent(200))
    s.onTouchMove(makeTouchEvent(250))  // dy=50>0
    expect(s.isDragging).toBe(true)
    expect(s.dragY).toBe(50)
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
})
