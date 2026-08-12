/**
 * 真 bug 复现：VaultSetupModal onComplete setup 路径跨取消 await 窗口竞态（层一组件守门）
 *
 * 与 VaultUnlockModal._pwGen / E2EUnlockModal._bioGen 同款代际 token 模式：
 * onComplete `await vault.setupVaultPassword()`（含 _saveCanaryData 云端 upsert 弱网秒级
 * awaiting 窗口）期间用户点遮罩取消 → App.vue 置 store.modals.vaultSetup=false → watch 负向
 * 分支 reset loading.value=false **恰好绕过 onComplete 顶部 `if (loading.value) return` 守门**。
 * await resolve 后 `step.value = 3` 仍 push——modal 已 CSS 隐藏下用户看不见假成功页。
 *
 * 层一守门（本测）：模块级 _setupGen 代际 token，onComplete 开头 `const localGen = ++_setupGen`，
 * await 后 `if (localGen !== _setupGen) return` 短路 step=3；watch 负向分支 `_setupGen++`。
 * **重要边界**：此守门只消除「step=3 假成功页」可见后果，vault 写路径副作用（setEnabled/_setKey
 * 等 await resolve 后同步执行无 cancel token）组件层管不到——层二 cancel token 留人工跟进。
 *
 * 此测锁定 race 复现：mount open=true → 填密码 → 下一步（step=2）→ 勾选 saved → 点确认开启触发
 * onComplete → setupVaultPassword 挂 controllablePromise → open=false 取消（推进 _setupGen）→
 * 后续 resolve 返 true → 断言 step 仍 2（修复后短路不推 3）。红绿门：stash 源码（删 _setupGen
 * 守门）后 step 应变 3 证明复现 bug。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const setupVaultPasswordMock = vi.hoisted(() => vi.fn())
const generateRecoveryKeyMock = vi.hoisted(() => vi.fn())
const isBiometricAvailableMock = vi.hoisted(() => vi.fn())

vi.mock('../../composables/domain/useVault.js', () => ({
  useVault: () => ({
    setupVaultPassword: setupVaultPasswordMock,
    generateRecoveryKey: generateRecoveryKeyMock,
    isBiometricAvailable: isBiometricAvailableMock,
    isVaultBiometricEnrolled: () => ({ value: false }),
    enrollBiometric: vi.fn(),
    cancelSetup: vi.fn(),
  }),
}))

vi.mock('../../config/icons.js', () => ({
  I: { password: '<svg/>', lock: '<svg/>', eye: '<svg/>', eyeOff: '<svg/>', check: '<svg/>', download: '<svg/>' },
}))

import VaultSetupModal from '../../components/modals/VaultSetupModal.vue'

function mountComp() {
  return mount(VaultSetupModal, {
    props: { open: false },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  setupVaultPasswordMock.mockReset()
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

describe('VaultSetupModal onComplete setup 路径跨取消 await 窗口竞态（层一守门）', () => {
  it('取消后 setupVaultPassword 后续 resolve → step 不应推 3（代际 token 短路假成功页）', async () => {
    const w = mountComp()
    setupVaultPasswordMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      ;(setupVaultPasswordMock as any)._resolve = resolve
    }))

    // 1. 打开弹窗 → step=1
    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    expect(w.vm.step).toBe(1)

    // 2. 填主密码两遍 + 点下一步 → step=2（generateRecoveryKey mock 生成 key）
    w.vm.masterPw = 'master-pw-12345'
    w.vm.masterPw2 = 'master-pw-12345'
    await nextTick()
    const nextBtn = w.find('[data-testid="lv-vault-setup-next"]')
    await nextBtn.trigger('click')
    await nextTick()
    await nextTick()
    expect(w.vm.step).toBe(2)
    expect(generateRecoveryKeyMock).toHaveBeenCalled()

    // 3. 勾选「我已保存 Recovery Key」→ 确认按钮可点
    w.vm.saved = true
    await nextTick()

    // 4. 点「确认开启」触发 onComplete → await setupVaultPassword 挂起（弱网秒级窗口）
    const confirmBtn = w.find('[data-testid="lv-vault-setup-confirm"]')
    expect(confirmBtn.attributes('disabled')).toBeFalsy()
    await confirmBtn.trigger('click')
    await nextTick()
    expect(setupVaultPasswordMock).toHaveBeenCalled()

    // 5. await 挂起期间用户点遮罩取消 → open=false → watch 负向分支推进 _setupGen
    await w.setProps({ open: false })
    await nextTick()
    await nextTick()

    // 6. 后续 setupVaultPassword resolve 成功（模拟弱网数秒后 server 通过）
    const resolve = (setupVaultPasswordMock as any)._resolve as (v: boolean) => void
    resolve(true)
    await flushAfterResolve()

    // 修复后：watch 负向分支已推进 _setupGen → onComplete localGen 失效 → 短路 → step 不推 3
    //（watch 负向分支已把 step reset 回 1）。红绿门：stash 源码（删 _setupGen 守门）后
    // step 应变 3 证明复现 bug
    expect(w.vm.step, '取消后 step 不应推 3（假成功页被短路）').not.toBe(3)

    w.unmount()
  })

  it('基线：未取消时 setupVaultPassword 成功 → step 正常推 3（守门不误伤正常路径）', async () => {
    const w = mountComp()
    setupVaultPasswordMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      ;(setupVaultPasswordMock as any)._resolve = resolve
    }))

    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    w.vm.masterPw = 'master-pw-12345'
    w.vm.masterPw2 = 'master-pw-12345'
    await nextTick()
    await w.find('[data-testid="lv-vault-setup-next"]').trigger('click')
    await nextTick()
    await nextTick()
    w.vm.saved = true
    await nextTick()
    await w.find('[data-testid="lv-vault-setup-confirm"]').trigger('click')
    await nextTick()

    // 不取消——open 保持 true，_setupGen 不前进
    expect(w.props('open')).toBe(true)

    const resolve = (setupVaultPasswordMock as any)._resolve as (v: boolean) => void
    resolve(true)
    await flushAfterResolve()

    // 正常路径：setup 成功 → step 推 3（成功页展示）
    expect(w.vm.step, '未取消时 step 应推 3').toBe(3)

    w.unmount()
  })
})
