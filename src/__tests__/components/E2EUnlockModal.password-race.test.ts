/**
 * 真 bug 复现：E2EUnlockModal onUnlock/onReset/onChangePw 密码路径跨取消 await 窗口 orphan emit 竞态
 *
 * 与 bug1（同模块 onBiometricUnlock 跨取消竞态，commit 803f16be 已修）同根漏守——
 * bug1 commit 803f16be 仅加模块级 _bioGen 代际 token 守 onBiometricUnlock 路径，
 * onUnlock/onReset/onChangePw 密码路径完全未触及（_bioGen 仅供 onBiometricUnlock 两个 await guard 读，
 * 密码路径顶部仍只 `if (loading.value) return` bool 守门）。
 *
 * 触发链（三个密码路径同根）：
 *   - onUnlock: `await e2e.unlock(pw)` PBKDF2 + GCM，移动端 ~200-400ms。
 *   - onReset: `await e2e.resetWithRecoveryKey(rk, newPw)` 含 3×PBKDF2 + 重写 canary +（登录用户）
 *     Supabase upsert 网络往返，弱网数秒 awaiting 窗口。
 *   - onChangePw: `await e2e.changeMasterPassword(oldPw, newPw)` 含 3×PBKDF2 + 重加密本机全部数据 +
 *     推新 key 密文到云，弱网数秒 awaiting 窗口，且成功后还会 `await showConfirm(...)` 弹确认框。
 *
 * 此 await 期间用户点弹窗遮罩 @click.self="onCancel" → emit('close') → App.vue 置
 *   store.modals.e2eUnlock=false → watch 负向分支 reset loading.value=false → **恰好绕过密码路径顶部
 *   `if (loading.value) return` 守门**。await 完成后 `if (ok) { ...; emit('unlocked'); emit('close') }`
 *   仍触发 → App.vue onE2EUnlocked 跑 drainPendingUnlock(true)+debouncedSync，取消语义被吞
 *   （key 进内存 + 敏感字段推云）。
 *
 * 修复（代际 token 对齐 onBiometricUnlock 的 _bioGen 模式）：模块级 _pwGen，onUnlock/onReset/onChangePw
 *   开头 `const localGen = ++_pwGen`，await 后各判 `if (localGen !== _pwGen) { loading.value=false; return }`
 *   让旧 await 的 emit 短路；watch 负向分支同步推进 `_pwGen++` 让关闭时在途链失效。
 *
 * 三个密码路径各配 1 例复现测，红绿门验证 stash 源码（删 _pwGen 守门）后应 emit('unlocked') 触发证复现。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const unlockMock = vi.hoisted(() => vi.fn())
const resetWithRecoveryKeyMock = vi.hoisted(() => vi.fn())
const changeMasterPasswordMock = vi.hoisted(() => vi.fn())
const isBiometricEnrolledMock = vi.hoisted(() => vi.fn())
const isBiometricAvailableMock = vi.hoisted(() => vi.fn())
const showConfirmMock = vi.hoisted(() => vi.fn())

// mock useE2E：返 enrolled=false / available=false 关闭自动指纹链，让密码路径无干扰独占
vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({
    isE2EEnabled: { value: true },
    isUnlocked: { value: false },
    isBiometricEnrolled: isBiometricEnrolledMock,
    cloudCanaryStale: { value: false },
    isBiometricAvailable: isBiometricAvailableMock,
    unlockWithBiometric: vi.fn(),
    unlock: unlockMock,
    resetWithRecoveryKey: resetWithRecoveryKeyMock,
    changeMasterPassword: changeMasterPasswordMock,
  }),
}))

vi.mock('../../config/icons.js', () => ({
  I: { password: '<svg/>', lock: '<svg/>', eye: '<svg/>', eyeOff: '<svg/>' },
}))

// onChangePw 成功后 await showConfirm（cloudCanaryStale=true 时才走，测中默认 false 不触发，仅 stub）
vi.mock('../../lib/toast.js', () => ({
  showConfirm: showConfirmMock,
}))

import E2EUnlockModal from '../../components/modals/E2EUnlockModal.vue'

function mountComp(initialMode: 'unlock' | 'reset' | 'changePw' = 'unlock') {
  return mount(E2EUnlockModal, {
    props: { open: false, initialMode },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  unlockMock.mockReset()
  resetWithRecoveryKeyMock.mockReset()
  changeMasterPasswordMock.mockReset()
  isBiometricEnrolledMock.mockReset()
  isBiometricAvailableMock.mockReset()
  showConfirmMock.mockReset()
  // 关闭指纹可用，避免 watch 正向分支 nextTick 起自动指纹链干扰密码路径测
  isBiometricEnrolledMock.mockReturnValue({ value: false })
  isBiometricAvailableMock.mockReturnValue(false)
})

async function flushAfterResolve() {
  await nextTick()
  await nextTick()
  await nextTick()
  await nextTick()
}

describe('E2EUnlockModal onUnlock 密码路径跨取消 await 窗口 orphan emit 竞态', () => {
  it('取消后 unlock 后续 resolve → emit(unlocked) 不应触发（代际 token 短路）', async () => {
    const w = mountComp('unlock')
    unlockMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      ;(unlockMock as any)._resolve = resolve
    }))

    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    expect(w.vm.mode).toBe('unlock')

    w.vm.masterPw = 'e2e-master-pw-123'
    await nextTick()
    const submitBtn = w.find('[data-testid="lv-e2e-unlock-submit"]')
    expect(submitBtn.attributes('disabled')).toBeFalsy()
    await submitBtn.trigger('click')
    await nextTick()
    expect(unlockMock).toHaveBeenCalledWith('e2e-master-pw-123')

    // await unlock 挂起期间用户点遮罩取消 → open=false → watch 负向分支推进 _pwGen
    await w.setProps({ open: false })
    await nextTick()
    await nextTick()

    const resolve = (unlockMock as any)._resolve as (v: boolean) => void
    resolve(true)
    await flushAfterResolve()

    // 修复后：watch 负向分支已推进 _pwGen → onUnlock 的 localGen 失效 → 短路 → 不 emit('unlocked')
    expect(w.emitted('unlocked'), '取消后 emit(unlocked) 不应触发').toBeFalsy()

    w.unmount()
  })

  it('基线：未取消时 unlock 成功 → emit(unlocked) 正常触发（守门不误伤正常路径）', async () => {
    const w = mountComp('unlock')
    unlockMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      ;(unlockMock as any)._resolve = resolve
    }))

    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    w.vm.masterPw = 'e2e-master-pw-123'
    await nextTick()
    const submitBtn = w.find('[data-testid="lv-e2e-unlock-submit"]')
    await submitBtn.trigger('click')
    await nextTick()

    expect(w.props('open')).toBe(true)

    const resolve = (unlockMock as any)._resolve as (v: boolean) => void
    resolve(true)
    await flushAfterResolve()

    expect(w.emitted('unlocked'), '未取消时 emit(unlocked) 应触发').toBeTruthy()
    expect(unlockMock, '未取消时 unlock 应被调').toHaveBeenCalledWith('e2e-master-pw-123')

    w.unmount()
  })
})

describe('E2EUnlockModal onReset 重置路径跨取消 await 窗口 orphan emit 竞态', () => {
  it('取消后 resetWithRecoveryKey 后续 resolve → emit(unlocked) 不应触发', async () => {
    const w = mountComp('reset')
    resetWithRecoveryKeyMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      ;(resetWithRecoveryKeyMock as any)._resolve = resolve
    }))

    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    expect(w.vm.mode).toBe('reset')

    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'new-pw-12345'
    w.vm.newPw2 = 'new-pw-12345'
    await nextTick()
    expect(w.vm.canReset, '前置满足后 canReset 应为 true').toBe(true)

    const buttons = w.findAll('button')
    const resetBtn = buttons.find((b) => /重置主密码/.test(b.text()))
    expect(resetBtn, '应找到重置按钮').toBeTruthy()
    await resetBtn!.trigger('click')
    await nextTick()
    expect(resetWithRecoveryKeyMock).toHaveBeenCalled()

    // await reset 含云端 upsert 弱网数秒，期间用户点遮罩取消
    await w.setProps({ open: false })
    await nextTick()
    await nextTick()

    const resolve = (resetWithRecoveryKeyMock as any)._resolve as (v: boolean) => void
    resolve(true)
    await flushAfterResolve()

    expect(w.emitted('unlocked'), '取消后 emit(unlocked) 不应触发').toBeFalsy()
    w.unmount()
  })
})

describe('E2EUnlockModal onChangePw 修改主密码路径跨取消 await 窗口 orphan emit 竞态', () => {
  it('取消后 changeMasterPassword 后续 resolve → emit(unlocked) 不应触发（含 showConfirm 不应被调）', async () => {
    // changePw 模式 + alreadyUnlocked=true（已解密状态改主密码，无需 oldPw）
    const w = mountComp('changePw')
    // 让 alreadyUnlocked=true 跳过 oldPw 前置；mock useE2E isUnlocked.value=false 需改这里：
    // alreadyUnlocked 读 e2e.isUnlocked.value——测中初始 false。需要 oldPw 满足 canChangePw。
    w.vm.oldPw = 'current-master-pw'
    w.vm.newPw = 'new-pw-12345'
    w.vm.newPw2 = 'new-pw-12345'
    await nextTick()

    changeMasterPasswordMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      ;(changeMasterPasswordMock as any)._resolve = resolve
    }))

    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    expect(w.vm.mode).toBe('changePw')

    // 重设 oldPw，因为 watch 正向分支没重置复现模式；这里 mode 仍是 changePw
    w.vm.oldPw = 'current-master-pw'
    w.vm.newPw = 'new-pw-12345'
    w.vm.newPw2 = 'new-pw-12345'
    await nextTick()
    expect(w.vm.canChangePw, '前置满足后 canChangePw 应为 true').toBe(true)

    const buttons = w.findAll('button')
    const changeBtn = buttons.find((b) => /修改主密码/.test(b.text()))
    expect(changeBtn, '应找到修改主密码按钮').toBeTruthy()
    await changeBtn!.trigger('click')
    await nextTick()
    expect(changeMasterPasswordMock).toHaveBeenCalled()

    // await changeMasterPassword 含重加密本机全部数据 + 推云新 key 密文，弱网数秒
    await w.setProps({ open: false })
    await nextTick()
    await nextTick()

    const resolve = (changeMasterPasswordMock as any)._resolve as (v: boolean) => void
    resolve(true)
    await flushAfterResolve()

    // 修复后：watch 负向分支已推进 _pwGen → onChangePw 的 localGen 失效 → 短路 →
    //   不 emit('unlocked')，也不应触发 cloudCanaryStale 分支的 showConfirm
    expect(w.emitted('unlocked'), '取消后 emit(unlocked) 不应触发').toBeFalsy()
    expect(showConfirmMock, '取消后不应触发 cloudCanaryStale 分支的 showConfirm').not.toHaveBeenCalled()

    w.unmount()
  })
})
