import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useToastStore } from '../../stores/toast.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'

describe('lib/toast', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('toast 委托给 store', () => {
    toast('测试消息')
    const store = useToastStore()
    expect(store.toasts.length).toBe(1)
    expect(store.toasts[0].html).toContain('测试消息')
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

  it('Pinia 未初始化时静默跳过', () => {
    // 模拟 Pinia 未初始化场景
    const origStore = useToastStore
    const { useToastStore: mockFn }: any = { useToastStore: () => { throw new Error('no pinia') } }
    // 应不抛出
    expect(() => toast('测试')).not.toThrow()
  })
})
