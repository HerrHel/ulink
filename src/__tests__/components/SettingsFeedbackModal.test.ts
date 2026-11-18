/**
 * SettingsFeedbackModal（自 SettingsPanel 拆出）：打开即重置表单 + 后台预解 PoW、
 * 字数不足时禁用发送并说明原因、复制邮箱后关闭。
 * 打开入口在「关于与帮助」页（只负责置 uiStore.overlays.feedback = true），
 * 重置职责随弹窗独立成组件迁入弹窗自身的 watch。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const cb = vi.hoisted(() => ({
  isCloudBaseBackend: vi.fn(() => true),
  getCbFnBase: vi.fn(() => 'https://test.ulink.ren'),
  invokeCbFunction: vi.fn(async () => ({ data: { ok: true }, error: null })),
  getCbAuth: vi.fn(() => null),
}))
vi.mock('../../lib/cloudbase.js', () => cb)
const pow = vi.hoisted(() => ({ solvePow: vi.fn(async () => 'nonce-1') }))
vi.mock('../../lib/pow.js', () => pow)
const toastMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/toast.js', () => ({ toast: toastMock, showConfirm: vi.fn() }))

import SettingsFeedbackModal from '../../components/shell/settings/SettingsFeedbackModal.vue'
import { useUIStore } from '../../stores/ui.js'

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await nextTick() }

function mountModal() {
  return mount(SettingsFeedbackModal, {
    attachTo: document.body,
    global: { stubs: { Teleport: true, Transition: false } },
  })
}

describe('SettingsFeedbackModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({ pow: { challenge: 'c', difficulty: 1, exp: 0, jti: 'j', signature: 's' } }),
    })) as unknown as typeof fetch
  })

  it('打开时清空上一次的输入，并后台预解 PoW', async () => {
    const ui = useUIStore()
    const w = mountModal()
    ui.overlays.feedback = true
    await flush()
    const textarea = w.find('textarea')
    await textarea.setValue('上一次没发出去的内容')
    await w.find('#lv-feedback-contact').setValue('me@example.com')

    // 关闭后再打开：表单应被重置
    ui.overlays.feedback = false
    await flush()
    ui.overlays.feedback = true
    await flush()
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    expect((w.find('#lv-feedback-contact').element as HTMLInputElement).value).toBe('')
    // 每次打开都预取挑战并解题（GET /send-feedback → solvePow）
    expect(globalThis.fetch).toHaveBeenCalledWith('https://test.ulink.ren/send-feedback', { method: 'GET' })
    expect(pow.solvePow).toHaveBeenCalled()
    w.unmount()
  })

  it('字数不足 5 个：发送按钮禁用并提示原因；达到后可发送', async () => {
    const ui = useUIStore()
    const w = mountModal()
    ui.overlays.feedback = true
    await flush()
    const send = () => w.find('.modal-foot .btn-primary')

    await w.find('textarea').setValue('太短')
    expect(send().attributes('disabled')).toBeDefined()
    expect(w.find('.sp-feedback-short').exists()).toBe(true)

    await w.find('textarea').setValue('这是一条足够长的反馈')
    expect(send().attributes('disabled')).toBeUndefined()
    expect(w.find('.sp-feedback-short').exists()).toBe(false)
    w.unmount()
  })

  it('提交成功：调用 send-feedback 云函数，提示成功并关闭弹窗', async () => {
    const ui = useUIStore()
    const w = mountModal()
    ui.overlays.feedback = true
    await flush()
    await w.find('textarea').setValue('这是一条足够长的反馈')
    await w.find('.modal-foot .btn-primary').trigger('click')
    await flush()
    expect(cb.invokeCbFunction).toHaveBeenCalledWith('send-feedback', expect.objectContaining({
      message: '这是一条足够长的反馈',
    }))
    expect(toastMock).toHaveBeenCalledWith(expect.any(String), true)
    expect(ui.overlays.feedback).toBe(false)
    w.unmount()
  })
})
