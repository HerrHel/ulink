/**
 * 真 bug 复现：VaultUnlockModal / E2EUnlockModal onBiometricUnlock 跨取消 await 窗口 orphan emit 竞态
 *
 * 触发链：用户已对保险柜/E2E 录入指纹，弹窗 watch(props.open) 正向分支在已录入+可用时
 *   `nextTick(() => onBiometricUnlock())` 自动起指纹链。onBiometricUnlock 内
 *   `await unlockWithBiometric()` 就是 `navigator.credentials.get` 平台模态秒级阻塞窗口。
 *   此 await 期间用户点弹窗遮罩 @click.self="onCancel" → emit('close') → App.vue 置
 *   store.modals.vaultUnlock=false（或 e2eUnlock=false）。本组件裸挂无外层 v-if（与
 *   BookmarkModal/CategoryModal 不同），关闭后实例常驻、watch 负向分支仅重置 ref 不短路
 *   在途异步。指纹后续 resolve → unlockVault → `if (ok) { emit('unlocked'); emit('close') }`
 *   仍触发 → App.vue onVaultUnlocked 跑 switchSpace('vault') 把用户强行切进私密空间，
 *   用户主动取消的语义被吞（E2E 侧则 drainPendingUnlock+debouncedSync，key 进内存）。
 *
 * 修复（代际 token 对齐 ChildBookmarkEditModal._loadGen / HistoryPanel._gen / bdPwShow._detailGen）：
 *   模块级 _bioGen，onBiometricUnlock 开头 `const localGen = ++_bioGen`，两个 await 后各判
 *   `if (localGen !== _bioGen) return` 让旧 await 的 emit 短路；watch 负向分支推进 _bioGen
 *   让关闭时在途链失效。
 *
 * 此测锁定 race 复现：open=true 起指纹链 → unlockWithBiometric 挂在 await → open=false 取消
 *   （推进 _bioGen）→ 后续 resolve unlockWithBiometric 返主密码 + unlockVault 返 true →
 *   断言 emit('unlocked') 未触发（修复后短路）。红绿门：stash 源码后应 emit('unlocked') 触发
 *   证明复现了 bug。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// unlockWithBiometric 返回可手动 resolve 的 Promise，模拟指纹平台模态 await 窗口
const unlockWithBiometricMock = vi.hoisted(() => vi.fn())
const unlockVaultMock = vi.hoisted(() => vi.fn())
const isVaultBiometricEnrolledMock = vi.hoisted(() => vi.fn())
const isBiometricAvailableMock = vi.hoisted(() => vi.fn())

// mock useVault：返固定 enrolled=true / available=true 让走自动指纹链
vi.mock('../../composables/domain/useVault.js', () => ({
  useVault: () => ({
    isVaultBiometricEnrolled: { value: true },
    isBiometricAvailable: isBiometricAvailableMock,
    isVaultEnabled: { value: true },
    isVaultUnlocked: { value: false },
    unlockWithBiometric: unlockWithBiometricMock,
    unlockVault: unlockVaultMock,
    resetVaultWithRecoveryKey: vi.fn(),
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
  unlockWithBiometricMock.mockReset()
  unlockVaultMock.mockReset()
  isVaultBiometricEnrolledMock.mockReset()
  isBiometricAvailableMock.mockReset()
  isBiometricAvailableMock.mockReturnValue(true)
})

/**
 * 驱动一次完整的 race 时序：
 * 1. open=true → watch 正向分支 nextTick 起指纹链（unlockWithBiometric 起一个 controllablePromise）
 * 2. await 期间 open=false → watch 负向分支推进 _bioGen（模拟用户点遮罩取消）
 * 3. 后续 resolve unlockWithBiometric 返主密码 + unlockVault 返 true（模拟指纹后续通过）
 * 返回 [unlockedEmittedCount]
 */
