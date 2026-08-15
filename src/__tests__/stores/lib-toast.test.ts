import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useToastStore } from '../../stores/toast.js'
import { toast, toastWithUndo, showConfirm, showChoice } from '../../lib/toast.js'

// showChoice 默认 cancelLabel='取消' 转发契约的 options 样本
const CHOICE_OPTS = [
  { id: 'keep', label: '保留' },
  { id: 'delete', label: '删除', description: '彻底移除' },
]

describe('lib/toast（Pinia 已初始化）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('toast 委托给 store', () => {
    toast('测试消息')
    const store = useToastStore()
    expect(store.toasts.length).toBe(1)
    expect(store.toasts[0].msg).toContain('测试消息')
  })

  it('toastWithUndo 委托给 store', () => {
    toastWithUndo('已删除', () => {})
    const store = useToastStore()
    expect(store.undoToast).not.toBeNull()
  })

  it('showConfirm 返回 Promise', async () => {
    const promise = showConfirm('确认？')
    const store = useToastStore()
    store.resolveConfirm(true)
    await expect(promise).resolves.toBe(true)
  })

  // showChoice 成功委托：转发 message/options/默认 cancelLabel 至 store.choiceDialog，
  // 返回的 Promise 由 store.resolveChoice(optionId) resolve。锁住 showChoice 委托转发契约。
  it('showChoice 委托给 store 并转发默认 cancelLabel', async () => {
    const promise = showChoice('选择操作', CHOICE_OPTS)
    const store = useToastStore()
    expect(store.choiceOpen).toBe(true)
    expect(store.choiceDialog).not.toBeNull()
    expect(store.choiceDialog!.message).toBe('选择操作')
    // options 经 Pinia reactive unwrap 后非原始引用，逐项断言内容
    expect(store.choiceDialog!.options).toHaveLength(CHOICE_OPTS.length)
    expect(store.choiceDialog!.options[0].id).toBe('keep')
    expect(store.choiceDialog!.options[1].id).toBe('delete')
    expect(store.choiceDialog!.options[1].description).toBe('彻底移除')
    // 未传 cancelLabel 时转发默认值 '取消'（锁 default-arg 分支）
    expect(store.choiceDialog!.cancelLabel).toBe('取消')
    store.resolveChoice('delete')
    await expect(promise).resolves.toBe('delete')
  })

  // showChoice 显式传 cancelLabel 转发（覆盖非默认参数路径）。
  it('showChoice 委托给 store 并转发显式 cancelLabel', async () => {
    const promise = showChoice('选择操作', CHOICE_OPTS, '不要了')
    const store = useToastStore()
    expect(store.choiceDialog!.cancelLabel).toBe('不要了')
    // 取消 resolve null
    store.resolveChoice(null)
    await expect(promise).resolves.toBeNull()
  })

  // showChoice 已有挂起时先取消旧 choice（store 内 _choiceResolve(null) 旧 resolver），
  // 新 showChoice 接管 choiceOpen。锁 showChoice 重入不交叉契约。
  it('showChoice 重入时旧挂起 Promise 先 resolve null', async () => {
    const oldP = showChoice('第一个', CHOICE_OPTS)
    const newP = showChoice('第二个', CHOICE_OPTS)
    // 旧应被取消（resolve null）
    await expect(oldP).resolves.toBeNull()
    const store = useToastStore()
    expect(store.choiceDialog!.message).toBe('第二个')
    store.resolveChoice('keep')
    await expect(newP).resolves.toBe('keep')
  })
})

// M24：独立 describe，不 setActivePinia，才能测到 catch 降级路径
describe('lib/toast（Pinia 未初始化）', () => {
  afterEach(() => {
    // 避免污染同文件后续/并行用例：恢复可用 Pinia
    setActivePinia(createPinia())
  })

  it('toast / toastWithUndo / showConfirm / showChoice 静默不抛', async () => {
    // 显式清掉 active pinia（beforeEach 未初始化）
    setActivePinia(undefined as unknown as ReturnType<typeof createPinia>)
    expect(() => toast('测试')).not.toThrow()
    expect(() => toastWithUndo('撤销', () => {})).not.toThrow()
    await expect(showConfirm('确认？')).resolves.toBe(false)
    // showChoice catch 降级返 Promise<null> 不抛（Pinia 未初始化安全降级契约）
    await expect(showChoice('选择', CHOICE_OPTS)).resolves.toBeNull()
  })
})
