import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PurchaseModal from '../../components/modals/PurchaseModal.vue'
import { useEntitlement } from '../../composables/domain/useEntitlement.js'
import { useUIStore } from '../../stores/ui.js'

// 与线上 plans 表同构（2026-11-03 核对）：月付 ¥15 / 季付 ¥36 / 年付 ¥108，
// plan id 也取真实库里的值（plus_monthly / pro_quarterly / plus_yearly），
// 避免 mock 与生产漂移后测试仍"自说自话"。
const { mockPlans, mockCreate } = vi.hoisted(() => {
  return {
    mockPlans: [
      // features 取迁移 20261121000001 之后的线上口径（历史保留 free 7 / PRO 365，storage.bytes 已撤下）
      { planId: 'free', name: '免费版', priceCents: 0, currency: 'CNY', periodDays: 0, features: { 'history.days': 7, 'ai.requests.daily': 20 } },
      { planId: 'plus_monthly', name: 'PRO 月付', priceCents: 1500, currency: 'CNY', periodDays: 30, features: { 'history.days': 365, 'ai.requests.daily': 100 } },
      { planId: 'pro_quarterly', name: 'PRO 季付', priceCents: 3600, currency: 'CNY', periodDays: 90, features: { 'history.days': 365, 'ai.requests.daily': 100 } },
      { planId: 'plus_yearly', name: 'PRO 年付', priceCents: 10800, currency: 'CNY', periodDays: 365, features: { 'history.days': 365, 'ai.requests.daily': 100 } },
    ],
    mockCreate: vi.fn().mockResolvedValue({
      orderId: 'ord_123',
      qrCode: 'https://pay.example.com/qr',
      expiresAt: new Date(Date.now() + 1800000).toISOString(),
    }),
  }
})

vi.mock('../../composables/domain/usePurchasePlans.js', () => ({
  fetchPurchasePlans: vi.fn().mockResolvedValue(mockPlans),
  getCachedPlans: vi.fn().mockReturnValue(mockPlans),
}))

vi.mock('../../composables/domain/usePayment.js', () => ({
  usePayment: () => ({
    create: mockCreate,
    checkStatus: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    reset: vi.fn(),
    creating: { value: false },
    checking: { value: false },
    polling: { value: false },
    error: { value: null },
    order: { value: null },
    isPaid: { value: false },
    expired: { value: false },
  }),
}))

