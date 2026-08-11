/**
 * 真 bug 复现：E2ESetupModal onComplete setup 路径跨取消 await 窗口竞态（层一组件守门）
 *
 * 与 VaultSetupModal 完全同构（board 第二十四轮漏报的孪生）：
 * onComplete `await e2e.setupMasterPassword()`（含重加密本机全部数据 + 推新 key 密文到云，
 * 弱网秒级 awaiting 窗口）期间用户点遮罩取消 → watch 负向分支 reset loading.value=false 绕过
 * 顶部 `if (loading.value) return` 守门 → await resolve 后 `step.value = 3` 仍 push（modal 已关
 * CSS 隐藏下不可见）。层一守门：模块级 _setupGen 代际 token 短路 step=3。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const setupMasterPasswordMock = vi.hoisted(() => vi.fn())
const generateRecoveryKeyMock = vi.hoisted(() => vi.fn())
const isBiometricAvailableMock = vi.hoisted(() => vi.fn())

vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({
    setupMasterPassword: setupMasterPasswordMock,
    generateRecoveryKey: generateRecoveryKeyMock,
    isBiometricAvailable: isBiometricAvailableMock,
    hasEncryptedData: () => ({ value: false }),
    enrollBiometric: vi.fn(),
  }),
}))

vi.mock('../../config/icons.js', () => ({
  I: { password: '<svg/>', lock: '<svg/>', eye: '<svg/>', eyeOff: '<svg/>', check: '<svg/>', download: '<svg/>' },
}))

import E2ESetupModal from '../../components/modals/E2ESetupModal.vue'

function mountComp() {
  return mount(E2ESetupModal, {
    props: { open: false },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  setupMasterPasswordMock.mockReset()
  generateRecoveryKeyMock.mockReset()
  isBiometricAvailableMock.mockReset()
  generateRecoveryKeyMock.mockReturnValue('XXXX-XXXX-XXXX-XXXX')
  isBiometricAvailableMock.mockReturnValue(false)
})

async function flushAfterResolve() {
  await nextTick()
  await nextTick()
  await nextTick()
  await nextTick()
}

describe('E2ESetupModal onComplete setup 路径跨取消 await 窗口竞态（层一守门）', () => {
  it('取消后 setupMasterPassword 后续 resolve → step 不应推 3（代际 token 短路假成功页）', async () => {
    const w = mountComp()
    setupMasterPasswordMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      ;(setupMasterPasswordMock as any)._resolve = resolve
    }))

    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    expect(w.vm.step).toBe(1)

    w.vm.masterPw = 'master-pw-12345'
    w.vm.masterPw2 = 'master-pw-12345'
    await nextTick()
    await w.find('[data-testid="lv-e2e-setup-next"]').trigger('click')
    await nextTick()
    await nextTick()
    expect(w.vm.step).toBe(2)
    expect(generateRecoveryKeyMock).toHaveBeenCalled()

    w.vm.saved = true
    await nextTick()

    const confirmBtn = w.find('[data-testid="lv-e2e-setup-confirm"]')
    expect(confirmBtn.attributes('disabled')).toBeFalsy()
    await confirmBtn.trigger('click')
    await nextTick()
    expect(setupMasterPasswordMock).toHaveBeenCalled()

    // await 挂起期间用户点遮罩取消 → open=false → watch 负向分支推进 _setupGen
    await w.setProps({ open: false })
    await nextTick()
    await nextTick()

    const resolve = (setupMasterPasswordMock as any)._resolve as (v: boolean) => void
    resolve(true)
    await flushAfterResolve()

    // 修复后：watch 负向分支已推进 _setupGen → onComplete localGen 失效 → 短路 → step 不推 3
    //（watch 负向分支已把 step reset 回 1）。红绿门：stash 源码（删 _setupGen 守门）后
    // step 应变 3 证明复现 bug
    expect(w.vm.step, '取消后 step 不应推 3（假成功页被短路）').not.toBe(3)

    w.unmount()
  })

  it('基线：未取消时 setupMasterPassword 成功 → step 正常推 3（守门不误伤正常路径）', async () => {
    const w = mountComp()
    setupMasterPasswordMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      ;(setupMasterPasswordMock as any)._resolve = resolve
    }))

    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    w.vm.masterPw = 'master-pw-12345'
    w.vm.masterPw2 = 'master-pw-12345'
    await nextTick()
    await w.find('[data-testid="lv-e2e-setup-next"]').trigger('click')
    await nextTick()
    await nextTick()
    w.vm.saved = true
    await nextTick()
    await w.find('[data-testid="lv-e2e-setup-confirm"]').trigger('click')
    await nextTick()

    expect(w.props('open')).toBe(true)

    const resolve = (setupMasterPasswordMock as any)._resolve as (v: boolean) => void
    resolve(true)
    await flushAfterResolve()

    expect(w.vm.step, '未取消时 step 应推 3').toBe(3)

    w.unmount()
  })
})
