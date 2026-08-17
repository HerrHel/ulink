/**
 * useInlineRename — 行内重命名三态编排护栏
 *
 * useInlineRename(store, renameMethod) 工厂被 CategoryModal('renameCategory') 和
 * AttributeModal('renameAttribute') 复用，是「分类/属性列表行内点编辑 → 输入框聚焦 →
 * 回车确认重命名 / Esc 取消」这一用户可见行为的唯一承载逻辑。两消费方组件均无
 * 对应组件测试（src/__tests__/components/ 无 AttributeModal/CategoryModal），
 * src/__tests__/ 全量 grep useInlineRename|startRename|confirmRename|cancelRename 零命中
 * — 三态编排此前零直接断言靠实现口头维护。本护栏把「空名/无 id 静默不调 store」
 * 「confirm 链 store[renameMethod]+save+toast+reset」「Esc 冒泡 stopPropagation（M12）」
 * 「startRename nextTick focus」「cancel 幂等」「返回恰好 6 键」六组隐分支直锁为可回归
 * 断言，防未来误改可见性语义。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick, isRef } from 'vue'

// toast 经模块级 vi.mock 桩——useInlineRename.ts 顶层 `import { toast } from '../../lib/toast.js'`，
// 测试在 src/__tests__/composables/ 相对 '../../lib/toast.js'，与 addNewCategory.test.ts /
// addGroupRefToGroup.test.ts 同款范式。vi.mock factory 被 hoist 到文件顶，模块级 const 不能引用
// 可能尚未初始化的变量（d1-108 试错同款 vitest hoisting 真特性），故 mock factory 内直接用 vi.fn()，
// 后 `vi.mocked(toast)` 拿句柄断言调用次数。
vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
}))

import { useInlineRename, type RenameTarget } from '../../composables/ui/useInlineRename.js'
import { toast as toastImpl } from '../../lib/toast.js'

const toastMock = vi.mocked(toastImpl)

/** 假 input element 带 focus spy，复用 setEditInputRef 注入范式 */
function makeFakeInput(): { el: HTMLInputElement; focus: ReturnType<typeof vi.fn> } {
  const focus = vi.fn()
  const el = { focus } as unknown as HTMLInputElement
  return { el, focus }
}

/** 假 store：renameXxx/save 全 spy，renameMethod 注入名驱动确认动态分发契约 */
function makeFakeStore(
  over: { renameMethodReturn?: unknown; saveReturn?: unknown } = {},
): {
  store: RenameTarget
  renameCategory: ReturnType<typeof vi.fn>
  renameAttribute: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
} {
  const renameCategory = vi.fn(() => over.renameMethodReturn ?? undefined)
  const renameAttribute = vi.fn(() => over.renameMethodReturn ?? undefined)
  const save = vi.fn(() => over.saveReturn ?? undefined)
  const store = {
    renameCategory,
    renameAttribute,
    save,
  }
  return { store, renameCategory, renameAttribute, save }
}

beforeEach(() => {
  toastMock.mockClear()
})

describe('useInlineRename 返回结构', () => {
  it('返回恰好 6 键 editingId/editingName/setEditInputRef/startRename/confirmRename/cancelRename 无多余', () => {
    const { store } = makeFakeStore()
    const r = useInlineRename(store, 'renameCategory')
    expect(Object.keys(r).sort()).toEqual(
      ['cancelRename', 'confirmRename', 'editingId', 'editingName', 'setEditInputRef', 'startRename'].sort(),
    )
  })

  it('editingId 与 editingName 是 ref（.value 可读写、isRef 真）', () => {
    const { store } = makeFakeStore()
    const r = useInlineRename(store, 'renameCategory')
    expect(isRef(r.editingId)).toBe(true)
    expect(isRef(r.editingName)).toBe(true)
    expect(r.editingId.value).toBe(null)
    expect(r.editingName.value).toBe('')
  })

  it('startRename/confirmRename/cancelRename/setEditInputRef 均为 function', () => {
    const { store } = makeFakeStore()
    const r = useInlineRename(store, 'renameCategory')
    expect(typeof r.startRename).toBe('function')
    expect(typeof r.confirmRename).toBe('function')
    expect(typeof r.cancelRename).toBe('function')
    expect(typeof r.setEditInputRef).toBe('function')
  })
})

