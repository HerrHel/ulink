/**
 * E2EUnlockModal.vue 分支补测 — 补 password-race / validatePwReset 两测未触达的分支行：
 *   Uncovered 248-253（onReset 成功 emit + 失败 error）、274-316（onChangePw cloudCanaryStale
 *   showConfirm + 成功 emit + 失败 error、alreadyUnlocked 跳 oldPw 校验、onCancel、
 *   onBiometricUnlock 全函数：成功 emit / 指纹取消静默 / 指纹失败 error / 双 await gen 守门 /
 *   入口 bioLoading+loading 守门），并锁三态模板渲染分支（unlock/reset/changePw）、
 *   生物识别块显隐、动态「还需 N 位」提示、enterReset/enterUnlock mode 切换清 error。
 *
 * 桩沿用 password-race.test.ts 同构骨架（vi.hoisted + useE2E mock + 可控 Promise 挂起）。
 * 纯锁真实行为分支契约，非刷行数；每测注明锁住的分支。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// —— hoisted mock，跨测可控 ——
const unlockMock = vi.hoisted(() => vi.fn())
const resetWithRecoveryKeyMock = vi.hoisted(() => vi.fn())
const changeMasterPasswordMock = vi.hoisted(() => vi.fn())
const unlockWithBiometricMock = vi.hoisted(() => vi.fn())
// isBiometricEnrolled 在源码是 ref-like（直接 .value 读），用普通对象桩非 mock fn
const isBiometricEnrolledRef = vi.hoisted(() => ({ value: false }))
const isUnlockedRef = vi.hoisted(() => ({ value: false }))
const cloudCanaryStaleRef = vi.hoisted(() => ({ value: false }))
const isBiometricAvailableMock = vi.hoisted(() => vi.fn())
const showConfirmMock = vi.hoisted(() => vi.fn())

vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({
    isE2EEnabled: { value: true },
    isUnlocked: isUnlockedRef,
    isBiometricEnrolled: isBiometricEnrolledRef,
    cloudCanaryStale: cloudCanaryStaleRef,
    isBiometricAvailable: isBiometricAvailableMock,
    unlockWithBiometric: unlockWithBiometricMock,
    unlock: unlockMock,
    resetWithRecoveryKey: resetWithRecoveryKeyMock,
    changeMasterPassword: changeMasterPasswordMock,
  }),
}))

vi.mock('../../config/icons.js', () => ({
  I: { password: '<svg/>', lock: '<svg/>', eye: '<svg/>', eyeOff: '<svg/>' },
}))

vi.mock('../../lib/toast.js', () => ({
  showConfirm: showConfirmMock,
}))

import E2EUnlockModal from '../../components/modals/E2EUnlockModal.vue'

function mountComp(initialMode: 'unlock' | 'reset' | 'changePw' = 'unlock', open: boolean = false) {
  return mount(E2EUnlockModal, {
    props: { open, initialMode },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  unlockMock.mockReset()
  resetWithRecoveryKeyMock.mockReset()
  changeMasterPasswordMock.mockReset()
  unlockWithBiometricMock.mockReset()
  isBiometricAvailableMock.mockReset()
  showConfirmMock.mockReset()
  // 默认关闭指纹，避免 watch 正向分支 nextTick 起自动指纹链干扰密码路径测
  isBiometricEnrolledRef.value = false
  isUnlockedRef.value = false
  cloudCanaryStaleRef.value = false
  isBiometricAvailableMock.mockReturnValue(false)
})

async function flush() {
  await nextTick()
  await nextTick()
  await nextTick()
  await nextTick()
}

// —— 可控挂起 Promise 工具：返回 resolve 句柄供测手动推进（宽松类型供 bio/unlock 通用）——
function controllable(): { p: Promise<any>; resolve: (v: any) => void } {
  let resolve!: (v: any) => void
  const p = new Promise<any>((r) => { resolve = r })
  return { p: p as Promise<boolean>, resolve }
}

// ============================================================================
// 渲染分支：三态模板 + 生物识别块显隐 + 动态提示
// ============================================================================

describe('E2EUnlockModal 三态模板渲染分支', () => {
  it('unlock 模式：渲染密码输入 + 解锁按钮 disabled 随 masterPw 联动 + 无 reset/changePw 块', async () => {
    const w = mountComp('unlock', true)
    await flush()
    expect(w.vm.mode).toBe('unlock')
    // 解锁插桩在
    expect(w.find('[data-testid="lv-e2e-unlock-password"]').exists()).toBe(true)
    const submit = w.find('[data-testid="lv-e2e-unlock-submit"]')
    expect(submit.exists()).toBe(true)
    // 空 masterPw → 解锁按钮 disabled
    expect(submit.attributes('disabled')).toBeDefined()
    // 填入后解除 disabled（锁 canReset/canUnlock 联动契约）
    w.vm.masterPw = 'pw123'
    await nextTick()
    expect(submit.attributes('disabled')).toBeFalsy()
    // unlock 模式无 reset 块的 Recovery Key 输入
    expect(w.find('[data-testid="lv-e2e-changepw-old"]').exists()).toBe(false)
    w.unmount()
  })

  it('reset 模式：渲染 Recovery Key + 新密码 + 确认 + 重置按钮 disabled/canReset 联动', async () => {
    const w = mountComp('reset', true)
    await flush()
    expect(w.vm.mode).toBe('reset')
    expect(w.vm.canReset).toBe(false)
    // 重置按钮默认 disabled
    const resetBtn = w.findAll('button').find((b) => /重置主密码/.test(b.text()))!
    expect(resetBtn.attributes('disabled')).toBeDefined()
    // 填齐三字段 → canReset true → 按钮启用
    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw1234'
    await nextTick()
    expect(w.vm.canReset).toBe(true)
    expect(resetBtn.attributes('disabled')).toBeFalsy()
    w.unmount()
  })

  it('changePw 模式：未解锁渲染旧密码输入，已解锁跳过旧密码只渲染新密码块', async () => {
    // 未解锁：需旧密码
    isUnlockedRef.value = false
    const w = mountComp('changePw', true)
    await flush()
    expect(w.vm.mode).toBe('changePw')
    expect(w.find('[data-testid="lv-e2e-changepw-old"]').exists()).toBe(true)
    expect(w.vm.canChangePw).toBe(false)
    w.unmount()

    // 已解锁：旧密码块不渲染 + alreadyUnlocked 走跳 oldPw 校验路径
    isUnlockedRef.value = true
    const w2 = mountComp('changePw', true)
    await flush()
    expect(w2.find('[data-testid="lv-e2e-changepw-old"]').exists()).toBe(false)
    expect(w2.vm.alreadyUnlocked).toBe(true)
    // alreadyUnlocked + 新密码达下界 + 一致 → canChangePw true（旧密码空可）
    w2.vm.newPw = 'newpw1234'
    w2.vm.newPw2 = 'newpw1234'
    await nextTick()
    expect(w2.vm.canChangePw).toBe(true)
    w2.unmount()
  })
})

describe('E2EUnlockModal 动态「还需 N 位」提示与 error 互斥', () => {
  it('reset 模式 newPw 1-7 位 → 显示「还需 N 位」非 error', async () => {
    const w = mountComp('reset', true)
    await flush()
    w.vm.newPw = '123' // 3 位 → 还需 5
    await nextTick()
    const hint = w.findAll('.e2e-error').find((e) => /还需 5 位/.test(e.text()))
    expect(hint, '3 位应提示还需 5 位').toBeTruthy()
    w.unmount()
  })

  it('changePw 模式 newPw 5 位 → 显示「还需 3 位」', async () => {
    const w = mountComp('changePw', true)
    await flush()
    w.vm.newPw = '12345'
    await nextTick()
    const hint = w.findAll('.e2e-error').find((e) => /还需 3 位/.test(e.text()))
    expect(hint, '5 位应提示还需 3 位').toBeTruthy()
    w.unmount()
  })

  it('error 优先于动态提示：error 非空时不显示「还需 N 位」', async () => {
    const w = mountComp('reset', true)
    await flush()
    w.vm.newPw = '123'
    w.vm.error = 'Recovery Key 错误或重置失败'
    await nextTick()
    // error 块渲染（带 error 内容）
    const errs = w.findAll('.e2e-error')
    const hasErr = errs.some((e) => /Recovery Key 错误/.test(e.text()))
    expect(hasErr).toBe(true)
    // error 与「还需 N 位」互斥：不应同时有「还需 5 位」
    const hasHint = errs.some((e) => /还需 5 位/.test(e.text()))
    expect(hasHint, 'error 优先时不应同时显示动态提示').toBe(false)
    w.unmount()
  })
})

describe('E2EUnlockModal enterReset/enterUnlock mode 切换清 error', () => {
  it('enterReset 切 reset 模式并清空 error', async () => {
    const w = mountComp('unlock', true)
    await flush()
    w.vm.error = '主密码错误'
    await nextTick()
    expect(w.vm.mode).toBe('unlock')
    w.vm.enterReset()
    expect(w.vm.mode).toBe('reset')
    expect(w.vm.error).toBe('')
    w.unmount()
  })

  it('enterUnlock 切 unlock 模式并清空 error', async () => {
    const w = mountComp('reset', true)
    await flush()
    w.vm.error = 'Recovery Key 错误或重置失败'
    await nextTick()
    expect(w.vm.mode).toBe('reset')
    w.vm.enterUnlock()
    expect(w.vm.mode).toBe('unlock')
    expect(w.vm.error).toBe('')
    w.unmount()
  })
})

// ============================================================================
// onReset 成功/失败路径（248-253）
// ============================================================================

describe('E2EUnlockModal onReset 成功/失败路径', () => {
  it('reset 成功 → emit(unlocked) + emit(close)（未取消正常路径）', async () => {
    const w = mountComp('reset', true)
    await flush()
    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw1234'
    await nextTick()
    resetWithRecoveryKeyMock.mockResolvedValueOnce(true)
    const resetBtn = w.findAll('button').find((b) => /重置主密码/.test(b.text()))!
    await resetBtn.trigger('click')
    await flush()
    expect(resetWithRecoveryKeyMock).toHaveBeenCalled()
    expect(w.emitted('unlocked'), '成功应 emit unlocked').toBeTruthy()
    expect(w.emitted('close'), '成功应 emit close').toBeTruthy()
    expect(w.vm.error).toBe('')
    w.unmount()
  })

  it('reset 失败 → 设 error「Recovery Key 错误或重置失败」+ 不 emit', async () => {
    const w = mountComp('reset', true)
    await flush()
    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw1234'
    await nextTick()
    resetWithRecoveryKeyMock.mockResolvedValueOnce(false)
    const resetBtn = w.findAll('button').find((b) => /重置主密码/.test(b.text()))!
    await resetBtn.trigger('click')
    await flush()
    expect(w.vm.error).toBe('Recovery Key 错误或重置失败')
    expect(w.emitted('unlocked')).toBeFalsy()
    w.unmount()
  })

  it('reset 同步校验前置：rk 空 → recoveryKeyEmptyError 早退设 error 不调 reset', async () => {
    const w = mountComp('reset', true)
    await flush()
    // 只填新密码不填 rk；按钮因 canReset=false 而 disabled，trigger 不触发 onReset，直接调绕过
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw1234'
    await nextTick()
    w.vm.onReset()
    await nextTick()
    expect(w.vm.error).toBe('请输入 Recovery Key')
    expect(resetWithRecoveryKeyMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('reset loading 守门：重置中再点不重入', async () => {
    const w = mountComp('reset', true)
    await flush()
    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw1234'
    await nextTick()
    const { p, resolve } = controllable()
    resetWithRecoveryKeyMock.mockReturnValueOnce(p)
    const resetBtn = w.findAll('button').find((b) => /重置主密码/.test(b.text()))!
    await resetBtn.trigger('click')
    await nextTick()
    expect(w.vm.loading).toBe(true)
    // 二次点击：loading.value=true 早退
    await resetBtn.trigger('click')
    await nextTick()
    expect(resetWithRecoveryKeyMock).toHaveBeenCalledTimes(1)
    resolve(true)
    await flush()
    w.unmount()
  })
})

// ============================================================================
// onChangePw 成功 cloudCanaryStale / 失败 / alreadyUnlocked 跳 oldPw（274-289）
// ============================================================================

describe('E2EUnlockModal onChangePw 路径分支', () => {
  it('成功 + cloudCanaryStale=false → 跳过 showConfirm 直接 emit + close', async () => {
    isUnlockedRef.value = true // alreadyUnlocked 跳 oldPw
    const w = mountComp('changePw', true)
    await flush()
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw1234'
    await nextTick()
    changeMasterPasswordMock.mockResolvedValueOnce(true)
    const btn = w.findAll('button').find((b) => /修改主密码/.test(b.text()))!
    await btn.trigger('click')
    await flush()
    // alreadyUnlocked → 传 '' 作旧密码
    expect(changeMasterPasswordMock).toHaveBeenCalledWith('', 'newpw1234')
    expect(showConfirmMock, 'cloudCanaryStale=false 不弹 showConfirm').not.toHaveBeenCalled()
    expect(w.emitted('unlocked')).toBeTruthy()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('成功 + cloudCanaryStale=true → 走 showConfirm 引导用户其他设备重置再 emit', async () => {
    isUnlockedRef.value = true
    cloudCanaryStaleRef.value = true
    const w = mountComp('changePw', true)
    await flush()
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw1234'
    await nextTick()
    changeMasterPasswordMock.mockResolvedValueOnce(true)
    showConfirmMock.mockResolvedValueOnce(true)
    const btn = w.findAll('button').find((b) => /修改主密码/.test(b.text()))!
    await btn.trigger('click')
    await flush()
    expect(showConfirmMock, 'cloudCanaryStale=true 应弹 showConfirm 引导').toHaveBeenCalledTimes(1)
    expect(showConfirmMock).toHaveBeenCalledWith(expect.stringContaining('云端同步失败'))
    expect(w.emitted('unlocked'), 'showConfirm 后仍 emit unlocked').toBeTruthy()
    w.unmount()
  })

  it('失败 → 设 error「修改失败…已保持原密码」+ 不 emit + 不调 showConfirm', async () => {
    isUnlockedRef.value = true
    const w = mountComp('changePw', true)
    await flush()
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw1234'
    await nextTick()
    changeMasterPasswordMock.mockResolvedValueOnce(false)
    const btn = w.findAll('button').find((b) => /修改主密码/.test(b.text()))!
    await btn.trigger('click')
    await flush()
    expect(w.vm.error).toBe('修改失败：旧密码错误或重加密/同步异常，已保持原密码')
    expect(w.emitted('unlocked')).toBeFalsy()
    expect(showConfirmMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('未解锁 + 旧密码空 → oldPasswordEmptyError 早退设 error 不调 changeMasterPassword', async () => {
    isUnlockedRef.value = false
    const w = mountComp('changePw', true)
    await flush()
    w.vm.oldPw = ''
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw1234'
    await nextTick()
    // canChangePw 要 alreadyUnlocked || oldPw>0——oldPw 空 + 未解锁 → 按钮禁用，需直接调 onChangePw
    w.vm.onChangePw()
    await nextTick()
    expect(w.vm.error).toBe('请输入旧主密码')
    expect(changeMasterPasswordMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('密码长度前置：newPw<8 → newPasswordLengthError 早退', async () => {
    isUnlockedRef.value = true
    const w = mountComp('changePw', true)
    await flush()
    w.vm.oldPw = 'x'
    w.vm.newPw = '123'
    w.vm.newPw2 = '123'
    await nextTick()
    w.vm.onChangePw()
    await nextTick()
    expect(w.vm.error).toBe('新主密码至少 8 位')
    w.unmount()
  })

  it('不一致前置：两次新密码不等 → newPasswordMismatchError 早退', async () => {
    isUnlockedRef.value = true
    const w = mountComp('changePw', true)
    await flush()
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw9999'
    await nextTick()
    w.vm.onChangePw()
    await nextTick()
    expect(w.vm.error).toBe('两次新主密码不一致')
    w.unmount()
  })

  it('loading 守门：修改中再点不重入', async () => {
    isUnlockedRef.value = true
    const w = mountComp('changePw', true)
    await flush()
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw1234'
    await nextTick()
    const { p, resolve } = controllable()
    changeMasterPasswordMock.mockReturnValueOnce(p)
    const btn = w.findAll('button').find((b) => /修改主密码/.test(b.text()))!
    await btn.trigger('click')
    await nextTick()
    expect(w.vm.loading).toBe(true)
    await btn.trigger('click')
    await nextTick()
    expect(changeMasterPasswordMock).toHaveBeenCalledTimes(1)
    resolve(true)
    await flush()
    w.unmount()
  })
})

// ============================================================================
// onCancel（291-293）
// ============================================================================

describe('E2EUnlockModal onCancel', () => {
  it(' onCancel → emit(close)', async () => {
    const w = mountComp('unlock', true)
    await flush()
    w.vm.onCancel()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('遮罩 @click.self="onCancel" → emit(close)', async () => {
    const w = mountComp('unlock', true)
    await flush()
    // 点遮罩自身（非内部 modal）应触发 onCancel → close
    await w.find('.modal-mask').trigger('click')
    await nextTick()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })
})

// ============================================================================
// onBiometricUnlock 全函数（295-318）+ 入口守门 + 双 await gen 守门
// ============================================================================

describe('E2EUnlockModal onBiometricUnlock 分支', () => {
  it('生物识别块显隐：enrolled=true + available=true → 渲染指纹解锁按钮', async () => {
    isBiometricEnrolledRef.value = true
    isBiometricAvailableMock.mockReturnValue(true)
    unlockWithBiometricMock.mockResolvedValueOnce(null) // 防 watch 自动链挂起
    const w = mountComp('unlock', false)
    await w.setProps({ open: true })
    await flush()
    const bioBtn = w.findAll('button').find((b) => /指纹解锁/.test(b.text()))
    expect(bioBtn, '已注册+可用应渲染指纹解锁按钮').toBeTruthy()
    w.unmount()
  })

  it('watch 正向分支自动起指纹链：open=true 时 nextTick 调 onBiometricUnlock', async () => {
    isBiometricEnrolledRef.value = true
    isBiometricAvailableMock.mockReturnValue(true)
    unlockWithBiometricMock.mockResolvedValueOnce(null) // 用户取消，自动链静默退出
    const w = mountComp('unlock', false)
    await w.setProps({ open: true })
    await flush()
    expect(unlockWithBiometricMock).toHaveBeenCalled()
    w.unmount()
  })

  it('指纹成功 → unlock(pw) 成功 → emit(unlocked)+close', async () => {
    isBiometricEnrolledRef.value = true
    isBiometricAvailableMock.mockReturnValue(true)
    unlockWithBiometricMock.mockResolvedValueOnce('bio-pw')
    unlockMock.mockResolvedValueOnce(true)
    const w = mountComp('unlock', false) // open=false 避 watch 自动链干扰
    await nextTick()
    await w.vm.onBiometricUnlock()
    await flush()
    expect(unlockWithBiometricMock).toHaveBeenCalled()
    expect(unlockMock).toHaveBeenCalledWith('bio-pw')
    expect(w.emitted('unlocked'), '指纹解锁成功应 emit unlocked').toBeTruthy()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('指纹用户取消（pw=null）→ 静默，不设 error 不 emit', async () => {
    isBiometricEnrolledRef.value = true
    isBiometricAvailableMock.mockReturnValue(true)
    unlockWithBiometricMock.mockResolvedValueOnce(null)
    const w = mountComp('unlock', false)
    await nextTick()
    await w.vm.onBiometricUnlock()
    await flush()
    expect(w.vm.error, '用户取消应静默不设 error').toBe('')
    expect(w.emitted('unlocked')).toBeFalsy()
    expect(w.vm.bioLoading).toBe(false)
    w.unmount()
  })

  it('指纹得 pw 但 unlock 失败 → 设 error「指纹解锁失败，请手动输入主密码」', async () => {
    isBiometricEnrolledRef.value = true
    isBiometricAvailableMock.mockReturnValue(true)
    unlockWithBiometricMock.mockResolvedValueOnce('bio-pw')
    unlockMock.mockResolvedValueOnce(false)
    const w = mountComp('unlock', false)
    await nextTick()
    await w.vm.onBiometricUnlock()
    await flush()
    expect(w.vm.error).toBe('指纹解锁失败，请手动输入主密码')
    expect(w.emitted('unlocked')).toBeFalsy()
    expect(w.vm.bioLoading).toBe(false)
    w.unmount()
  })

  it('入口守门：bioLoading=true 时直接调不重入', async () => {
    isBiometricEnrolledRef.value = true
    isBiometricAvailableMock.mockReturnValue(true)
    const { p } = controllable()
    unlockWithBiometricMock.mockReturnValueOnce(p)
    const w = mountComp('unlock', false)
    await nextTick()
    void w.vm.onBiometricUnlock() // 不 await（内部 await 挂起阻塞测试）
    await nextTick()
    expect(w.vm.bioLoading).toBe(true)
    // 二次调：bioLoading 守门早退，不重复调
    void w.vm.onBiometricUnlock()
    await nextTick()
    expect(unlockWithBiometricMock).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('入口守门：loading=true（密码路径进行中）时不进入指纹链', async () => {
    isBiometricEnrolledRef.value = true
    isBiometricAvailableMock.mockReturnValue(true)
    const w = mountComp('unlock', false)
    await nextTick()
    w.vm.loading = true // 模拟密码路径在跑
    await w.vm.onBiometricUnlock()
    await nextTick()
    expect(unlockWithBiometricMock, 'loading=true 时应早退不调指纹').not.toHaveBeenCalled()
    w.unmount()
  })

  it('代际守门 1：指纹 await 期间用户取消（open=false 推进 _bioGen）→ 不 emit', async () => {
    // open=false→true 触发 watch 正向；初始 enrolled=false 避自动链；触发后置 true 手动起链
    isBiometricEnrolledRef.value = false
    isBiometricAvailableMock.mockReturnValue(true)
    const { p, resolve } = controllable()
    unlockWithBiometricMock.mockReturnValueOnce(p)
    const w = mountComp('unlock', false)
    await w.setProps({ open: true }) // trigger watch 正向（enrolled=false 不起自动链）
    await nextTick()
    isBiometricEnrolledRef.value = true
    // 不 await onBiometricUnlock（内部 await 挂起会阻塞测试），触发后遗症 bioLoading=true 进入挂起
    void w.vm.onBiometricUnlock()
    await nextTick()
    expect(w.vm.bioLoading).toBe(true)
    // 指纹 await 挂起期间用户点遮罩取消 → open true→false 触发 watch 负向推 _bioGen++
    await w.setProps({ open: false })
    await nextTick()
    resolve('bio-pw')
    await flush()
    // 取消后 _bioGen 已推进 → localGen 失效 → 即使后续 unlock 走成功路径仍短路
    expect(w.emitted('unlocked'), '取消后不应 emit unlocked').toBeFalsy()
    w.unmount()
  })

  it('代际守门 2：二次 await（unlock）期间用户取消 → 不 emit', async () => {
    isBiometricEnrolledRef.value = false
    isBiometricAvailableMock.mockReturnValue(true)
    const bio = controllable()
    const ulk = controllable()
    unlockWithBiometricMock.mockReturnValueOnce(bio.p)
    unlockMock.mockReturnValueOnce(ulk.p)
    const w = mountComp('unlock', false)
    await w.setProps({ open: true })
    await nextTick()
    isBiometricEnrolledRef.value = true
    void w.vm.onBiometricUnlock() // 不 await（内部 bio.p 先挂起）
    await nextTick()
    bio.resolve('bio-pw') // 指纹完 → 进 unlock（挂起）
    await nextTick()
    await nextTick()
    // unlock 挂起期间用户取消 → open true→false 触发 watch 负向推 _bioGen++
    await w.setProps({ open: false })
    await nextTick()
    ulk.resolve(true)
    await flush()
    expect(w.emitted('unlocked'), 'unlock 二次 await 期间取消后不应 emit').toBeFalsy()
    w.unmount()
  })
})

// ============================================================================
// watch 正负向分支：正向设 bioAvailable + 自动指纹链；负向 reset 全 ref + 推进 gen
// ============================================================================

describe('E2EUnlockModal watch 正负向分支', () => {
  it('watch 负向分支：open=false → reset 所有 ref + 重置 mode 到 initialMode', async () => {
    const w = mountComp('reset', true)
    await flush()
    w.vm.masterPw = 'x'
    w.vm.recoveryKey = 'y'
    w.vm.newPw = 'newpw1234'
    w.vm.newPw2 = 'newpw1234'
    w.vm.oldPw = 'o'
    w.vm.showPw = true
    w.vm.showPw2 = true
    w.vm.showOldPw = true
    w.vm.showRk = true
    w.vm.error = 'err'
    w.vm.loading = true
    w.vm.bioLoading = true
    await w.setProps({ open: false })
    await nextTick()
    expect(w.vm.masterPw).toBe('')
    expect(w.vm.recoveryKey).toBe('')
    expect(w.vm.newPw).toBe('')
    expect(w.vm.newPw2).toBe('')
    expect(w.vm.oldPw).toBe('')
    expect(w.vm.showPw).toBe(false)
    expect(w.vm.showPw2).toBe(false)
    expect(w.vm.showOldPw).toBe(false)
    expect(w.vm.showRk).toBe(false)
    expect(w.vm.error).toBe('')
    expect(w.vm.loading).toBe(false)
    expect(w.vm.bioLoading).toBe(false)
    // mode 复位回 initialMode（reset）
    expect(w.vm.mode).toBe('reset')
    w.unmount()
  })

  it('watch 正向分支：open=true → 设 bioAvailable = isBiometricAvailable() 返回值', async () => {
    isBiometricAvailableMock.mockReturnValue(true)
    const w = mountComp('unlock', false)
    await w.setProps({ open: true })
    await nextTick()
    expect(w.vm.bioAvailable).toBe(true)
    w.unmount()
  })

  it('watch 正向分支：非 unlock 模式不自动起指纹链（mode!==unlock 跳过）', async () => {
    isBiometricEnrolledRef.value = true
    isBiometricAvailableMock.mockReturnValue(true)
    unlockWithBiometricMock.mockResolvedValueOnce(null)
    const w = mountComp('reset', false) // reset 模式
    await w.setProps({ open: true })
    await flush()
    // mode===reset → 不满足 `mode.value === 'unlock'` 条件 → 不起指纹链
    expect(unlockWithBiometricMock).not.toHaveBeenCalled()
    w.unmount()
  })
})