describe('PurchaseModal.vue（图2新格局）', () => {
  beforeEach(() => {
    mockCreate.mockClear()
  })

  it('1. 默认渲染双卡片居中（基础免费版 + 默认年付档）', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true, currentPlanId: 'free' },
      attachTo: document.body,
    })
    await nextTick()

    // 默认展示 2 张卡片：免费版 + 默认选中的年付（推荐档）
    const cards = wrapper.findAll('.pur-tier-card')
    expect(cards.length).toBe(2)

    const freeCard = wrapper.find('[data-testid="plan-free"]')
    expect(freeCard.text()).toContain('基础免费版')
    expect(freeCard.text()).toContain('¥0')

    const yearlyCard = wrapper.find('[data-testid="plan-plus_yearly"]')
    expect(yearlyCard.text()).toContain('PRO 年付')
    expect(yearlyCard.text()).toContain('¥108')
    // 被比较价 = 按月订阅 12 个月合计 ¥180（真实可购方案，非虚构原价）
    expect(yearlyCard.find('del').text()).toBe('¥180')
    expect(yearlyCard.text()).toContain('按月订阅 12 个月合计 ¥180')

    wrapper.unmount()
  })

  it('2. 顶部周期切换胶囊仅保留包月、包季、包年三项，切换展示对应方案', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true },
      attachTo: document.body,
    })
    await nextTick()

    const tabs = wrapper.findAll('.pur-cycle-tab')
    expect(tabs.length).toBe(3)
    expect(tabs[0].text()).toContain('包月')
    expect(tabs[1].text()).toContain('包季')
    expect(tabs[2].text()).toContain('包年')

    // 包季：¥36（2026-11-23 调价），划线 ¥45（= 月付 ¥15 × 3），立省 ¥9
    await tabs[1].trigger('click')
    await nextTick()
    const quarterlyCard = wrapper.find('[data-testid="plan-pro_quarterly"]')
    expect(quarterlyCard.exists()).toBe(true)
    expect(quarterlyCard.text()).toContain('PRO 季付')
    expect(quarterlyCard.find('del').text()).toBe('¥45')
    expect(quarterlyCard.text()).toContain('省 ¥9')
    expect(quarterlyCard.text()).toContain('按月订阅 3 个月合计 ¥45')

    // 包年：¥108，划线 ¥180，立省 ¥72（40%），并标推荐
    await tabs[2].trigger('click')
    await nextTick()
    const yearlyCard = wrapper.find('[data-testid="plan-plus_yearly"]')
    expect(yearlyCard.exists()).toBe(true)
    expect(yearlyCard.text()).toContain('PRO 年付')
    // 合规修订：徽标文案由「首发早鸟」改为「订阅期内价格锁定」（见 locales/parts/purchase.ts）
    expect(yearlyCard.text()).toContain('订阅期内价格锁定')
    expect(yearlyCard.find('del').text()).toBe('¥180')
    expect(yearlyCard.text()).toContain('省 ¥72')
    expect(yearlyCard.classes()).toContain('is-recommended')

    // 包月：¥15 且**不显示**划线价（月付即基准价，没有可对比的更高参照）
    await tabs[0].trigger('click')
    await nextTick()
    const monthlyCard = wrapper.find('[data-testid="plan-plus_monthly"]')
    expect(monthlyCard.exists()).toBe(true)
    expect(monthlyCard.text()).toContain('¥15')
    expect(monthlyCard.find('del').exists()).toBe(false)

    wrapper.unmount()
  })

  it('3. 完整参数对比表默认收起，点击可展开', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true },
      attachTo: document.body,
    })
    await nextTick()

    expect(wrapper.find('[data-testid="purchase-compare"]').exists()).toBe(false)

    const toggleBtn = wrapper.find('.pur-toggle-btn')
    await toggleBtn.trigger('click')
    await nextTick()

    expect(wrapper.find('[data-testid="purchase-compare"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('4. 点击卡片上的订阅按钮直接唤起支付下单', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true, currentPlanId: 'free' },
      attachTo: document.body,
    })
    await nextTick()

    // 默认展示年付档，免费用户看到的是「升级」
    const yearlyBtn = wrapper.find('[data-testid="plan-plus_yearly"] .pur-card-btn')
    expect(yearlyBtn.text()).toBe('升级')

    // 页面底部不再有旧版支付栏
    expect(wrapper.find('.pur-checkout-bar').exists()).toBe(false)

    await yearlyBtn.trigger('click')
    await nextTick()

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledWith('plus_yearly', 'wechat')

    // 唤起独立 2-Column 结算支付弹层
    expect(wrapper.find('.pur-checkout-dialog').exists()).toBe(true)
    expect(wrapper.find('.pur-checkout-left').exists()).toBe(true)
    expect(wrapper.find('.pur-checkout-right').exists()).toBe(true)
    expect(wrapper.find('.pur-checkout-right').text()).toContain('升级为 PRO 年付')

    // 点击「返回修改方案」，结算弹层关闭，回到套餐选择页
    const backBtn = wrapper.find('.pur-btn-ghost')
    await backBtn.trigger('click')
    await nextTick()
    expect(wrapper.find('.pur-checkout-dialog').exists()).toBe(false)

    wrapper.unmount()
  })

  it('5. 普通未购用户显示「升级」，已有 PRO 会员在任何 PRO 周期档位均显示「续费」', async () => {
    // A. 免费版用户：PRO 方案显示「升级」
    const freeWrapper = mount(PurchaseModal, {
      props: { visible: true, currentPlanId: 'free' },
      attachTo: document.body,
    })
    await nextTick()
    const freeYearlyBtn = freeWrapper.find('[data-testid="plan-plus_yearly"] .pur-card-btn')
    expect(freeYearlyBtn.text()).toBe('升级')
    expect(freeWrapper.find('.pur-title').text()).toBe('升级 与链 PRO')
    freeWrapper.unmount()

    // B. 已有 PRO 用户：PRO 方案显示「续费」，弹窗标题显示「续费 与链 PRO」
    const proWrapper = mount(PurchaseModal, {
      props: { visible: true, currentPlanId: 'plus_yearly' },
      attachTo: document.body,
    })
    await nextTick()

    expect(proWrapper.find('.pur-title').text()).toBe('续费 与链 PRO')
    const yearlyBtn = proWrapper.find('[data-testid="plan-plus_yearly"] .pur-card-btn')
    expect(yearlyBtn.text()).toBe('续费')
    expect(proWrapper.find('[data-testid="plan-plus_yearly"] .pur-features-heading').text()).toContain('以及全部 PRO 功能')

    const tabs = proWrapper.findAll('.pur-cycle-tab')
    await tabs[0].trigger('click')
    await nextTick()
    const monthlyBtn = proWrapper.find('[data-testid="plan-plus_monthly"] .pur-card-btn')
    expect(monthlyBtn.text()).toBe('续费')

    proWrapper.unmount()
  })

  it('6. 月付不显示冗余的折合单价，季付角标使用统一折扣类', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true },
      attachTo: document.body,
    })
    await nextTick()

    const tabs = wrapper.findAll('.pur-cycle-tab')
    await tabs[0].trigger('click')
    await nextTick()
    const monthlyCard = wrapper.find('[data-testid="plan-plus_monthly"]')
    expect(monthlyCard.text()).not.toContain('折合 ¥15/月')

    await tabs[1].trigger('click')
    await nextTick()
    const quarterlyCard = wrapper.find('[data-testid="plan-pro_quarterly"]')
    expect(quarterlyCard.text()).toContain('省 ¥9')
    const badge = quarterlyCard.find('.pur-tier-badge')
    expect(badge.classes()).toContain('badge-discount')

    wrapper.unmount()
  })

  it('7. 免费版不含自动死链巡检，PRO 方案包含核心特权', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true },
      attachTo: document.body,
    })
    await nextTick()

    const freeCard = wrapper.find('[data-testid="plan-free"]')
    expect(freeCard.text()).not.toContain('每日 3 次自动检测')
    expect(freeCard.text()).not.toContain('基础死链巡检')
    expect(freeCard.text()).not.toContain('全库健康巡检')

    const tabs = wrapper.findAll('.pur-cycle-tab')
    await tabs[0].trigger('click')
    await nextTick()
    const monthlyCard = wrapper.find('[data-testid="plan-plus_monthly"]')
    expect(monthlyCard.text()).toContain('全库健康巡检与失效死链自愈')
    expect(monthlyCard.text()).toContain('AI 网页深度阅读与自动补齐')
    expect(monthlyCard.text()).not.toContain('每天50次')
    expect(monthlyCard.text()).not.toContain('5 GB')

    wrapper.unmount()
  })

  it('8. 云端历史保留期按 plans.features 展示：免费 7 天、PRO 365 天；对比表不再出现存储配额', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true, currentPlanId: 'free' },
      attachTo: document.body,
    })
    await nextTick()

    // 天数来自数据而非写死文案：旧文案曾写死「90 天」，与云端清理口径脱节
    const freeCard = wrapper.find('[data-testid="plan-free"]')
    expect(freeCard.text()).toContain('7 天云端历史版本回溯')
    expect(freeCard.text()).not.toContain('90 天')
    const yearlyCard = wrapper.find('[data-testid="plan-plus_yearly"]')
    expect(yearlyCard.text()).toContain('365 天云端历史版本回溯')

    await wrapper.find('.pur-toggle-btn').trigger('click')
    await nextTick()
    const compare = wrapper.find('[data-testid="purchase-compare"]')
    expect(compare.text()).toContain('云端版本历史保留')
    expect(compare.text()).toContain('7 天')
    expect(compare.text()).toContain('365 天')
    expect(compare.text()).not.toContain('云端空间配额')

    wrapper.unmount()
  })

  it('9. PRO 档缺 history.days 时不渲染历史要点（不凭空承诺）', async () => {
    const saved = mockPlans.map((p) => ({ ...p, features: { ...p.features } }))
    for (const p of mockPlans) if (p.planId !== 'free') delete (p.features as Record<string, number>)['history.days']
    try {
      const wrapper = mount(PurchaseModal, {
        props: { visible: true, currentPlanId: 'free' },
        attachTo: document.body,
      })
      await nextTick()
      expect(wrapper.find('[data-testid="plan-plus_yearly"]').text()).not.toContain('云端历史版本回溯')
      wrapper.unmount()
    } finally {
      saved.forEach((p, i) => { mockPlans[i].features = p.features })
    }
  })
  describe('续费：顺延说明与年付优先', () => {
    function setPro(expiresAt: string | null) {
      useEntitlement().entitlement.value = {
        planId: expiresAt ? 'pro_quarterly' : 'free',
        planName: expiresAt ? 'PRO 季付' : '免费版',
        status: 'active',
        expiresAt,
        features: {},
        isPaid: Boolean(expiresAt),
      }
    }

    it('10. 已是 PRO：显示剩余天数与「续费顺延不浪费」说明；免费用户不显示', async () => {
      setPro(new Date(Date.now() + 10 * 86_400_000 - 60_000).toISOString())
      try {
        const wrapper = mount(PurchaseModal, { props: { visible: true, currentPlanId: 'pro_quarterly' }, attachTo: document.body })
        await nextTick()
        const note = wrapper.find('[data-testid="purchase-renew-note"]')
        expect(note.exists()).toBe(true)
        expect(note.text()).toContain('10 天')
        expect(note.text()).toContain('顺延')
        wrapper.unmount()
      } finally {
        setPro(null)
      }
      const free = mount(PurchaseModal, { props: { visible: true, currentPlanId: 'free' }, attachTo: document.body })
      await nextTick()
      expect(free.find('[data-testid="purchase-renew-note"]').exists()).toBe(false)
      free.unmount()
    })

    it('11. 从续费提醒打开（preferCycle=yearly）：季付用户默认选中包年；关闭后清除偏好', async () => {
      const ui = useUIStore()
      // 对照：不带偏好时季付用户默认停在当前档（包季）
      const plain = mount(PurchaseModal, { props: { visible: true, currentPlanId: 'pro_quarterly' }, attachTo: document.body })
      await nextTick()
      expect(plain.find('.pur-cycle-tab.active').text()).toContain('包季')
      plain.unmount()

      ui.openPurchase({ preferCycle: 'yearly' })
      const wrapper = mount(PurchaseModal, { props: { visible: true, currentPlanId: 'pro_quarterly' }, attachTo: document.body })
      await nextTick()
      expect(wrapper.find('.pur-cycle-tab.active').text()).toContain('包年')
      expect(wrapper.find('[data-testid="plan-plus_yearly"]').exists()).toBe(true)
      await wrapper.find('.pur-close').trigger('click')
      expect(ui.purchasePreferCycle).toBeNull()
      wrapper.unmount()
    })
  })
})