async function driveRace(w: ReturnType<typeof mountComp>) {
  // 1. 打开弹窗 → 起指纹链
  unlockWithBiometricMock.mockReturnValueOnce(new Promise<string | null>((resolve) => {
    ;(unlockWithBiometricMock as any)._resolve = resolve
  }))
  unlockVaultMock.mockResolvedValue(true)

  await w.setProps({ open: true })
  await nextTick()
  await nextTick()
  // nextTick(onBiometricUnlock) 跑起：unlockWithBiometric 已被调，挂在 await
  expect(unlockWithBiometricMock).toHaveBeenCalled()

  // 2. await 期间用户点遮罩取消 → open=false → watch 负向分支推进 _bioGen
  await w.setProps({ open: false })
  await nextTick()
  await nextTick()

  // 3. 后续指纹 resolve 返主密码（模拟平台认证器稍后通过）
  const resolve = (unlockWithBiometricMock as any)._resolve as (v: string | null) => void
  resolve('vault-master-pw')
  await nextTick()
  await nextTick()
  await nextTick()
  await nextTick()

  return w.emitted('unlocked')
}

describe('VaultUnlockModal onBiometricUnlock 跨取消 await 窗口 orphan emit 竞态', () => {
  it('取消后指纹后续 resolve → emit(unlocked) 不应触发（代际 token 短路）', async () => {
    const w = mountComp()
    const unlockedEmitted = await driveRace(w)

    // 修复后：watch 负向分支已推进 _bioGen → onBiometricUnlock 的 localGen 失效 →
    // await unlockWithBiometric 后 `if (localGen !== _bioGen) return` 短路 → 不 emit('unlocked')
    // 红绿门：stash 源码（删 _bioGen 守门）后此处应为 truthy（emit 触发）证明复现 bug
    expect(unlockedEmitted, '取消后 emit(unlocked) 不应触发').toBeFalsy()

    // unlockVault 也不应被调（短路在它之前）—— 双保险断言
    expect(unlockVaultMock, '取消后 unlockVault 不应被调').not.toHaveBeenCalled()

    w.unmount()
  })

  it('基线：未取消时指纹后续 resolve → emit(unlocked) 正常触发（守门不误伤正常路径）', async () => {
    const w = mountComp()
    unlockWithBiometricMock.mockReturnValueOnce(new Promise<string | null>((resolve) => {
      ;(unlockWithBiometricMock as any)._resolve = resolve
    }))
    unlockVaultMock.mockResolvedValue(true)

    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    expect(unlockWithBiometricMock).toHaveBeenCalled()

    // 不取消——open 保持 true，_bioGen 不前进
    const resolve = (unlockWithBiometricMock as any)._resolve as (v: string | null) => void
    resolve('vault-master-pw')
    await nextTick()
    await nextTick()
    await nextTick()
    await nextTick()

    // 正常路径：指纹通过 + unlockVault 成功 → emit('unlocked') 应触发
    expect(w.emitted('unlocked'), '未取消时 emit(unlocked) 应触发').toBeTruthy()
    expect(unlockVaultMock, '未取消时 unlockVault 应被调').toHaveBeenCalledWith('vault-master-pw')

    w.unmount()
  })

  it('取消后 unlockWithBiometric 返 null（指纹失败）→ emit(unlocked) 不触发（无副作用）', async () => {
    const w = mountComp()
    unlockWithBiometricMock.mockReturnValueOnce(new Promise<string | null>((resolve) => {
      ;(unlockWithBiometricMock as any)._resolve = resolve
    }))

    await w.setProps({ open: true })
    await nextTick()
    await nextTick()

    await w.setProps({ open: false })
    await nextTick()
    await nextTick()

    // 指纹后续返 null（失败/取消）
    const resolve = (unlockWithBiometricMock as any)._resolve as (v: string | null) => void
    resolve(null)
    await nextTick()
    await nextTick()
    await nextTick()

    // pw=null 早 return，无 emit('unlocked')；守门不应误触发副作用
    expect(w.emitted('unlocked'), '指纹返 null 后 emit(unlocked) 不应触发').toBeFalsy()
    expect(unlockVaultMock, '指纹返 null 后 unlockVault 不应被调').not.toHaveBeenCalled()

    w.unmount()
  })
})
