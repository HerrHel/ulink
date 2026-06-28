/**
 * stores/toast.test.ts — Toast/Confirm/Undo Store 测试
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useToastStore } from '../../stores/toast.js'

describe('ToastStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('show', () => {
    it('应该添加一条 toast', () => {
      const store = useToastStore()
      store.show('测试消息')
      expect(store.toasts.length).toBe(1)
      expect(store.toasts[0].id).toBeGreaterThan(0)
    })

    it('成功消息应包含 ok: true', () => {
      const store = useToastStore()
      store.show('成功', true)
      expect(store.toasts[0].ok).toBe(true)
    })

    it('失败消息应包含 ok: false', () => {
      const store = useToastStore()
      store.show('失败', false)
      expect(store.toasts[0].ok).toBe(false)
    })

    it('id 应自增', () => {
      const store = useToastStore()
      store.show('消息1')
      const id1 = store.toasts[0].id
      store.show('消息2')
      expect(store.toasts[1].id).toBe(id1 + 1)
    })

    it('超过 TOAST_FADE_MS 应开始淡出', () => {
      const store = useToastStore()
      store.show('测试')
      expect(store.toasts[0].opacity).toBe('1')
      vi.advanceTimersByTime(2400)
      expect(store.toasts[0].opacity).toBe('0')
    })

    it('超过 TOAST_REMOVE_MS 应被移除', () => {
      const store = useToastStore()
      store.show('测试')
      expect(store.toasts.length).toBe(1)
      vi.advanceTimersByTime(5000)
      expect(store.toasts.length).toBe(0)
    })

    it('多条 toast 应独立计时', () => {
      const store = useToastStore()
      store.show('消息1')
      const id1 = store.toasts[0].id
      vi.advanceTimersByTime(1000)
      store.show('消息2')
      const id2 = store.toasts[1].id
      // 消息1 在 2600ms 后被移除，消息2 在 3600ms 后被移除
      vi.advanceTimersByTime(2000)
      expect(store.toasts.find(t => t.id === id1)).toBeUndefined()
      expect(store.toasts.find(t => t.id === id2)).toBeDefined()
    })
  })

  describe('showWithUndo / dismissUndo', () => {
    it('应显示撤销 toast', () => {
      const store = useToastStore()
      store.showWithUndo('已删除', () => {})
      expect(store.undoToast).not.toBeNull()
      expect(store.undoToast!.msg).toBe('已删除')
    })

    it('undoFn 应被调用当触发撤销', () => {
      const store = useToastStore()
      const undoFn = vi.fn()
      store.showWithUndo('已删除', undoFn)
      store.undoToast!.undoFn()
      expect(undoFn).toHaveBeenCalledOnce()
    })

    it('dismissUndo 应清除撤销 toast', () => {
      const store = useToastStore()
      store.showWithUndo('已删除', () => {})
      expect(store.undoToast).not.toBeNull()
      store.dismissUndo()
      vi.advanceTimersByTime(300)
      expect(store.undoToast).toBeNull()
    })

    it('duration 过期应自动清除', () => {
      const store = useToastStore()
      store.showWithUndo('已删除', () => {}, 3000)
      expect(store.undoToast).not.toBeNull()
      vi.advanceTimersByTime(3300) // 3000ms dismiss + 300ms animation
      expect(store.undoToast).toBeNull()
    })

    it('undo 触发后不应自动清除', () => {
      const store = useToastStore()
      const undoFn = vi.fn()
      store.showWithUndo('已删除', undoFn, 6000)
      store.dismissUndo()
      vi.advanceTimersByTime(6000)
      expect(undoFn).not.toHaveBeenCalled()
      expect(store.undoToast).toBeNull()
    })
  })

  describe('showConfirm / resolveConfirm', () => {
    it('showConfirm 应打开确认框', async () => {
      const store = useToastStore()
      const promise = store.showConfirm('确认删除？')
      expect(store.confirmOpen).toBe(true)
      expect(store.confirmMessage).toBe('确认删除？')
      store.resolveConfirm(true)
      await expect(promise).resolves.toBe(true)
    })

    it('resolveConfirm(false) 应关闭确认框', async () => {
      const store = useToastStore()
      const promise = store.showConfirm('确认？')
      store.resolveConfirm(false)
      expect(store.confirmOpen).toBe(false)
      await expect(promise).resolves.toBe(false)
    })

    it('resolveConfirm 应拒绝前一个挂起的 confirm', async () => {
      const store = useToastStore()
      const p1 = store.showConfirm('第一次')
      const p2 = store.showConfirm('第二次')
      store.resolveConfirm(true)
      await expect(p1).resolves.toBe(false)
      await expect(p2).resolves.toBe(true)
      expect(store.confirmMessage).toBe('第二次')
    })

    it('onConfirmOpenChange 应拒绝未完成的 confirm', async () => {
      const store = useToastStore()
      const promise = store.showConfirm('确认？')
      store.onConfirmOpenChange(false)
      expect(store.confirmOpen).toBe(false)
      await expect(promise).resolves.toBe(false)
    })
  })
})
