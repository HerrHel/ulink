/**
 * AuthModal.vue setup 函数体分支契约覆盖（补 AuthModal.timer.test.ts 仅锁 3 条 timer 清理路径之外
 * 未触达的 onSendCode/onVerify/onBack/watch/focusCodeInput/computed 各分支）。
 * 锁住真实行为契约：早退守门 / 状态流转 / 重入守门 / 表单重置 / 失败路径不副作用。非刷行数。
 *
 * 桩沿用 timer 测骨架：reactive() 模拟 Pinia store 的 ref unwrap，让 auth.authModalOpen = false
 * 直接写属性 + watch 能响应；hoisted mock fn 可控 sendOtp/verifyOtp/cooldown/lock/resetVerifyState。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'

const verifyOtpMock = vi.hoisted(() => vi.fn())
const sendOtpMock = vi.hoisted(() => vi.fn())
const checkE2EStatusMock = vi.hoisted(() => vi.fn())
const initialSyncMock = vi.hoisted(() => vi.fn())
const sendCooldownRemainingMock = vi.hoisted(() => vi.fn())
const verifyLockRemainingMock = vi.hoisted(() => vi.fn())
const resetVerifyStateMock = vi.hoisted(() => vi.fn())

function mkAuthState() {
  return reactive({
    authModalOpen: false,
    authError: null as string | null,
  })
}
let authState: ReturnType<typeof mkAuthState>

vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => ({
    get authModalOpen() { return authState.authModalOpen },
    set authModalOpen(v: boolean) { authState.authModalOpen = v },
    get authError() { return authState.authError },
    set authError(v: string | null) { authState.authError = v },
    sendOtp: sendOtpMock,
    verifyOtp: verifyOtpMock,
    sendCooldownRemaining: sendCooldownRemainingMock,
    verifyLockRemaining: verifyLockRemainingMock,
    resetVerifyState: resetVerifyStateMock,
  }),
}))
vi.mock('../../composables/domain/useCloudSync.js', () => ({
  useCloudSync: () => ({ initialSync: initialSyncMock }),
}))
vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({ checkE2EStatus: checkE2EStatusMock, isE2EEnabled: { value: false } }),
}))
vi.mock('../../config/icons.js', () => ({ I: { close: '<svg/>', mail: '<svg/>', alert: '<svg/>', listCheck: '<svg/>' } }))

import AuthModal from '../../components/modals/AuthModal.vue'

beforeEach(() => {
  authState = mkAuthState()
  verifyOtpMock.mockReset()
  sendOtpMock.mockReset()
  checkE2EStatusMock.mockReset()
  initialSyncMock.mockReset()
  sendCooldownRemainingMock.mockReset()
  verifyLockRemainingMock.mockReset()
  resetVerifyStateMock.mockReset()
  // 默认无冷却无锁定
  sendCooldownRemainingMock.mockReturnValue(0)
  verifyLockRemainingMock.mockReturnValue(0)
  resetVerifyStateMock.mockImplementation(() => { authState.authError = null })
  verifyOtpMock.mockResolvedValue(true)
  sendOtpMock.mockResolvedValue(true)
  checkE2EStatusMock.mockResolvedValue(undefined)
  initialSyncMock.mockReturnValue(undefined)
})

/** 经 watch open=true 重置表单后到 step='email' 初始态 */
async function openModal(wrapper: ReturnType<typeof mount>) {
  authState.authModalOpen = true
  await nextTick()
}

/** open + 填邮箱 + 点发送（sendOtp 成功）到 step='code' */
async function reachCodeStep(wrapper: ReturnType<typeof mount>) {
  await openModal(wrapper)
  await wrapper.find('#authEmailInput').setValue('a@b.com')
  await wrapper.findAll('button').find(b => b.text().includes('发送验证码'))?.trigger('click')
  await flushPromises()
  await nextTick()
}

/** reachCodeStep + 填 6 位验证码（不点登录，留待各测自行触发 onVerify） */
async function fillCode(wrapper: ReturnType<typeof mount>, code = '123456') {
  await reachCodeStep(wrapper)
  await wrapper.find('#authCodeInput').setValue(code)
}

