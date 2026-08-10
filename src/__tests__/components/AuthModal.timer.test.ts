/**
 * 真 bug 复现：AuthModal onVerify 成功后 setTimeout(800ms) 回调未清理 ——
 * 用户在 800ms 内手动关闭弹窗后回调仍触发 checkE2EStatus + initialSync
 *
 * 触发链：onVerify 验证成功 → verified=true + setTimeout(800) 回调做三件事：
 *   auth.authModalOpen=false（自然关）+ await e2e.checkE2EStatus() + sync.initialSync()。
 * 用户在 800ms 窗口内手动点 X / 遮罩 / 取消 / 按 Esc → onClose → auth.authModalOpen=false
 * → 弹窗已关。但旧代码 timer id 没存、onClose/watch/卸载都不 clear —— 800ms 到点回调仍跑，
 * 在用户已主动取消登录流程后系统仍自作主张触发 checkE2EStatus（一次网络查询）+ initialSync
 * （全量云端同步）。错误行为：违背用户明确意图的副作用。
 *
 * 修复：存 syncTimer ref 存 setTimeout id；watch(authModalOpen → false) 时 clear（覆盖所有关闭
 * 路径，都置 authModalOpen=false）；onBeforeUnmount 兜底 clear；回调头 syncTimer.value=null
 * 防自然关闭路径 watch→false 对已消费 timer 重复 clear。
 *
 * 此测锁定复现：验证成功 → 800ms 内手动关弹窗 → 等待 1000ms 让旧 timer 到点 →
 * 断言 checkE2EStatus / initialSync 均未被调用（修复后）。
 * 同时断言正常登录路径（不提前关）仍然触发 checkE2EStatus + initialSync（无行为回归）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'

// 三个 composable 的 mock —— auth store 用 reactive 对象模拟 Pinia 的 ref unwrap，
// 让 `auth.authModalOpen = false` 直接写属性 + watch 能响应
const verifyOtpMock = vi.hoisted(() => vi.fn())
const sendOtpMock = vi.hoisted(() => vi.fn())
const checkE2EStatusMock = vi.hoisted(() => vi.fn())
const initialSyncMock = vi.hoisted(() => vi.fn())

// reactive 模拟 Pinia store：auth.authModalOpen 直接读写属性即触发响应式
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
    sendCooldownRemaining: () => 0,
    verifyLockRemaining: () => 0,
    resetVerifyState: () => { authState.authError = null },
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
  verifyOtpMock.mockResolvedValue(true)
  sendOtpMock.mockResolvedValue(true)
  checkE2EStatusMock.mockResolvedValue(undefined)
  initialSyncMock.mockReturnValue(undefined)
})

async function openAndVerify(wrapper: ReturnType<typeof mount>) {
  // 打开弹窗（触发 watch→true 重置表单，step 初始 'email'）
  authState.authModalOpen = true
  await nextTick()
  // step 1 'email'：填邮箱 → 点「发送验证码」→ onSendCode 成功后 step 切到 'code'
  const emailInput = wrapper.find('#authEmailInput')
  await emailInput.setValue('a@b.com')
  const sendBtn = wrapper.findAll('button').find(b => b.text().includes('发送验证码'))
  await sendBtn?.trigger('click')
  await flushPromises()
  await nextTick()
  // step 2 'code'：填 6 位验证码 → 点「登录」→ onVerify 调 verifyOtp
  const codeInput = wrapper.find('#authCodeInput')
  await codeInput.setValue('123456')
  const verifyBtn = wrapper.findAll('button').find(b => b.text().trim() === '登录')
  await verifyBtn?.trigger('click')
  await flushPromises()
}

describe('AuthModal setTimeout 清理', () => {
  it('800ms 内手动关闭弹窗 → 旧 timer 被清，checkE2EStatus/initialSync 不应被触发', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AuthModal)
    await openAndVerify(wrapper)
    // 验证已成功，verified=true，timer 已排入
    expect(verifyOtpMock).toHaveBeenCalledWith('a@b.com', '123456')
    // 800ms 内手动关闭弹窗（模拟点 X / 取消）
    authState.authModalOpen = false
    await nextTick()
    // 让假时钟跨过 1000ms —— 旧 timer 若未清应在此期间到点跑回调
    vi.advanceTimersByTime(1000)
    await flushPromises()
    // 修复后：回调不应跑
    expect(checkE2EStatusMock).not.toHaveBeenCalled()
    expect(initialSyncMock).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('正常登录路径不提前关 → 800ms 后回调应触发 checkE2EStatus + initialSync（无行为回归）', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AuthModal)
    await openAndVerify(wrapper)
    expect(verifyOtpMock).toHaveBeenCalledWith('a@b.com', '123456')
    // 不关弹窗，让 timer 自然到点
    vi.advanceTimersByTime(800)
    await flushPromises()
    // 回调内 auth.authModalOpen=false（自然关）+ checkE2EStatus + initialSync
    expect(authState.authModalOpen).toBe(false)
    expect(checkE2EStatusMock).toHaveBeenCalledTimes(1)
    expect(initialSyncMock).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('组件卸载时清掉 pending timer → 卸载后 800ms 到点不触发回调', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AuthModal)
    await openAndVerify(wrapper)
    // 在 timer pending 期间卸载组件（模拟 SPA 路由切走）
    wrapper.unmount()
    // 旧代码：无 onBeforeUnmount，timer 仍在跑。修复后：onBeforeUnmount 清掉
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(checkE2EStatusMock).not.toHaveBeenCalled()
    expect(initialSyncMock).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
