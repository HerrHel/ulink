/**
 * VaultUnlockModal 正文分支补测（补覆盖率轮：基线 60% Stmts / 44.44% Funcs → 目标 ≥85%）。
 * 既有 password-race.test.ts / biometric-race.test.ts 只锁了 onUnlock/onReset/onBiometricUnlock
 * 跨取消 await 窗口的 orphan emit 竞态守门（双层 _pwGen / _bioGen 代际 token），未触达
 * 正文函数级分支：enterReset/enterUnlock/onCancel/onUnlock 成功 emit + false error/onReset
 * 三校验早退 + 成功 emit + 失败 error/onBiometricUnlock pw=null 静默取消 + 解锁失败 error/
 * canReset computed 各 false 分支/watch 正负向/bioLoading+loading 守门/模板双色切换提示。
 *
 * 锁定真实行为契约（非刷行数）：
 *  - enterReset：mode 'unlock'→'reset' + 清 error ｜ enterUnlock：反向
 *  - onCancel：emit('close')
 *  - onUnlock 成功 → emit('unlocked')+emit('close') ｜ 失败 → error='保险柜主密码错误'
 *  - onReset 三校验早退（recoveryKey 空 / newPw<8 / 不一致）+ 成功 emit('unlocked')+emit('close')
 *    + 失败 error='Recovery Key 错误或重置失败' + loading 守门重入
 *  - onBiometricUnlock pw=null 静默取消（不设 error + bioLoading 复位）｜ unlockVault true emit
 *    ｜ unlockVault false error='指纹解锁失败，请手动输入保险柜主密码'
 *  - canReset computed：rk 空 / newPw<8 / 不一致 三 false 分支 + 全满足 true
 *  - watch 正向：open 真设 bioAvailable = isBiometricAvailable()；enrolled+available 自动弹指纹
 *    ｜ 负向：reset 全 ref + 推进 _bioGen/_pwGen
 *  - template：unlock/reset 双 mode 渲染 + newPw「还需 N 位」动态提示
 *
 * 实现注：reset 模式「重置主密码」按钮 :disabled=\"!canReset || loading\"，canReset false
 * 时 disabled，jsdom trigger('click') 静默不触发——故 onReset 测函数逻辑统一调 w.vm.onReset()
 * 绕过按钮态。onUnlock 提交按钮 :disabled=\"!masterPw\"：masterPw 空时 disabled。改 vm.masterPw
 * 后 trigger 应可点（满足 unlock 正常路径），但统一取 w.vm.onUnlock() 路径测函数逻辑一致性。
 *
 * 桩沿用 password-race.test.ts 同构骨架（vi.hoisted 可控 + vi.mock useVault/icons），新增
 * validatePwResetInput mock（onReset 调三校验函数）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const unlockVaultMock = vi.hoisted(() => vi.fn())
const resetVaultWithRecoveryKeyMock = vi.hoisted(() => vi.fn())
const unlockWithBiometricMock = vi.hoisted(() => vi.fn())
const isBiometricAvailableMock = vi.hoisted(() => vi.fn())
const generateRecoveryKeyMock = vi.hoisted(() => vi.fn())
const recoveryKeyEmptyErrorMock = vi.hoisted(() => vi.fn())
const newPasswordLengthErrorMock = vi.hoisted(() => vi.fn())
const newPasswordMismatchErrorMock = vi.hoisted(() => vi.fn())
// enrolled 用 hoisted 可变 ref-like 对象（源码 `vault.isVaultBiometricEnrolled.value` 直接读属性不调 ()，
// 故 mock fn 的 .value 是 undefined —— 必须用真对象让 .value 生效，beforeEach 通过 setEnrolled 切换值）
const enrolledState = vi.hoisted(() => ({ value: false }))

// 默认 mock useVault：enrolled=enrolledState.value（自动指纹链守门） / available=false 关闭自动链
vi.mock('../../composables/domain/useVault.js', () => ({
  useVault: () => ({
    // 源码 `vault.isVaultBiometricEnrolled.value` 直接取属性不调()，故返真 ref-like 对象
    isVaultBiometricEnrolled: enrolledState,
    isBiometricAvailable: isBiometricAvailableMock,
    isVaultEnabled: { value: true },
    isVaultUnlocked: { value: false },
    unlockWithBiometric: unlockWithBiometricMock,
    unlockVault: unlockVaultMock,
    resetVaultWithRecoveryKey: resetVaultWithRecoveryKeyMock,
    generateRecoveryKey: generateRecoveryKeyMock,
  }),
}))

// 默认 mock validatePwResetInput：默认返 null（全部通过），各测按需覆返错误文案
vi.mock('../../components/modals/validatePwResetInput.js', () => ({
  recoveryKeyEmptyError: recoveryKeyEmptyErrorMock,
  newPasswordLengthError: newPasswordLengthErrorMock,
  newPasswordMismatchError: newPasswordMismatchErrorMock,
}))

vi.mock('../../config/icons.js', () => ({
  I: {
    password: '<svg/>',
    lock: '<svg/>',
    eye: '<svg/>',
    eyeOff: '<svg/>',
  },
}))

import VaultUnlockModal from '../../components/modals/VaultUnlockModal.vue'

function mountComp(open = false) {
  return mount(VaultUnlockModal, {
    props: { open },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  unlockVaultMock.mockReset()
  resetVaultWithRecoveryKeyMock.mockReset()
  unlockWithBiometricMock.mockReset()
  isBiometricAvailableMock.mockReset()
  generateRecoveryKeyMock.mockReset()
  recoveryKeyEmptyErrorMock.mockReset()
  newPasswordLengthErrorMock.mockReset()
  newPasswordMismatchErrorMock.mockReset()
  // 关闭指纹自动链（让密码路径独占）；导入函数默认返 null（无错）
  enrolledState.value = false
  isBiometricAvailableMock.mockReturnValue(false)
  recoveryKeyEmptyErrorMock.mockReturnValue(null)
  newPasswordLengthErrorMock.mockReturnValue(null)
  newPasswordMismatchErrorMock.mockReturnValue(null)
})

function pendingPromise<T>(): { promise: Promise<T>, resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

async function flush() {
  await nextTick(); await nextTick(); await nextTick(); await nextTick()
}

describe('VaultUnlockModal mode 切换 + onCancel', () => {
  it('enterReset：mode unlock→reset + 清 error', async () => {
    const w = mountComp(true)
    expect(w.vm.mode).toBe('unlock')
    w.vm.error = 'some err'
    await w.vm.enterReset()
    expect(w.vm.mode).toBe('reset')
    expect(w.vm.error).toBe('')
    w.unmount()
  })

  it('enterUnlock：mode reset→unlock + 清 error', async () => {
    const w = mountComp(true)
    w.vm.mode = 'reset'
    w.vm.error = 'some err'
    await w.vm.enterUnlock()
    expect(w.vm.mode).toBe('unlock')
    expect(w.vm.error).toBe('')
    w.unmount()
  })

  it('onCancel：emit("close")', async () => {
    const w = mountComp(true)
    await w.vm.onCancel()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('模板：unlock 模式渲染「忘记保险柜主密码」链接 点击 enterReset', async () => {
    const w = mountComp(true)
    await nextTick()
    expect(w.html()).toContain('忘记保险柜主密码')
    const link = w.findAll('.e2e-link').find((el) => /忘记保险柜主密码/.test(el.text()))
    expect(link).toBeTruthy()
    await link!.trigger('click')
    await nextTick()
    expect(w.vm.mode).toBe('reset')
    w.unmount()
  })

  it('模板：reset 模式渲染「← 返回解锁」链接 点击 enterUnlock', async () => {
    const w = mountComp(true)
    await w.vm.enterReset()
    await nextTick()
    expect(w.html()).toContain('返回解锁')
    const link = w.findAll('.e2e-link').find((el) => /返回解锁/.test(el.text()))
    expect(link).toBeTruthy()
    await link!.trigger('click')
    await nextTick()
    expect(w.vm.mode).toBe('unlock')
    w.unmount()
  })

  it('模板：reset 模式 newPw 0<len<8 显示「还需 N 位」动态提示', async () => {
    const w = mountComp(true)
    await w.vm.enterReset()
    w.vm.newPw = 'abc' // len 3
    await nextTick()
    expect(w.html()).toContain('还需 5 位')
    w.unmount()
  })
})

describe('VaultUnlockModal onUnlock 成功/失败两端', () => {
  it('unlockVault 成功 → emit("unlocked")+emit("close")', async () => {
    unlockVaultMock.mockResolvedValue(true)
    const w = mountComp(true)
    w.vm.masterPw = 'vault-master-pw-123'
    await nextTick()
    await w.vm.onUnlock()
    await flush()
    expect(unlockVaultMock).toHaveBeenCalledWith('vault-master-pw-123')
    expect(w.emitted('unlocked')).toBeTruthy()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('unlockVault 失败 → error="保险柜主密码错误" + 不 emit unlocked', async () => {
    unlockVaultMock.mockResolvedValue(false)
    const w = mountComp(true)
    w.vm.masterPw = 'vault-master-pw-123'
    await nextTick()
    await w.vm.onUnlock()
    await flush()
    expect(w.vm.error).toBe('保险柜主密码错误')
    expect(w.emitted('unlocked')).toBeFalsy()
    w.unmount()
  })

  it('loading 守门：已在 loading → 重复 onUnlock 跳过不二次 unlockVault', async () => {
    const { promise, resolve } = pendingPromise<boolean>()
    unlockVaultMock.mockReturnValueOnce(promise)
    const w = mountComp(true)
    w.vm.masterPw = 'vault-master-pw-123'
    await nextTick()
    // 不 await 让挂起：onUnlock 首段同步设 loading=true + 调 unlockVault
    void w.vm.onUnlock()
    await nextTick()
    expect(unlockVaultMock).toHaveBeenCalledTimes(1)
    // 重入：loading 已 true
    await w.vm.onUnlock()
    await nextTick()
    expect(unlockVaultMock).toHaveBeenCalledTimes(1) // 守门跳过
    resolve(true)
    await flush()
    w.unmount()
  })
})

describe('VaultUnlockModal onReset 三校验早退 + 成功/失败两端', () => {
  it('recoveryKey 空 → recoveryKeyEmptyError 返错 → 设 error 不调 resetVaultWithRecoveryKey', async () => {
    recoveryKeyEmptyErrorMock.mockReturnValue('请输入 Recovery Key')
    const w = mountComp(true)
    await w.vm.enterReset()
    await w.vm.onReset()
    expect(w.vm.error).toBe('请输入 Recovery Key')
    expect(resetVaultWithRecoveryKeyMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('newPw<8 → newPasswordLengthError 返错 → 设 error 不调 reset', async () => {
    newPasswordLengthErrorMock.mockReturnValue('新主密码至少 8 位')
    const w = mountComp(true)
    await w.vm.enterReset()
    await w.vm.onReset()
    expect(w.vm.error).toBe('新主密码至少 8 位')
    expect(resetVaultWithRecoveryKeyMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('两次密码不一致 → newPasswordMismatchError 返错 → 设 error 不调 reset', async () => {
    newPasswordMismatchErrorMock.mockReturnValue('两次新主密码不一致')
    const w = mountComp(true)
    await w.vm.enterReset()
    await w.vm.onReset()
    expect(w.vm.error).toBe('两次新主密码不一致')
    expect(resetVaultWithRecoveryKeyMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('resetVaultWithRecoveryKey 成功 → emit("unlocked")+emit("close")', async () => {
    resetVaultWithRecoveryKeyMock.mockResolvedValue(true)
    const w = mountComp(true)
    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'new-pw-12345'
    w.vm.newPw2 = 'new-pw-12345'
    await w.vm.enterReset()
    await nextTick()
    await w.vm.onReset()
    await flush()
    expect(resetVaultWithRecoveryKeyMock).toHaveBeenCalledWith('XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', 'new-pw-12345')
    expect(w.emitted('unlocked')).toBeTruthy()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('resetVaultWithRecoveryKey 失败 → error="Recovery Key 错误或重置失败" + 不 emit unlocked', async () => {
    resetVaultWithRecoveryKeyMock.mockResolvedValue(false)
    const w = mountComp(true)
    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'new-pw-12345'
    w.vm.newPw2 = 'new-pw-12345'
    await w.vm.enterReset()
    await nextTick()
    await w.vm.onReset()
    await flush()
    expect(w.vm.error).toBe('Recovery Key 错误或重置失败')
    expect(w.emitted('unlocked')).toBeFalsy()
    w.unmount()
  })

  it('loading 守门：已在 loading → 重复 onReset 跳过不二次 reset', async () => {
    const { promise, resolve } = pendingPromise<boolean>()
    // 校验全过（默认 null）→ 走到 await resetVaultWithRecoveryKey
    resetVaultWithRecoveryKeyMock.mockReturnValueOnce(promise)
    const w = mountComp(true)
    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'new-pw-12345'
    w.vm.newPw2 = 'new-pw-12345'
    await w.vm.enterReset()
    await nextTick()
    void w.vm.onReset()
    await nextTick()
    expect(resetVaultWithRecoveryKeyMock).toHaveBeenCalledTimes(1)
    // 重入：loading 已 true
    await w.vm.onReset()
    await nextTick()
    expect(resetVaultWithRecoveryKeyMock).toHaveBeenCalledTimes(1)
    resolve(true)
    await flush()
    w.unmount()
  })

  it('reset 模式「重置主密码」按钮在 canReset 不满足时 disabled', async () => {
    const w = mountComp(true)
    await w.vm.enterReset()
    await nextTick()
    // 不填任何字段 → canReset false → 按钮 disabled
    const resetBtn = w.findAll('button').find((b) => /重置主密码/.test(b.text()))
    expect(resetBtn).toBeTruthy()
    expect(resetBtn!.attributes('disabled')).toBeDefined()
    w.unmount()
  })
})

describe('VaultUnlockModal canReset computed 守门', () => {
  it('全满足（rk 非空 + newPw≥8 + 一致）→ canReset true', async () => {
    const w = mountComp(true)
    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'new-pw-12345'
    w.vm.newPw2 = 'new-pw-12345'
    await nextTick()
    expect(w.vm.canReset).toBe(true)
    w.unmount()
  })

  it('recoveryKey trim 后空 → canReset false', async () => {
    const w = mountComp(true)
    w.vm.recoveryKey = '   '
    w.vm.newPw = 'new-pw-12345'
    w.vm.newPw2 = 'new-pw-12345'
    await nextTick()
    expect(w.vm.canReset).toBe(false)
    w.unmount()
  })

  it('newPw<8 → canReset false', async () => {
    const w = mountComp(true)
    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'short'
    w.vm.newPw2 = 'short'
    await nextTick()
    expect(w.vm.canReset).toBe(false)
    w.unmount()
  })

  it('两次 newPw 不一致 → canReset false', async () => {
    const w = mountComp(true)
    w.vm.recoveryKey = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    w.vm.newPw = 'new-pw-12345'
    w.vm.newPw2 = 'new-pw-99999'
    await nextTick()
    expect(w.vm.canReset).toBe(false)
    w.unmount()
  })
})

describe('VaultUnlockModal onBiometricUnlock 底层 pw/unlock 分支', () => {
  it('pw=null（用户取消）→ bioLoading 复位 + 不设 error + 不 emit unlocked', async () => {
    unlockWithBiometricMock.mockResolvedValue(null)
    const w = mountComp(true)
    await w.vm.onBiometricUnlock()
    await flush()
    expect(w.vm.bioLoading).toBe(false)
    expect(w.vm.error).toBe('') // 取消静默不设 error
    expect(w.emitted('unlocked')).toBeFalsy()
    w.unmount()
  })

  it('pwGot + unlockVault 失败 → error="指纹解锁失败，请手动输入保险柜主密码"', async () => {
    unlockWithBiometricMock.mockResolvedValue('bio-derived-pw')
    unlockVaultMock.mockResolvedValue(false)
    const w = mountComp(true)
    await w.vm.onBiometricUnlock()
    await flush()
    expect(unlockVaultMock).toHaveBeenCalledWith('bio-derived-pw')
    expect(w.vm.error).toBe('指纹解锁失败，请手动输入保险柜主密码')
    expect(w.emitted('unlocked')).toBeFalsy()
    w.unmount()
  })

  it('bioLoading 守门：已在 bioLoading → 重复 onBiometricUnlock 跳过不二次 unlockWithBiometric', async () => {
    const { promise, resolve } = pendingPromise<string | null>()
    unlockWithBiometricMock.mockReturnValueOnce(promise)
    const w = mountComp(true)
    void w.vm.onBiometricUnlock()
    await nextTick()
    expect(unlockWithBiometricMock).toHaveBeenCalledTimes(1)
    // 重入：bioLoading 已 true
    await w.vm.onBiometricUnlock()
    await nextTick()
    expect(unlockWithBiometricMock).toHaveBeenCalledTimes(1)
    resolve(null)
    await flush()
    w.unmount()
  })

  it('loading 守门：onUnlock 进行中 → onBiometricUnlock 跳过', async () => {
    const { promise, resolve } = pendingPromise<boolean>()
    unlockVaultMock.mockReturnValueOnce(promise)
    const w = mountComp(true)
    w.vm.masterPw = 'vault-master-pw-123'
    await nextTick()
    void w.vm.onUnlock()
    await nextTick()
    // loading 已 true 调 onBiometricUnlock → 顶部 `if (bioLoading || loading) return`
    await w.vm.onBiometricUnlock()
    await nextTick()
    expect(unlockWithBiometricMock).not.toHaveBeenCalled()
    resolve(true)
    await flush()
    w.unmount()
  })
})

describe('VaultUnlockModal watch 正向/负向分支', () => {
  it('open 由 false→true → bioAvailable = isBiometricAvailable() 当前值', async () => {
    isBiometricAvailableMock.mockReturnValue(true)
    const w = mountComp(false)
    expect(w.vm.bioAvailable).toBe(false)
    await w.setProps({ open: true })
    await nextTick()
    await nextTick()
    expect(isBiometricAvailableMock).toHaveBeenCalled()
    expect(w.vm.bioAvailable).toBe(true)
    w.unmount()
  })

  it('已录入指纹且 available → watch 正向自动触发 onBiometricUnlock', async () => {
    enrolledState.value = true
    isBiometricAvailableMock.mockReturnValue(true)
    unlockWithBiometricMock.mockResolvedValue('bio-pw')
    unlockVaultMock.mockResolvedValue(true)
    const w = mountComp(false)
    await w.setProps({ open: true })
    await flush()
    await flush() // watch nextTick 调 onBiometricUnlock 自身 await unlockWithBiometric 需更多 tick
    await flush()
    // watch nextTick 后自动 onBiometricUnlock → unlockWithBiometric 调
    expect(unlockWithBiometricMock).toHaveBeenCalled()
    w.unmount()
  })

  it('open 由 true→false → reset 全 ref + 推进 _bioGen/_pwGen 不副作用已设立 async', async () => {
    const { promise, resolve } = pendingPromise<boolean>()
    unlockVaultMock.mockReturnValueOnce(promise)
    const w = mountComp(true)
    w.vm.masterPw = 'vault-master-pw-123'
    await nextTick()
    void w.vm.onUnlock()
    await nextTick()
    // await 挂起期间 open=false → watch 负向 reset + 推进 _pwGen
    await w.setProps({ open: false })
    await nextTick()
    await nextTick()
    expect(w.vm.masterPw).toBe('')
    expect(w.vm.loading).toBe(false) // 负向 reset
    expect(w.vm.error).toBe('')
    expect(w.vm.mode).toBe('unlock')
    // 后续 resolve（模拟弱网数秒后 server 通过）→ _pwGen 已推进 → short-circuit 不 emit
    resolve(true)
    await flush()
    expect(w.emitted('unlocked'), '取消后 emit(unlocked) 不应触发').toBeFalsy()
    w.unmount()
  })
})
