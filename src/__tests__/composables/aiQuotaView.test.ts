import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const mockFetchMyEntitlement = vi.hoisted(() => vi.fn())
const mockFetchMyAiAccess = vi.hoisted(() => vi.fn())
const mockSetMyTimezone = vi.hoisted(() => vi.fn())
vi.mock('../../composables/domain/useRedeem.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../composables/domain/useRedeem.js')>()
  return { ...actual, fetchMyEntitlement: mockFetchMyEntitlement, fetchMyAiAccess: mockFetchMyAiAccess, setMyTimezone: mockSetMyTimezone }
})
const toastWithActionMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/toast.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/toast.js')>()
  return { ...actual, toastWithAction: toastWithActionMock }
})
const authState = vi.hoisted(() => ({ isLoggedIn: true, authModalOpen: false }))
vi.mock('../../composables/domain/useAuth.js', () => ({ useAuth: () => authState }))

import {
  useEntitlement,
  refreshAiAccessSoon,
  notifyAiTrialExhausted,
  AI_TRIAL_LOW_THRESHOLD,
  PRO_NEAR_RATIO,
  PRO_MONTH_WARN_PCT,
} from '../../composables/domain/useEntitlement.js'
import { useUIStore } from '../../stores/ui.js'
import AiQuotaChip from '../../components/chat/AiQuotaChip.vue'

const TRIAL = (remaining: number, limit = 30) => ({ tier: 'trial' as const, used: limit - remaining, limit, remaining })

