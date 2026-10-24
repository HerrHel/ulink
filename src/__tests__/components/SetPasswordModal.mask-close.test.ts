/**
 * SetPasswordModal — 遮罩关闭防误关回归
 *
 * 现象：在弹窗内按住鼠标、滑到遮罩上松开，弹窗被关掉，已填的验证码/密码全丢。
 * 根因：遮罩用裸 `@click.self`。mousedown 落在弹窗内、mouseup 落在遮罩上时，
 * click 事件的 target 是两者最近的共同祖先（遮罩），`.self` 判定照样成立。
 * 修法与 BookmarkModal 等一致：统一走 useMaskClose（mousedown 记录起点）。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const authState = {
  userEmail: 'test@example.com',
  authError: null as string | null,
  sendCooldownRemaining: () => 0,
  sendPasswordSetupCode: vi.fn(),
  setPasswordWithCode: vi.fn(),
}
const uiState = { modals: { setPassword: true } }

vi.mock('../../composables/domain/useAuth.js', () => ({ useAuth: () => authState }))
vi.mock('../../stores/ui.js', () => ({ useUIStore: () => uiState }))
vi.mock('../../lib/toast.js', () => ({ toast: vi.fn() }))

import SetPasswordModal from '../../components/modals/SetPasswordModal.vue'

describe('SetPasswordModal — 遮罩关闭防误关', () => {
  it('按下与松开都在遮罩上 → 关闭', async () => {
    const w = mount(SetPasswordModal, { props: { open: true } })
    const mask = w.find('.modal-mask')
    await mask.trigger('mousedown')
    await mask.trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('在弹窗内按下、滑到遮罩上松开 → 不关闭', async () => {
    const w = mount(SetPasswordModal, { props: { open: true } })
    const mask = w.find('.modal-mask')
    // mousedown 落在 .modal 内部，click 冒泡到遮罩：不算「点击外部」
    await w.find('.modal').trigger('mousedown')
    await mask.trigger('click')
    expect(w.emitted('close')).toBeFalsy()
    w.unmount()
  })

  it('点关闭按钮 → 关闭', async () => {
    const w = mount(SetPasswordModal, { props: { open: true } })
    await w.find('.modal-close').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })
})