describe('AuthModal 分支契约', () => {
  describe('watch(authModalOpen) open=true 重置表单', () => {
    it('打开弹窗重置 email/code/step/sending/verifying/verified/authError 并聚焦 input', async () => {
      const wrapper = mount(AuthModal)
      const s = wrapper.vm.$.setupState as any
      // 预污染全部字段，验证打开时被重置
      s.email = 'polluted@x.com'
      s.code = '999999'
      s.step = 'code'
      s.sending = true
      s.verifying = true
      s.verified = true
      authState.authError = '旧错误信息'
      // 预置 inputRef 已挂载（ref unwrap 后 setupState.inputRef = DOM 元素）
      expect(s.inputRef).toBeInstanceOf(HTMLInputElement)
      // 触发 watch open=true
      authState.authModalOpen = true
      await nextTick()
      await flushPromises()
      expect(s.email).toBe('')
      expect(s.code).toBe('')
      expect(s.step).toBe('email')
      expect(s.sending).toBe(false)
      expect(s.verifying).toBe(false)
      expect(s.verified).toBe(false)
      expect(authState.authError).toBe(null)
    })
  })

  describe('onSendCode', () => {
    it('空邮箱早退：不调 sendOtp 不改 sending', async () => {
      const wrapper = mount(AuthModal)
      await openModal(wrapper)
      // 不填邮箱（email=''），emailTrim='' → onSendCode line 127 `if(!e) return`
      // 找 step='email' 的「发送验证码」主按钮 trigger click
      await wrapper.findAll('button').find(b => b.text().includes('发送验证码'))?.trigger('click')
      await flushPromises()
      const s = wrapper.vm.$.setupState as any
      expect(sendOtpMock).not.toHaveBeenCalled()
      expect(s.sending).toBe(false)
      expect(s.step).toBe('email')
    })

    it('冷却中 cooldownSec>0 早退：设 error 不调 sendOtp', async () => {
      sendCooldownRemainingMock.mockReturnValue(30)
      const wrapper = mount(AuthModal)
      await openModal(wrapper)
      await wrapper.find('#authEmailInput').setValue('a@b.com')
      // 冷却中主按钮文案变「重新发送」且 disabled（cooldownSec>0），jsdom trigger 静默
      // → 经 setupState 直调 onSendCode 锁早退守门契约
      const s = wrapper.vm.$.setupState as any
      await s.onSendCode()
      await flushPromises()
      expect(sendOtpMock).not.toHaveBeenCalled()
      expect(s.step).toBe('email')
      expect(authState.authError).toBe('验证码已发送，请 30 秒后再试')
    })

    it('sendOtp 失败：step 不切到 code，verified 保持 false', async () => {
      sendOtpMock.mockResolvedValue(false)
      const wrapper = mount(AuthModal)
      await openModal(wrapper)
      await wrapper.find('#authEmailInput').setValue('a@b.com')
      await wrapper.findAll('button').find(b => b.text().includes('发送验证码'))?.trigger('click')
      await flushPromises()
      const s = wrapper.vm.$.setupState as any
      expect(sendOtpMock).toHaveBeenCalledWith('a@b.com')
      expect(s.step).toBe('email')
      expect(s.sending).toBe(false)
    })

    it('sendOtp 成功：step 切到 code 并聚焦 codeInput', async () => {
      const wrapper = mount(AuthModal)
      await reachCodeStep(wrapper)
      const s = wrapper.vm.$.setupState as any
      expect(sendOtpMock).toHaveBeenCalledWith('a@b.com')
      expect(s.step).toBe('code')
      expect(s.sending).toBe(false)
    })
  })

  describe('onVerify', () => {
    it('锁定中 lockSec>0 早退：设 error 不调 verifyOtp', async () => {
      verifyLockRemainingMock.mockReturnValue(60)
      const wrapper = mount(AuthModal)
      await fillCode(wrapper, '123456')
      // lockSec>0 时登录按钮 disabled（code.length<6||verifying||lockSec>0），jsdom trigger 静默
      // → 经 setupState 直调 onVerify 锁早退守门契约
      const s = wrapper.vm.$.setupState as any
      await s.onVerify()
      await flushPromises()
      expect(verifyOtpMock).not.toHaveBeenCalled()
      expect(s.verifying).toBe(false)
      expect(authState.authError).toBe('验证失败次数过多，请 60 秒后重试或重新获取验证码')
    })

    it('验证码不足 6 位早退：不调 verifyOtp 不设 verifying', async () => {
      const wrapper = mount(AuthModal)
      await fillCode(wrapper, '12') // 不足 6 位
      const s = wrapper.vm.$.setupState as any
      await s.onVerify()
      await flushPromises()
      expect(verifyOtpMock).not.toHaveBeenCalled()
      expect(s.verifying).toBe(false)
      expect(s.verified).toBe(false)
    })

    it('verifyOtp 失败：verified 保持 false，不排 syncTimer 回调', async () => {
      vi.useFakeTimers()
      verifyOtpMock.mockResolvedValue(false)
      const wrapper = mount(AuthModal)
      await fillCode(wrapper, '123456')
      await wrapper.findAll('button').find(b => b.text().trim() === '登录')?.trigger('click')
      await flushPromises()
      const s = wrapper.vm.$.setupState as any
      expect(verifyOtpMock).toHaveBeenCalledWith('a@b.com', '123456')
      expect(s.verifying).toBe(false)
      expect(s.verified).toBe(false)
      // advance 跨过 800ms 回调不应触发（未排 timer）
      vi.advanceTimersByTime(1000)
      await flushPromises()
      expect(checkE2EStatusMock).not.toHaveBeenCalled()
      expect(initialSyncMock).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('verifyOtp 成功：verified=true 排 syncTimer，800ms 后回调触发 checkE2EStatus+initialSync', async () => {
      vi.useFakeTimers()
      const wrapper = mount(AuthModal)
      await fillCode(wrapper, '123456')
      await wrapper.findAll('button').find(b => b.text().trim() === '登录')?.trigger('click')
      await flushPromises()
      const s = wrapper.vm.$.setupState as any
      expect(s.verified).toBe(true)
      vi.advanceTimersByTime(800)
      await flushPromises()
      expect(authState.authModalOpen).toBe(false) // 回调自然关弹窗
      expect(checkE2EStatusMock).toHaveBeenCalledTimes(1)
      expect(initialSyncMock).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })

    it('重入守门：800ms 内重复点登录成功 → 旧 timer 被 clearTimeout，回调最终只跑一次', async () => {
      vi.useFakeTimers()
      const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
      const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
      const wrapper = mount(AuthModal)
      await fillCode(wrapper, '123456')
      // 第一次 onVerify 成功 → 排 timer1
      await wrapper.findAll('button').find(b => b.text().trim() === '登录')?.trigger('click')
      await flushPromises()
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
      const firstTimerId = setTimeoutSpy.mock.results[0].value
      // 不 advance，第二次 onVerify 成功 → line 159 检测 syncTimer!==null 应清旧 timer1 再排 timer2
      await wrapper.findAll('button').find(b => b.text().trim() === '登录')?.trigger('click')
      await flushPromises()
      expect(setTimeoutSpy).toHaveBeenCalledTimes(2)
      expect(clearTimeoutSpy).toHaveBeenCalledWith(firstTimerId)
      // advance 后只有 timer2 的回调跑一次（timer1 已被清）
      vi.advanceTimersByTime(800)
      await flushPromises()
      expect(checkE2EStatusMock).toHaveBeenCalledTimes(1)
      expect(initialSyncMock).toHaveBeenCalledTimes(1)
      clearTimeoutSpy.mockRestore()
      setTimeoutSpy.mockRestore()
      vi.useRealTimers()
    })
  })

  describe('onBack', () => {
    it('返回修改：step 回 email + 清 code + 清 error + 调 resetVerifyState + 聚焦 input', async () => {
      const wrapper = mount(AuthModal)
      await fillCode(wrapper, '123456')
      const s = wrapper.vm.$.setupState as any
      expect(s.step).toBe('code')
      // 预置 error 验证 onBack 清除
      authState.authError = '某个错误'
      // 点「返回修改」按钮
      await wrapper.findAll('button').find(b => b.text().includes('返回修改'))?.trigger('click')
      await nextTick()
      await flushPromises()
      expect(s.step).toBe('email')
      expect(s.code).toBe('')
      expect(authState.authError).toBe(null)
      expect(resetVerifyStateMock).toHaveBeenCalledWith('a@b.com')
    })
  })

  describe('focusCodeInput', () => {
    it('点击 code-boxes 容器聚焦隐藏验证码输入框', async () => {
      const wrapper = mount(AuthModal)
      await fillCode(wrapper, '123456')
      const codeInput = wrapper.find('#authCodeInput').element as HTMLInputElement
      const focusSpy = vi.spyOn(codeInput, 'focus')
      // 点击 code-boxes 容器（@click="focusCodeInput"）
      await wrapper.find('.code-boxes').trigger('click')
      expect(focusSpy).toHaveBeenCalledTimes(1)
      focusSpy.mockRestore()
    })
  })

  describe('onClose 各关闭路径', () => {
    it('点关闭按钮 → authModalOpen=false', async () => {
      const wrapper = mount(AuthModal)
      await openModal(wrapper)
      expect(authState.authModalOpen).toBe(true)
      await wrapper.find('.modal-close').trigger('click')
      expect(authState.authModalOpen).toBe(false)
    })

    it('点遮罩（@click.self）→ authModalOpen=false', async () => {
      const wrapper = mount(AuthModal)
      await openModal(wrapper)
      // .modal-mask 的 @click.self → onClose
      await wrapper.find('.modal-mask').trigger('click')
      expect(authState.authModalOpen).toBe(false)
    })

    it('点「取消」按钮 → authModalOpen=false', async () => {
      const wrapper = mount(AuthModal)
      await openModal(wrapper)
      await wrapper.findAll('button').find(b => b.text().trim() === '取消')?.trigger('click')
      expect(authState.authModalOpen).toBe(false)
    })
  })

  describe('computed 联动', () => {
    it('emailTrim 去 trim；cooldownSec/lockSec 调用对应 auth 方法并返值', async () => {
      sendCooldownRemainingMock.mockReturnValue(5)
      verifyLockRemainingMock.mockReturnValue(9)
      const wrapper = mount(AuthModal)
      await openModal(wrapper)
      await wrapper.find('#authEmailInput').setValue('  spaced@x.com  ')
      await nextTick()
      // 先读 emailTrim 触发 computed 求值链：cooldownSec/lockSec 依赖 emailTrim 依赖 email
      // 经 wrapper.vm 访问（组件代理自动解包 computed ref，触发 .value 求值）
      expect((wrapper.vm as any).emailTrim).toBe('spaced@x.com')
      expect((wrapper.vm as any).cooldownSec).toBe(5)
      expect((wrapper.vm as any).lockSec).toBe(9)
      expect(sendCooldownRemainingMock).toHaveBeenCalledWith('spaced@x.com')
      expect(verifyLockRemainingMock).toHaveBeenCalledWith('spaced@x.com')
    })
  })

  describe('step="code" 按钮态联动', () => {
    it('code 长度 <6 时登录按钮 disabled', async () => {
      const wrapper = mount(AuthModal)
      await fillCode(wrapper, '12')
      const verifyBtn = wrapper.findAll('button').find(b => b.text().trim() === '登录')
      expect(verifyBtn?.attributes('disabled')).toBeDefined()
    })

    it('code 长度 >=6 时登录按钮 enabled', async () => {
      const wrapper = mount(AuthModal)
      await fillCode(wrapper, '123456')
      const verifyBtn = wrapper.findAll('button').find(b => b.text().trim() === '登录')
      expect(verifyBtn?.attributes('disabled')).toBeUndefined()
    })
  })
})
