/**
 * VaultSetupModal 正文分支补测（补覆盖率轮：基线 66.98% Stmts / 68% Br / 25% Func / 73.11% Lines → 目标 ≥85%）。
 * 既有 VaultSetupModal.race.test.ts 只锁了 onComplete 跨取消 await 竞态（层一组件守门），
 * 未触达 onNext（3 step 流转 + 校验 + 动态提示）、downloadPDF、copyKey、onEnrollBiometric、
 * step3 完成按钮、watch 正向分支、onComplete cancelled/false/重入/finally 各错误分支、
 * showPw/showPw2 切换、step1 「还需 N 位」动态提示、step3 指纹块渲染。
 *
 * 锁定真实行为契约（非刷行数）：
 *  - onNext：<8 位拒 + 不一致拒 + 成功生成 recoveryKey 推 step=2 + generateRecoveryKey 抛错降级（Error/非 Error）
 *  - step1 动态提示：masterPw 0<len<8 显示「还需 N 位」；0 位不显示；error 优先于动态提示
 *  - showPw/showPw2 切换：input type 在 text/password 间切换
 *  - downloadPDF：转发 recoveryKey 给 generateRecoveryKeyPDF
 *  - copyKey：clipboard 成功→toast true / 失败→toast false
 *  - onEnrollBiometric：成功 bioDone+toast / 失败 bioError / 抛错 catch(E message/非 E String) / finally 复位 / bioLoading+bioDone 双重入守门
 *  - step2 确认守门：未勾选 saved 按钮 disabled / step3 完成按钮 emit('close')
 *  - watch 正向 open=true 设 bioAvailable；负向 reset 全 ref + 调 vault.cancelSetup（层二）
 *  - onComplete：loading 守门重入跳过 / ok='cancelled' 短路 / ok=false 设 error / 成功推 step=3 / finally 复位 loading
 *
 * 实现注：onNext 受 `:disabled="masterPw.length < 8"` 守门的「下一步」按钮在密码 <8 位时 disabled，
 * jsdom 下 trigger('click') 对 disabled button 静默不触发——故测函数逻辑统一调 w.vm.onNext() / onComplete /
 * onEnrollBiometric / copyKey 等实例方法绕过按钮态，断言 step/error/ref 反映真实行为；按钮 disabled 状态由
 * `:disabled` 表达式隐含覆盖。step3 完成按钮（无 disabled）保留 trigger 验 emit('close')。
 *
 * 沿用 race 测的同构桩骨架（vi.hoisted 可控 + vi.mock useVault/icons），新增 recoveryKeyPDF/toast mock。
 * 同构参考 E2ESetupModal-branches.test.ts。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// 可控桩：useVault 各导出 + recoveryKeyPDF + toast，每测覆 mockReturnValueOnce 注入分支
const setupVaultPasswordMock = vi.hoisted(() => vi.fn())
const generateRecoveryKeyMock = vi.hoisted(() => vi.fn())
const isBiometricAvailableMock = vi.hoisted(() => vi.fn())
const enrollBiometricMock = vi.hoisted(() => vi.fn())
const cancelSetupMock = vi.hoisted(() => vi.fn())
const generateRecoveryKeyPDFMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => vi.fn())

vi.mock('../../composables/domain/useVault.js', () => ({
  useVault: () => ({
    setupVaultPassword: setupVaultPasswordMock,
    generateRecoveryKey: generateRecoveryKeyMock,
    isBiometricAvailable: isBiometricAvailableMock,
    isVaultBiometricEnrolled: () => ({ value: false }),
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

import VaultSetupModal from '../../components/modals/VaultSetupModal.vue'

function mountComp(open = false) {
  return mount(VaultSetupModal, {
    props: { open },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  setupVaultPasswordMock.mockReset()
  generateRecoveryKeyMock.mockReset()
  isBiometricAvailableMock.mockReset()
  enrollBiometricMock.mockReset()
  cancelSetupMock.mockReset()
  generateRecoveryKeyPDFMock.mockReset()
  toastMock.mockReset()
  // 默认：指纹不可用 / 生成 key 正常
  isBiometricAvailableMock.mockReturnValue(false)
  generateRecoveryKeyMock.mockReturnValue('RK-1234-5678-ABCD')
})

/** 让 await setupVaultPassword 的 controllable Promise 在测里手动 resolve */
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
  setupVaultPasswordMock.mockResolvedValue(true)
  await gotoStep2(w)
  w.vm.saved = true
  await nextTick()
  await w.vm.onComplete()
  await flush()
}

