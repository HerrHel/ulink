/**
 * #40（ConfirmModal 部分）：多层弹窗下焦点可逃到背景，而 Enter 在 document
 * capture 阶段无条件 resolveConfirm(true)，会误确认危险删除。
 * 修复后 Enter 仅当焦点仍在本 confirm 弹窗内才确认。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import ConfirmModal from '../../components/modals/ConfirmModal.vue'
import { useToastStore } from '../../stores/toast.js'

vi.mock('../../composables/ui/useMaskClose.js', () => ({
  useMaskClose: () => ({ onMaskMouseDown: vi.fn(), onMaskClick: vi.fn() }),
}))

describe('ConfirmModal Enter 焦点归属（#40）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('焦点在本 confirm 弹窗内时 Enter 确认', async () => {
    const wrapper = mount(ConfirmModal, { attachTo: document.body })
    const store = useToastStore()
    const spy = vi.spyOn(store, 'resolveConfirm')
    store.confirmOpen = true
    await nextTick()
    await flushPromises()
    const btn = wrapper.find('.confirm-foot .btn-danger')
    ;(btn.element as HTMLElement).focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(spy).toHaveBeenCalledWith(true)
    wrapper.unmount()
  })

  it('焦点逃到背景时 Enter 不确认危险删除', async () => {
    const wrapper = mount(ConfirmModal, { attachTo: document.body })
    const store = useToastStore()
    const spy = vi.spyOn(store, 'resolveConfirm')
    store.confirmOpen = true
    await nextTick()
    await flushPromises()
    // 覆盖 activeElement 到背景 body，模拟多层弹窗焦点逃逸
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => document.body })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(spy).not.toHaveBeenCalledWith(true)
    delete (document as any).activeElement
    wrapper.unmount()
  })
})
