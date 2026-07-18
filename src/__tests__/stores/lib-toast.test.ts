import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useToastStore } from '../../stores/toast.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'

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
})

// M24：独立 describe，不 setActivePinia，才能测到 catch 降级路径
describe('lib/toast（Pinia 未初始化）', () => {
  afterEach(() => {
    // 避免污染同文件后续/并行用例：恢复可用 Pinia
    setActivePinia(createPinia())
  })

  it('toast / toastWithUndo / showConfirm 静默不抛', async () => {
    // 显式清掉 active pinia（beforeEach 未初始化）
    setActivePinia(undefined as unknown as ReturnType<typeof createPinia>)
    expect(() => toast('测试')).not.toThrow()
    expect(() => toastWithUndo('撤销', () => {})).not.toThrow()
    await expect(showConfirm('确认？')).resolves.toBe(false)
  })
})