describe('AI 额度展示（aiQuotaView / 额度标签 / 用完提示）', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mockFetchMyAiAccess.mockReset()
    mockFetchMyAiAccess.mockResolvedValue({ tier: 'unknown', used: 0, limit: 0, remaining: 0 })
    toastWithActionMock.mockReset()
    authState.isLoggedIn = true
    authState.authModalOpen = false
    useEntitlement().clear()
  })

  it('按剩余次数分档：充足 / 提醒 / 用完 / 未登录 / 未知', () => {
    const { aiAccess, aiQuotaView } = useEntitlement()
    expect(aiQuotaView.value.kind).toBe('unknown')
    aiAccess.value = TRIAL(20)
    expect(aiQuotaView.value).toEqual({ kind: 'trial', remaining: 20, total: 30 })
    aiAccess.value = TRIAL(AI_TRIAL_LOW_THRESHOLD)
    expect(aiQuotaView.value.kind).toBe('low')
    aiAccess.value = TRIAL(0)
    expect(aiQuotaView.value.kind).toBe('exhausted')
    aiAccess.value = { tier: 'anonymous', used: 0, limit: 0, remaining: 0 }
    expect(aiQuotaView.value.kind).toBe('anonymous')
    aiAccess.value = { tier: 'pro', used: 0, limit: 0, remaining: 0 }
    expect(aiQuotaView.value.kind).toBe('pro')
  })

  it('refreshAiAccessSoon 合并多次调用为一次请求；拉取失败不把已知次数刷成未知', async () => {
    vi.useFakeTimers()
    const { aiAccess } = useEntitlement()
    aiAccess.value = TRIAL(10)
    mockFetchMyAiAccess.mockResolvedValue(TRIAL(9))
    refreshAiAccessSoon()
    refreshAiAccessSoon()
    refreshAiAccessSoon()
    await vi.advanceTimersByTimeAsync(900)
    expect(mockFetchMyAiAccess).toHaveBeenCalledTimes(1)
    expect(aiAccess.value.remaining).toBe(9)

    mockFetchMyAiAccess.mockResolvedValue({ tier: 'unknown', used: 0, limit: 0, remaining: 0 })
    refreshAiAccessSoon()
    await vi.advanceTimersByTimeAsync(900)
    expect(aiAccess.value.remaining).toBe(9)
  })

  it('notifyAiTrialExhausted 归零镜像并给出带升级按钮的提示，短时间内不重复弹', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-27T10:00:00Z'))
    const { aiAccess, aiQuotaView } = useEntitlement()
    aiAccess.value = TRIAL(3)
    notifyAiTrialExhausted()
    notifyAiTrialExhausted()
    expect(aiQuotaView.value.kind).toBe('exhausted')
    expect(toastWithActionMock).toHaveBeenCalledTimes(1)
    const ui = useUIStore()
    const openSpy = vi.spyOn(ui, 'openPurchase')
    toastWithActionMock.mock.calls[0][2]()
    expect(openSpy).toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-11-27T10:02:00Z'))
    notifyAiTrialExhausted()
    expect(toastWithActionMock).toHaveBeenCalledTimes(2)
  })

  it('额度标签：免费显示剩余次数，提醒态带升级入口，PRO 不显示，未登录引导登录', async () => {
    const { aiAccess } = useEntitlement()
    aiAccess.value = TRIAL(12)
    const wrapper = mount(AiQuotaChip)
    expect(wrapper.find('[data-testid="ai-quota-chip"]').text()).toContain('12 / 30')
    expect(wrapper.find('.ai-quota-action').exists()).toBe(false)

    aiAccess.value = TRIAL(2)
    await nextTick()
    const chip = wrapper.find('[data-testid="ai-quota-chip"]')
    expect(chip.classes()).toContain('is-low')
    expect(chip.find('.ai-quota-action').exists()).toBe(true)
    const ui = useUIStore()
    const openSpy = vi.spyOn(ui, 'openPurchase')
    await chip.trigger('click')
    expect(openSpy).toHaveBeenCalled()

    aiAccess.value = { tier: 'pro', used: 0, limit: 0, remaining: 0 }
    await nextTick()
    expect(wrapper.find('[data-testid="ai-quota-chip"]').exists()).toBe(false)

    aiAccess.value = { tier: 'anonymous', used: 0, limit: 0, remaining: 0 }
    await nextTick()
    await wrapper.find('[data-testid="ai-quota-chip"]').trigger('click')
    expect(authState.authModalOpen).toBe(true)
  })

  // PRO 用量：monthUsed 为每月次数（主限额 3000），dailyUsed 为单日防滥用上限（300），tokenUsed 为 token 兜底（上限 1000）
  const PRO = (monthUsed: number, dailyUsed = 10, tokenUsed = 100, monthLimit = 3000) => ({
    tier: 'pro' as const, used: 0, limit: 0, remaining: 0,
    pro: {
      dailyUsed, dailyLimit: 300, monthlyUsedTokens: tokenUsed, monthlyLimitTokens: 1000,
      requestsMonthUsed: monthUsed, requestsMonthLimit: monthLimit,
    },
  })

  it('PRO：以每月次数为主限额；单日 / 月度 / token 任一接近上限才标记 near', () => {
    const { aiAccess, aiQuotaView } = useEntitlement()
    aiAccess.value = PRO(400)
    expect(aiQuotaView.value).toMatchObject({ kind: 'pro', remaining: 2600, total: 3000 })
    expect(aiQuotaView.value.pro).toMatchObject({ monthRemaining: 2600, tokenPct: 10, near: false })
    // 月度剩余 ≤ 10%
    aiAccess.value = PRO(3000 - Math.floor(3000 * PRO_NEAR_RATIO))
    expect(aiQuotaView.value.pro).toMatchObject({ monthNear: true, near: true })
    // 单日防滥用上限剩余 ≤ 10%
    aiAccess.value = PRO(400, 300 - Math.floor(300 * PRO_NEAR_RATIO))
    expect(aiQuotaView.value.pro).toMatchObject({ dailyNear: true, monthNear: false, near: true })
    // token 兜底 ≥ 80%
    aiAccess.value = PRO(400, 10, PRO_MONTH_WARN_PCT * 10)
    expect(aiQuotaView.value.pro).toMatchObject({ tokenPct: PRO_MONTH_WARN_PCT, tokenNear: true, near: true })
    // 旧套餐无月度键：主限额退回每日次数
    aiAccess.value = PRO(0, 120, 100, 0)
    expect(aiQuotaView.value).toMatchObject({ remaining: 180, total: 300 })
    // 旧服务端：只有 tier，无 pro 用量
    aiAccess.value = { tier: 'pro', used: 0, limit: 0, remaining: 0 }
    expect(aiQuotaView.value).toEqual({ kind: 'pro', remaining: 0, total: 0 })
  })

  it('额度标签：PRO 平时不显示，接近月度上限时提醒，点击打开设置的账号页', async () => {
    const { aiAccess } = useEntitlement()
    aiAccess.value = PRO(400)
    const wrapper = mount(AiQuotaChip)
    expect(wrapper.find('[data-testid="ai-quota-chip"]').exists()).toBe(false)

    aiAccess.value = PRO(2950)
    await nextTick()
    const chip = wrapper.find('[data-testid="ai-quota-chip"]')
    expect(chip.text()).toContain('本月 AI 剩余 50 / 3000')

    // 单日上限更紧迫时优先显示单日
    aiAccess.value = PRO(400, 290)
    await nextTick()
    expect(wrapper.find('[data-testid="ai-quota-chip"]').text()).toContain('单日上限：剩 10 / 300')
    expect(chip.find('.ai-quota-action').exists()).toBe(false)
    const ui = useUIStore()
    const openSpy = vi.spyOn(ui, 'openPurchase')
    await wrapper.find('[data-testid="ai-quota-chip"]').trigger('click')
    expect(openSpy).not.toHaveBeenCalled()
    expect(ui.panels.settings).toBe(true)
    expect(ui.settingsInitialTab).toBe('account')
  })

  it('首次登录：账号未登记时区时自动上报本设备时区（initial 模式，每个会话一次）', async () => {
    const tzUnset = { zone: 'Asia/Shanghai', isSet: false }
    mockFetchMyAiAccess.mockResolvedValue({ ...TRIAL(30), tz: tzUnset })
    mockSetMyTimezone.mockResolvedValue({ ok: true, tz: { zone: 'Europe/Berlin', isSet: true, dailyResetsAt: '2026-11-28T23:00:00Z' } })
    const ent = useEntitlement()
    await ent.refreshAiAccess()
    await vi.waitFor(() => expect(mockSetMyTimezone).toHaveBeenCalledTimes(1))
    expect(mockSetMyTimezone.mock.calls[0][1]).toBe(true)
    await vi.waitFor(() => expect(ent.aiAccess.value.tz?.zone).toBe('Europe/Berlin'))
    // 同一会话再刷新不重复上报
    await ent.refreshAiAccess()
    expect(mockSetMyTimezone).toHaveBeenCalledTimes(1)
  })

  it('账号已登记时区：不上报', async () => {
    mockSetMyTimezone.mockReset()
    mockFetchMyAiAccess.mockResolvedValue({ ...TRIAL(30), tz: { zone: 'Asia/Tokyo', isSet: true } })
    await useEntitlement().refreshAiAccess()
    await nextTick()
    expect(mockSetMyTimezone).not.toHaveBeenCalled()
  })

  it('额度标签挂载时状态未知且已登录：补拉一次服务端次数', async () => {
    mockFetchMyAiAccess.mockResolvedValue(TRIAL(30))
    const wrapper = mount(AiQuotaChip)
    await vi.waitFor(() => expect(wrapper.find('[data-testid="ai-quota-chip"]').exists()).toBe(true))
    expect(wrapper.text()).toContain('30 / 30')
  })
})