describe('VaultSetupModal onNext 校验与 step 流转', () => {
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

  it('onNext 前先清空旧 error（每次重新校验不残留）', async () => {
    const w = mountComp(true)
    // 先造一个 error（不一致）
    w.vm.masterPw = 'master-pw-12345'
    w.vm.masterPw2 = 'mismatch-pw-99'
    await nextTick()
    await w.vm.onNext()
    expect(w.vm.error).toBe('两次密码不一致')
    // 修正后重新校验 → error 应清空（onNext 顶部 error.value=''）
    w.vm.masterPw2 = 'master-pw-12345'
    await nextTick()
    await w.vm.onNext()
    expect(w.vm.error).toBe('')
    expect(w.vm.step).toBe(2)
    w.unmount()
  })

  it('step1「下一步」按钮在密码 <8 位时 disabled（模板表达式隐含）', async () => {
    const w = mountComp(true)
    w.vm.masterPw = 'short'
    await nextTick()
    expect(w.find('[data-testid="lv-vault-setup-next"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('主密码 input 回车 → 触发 onNext（模板内联 @keydown.enter）', async () => {
    const w = mountComp(true)
    w.vm.masterPw = 'master-pw-12345'
    w.vm.masterPw2 = 'master-pw-12345'
    await nextTick()
    await w.find('[data-testid="lv-vault-setup-password"]').trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(w.vm.step).toBe(2) // 回车走 onNext 成功推 step
    w.unmount()
  })

  it('确认密码 input 回车 → 触发 onNext（模板内联 @keydown.enter）', async () => {
    const w = mountComp(true)
    w.vm.masterPw = 'master-pw-12345'
    w.vm.masterPw2 = 'master-pw-12345'
    await nextTick()
    await w.find('[data-testid="lv-vault-setup-password2"]').trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(w.vm.step).toBe(2)
    w.unmount()
  })
})

describe('VaultSetupModal step1 动态提示与密码可见切换', () => {
  it('masterPw 0<len<8 且无 error → 显示「还需 N 位」动态提示', async () => {
    const w = mountComp(true)
    w.vm.masterPw = 'abc' // 3 位
    await nextTick()
    expect(w.html()).toContain('还需 5 位（至少 8 位）')
    w.unmount()
  })

  it('masterPw 为空（0 位）→ 不显示动态提示（v-else-if length>0 守门）', async () => {
    const w = mountComp(true)
    await nextTick()
    expect(w.html()).not.toContain('还需')
    w.unmount()
  })

  it('masterPw ≥8 位 → 不显示动态提示', async () => {
    const w = mountComp(true)
    w.vm.masterPw = 'master-pw-12345'
    await nextTick()
    expect(w.html()).not.toContain('还需')
    w.unmount()
  })

  it('error 优先于动态提示（有 error 时 v-if 胜出 v-else-if 不渲染）', async () => {
    // 精确测 v-if/v-else-if 互斥：masterPw 同时满足 v-else-if 触发条件(0<len<8)，
    // 但 error 已设 → v-if 胜出，v-else-if「还需 N 位」不应渲染。
    const w = mountComp(true)
    w.vm.masterPw = 'abc' // 3 位（同时满足 v-else-if 0<len<8）
    w.vm.error = '预设错误' // 直接设 error（不经 onNext 早退）
    await nextTick()
    expect(w.html()).toContain('预设错误')
    expect(w.html()).not.toContain('还需') // v-if error 胜出，v-else-if 被压制不渲染
    w.unmount()
  })

  it('showPw 切换 → 主密码 input type 在 text/password 间切换', async () => {
    const w = mountComp(true)
    expect(w.vm.showPw).toBe(false)
    expect(w.find('[data-testid="lv-vault-setup-password"]').attributes('type')).toBe('password')
    w.vm.showPw = true
    await nextTick()
    expect(w.find('[data-testid="lv-vault-setup-password"]').attributes('type')).toBe('text')
    w.unmount()
  })

  it('点击 pw-toggle 按钮 → 翻转 showPw（模板内联 @click="showPw=!showPw"）', async () => {
    const w = mountComp(true)
    expect(w.vm.showPw).toBe(false)
    await w.find('.pw-toggle').trigger('click')
    await nextTick()
    expect(w.vm.showPw).toBe(true)
    w.unmount()
  })

  it('showPw2 切换 → 确认密码 input type 在 text/password 间切换', async () => {
    const w = mountComp(true)
    expect(w.vm.showPw2).toBe(false)
    expect(w.find('[data-testid="lv-vault-setup-password2"]').attributes('type')).toBe('password')
    w.vm.showPw2 = true
    await nextTick()
    expect(w.find('[data-testid="lv-vault-setup-password2"]').attributes('type')).toBe('text')
    w.unmount()
  })

  it('点击第二个 pw-toggle 按钮 → 翻转 showPw2（模板内联 @click="showPw2=!showPw2"）', async () => {
    const w = mountComp(true)
    expect(w.vm.showPw2).toBe(false)
    await w.findAll('.pw-toggle')[1].trigger('click') // 第二个 = 确认密码 toggle
    await nextTick()
    expect(w.vm.showPw2).toBe(true)
    w.unmount()
  })

  it('点击「取消」按钮 → emit("close")（模板内联 @click="emit(\'close\')"）', async () => {
    const w = mountComp(true)
    await w.find('.btn-secondary').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('点击遮罩背景 → emit("close")（@click.self="emit(\'close\')"）', async () => {
    const w = mountComp(true)
    await w.find('[data-testid="lv-vault-setup-modal"]').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('点击关闭按钮 → emit("close")', async () => {
    const w = mountComp(true)
    await w.find('.modal-close').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('step2 显示生成的 recoveryKey 文本', async () => {
    const w = mountComp(true)
    await gotoStep2(w)
    expect(w.html()).toContain('RK-1234-5678-ABCD')
    w.unmount()
  })
})

describe('VaultSetupModal downloadPDF', () => {
  it('点击下载 → generateRecoveryKeyPDF 收到当前 recoveryKey', async () => {
    const w = mountComp(true)
    await gotoStep2(w)
    await nextTick()
    await w.vm.downloadPDF()
    expect(generateRecoveryKeyPDFMock).toHaveBeenCalledWith('RK-1234-5678-ABCD')
    w.unmount()
  })
})

describe('VaultSetupModal copyKey', () => {
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

describe('VaultSetupModal step2 确认开启守门 + step3 完成/指纹块', () => {
  it('step2 未勾选「已保存」→ 确认按钮 disabled', async () => {
    const w = mountComp(true)
    await gotoStep2(w)
    w.vm.saved = false
    await nextTick()
    expect(w.find('[data-testid="lv-vault-setup-confirm"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('step2 勾选「已保存」且非 loading → 确认按钮可点', async () => {
    const w = mountComp(true)
    await gotoStep2(w)
    w.vm.saved = true
    await nextTick()
    expect(w.find('[data-testid="lv-vault-setup-confirm"]').attributes('disabled')).toBeFalsy()
    w.unmount()
  })

  it('step2 勾选「已保存」checkbox → saved 翻转 true（模板内联 v-model）', async () => {
    const w = mountComp(true)
    await gotoStep2(w)
    expect(w.vm.saved).toBe(false)
    await w.find('[data-testid="lv-vault-setup-saved"]').setValue(true)
    await nextTick()
    expect(w.vm.saved).toBe(true)
    expect(w.find('[data-testid="lv-vault-setup-confirm"]').attributes('disabled')).toBeFalsy()
    w.unmount()
  })

  it('step3 完成按钮 → emit("close")', async () => {
    const w = mountComp(true)
    await gotoStep3(w)
    expect(w.vm.step).toBe(3)
    // step3「完成」按钮（无 disabled）经 trigger 验 emit close
    await w.find('[data-testid="lv-vault-setup-done"]').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('step3 bioAvailable=true → 渲染指纹录入块', async () => {
    isBiometricAvailableMock.mockReturnValue(true)
    // mount open=false 再 setProps open=true 触发 watch 正向分支设 bioAvailable=true
    // （mountComp(true) 初始即 true，watch 不触发正向，bioAvailable 始终 false）
    const w = mountComp(false)
    await w.setProps({ open: true }) // 触发 watch 正向设 bioAvailable=true
    await nextTick()
    await gotoStep3(w) // 推进 step=3
    await nextTick()
    expect(w.vm.bioAvailable).toBe(true)
    expect(w.html()).toContain('启用指纹快速解锁')
    w.unmount()
  })

  it('step3 bioAvailable=false → 不渲染指纹录入块', async () => {
    isBiometricAvailableMock.mockReturnValue(false)
    const w = mountComp(true)
    await gotoStep3(w)
    await nextTick()
    expect(w.html()).not.toContain('启用指纹快速解锁')
    w.unmount()
  })
})

describe('VaultSetupModal onComplete 分支契约', () => {
  it('loading 守门：已在 loading → 连点跳过不二次 setupVaultPassword', async () => {
    const { promise, resolve } = pendingPromise<boolean | 'cancelled'>()
    setupVaultPasswordMock.mockReturnValueOnce(promise)
    const w = mountComp(true)
    await gotoStep2(w)
    w.vm.saved = true
    await nextTick()
    // 不 await：onComplete 在 await setupVaultPassword 处挂起（同步段已调 mock）
    void w.vm.onComplete()
    await nextTick()
    expect(setupVaultPasswordMock).toHaveBeenCalledTimes(1)
    // 模拟连点：loading 已 true → 第二次被顶部守门早退跳过
    await w.vm.onComplete()
    await nextTick()
    expect(setupVaultPasswordMock).toHaveBeenCalledTimes(1)
    resolve(true)
    await flush()
    w.unmount()
  })

  it('setupVaultPassword 返回 "cancelled" → 不推 step=3（层二短路）', async () => {
    setupVaultPasswordMock.mockResolvedValue('cancelled')
    const w = mountComp(true)
    await gotoStep2(w)
    w.vm.saved = true
    await nextTick()
    await w.vm.onComplete()
    await flush()
    expect(w.vm.step).not.toBe(3) // cancelled 短路
    expect(w.vm.error).toBe('') // cancelled 不设 error
    w.unmount()
  })

  it('setupVaultPassword 返回 false → 设「设置失败，请重试」error 不推 step', async () => {
    setupVaultPasswordMock.mockResolvedValue(false)
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

  it('setupVaultPassword 成功 → 推 step=3 + finally 复位 loading=false', async () => {
    setupVaultPasswordMock.mockResolvedValue(true)
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

  it('setupVaultPassword 失败 → finally 也复位 loading=false（失败路 finally 同样执行）', async () => {
    setupVaultPasswordMock.mockResolvedValue(false)
    const w = mountComp(true)
    await gotoStep2(w)
    w.vm.saved = true
    await nextTick()
    await w.vm.onComplete()
    await flush()
    expect(w.vm.loading).toBe(false)
    w.unmount()
  })

  it('await 前置入参：setupVaultPassword 收到 masterPw + recoveryKey', async () => {
    setupVaultPasswordMock.mockResolvedValue(true)
    const w = mountComp(true)
    await gotoStep2(w)
    w.vm.saved = true
    await nextTick()
    await w.vm.onComplete()
    await flush()
    expect(setupVaultPasswordMock).toHaveBeenCalledWith('master-pw-12345', 'RK-1234-5678-ABCD')
    w.unmount()
  })
})

describe('VaultSetupModal onEnrollBiometric 指纹录入', () => {
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

describe('VaultSetupModal watch 正向/负向分支', () => {
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

  it('open false→true 且 fingerprint 不可用 → bioAvailable 保持 false', async () => {
    isBiometricAvailableMock.mockReturnValue(false)
    const w = mountComp(false)
    await w.setProps({ open: true })
    await nextTick()
    expect(w.vm.bioAvailable).toBe(false)
    w.unmount()
  })

  it('open 由 true→false → reset 全部 ref + 调 vault.cancelSetup()（层二）', async () => {
    const w = mountComp(true)
    // 故弄一些非初值
    w.vm.masterPw = 'dirty'
    w.vm.masterPw2 = 'dirty2'
    w.vm.showPw = true
    w.vm.showPw2 = true
    w.vm.step = 2
    w.vm.error = 'some err'
    w.vm.recoveryKey = 'RK'
    w.vm.saved = true
    w.vm.loading = true
    w.vm.bioDone = true
    w.vm.bioAvailable = true
    w.vm.bioLoading = true
    w.vm.bioError = 'bio err'
    await nextTick()
    await w.setProps({ open: false })
    await nextTick()
    expect(w.vm.masterPw).toBe('')
    expect(w.vm.masterPw2).toBe('')
    expect(w.vm.showPw).toBe(false)
    expect(w.vm.showPw2).toBe(false)
    expect(w.vm.step).toBe(1)
    expect(w.vm.error).toBe('')
    expect(w.vm.recoveryKey).toBe('')
    expect(w.vm.saved).toBe(false)
    expect(w.vm.loading).toBe(false)
    expect(w.vm.bioDone).toBe(false)
    expect(w.vm.bioAvailable).toBe(false)
    expect(w.vm.bioLoading).toBe(false)
    expect(w.vm.bioError).toBe('')
    // 层二 cancel token：watch 负向分支应调
    expect(cancelSetupMock).toHaveBeenCalled()
    w.unmount()
  })
})
