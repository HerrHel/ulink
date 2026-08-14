/**
 * E2ESetupModal 正文分支补测（补覆盖率轮：基线 66% Stmts / 29.41% Funcs → 目标 ≥85%）。
 * 既有 E2ESetupModal.race.test.ts 只锁了 onComplete 跨取消 await 竞态（层一守门），
 * 未触达 onNext（3 step 流转 + 校验）、downloadPDF、copyKey、onEnrollBiometric、legacy 警告、
 * step3 完成按钮、watch 正向分支、onComplete cancelled/false/重入/finally 各错误分支。
 *
 * 锁定真实行为契约（非刷行数）：
 *  - onNext：<8 位拒 + 不一致拒 + 成功生成 recoveryKey 推 step=2 + generateRecoveryKey 抛错降级（Error/非 Error）
 *  - downloadPDF：转发 recoveryKey 给 generateRecoveryKeyPDF
 *  - copyKey：clipboard 成功→toast true / 失败→toast false
 *  - onEnrollBiometric：成功 bioDone+toast / 失败 bioError / 抛错 catch(E message/非 E String) / finally 复位 / bioDone 重入守门
 *  - legacy：hasEncryptedData()=true 渲染警告块
 *  - step3 完成按钮 emit('close')
 *  - watch 正向 open=true 设 bioAvailable；负向 reset 全 ref + 调 cancelSetup
 *  - onComplete：loading 守门重入跳过 / ok='cancelled' 短路 / ok=false 设 error / finally 复位 loading
 *
 * 实现注：onNext 受 `:disabled="masterPw.length < 8"` 守门的「下一步」按钮在密码 <8 位时 disabled，
 * jsdom 下 trigger('click') 对 disabled button 静默不触发——故测函数逻辑统一调 w.vm.onNext() / onComplete /
 * onEnrollBiometric / copyKey 等实例方法绕过按钮态，断言 step/error/ref 反映真实行为；按钮 disabled 状态由
 * `:disabled` 表达式隐含覆盖。step3 完成按钮（无 disabled）保留 trigger 验 emit('close')。
 *
 * 沿用 race 测的同构桩骨架（vi.hoisted 可控 + vi.mock useE2E/icons），新增 recoveryKeyPDF/toast mock。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// 可控桩：useE2E 各导出 + recoveryKeyPDF + toast，每测覆 mockReturnValueOnce 注入分支
const setupMasterPasswordMock = vi.hoisted(() => vi.fn())
const generateRecoveryKeyMock = vi.hoisted(() => vi.fn())
const isBiometricAvailableMock = vi.hoisted(() => vi.fn())
const hasEncryptedDataMock = vi.hoisted(() => vi.fn())
const enrollBiometricMock = vi.hoisted(() => vi.fn())
const cancelSetupMock = vi.hoisted(() => vi.fn())
const generateRecoveryKeyPDFMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => vi.fn())

vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({
    setupMasterPassword: setupMasterPasswordMock,
    generateRecoveryKey: generateRecoveryKeyMock,
    isBiometricAvailable: isBiometricAvailableMock,
    hasEncryptedData: hasEncryptedDataMock,
    enrollBiometric: enrollBiometricMock,
    cancelSetup: cancelSetupMock,
  }),
}))

vi.mock('../../lib/recoveryKeyPDF.js', () => ({
  generateRecoveryKeyPDF: generateRecoveryKeyPDFMock,
}))

vi.mock('../../lib/toast.js', () => ({
  toast: toastMock,
}))

vi.mock('../../config/icons.js', () => ({
  I: {
    password: '<svg/>',
    lock: '<svg/>',
    eye: '<svg/>',
    eyeOff: '<svg/>',
    alert: '<svg/>',
    export: '<svg/>',
    copy: '<svg/>',
    listCheck: '<svg/>',
  },
}))

import E2ESetupModal from '../../components/modals/E2ESetupModal.vue'

function mountComp(open = false) {
  return mount(E2ESetupModal, {
    props: { open },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  setupMasterPasswordMock.mockReset()
  generateRecoveryKeyMock.mockReset()
  isBiometricAvailableMock.mockReset()
  hasEncryptedDataMock.mockReset()
  enrollBiometricMock.mockReset()
  cancelSetupMock.mockReset()
  generateRecoveryKeyPDFMock.mockReset()
  toastMock.mockReset()
  // 默认：不显示 legacy 警告 / 指纹不可用 / 生成 key 正常
  hasEncryptedDataMock.mockReturnValue(false)
  isBiometricAvailableMock.mockReturnValue(false)
  generateRecoveryKeyMock.mockReturnValue('RK-1234-5678-ABCD')
})

/** 让 await setupMasterPassword 的 controllable Promise 在测里手动 resolve */
function pendingPromise<T>(): { promise: Promise<T>, resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

async function flush() {
  // 多次 nextTick 让 await 链回到调用方
  await nextTick(); await nextTick(); await nextTick(); await nextTick()
}

/** 把组件推到 step=2（onNext 成功），返回组件实例 */
async function gotoStep2(w: ReturnType<typeof mountComp>) {
  w.vm.masterPw = 'master-pw-12345'
  w.vm.masterPw2 = 'master-pw-12345'
  await nextTick()
  await w.vm.onNext()
  await nextTick()
}

/** 把组件推到 step3（onNext + onComplete 成功），返回组件实例 */
async function gotoStep3(w: ReturnType<typeof mountComp>) {
  setupMasterPasswordMock.mockResolvedValue(true)
  await gotoStep2(w)
  w.vm.saved = true
  await nextTick()
  await w.vm.onComplete()
  await flush()
}

describe('E2ESetupModal onNext 校验与 step 流转', () => {
  it('密码 <8 位 → 设「主密码至少 8 位」error 不推 step', async () => {
    const w = mountComp(true)
    w.vm.masterPw = 'short'
    w.vm.masterPw2 = 'short'
    await nextTick()
    await w.vm.onNext()
    expect(w.vm.error).toBe('主密码至少 8 位')
    expect(w.vm.step).toBe(1) // 不推 step=2
    expect(generateRecoveryKeyMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('两次密码不一致 → 设「两次密码不一致」error 不推 step', async () => {
    const w = mountComp(true)
    w.vm.masterPw = 'master-pw-12345'
    w.vm.masterPw2 = 'master-pw-99999' // 不一致
    await nextTick()
    await w.vm.onNext()
    expect(w.vm.error).toBe('两次密码不一致')
    expect(w.vm.step).toBe(1)
    expect(generateRecoveryKeyMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('密码合法一致 → 生成 recoveryKey 推 step=2', async () => {
    const w = mountComp(true)
    await gotoStep2(w)
    expect(generateRecoveryKeyMock).toHaveBeenCalled()
    expect(w.vm.recoveryKey).toBe('RK-1234-5678-ABCD')
    expect(w.vm.step).toBe(2)
    expect(w.vm.error).toBe('')
    w.unmount()
  })

  it('generateRecoveryKey 抛 Error → catch 设「生成 Recovery Key 失败」拼接 message 不推 step', async () => {
    generateRecoveryKeyMock.mockImplementation(() => { throw new Error('rng broken') })
    const w = mountComp(true)
    w.vm.masterPw = 'master-pw-12345'
    w.vm.masterPw2 = 'master-pw-12345'
    await nextTick()
    await w.vm.onNext()
    expect(w.vm.error).toBe('生成 Recovery Key 失败：rng broken')
    expect(w.vm.step).toBe(1) // 抛错不推 step
    w.unmount()
  })

  it('generateRecoveryKey 抛非 Error → catch 用 String 兜底 desc', async () => {
    generateRecoveryKeyMock.mockImplementation(() => { throw 'string err' /* 非 Error */ })
    const w = mountComp(true)
    w.vm.masterPw = 'master-pw-12345'
    w.vm.masterPw2 = 'master-pw-12345'
    await nextTick()
    await w.vm.onNext()
    expect(w.vm.error).toBe('生成 Recovery Key 失败：string err')
    w.unmount()
  })

  it('step1「下一步」按钮在密码 <8 位时 disabled（模板表达式隐含）', async () => {
    const w = mountComp(true)
    w.vm.masterPw = 'short'
    await nextTick()
    expect(w.find('[data-testid="lv-e2e-setup-next"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })
})

describe('E2ESetupModal legacy 换设备防呆警告', () => {
  it('hasEncryptedData()=true → 渲染「检测到已有加密数据」警告块', async () => {
    hasEncryptedDataMock.mockReturnValue(true)
    const w = mountComp(true)
    await nextTick()
    expect(w.html()).toContain('检测到已有加密数据')
    w.unmount()
  })

  it('hasEncryptedData()=false → 不渲染 legacy 警告块', async () => {
    hasEncryptedDataMock.mockReturnValue(false)
    const w = mountComp(true)
    await nextTick()
    expect(w.html()).not.toContain('检测到已有加密数据')
    w.unmount()
  })
})

describe('E2ESetupModal downloadPDF', () => {
  it('点击下载 → generateRecoveryKeyPDF 收到当前 recoveryKey', async () => {
    const w = mountComp(true)
    await gotoStep2(w)
    await nextTick()
    await w.vm.downloadPDF()
    expect(generateRecoveryKeyPDFMock).toHaveBeenCalledWith('RK-1234-5678-ABCD')
    w.unmount()
  })
})

describe('E2ESetupModal copyKey', () => {
  it('clipboard 成功 → toast(ok=true) 「Recovery Key 已复制」', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const w = mountComp(true)
    await gotoStep2(w)
    await w.vm.copyKey()
    await flush()
    expect(writeText).toHaveBeenCalledWith('RK-1234-5678-ABCD')
    expect(toastMock).toHaveBeenCalledWith('Recovery Key 已复制，请妥善保存', true)
    w.unmount()
  })

  it('clipboard 失败 → toast(ok=false) 「复制失败」', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const w = mountComp(true)
    await gotoStep2(w)
    await w.vm.copyKey()
    await flush()
    expect(toastMock).toHaveBeenCalledWith('复制失败，请手动选中上方 Recovery Key 复制', false)
    w.unmount()
  })
})

describe('E2ESetupModal step2 确认开启守门 + step3 完成按钮', () => {
  it('step2 未勾选「已保存」→ 确认按钮 disabled', async () => {
    const w = mountComp(true)
    await gotoStep2(w)
    w.vm.saved = false
    await nextTick()
    expect(w.find('[data-testid="lv-e2e-setup-confirm"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('step3 完成按钮 → emit("close")', async () => {
    const w = mountComp(true)
    await gotoStep3(w)
    expect(w.vm.step).toBe(3)
    // step3「完成」按钮（无 disabled）经 trigger 验 emit close
    await w.find('[data-testid="lv-e2e-setup-done"]').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })
})

describe('E2ESetupModal onComplete 分支契约', () => {
  it('loading 守门：已在 loading → 连点跳过不二次 setupMasterPassword', async () => {
    const { promise, resolve } = pendingPromise<boolean | 'cancelled'>()
    setupMasterPasswordMock.mockReturnValueOnce(promise)
    const w = mountComp(true)
    await gotoStep2(w)
    w.vm.saved = true
    await nextTick()
    // 不 await：onComplete 在 await setupMasterPassword 处挂起（同步段已调 mock）
    void w.vm.onComplete()
    await nextTick()
    expect(setupMasterPasswordMock).toHaveBeenCalledTimes(1)
    // 模拟连点：loading 已 true → 第二次被顶部守门早退跳过
    await w.vm.onComplete()
    await nextTick()
    expect(setupMasterPasswordMock).toHaveBeenCalledTimes(1)
    resolve(true)
    await flush()
    w.unmount()
  })

  it('setupMasterPassword 返回 "cancelled" → 不推 step=3（层二短路）', async () => {
    setupMasterPasswordMock.mockResolvedValue('cancelled')
    const w = mountComp(true)
    await gotoStep2(w)
    w.vm.saved = true
    await nextTick()
    await w.vm.onComplete()
    await flush()
    expect(w.vm.step).not.toBe(3) // cancelled 短路
    w.unmount()
  })

  it('setupMasterPassword 返回 false → 设「设置失败，请重试」error 不推 step', async () => {
    setupMasterPasswordMock.mockResolvedValue(false)
    const w = mountComp(true)
    await gotoStep2(w)
    w.vm.saved = true
    await nextTick()
    await w.vm.onComplete()
    await flush()
    expect(w.vm.error).toBe('设置失败，请重试')
    expect(w.vm.step).not.toBe(3)
    w.unmount()
  })

  it('setupMasterPassword 成功 → finally 复位 loading=false', async () => {
    setupMasterPasswordMock.mockResolvedValue(true)
    const w = mountComp(true)
    await gotoStep2(w)
    w.vm.saved = true
    await nextTick()
    await w.vm.onComplete()
    await flush()
    expect(w.vm.step).toBe(3)
    expect(w.vm.loading).toBe(false) // finally 复位
    w.unmount()
  })
})

describe('E2ESetupModal onEnrollBiometric 指纹录入', () => {
  it('录入成功 → bioDone=true + toast(true)「指纹解锁已启用」', async () => {
    isBiometricAvailableMock.mockReturnValue(true)
    enrollBiometricMock.mockResolvedValue(true)
    const w = mountComp(true)
    await gotoStep3(w)
    await w.vm.onEnrollBiometric()
    await flush()
    expect(enrollBiometricMock).toHaveBeenCalledWith('master-pw-12345')
    expect(w.vm.bioDone).toBe(true)
    expect(toastMock).toHaveBeenCalledWith('指纹解锁已启用', true)
    w.unmount()
  })

  it('录入失败（返 false）→ bioError 提示 + bioDone 保持 false', async () => {
    isBiometricAvailableMock.mockReturnValue(true)
    enrollBiometricMock.mockResolvedValue(false)
    const w = mountComp(true)
    await gotoStep3(w)
    await w.vm.onEnrollBiometric()
    await flush()
    expect(w.vm.bioDone).toBe(false)
    expect(w.vm.bioError).toBe('录入失败，当前设备不支持、存储空间不足或已取消')
    w.unmount()
  })

  it('录入抛 Error → catch 设「录入失败：」拼接 message', async () => {
    isBiometricAvailableMock.mockReturnValue(true)
    enrollBiometricMock.mockRejectedValue(new Error('hw broken'))
    const w = mountComp(true)
    await gotoStep3(w)
    await w.vm.onEnrollBiometric()
    await flush()
    expect(w.vm.bioError).toBe('录入失败：hw broken')
    expect(w.vm.bioDone).toBe(false)
    w.unmount()
  })

  it('录入抛非 Error → catch 用 String 兜底', async () => {
    isBiometricAvailableMock.mockReturnValue(true)
    enrollBiometricMock.mockRejectedValue('boom')
    const w = mountComp(true)
    await gotoStep3(w)
    await w.vm.onEnrollBiometric()
    await flush()
    expect(w.vm.bioError).toBe('录入失败：boom')
    w.unmount()
  })

  it('录入期间 finally 复位 bioLoading=false', async () => {
    isBiometricAvailableMock.mockReturnValue(true)
    enrollBiometricMock.mockResolvedValue(true)
    const w = mountComp(true)
    await gotoStep3(w)
    await w.vm.onEnrollBiometric()
    await flush()
    expect(w.vm.bioLoading).toBe(false)
    w.unmount()
  })

  it('bioLoading 重入守门：录入中再调跳过不二次 enrollBiometric', async () => {
    isBiometricAvailableMock.mockReturnValue(true)
    const { promise, resolve } = pendingPromise<boolean>()
    enrollBiometricMock.mockReturnValueOnce(promise)
    const w = mountComp(true)
    await gotoStep3(w)
    // 不 await：onEnrollBiometric 在 await enrollBiometric 处挂起（同步段已调 mock）
    void w.vm.onEnrollBiometric()
    await nextTick()
    expect(enrollBiometricMock).toHaveBeenCalledTimes(1)
    // 重入：bioLoading 已 true → 顶部守门早退跳过
    await w.vm.onEnrollBiometric()
    await nextTick()
    expect(enrollBiometricMock).toHaveBeenCalledTimes(1) // 守门跳过
    resolve(true)
    await flush()
    w.unmount()
  })

  it('bioDone 守门：已录入成功后再调跳过不二次 enrollBiometric', async () => {
    isBiometricAvailableMock.mockReturnValue(true)
    enrollBiometricMock.mockResolvedValue(true)
    const w = mountComp(true)
    await gotoStep3(w)
    await w.vm.onEnrollBiometric()
    await flush()
    expect(w.vm.bioDone).toBe(true)
    // 已录入成功按钮文案变「已启用」，但测函数守门 bioDone 短路
    enrollBiometricMock.mockClear()
    await w.vm.onEnrollBiometric()
    await flush()
    expect(enrollBiometricMock).not.toHaveBeenCalled()
    w.unmount()
  })
})

describe('E2ESetupModal watch 正向/负向分支', () => {
  it('open 由 false→true → bioAvailable = isBiometricAvailable() 当前值', async () => {
    isBiometricAvailableMock.mockReturnValue(true)
    const w = mountComp(false)
    expect(w.vm.bioAvailable).toBe(false) // 初始 false（watch 尚未正向触发）
    await w.setProps({ open: true })
    await nextTick()
    expect(isBiometricAvailableMock).toHaveBeenCalled()
    expect(w.vm.bioAvailable).toBe(true)
    w.unmount()
  })

  it('open 由 true→false → reset 全部 ref + 调 e2e.cancelSetup()', async () => {
    const w = mountComp(true)
    // 故弄一些非初值
    w.vm.masterPw = 'dirty'
    w.vm.step = 2
    w.vm.error = 'some err'
    w.vm.loading = true
    w.vm.bioDone = true
    await nextTick()
    await w.setProps({ open: false })
    await nextTick()
    expect(w.vm.masterPw).toBe('')
    expect(w.vm.step).toBe(1)
    expect(w.vm.error).toBe('')
    expect(w.vm.loading).toBe(false)
    expect(w.vm.bioDone).toBe(false)
    // 层二 cancel token：watch 负向分支应调
    expect(cancelSetupMock).toHaveBeenCalled()
    w.unmount()
  })
})