describe('startRename', () => {
  it('进编辑态：set editingId + editingName 同步写入入参 id/name', () => {
    const { store } = makeFakeStore()
    const { startRename, editingId, editingName } = useInlineRename(store, 'renameCategory')
    startRename({ id: 'cat-1', name: '工作' })
    expect(editingId.value).toBe('cat-1')
    expect(editingName.value).toBe('工作')
  })

  it('注入 input ref 后 nextTick 触发该 input.focus() 调一次', async () => {
    const { store } = makeFakeStore()
    const { startRename, setEditInputRef } = useInlineRename(store, 'renameCategory')
    const { el, focus } = makeFakeInput()
    setEditInputRef(el)
    expect(focus).not.toHaveBeenCalled()
    startRename({ id: 'a', name: 'b' })
    expect(focus).not.toHaveBeenCalled() // 同步刻还没 focus（nextTick 未跑）
    await nextTick()
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('未注入 input ref（null）时 startRename 不抛（nullish ? 链安全短路）', async () => {
    const { store } = makeFakeStore()
    const { startRename, setEditInputRef } = useInlineRename(store, 'renameCategory')
    setEditInputRef(null)
    let threw = false
    try {
      startRename({ id: 'a', name: 'b' })
      await nextTick()
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
  })

  it('连续两次 startRename 切换：editingId/editingName 跟随最新入参（不残留旧项）', () => {
    const { store } = makeFakeStore()
    const { startRename, editingId, editingName } = useInlineRename(store, 'renameCategory')
    startRename({ id: 'a', name: 'A' })
    startRename({ id: 'b', name: 'B' })
    expect(editingId.value).toBe('b')
    expect(editingName.value).toBe('B')
  })
})

describe('confirmRename 成功路径', () => {
  it('合法 name+id：调 store[renameMethod](id, trim后name) + store.save() + toast("已重命名") + reset editingId=null', () => {
    const { store, renameCategory, save } = makeFakeStore()
    const { startRename, confirmRename, editingId } = useInlineRename(store, 'renameCategory')
    startRename({ id: 'cat-1', name: '工作' })
    expect(editingId.value).toBe('cat-1')
    confirmRename()
    expect(renameCategory).toHaveBeenCalledTimes(1)
    // 防未来误改：renameMethod 名注入分发，非硬编码 'renameCategory'
    expect(renameCategory).toHaveBeenCalledWith('cat-1', '工作')
    expect(save).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith('已重命名')
    expect(editingId.value).toBe(null)
  })

  it('renameAttribute 注入名驱动分发：调 renameAttribute 而非 renameCategory（确认动态分发非硬编码）', () => {
    const { store, renameCategory, renameAttribute, save } = makeFakeStore()
    const { startRename, confirmRename } = useInlineRename(store, 'renameAttribute')
    startRename({ id: 'attr-9', name: '颜色' })
    confirmRename()
    expect(renameAttribute).toHaveBeenCalledWith('attr-9', '颜色')
    expect(renameCategory).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('editingName 带首尾空白：trim 后传入 store 方法（不传原始带空白名）', () => {
    const { store, renameCategory } = makeFakeStore()
    const { startRename, confirmRename } = useInlineRename(store, 'renameCategory')
    startRename({ id: 'x', name: '  标签  ' })
    confirmRename()
    expect(renameCategory).toHaveBeenCalledWith('x', '标签')
  })

  it('特殊字符 / 中文 / 含空格的 name 透传 trim 后原值（非纯字母过滤）', () => {
    const { store, renameCategory } = makeFakeStore()
    const { startRename, confirmRename } = useInlineRename(store, 'renameCategory')
    startRename({ id: 'x', name: '我的 标签 <!>' })
    confirmRename()
    expect(renameCategory).toHaveBeenCalledWith('x', '我的 标签 <!>')
  })
})

describe('confirmRename 空名/无 id 静默保护（核心防误改）', () => {
  it('空 name（trim 后空串）：不调 store[renameMethod]/save/toast 任何之一，但 reset editingId=null', () => {
    const { store, renameCategory, save } = makeFakeStore()
    const { startRename, confirmRename, editingId } = useInlineRename(store, 'renameCategory')
    startRename({ id: 'cat-1', name: '   ' }) // 纯空白 trim 后空
    confirmRename()
    // 防未来误改 if(name && editingId.value) 为 if(editingId.value)：会让空名提交 store
    expect(renameCategory).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
    expect(editingId.value).toBe(null)
  })

  it('editingName 设空串：confirm 静默不调 store/save/toast', () => {
    const { store, renameCategory, save } = makeFakeStore()
    const { startRename, confirmRename, editingName, editingId } = useInlineRename(store, 'renameCategory')
    startRename({ id: 'cat-1', name: 'hi' })
    editingName.value = ''
    confirmRename()
    expect(renameCategory).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
    expect(editingId.value).toBe(null)
  })

  it('无 editingId（null）：即使有合法 name 也静默不调 store/save/toast，editingId 保持 null', () => {
    const { store, renameCategory, save } = makeFakeStore()
    const { confirmRename, editingId, editingName } = useInlineRename(store, 'renameCategory')
    editingName.value = '合法名'
    expect(editingId.value).toBe(null)
    confirmRename()
    // 防未来误改 if(name && editingId.value) 为 if(name)：会让无 id 时 store[renameMethod](null, name) 抛错
    expect(renameCategory).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
    expect(editingId.value).toBe(null)
  })

  it('cancel 后再 confirm（editingId 已 null）：静默不调 store（幂等保护链）', () => {
    const { store, renameCategory } = makeFakeStore()
    const { startRename, confirmRename, cancelRename, editingName } = useInlineRename(store, 'renameCategory')
    startRename({ id: 'x', name: '原' })
    cancelRename() // 退出编辑态，editingId=null
    editingName.value = '改'
    confirmRename()
    expect(renameCategory).not.toHaveBeenCalled()
  })
})

describe('cancelRename（M12 Esc 冒泡回归护栏）', () => {
  it('带 KeyboardEvent：调 preventDefault + stopPropagation + editingId=null（M12 阻止冒泡关掉整个模态框）', () => {
    const { store } = makeFakeStore()
    const { startRename, cancelRename, editingId } = useInlineRename(store, 'renameCategory')
    startRename({ id: 'x', name: 'y' })
    expect(editingId.value).toBe('x')
    const e = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent
    cancelRename(e)
    expect((e as any).preventDefault).toHaveBeenCalledTimes(1)
    expect((e as any).stopPropagation).toHaveBeenCalledTimes(1)
    expect(editingId.value).toBe(null)
  })

  it('不带 e 入参（点取消按钮直接 cancelRename()）：不抛 + editingId=null', () => {
    const { store } = makeFakeStore()
    const { startRename, cancelRename, editingId } = useInlineRename(store, 'renameCategory')
    startRename({ id: 'x', name: 'y' })
    expect(() => cancelRename()).not.toThrow()
    expect(editingId.value).toBe(null)
  })

  it('未在编辑态（editingId 已 null）：cancel 幂等不抛、保持 null', () => {
    const { store } = makeFakeStore()
    const { cancelRename, editingId } = useInlineRename(store, 'renameCategory')
    expect(editingId.value).toBe(null)
    const e = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent
    expect(() => cancelRename(e)).not.toThrow()
    expect(editingId.value).toBe(null)
  })

  it('带 e 但 mocks 未被 setup：preventDefault/stopPropagation 真触发（M12 冒泡回归真断言非空 mock）', () => {
    const { store } = makeFakeStore()
    const { startRename, cancelRename } = useInlineRename(store, 'renameCategory')
    startRename({ id: 'p', name: 'q' })
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const e = { preventDefault, stopPropagation } as unknown as KeyboardEvent
    cancelRename(e)
    // 防 M12 关键回归：未来若误删 if(e){preventDefault;stopPropagation}
    // 此两断言会失败——直锁 Esc 不冒泡关掉整个模态框的关键用户可见行为
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalledTimes(1)
  })
})

describe('setEditInputRef', () => {
  it('传入假 input 后可被 startRename 经 nextTick focus', async () => {
    const { store } = makeFakeStore()
    const { setEditInputRef, startRename } = useInlineRename(store, 'renameCategory')
    const { el, focus } = makeFakeInput()
    setEditInputRef(el)
    startRename({ id: 'a', name: 'b' })
    await nextTick()
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('重新注入 ref 覆盖旧值：第二次 startRename 聚焦新 input 不被旧 input 截', async () => {
    const { store } = makeFakeStore()
    const { setEditInputRef, startRename } = useInlineRename(store, 'renameCategory')
    const { focus: oldFocus } = makeFakeInput()
    setEditInputRef({ focus: oldFocus } as unknown as HTMLInputElement)
    const { focus: newFocus } = makeFakeInput()
    setEditInputRef({ focus: newFocus } as unknown as HTMLInputElement)
    startRename({ id: 'a', name: 'b' })
    await nextTick()
    expect(newFocus).toHaveBeenCalledTimes(1)
    expect(oldFocus).not.toHaveBeenCalled()
  })
})
