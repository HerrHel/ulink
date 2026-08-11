/**
 * 真 bug 复现：VaultUnlockModal onUnlock/onReset 密码路径跨取消 await 窗口 orphan emit 竞态
 *
 * 与 bug1（同模块 onBiometricUnlock 跨取消竞态，commit 803f16be 已修）同根漏守——
 * bug1 commit 803f16be 仅加模块级 _bioGen 代际 token 守 onBiometricUnlock 路径，
 * onUnlock/onReset 密码路径完全未触及（grep 确认 _bioGen 仅供 onBiometricUnlock 两个 await guard 读，
 * onUnlock/onReset 顶部仍只 `if (loading.value) return` bool 守门）。
 *
 * 触发链：用户进「私密空间入口」→ 输入保险柜主密码 → 点「解锁」→ onUnlock `await vault.unlockVault(pw)`
 *   （PBKDF2 600000 + GCM verifyCanary，移动端 ~200-400ms；onReset 经 resetVaultWithRecoveryKey 更长
 *   含 3×PBKDF2 + generateCanary + _saveCanaryData Supabase upsert，弱网秒数 awaiting 窗口）。
 *   此 await 期间用户点弹窗遮罩 @click.self="onCancel" → emit('close') → App.vue 置
 *   store.modals.vaultUnlock=false → watch 负向分支 reset loading.value=false → **恰好绕过
 *   onUnlock/onReset 顶部 `if (loading.value) return` 守门**。await 完成后 `if (ok) { emit('unlocked');
 *   emit('close') }` 仍触发 → App.vue onVaultUnlocked 跑 switchSpace('vault') 把用户强行切进私密空间，
 *   主动取消的语义被吞。
 *
 * 修复（代际 token 对齐 onBiometricUnlock 的 _bioGen 模式）：模块级 _pwGen，onUnlock/onReset 开头
 *   `const localGen = ++_pwGen`，await 后各判 `if (localGen !== _pwGen) { loading.value=false; return }`
 *   让旧 await 的 emit 短路；watch 负向分支同步推进 `_pwGen++` 让关闭时在途链失效。
 *
 * 此测锁定 race 复现：mount open=true（默认 unlock 模式）→ 点解锁按钮触发 onUnlock → unlockVault 挂在
 *   controllablePromise → open=false 取消（推进 _pwGen）→ 后续 resolve unlockVault 返 true →
 *   断言 emit('unlocked') 未触发（修复后短路）。红绿门：stash 源码（删 _pwGen 守门）后应
 *   emit('unlocked') 触发证明复现了 bug。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// unlockVaultMock / resetVaultWithRecoveryKeyMock 返回可手动 resolve 的 Promise，模拟 await 窗口
const unlockVaultMock = vi.hoisted(() => vi.fn())
const resetVaultWithRecoveryKeyMock = vi.hoisted(() => vi.fn())
const isVaultBiometricEnrolledMock = vi.hoisted(() => vi.fn())
const isBiometricAvailableMock = vi.hoisted(() => vi.fn())
const generateRecoveryKeyMock = vi.hoisted(() => vi.fn())

// mock useVault：enrolled=false / available=false 关闭自动指纹链（让密码路径无干扰独占）
vi.mock('../../composables/domain/useVault.js', () => ({
  useVault: () => ({
    isVaultBiometricEnrolled: isVaultBiometricEnrolledMock,
    isBiometricAvailable: isBiometricAvailableMock,
    isVaultEnabled: { value: true },
    isVaultUnlocked: { value: false },
    unlockWithBiometric: vi.fn(),
    unlockVault: unlockVaultMock,
    resetVaultWithRecoveryKey: resetVaultWithRecoveryKeyMock,
    generateRecoveryKey: generateRecoveryKeyMock,
  }),
}))

vi.mock('../../config/icons.js', () => ({
  I: { password: '<svg/>', lock: '<svg/>', eye: '<svg/>', eyeOff: '<svg/>' },
}))

import VaultUnlockModal from '../../components/modals/VaultUnlockModal.vue'

function mountComp() {
  return mount(VaultUnlockModal, {
    props: { open: false },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  unlockVaultMock.mockReset()
  resetVaultWithRecoveryKeyMock.mockReset()
  isVaultBiometricEnrolledMock.mockReset()
  isBiometricAvailableMock.mockReset()
  generateRecoveryKeyMock.mockReset()
  // 关闭指纹可用，避免 watch 正向分支 nextTick 起自动指纹链干扰密码路径测
  isVaultBiometricEnrolledMock.mockReturnValue({ value: false })
  isBiometricAvailableMock.mockReturnValue(false)
})

async function flushAfterResolve() {
  // await unlockVault resolve 后需多次 nextTick 让 await 链回到 onUnlock emit 路径
  await nextTick()
  await nextTick()
  await nextTick()
  await nextTick()
}

describe('VaultUnlockModal onUnlock 密码路径跨取消 await 窗口 orphan emit 竞态', () => {
  it('取消后 unlockVault 后续 resolve → emit(unlocked) 不应触发（代际 token 短路）', async () => {
    const w = mountComp()
    // 起一个 controllable Promise 模拟 await unlockVault 秒级窗口
    unlockVaultMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      ;(unlockVaultMock as any)._resolve = resolve
    }))

    // 1. 打开弹窗进入解锁模式
    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    expect(w.vm.mode).toBe('unlock')

    // 2. 用户填主密码 + 点解锁按钮触发 onUnlock
    w.vm.masterPw = 'vault-master-pw-123'
    await nextTick()
    const submitBtn = w.find('[data-testid="lv-vault-unlock-submit"]')
    expect(submitBtn.attributes('disabled')).toBeFalsy()
    await submitBtn.trigger('click')
    await nextTick()
    expect(unlockVaultMock).toHaveBeenCalledWith('vault-master-pw-123')

    // 3. await unlockVault 挂起期间用户点遮罩取消 → open=false → watch 负向分支推进 _pwGen
    await w.setProps({ open: false })
    await nextTick()
    await nextTick()

    // 4. 后续 unlockVault resolve 成功（模拟弱网数秒后 server 通过）
    const resolve = (unlockVaultMock as any)._resolve as (v: boolean) => void
    resolve(true)
    await flushAfterResolve()

    // 修复后：watch 负向分支已推进 _pwGen → onUnlock 的 localGen 失效 →
    // await unlockVault 后 `if (localGen !== _pwGen) return` 短路 → 不 emit('unlocked')
    // 红绿门：stash 源码（删 _pwGen 守门）后此处应为 truthy（emit 触发）证明复现 bug
    expect(w.emitted('unlocked'), '取消后 emit(unlocked) 不应触发').toBeFalsy()

    w.unmount()
  })

  it('基线：未取消时 unlockVault 成功 → emit(unlocked) 正常触发（守门不误伤正常路径）', async () => {
    const w = mountComp()
    unlockVaultMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      ;(unlockVaultMock as any)._resolve = resolve
    }))

    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    w.vm.masterPw = 'vault-master-pw-123'
    await nextTick()
    const submitBtn = w.find('[data-testid="lv-vault-unlock-submit"]')
    await submitBtn.trigger('click')
    await nextTick()

    // 不取消——open 保持 true，_pwGen 不前进
    expect(w.props('open')).toBe(true)

    const resolve = (unlockVaultMock as any)._resolve as (v: boolean) => void
    resolve(true)
    await flushAfterResolve()

    // 正常路径：unlockVault 成功 → emit('unlocked') 应触发
    expect(w.emitted('unlocked'), '未取消时 emit(unlocked) 应触发').toBeTruthy()
    expect(unlockVaultMock, '未取消时 unlockVault 应被调').toHaveBeenCalledWith('vault-master-pw-123')

    w.unmount()
  })
})

describe('VaultUnlockModal onReset 重置路径跨取消 await 窗口 orphan emit 竞态', () => {
  it('取消后 resetVaultWithRecoveryKey 后续 resolve → emit(unlocked) 不应触发（重置路径同根漏守对称修）', async () => {
    const w = mountComp()
    resetVaultWithRecoveryKeyMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      ;(resetVaultWithRecoveryKeyMock as any)._resolve = resolve
    }))

    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    expect(w.vm.mode).toBe('unlock')

    // 用户切到 reset 模式（点「忘记保险柜主密码？使用 Recovery Key 重置」）
    await w.vm.enterReset()
    await nextTick()
    expect(w.vm.mode).toBe('reset')

    // 填 React Recovery Key + 新密码（满足 re recoveryKeyEmpty/newPasswordLength/newPasswordMismatch 三前置）
    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'new-pw-12345'
    w.vm.newPw2 = 'new-pw-12345'
    await nextTick()

    // canReset computed 应为 true → 重置按钮可点
    expect(w.vm.canReset, '前置满足后 canReset 应为 true').toBe(true)

    // 点「重置主密码」按钮触发 onReset
    const buttons = w.findAll('button')
    const resetBtn = buttons.find((b) => /重置主密码/.test(b.text()))
    expect(resetBtn, '应找到重置按钮').toBeTruthy()
    await resetBtn!.trigger('click')
    await nextTick()
    expect(resetVaultWithRecoveryKeyMock).toHaveBeenCalled()

    // await resetVaultWithRecoveryKey 挂起期间（弱网云端 upsert 秒级）用户点遮罩取消 → open=false
    await w.setProps({ open: false })
    await nextTick()
    await nextTick()

    // 后续 resolve 成功（模拟弱网数秒后 server 通过）
    const resolve = (resetVaultWithRecoveryKeyMock as any)._resolve as (v: boolean) => void
    resolve(true)
    await flushAfterResolve()

    // 修复后：watch 负向分支已推进 _pwGen → onReset 的 localGen 失效 → 短路 → 不 emit('unlocked')
    expect(w.emitted('unlocked'), '取消后 emit(unlocked) 不应触发').toBeFalsy()

    w.unmount()
  })
})
