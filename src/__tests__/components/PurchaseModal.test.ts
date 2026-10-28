import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PurchaseModal from '../../components/modals/PurchaseModal.vue'

const { mockPlans, mockCreate } = vi.hoisted(() => {
  return {
    mockPlans: [
      { planId: 'free', name: '免费版', priceCents: 0, currency: 'CNY', periodDays: 0 },
      { planId: 'pro_monthly', name: 'PRO 月付', priceCents: 1200, currency: 'CNY', periodDays: 30 },
      { planId: 'pro_quarterly', name: 'PRO 季付', priceCents: 3200, currency: 'CNY', periodDays: 90 },
      { planId: 'pro_yearly', name: 'PRO 年付', priceCents: 10800, currency: 'CNY', periodDays: 365 },
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

  it('1. 默认渲染双卡片居中（免费体验套餐 + 当前周期套餐）', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true, currentPlanId: 'free' },
      attachTo: document.body,
    })
    await nextTick()

    // 默认展示 2 张卡片：免费体验套餐 + 默认选中的月付
    const cards = wrapper.findAll('.pur-tier-card')
    expect(cards.length).toBe(2)

    // 免费版卡片有当前方案标识与中文名
    const freeCard = wrapper.find('[data-testid="plan-free"]')
    expect(freeCard.text()).toContain('体验套餐')
    expect(freeCard.text()).toContain('¥0')

    // 默认展示的月付卡片
    const monthlyCard = wrapper.find('[data-testid="plan-pro_monthly"]')
    expect(monthlyCard.text()).toContain('PRO 月付')
    expect(monthlyCard.text()).toContain('¥12')

    wrapper.unmount()
  })

  it('2. 顶部周期切换胶囊仅保留包月、包季、包年三项，切换展示对应方案', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true },
      attachTo: document.body,
    })
    await nextTick()

    const tabs = wrapper.findAll('.pur-cycle-tab')
    // 仅保留 3 个周期标签
    expect(tabs.length).toBe(3)
    expect(tabs[0].text()).toContain('包月')
    expect(tabs[1].text()).toContain('包季')
    expect(tabs[2].text()).toContain('包年')

    // 点击“包季”
    await tabs[1].trigger('click')
    await nextTick()
    const quarterlyCard = wrapper.find('[data-testid="plan-pro_quarterly"]')
    expect(quarterlyCard.exists()).toBe(true)
    expect(quarterlyCard.text()).toContain('PRO 季付')
    expect(quarterlyCard.find('del').text()).toBe('¥36')
    expect(quarterlyCard.text()).toContain('立省 ¥4')

    // 点击“包年”
    await tabs[2].trigger('click')
    await nextTick()
    const yearlyCard = wrapper.find('[data-testid="plan-pro_yearly"]')
    expect(yearlyCard.exists()).toBe(true)
    expect(yearlyCard.text()).toContain('PRO 年付')
    expect(yearlyCard.text()).toContain('最划算')
    expect(yearlyCard.find('del').text()).toBe('¥144')
    expect(yearlyCard.text()).toContain('立省 ¥36')
    expect(yearlyCard.classes()).toContain('is-recommended')

    // 点击“包月”恢复
    await tabs[0].trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="plan-pro_monthly"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('3. 完整参数对比表默认收起，点击可展开', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true },
      attachTo: document.body,
    })
    await nextTick()

    expect(wrapper.find('[data-testid="purchase-compare"]').exists()).toBe(false)

    // 点击展开
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

    // 默认展示月付，免费用户看付费卡片，按钮文字为「升级」
    const monthlyBtn = wrapper.find('[data-testid="plan-pro_monthly"] .pur-card-btn')
    expect(monthlyBtn.text()).toBe('升级')

    // 页面底部不再有旧版支付栏
    expect(wrapper.find('.pur-checkout-bar').exists()).toBe(false)

    await monthlyBtn.trigger('click')
    await nextTick()

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledWith('pro_monthly', 'wechat')

    // 唤起 Supabase 风格独立 2-Column 结算支付弹层
    expect(wrapper.find('.pur-checkout-dialog').exists()).toBe(true)
    expect(wrapper.find('.pur-checkout-left').exists()).toBe(true)
    expect(wrapper.find('.pur-checkout-right').exists()).toBe(true)
    expect(wrapper.find('.pur-checkout-right').text()).toContain('升级为 PRO 月付')

    // 点击“返回修改方案”，结算弹层关闭，回到套餐选择页
    const backBtn = wrapper.find('.pur-btn-ghost')
    await backBtn.trigger('click')
    await nextTick()
    expect(wrapper.find('.pur-checkout-dialog').exists()).toBe(false)

    wrapper.unmount()
  })

  it('5. 已购套餐卡片显示「续费」，未购套餐显示「升级」', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true, currentPlanId: 'pro_yearly' },
      attachTo: document.body,
    })
    await nextTick()

    // 已购的年付卡片自动激活包年标签，按钮显示为「续费」
    const yearlyBtn = wrapper.find('[data-testid="plan-pro_yearly"] .pur-card-btn')
    expect(yearlyBtn.text()).toBe('续费')

    // 切换到未购的月付标签，月付卡片按钮显示为「升级」
    const tabs = wrapper.findAll('.pur-cycle-tab')
    await tabs[0].trigger('click')
    await nextTick()
    const monthlyBtn = wrapper.find('[data-testid="plan-pro_monthly"] .pur-card-btn')
    expect(monthlyBtn.text()).toBe('升级')

    wrapper.unmount()
  })

  it('6. 月付卡片不显示冗余的「折合 12 元/月」，季付与年付展示立省标签', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true },
      attachTo: document.body,
    })
    await nextTick()

    // 默认月付卡片
    const monthlyCard = wrapper.find('[data-testid="plan-pro_monthly"]')
    expect(monthlyCard.text()).not.toContain('折合 ¥12/月')

    // 切换到季付
    const tabs = wrapper.findAll('.pur-cycle-tab')
    await tabs[1].trigger('click')
    await nextTick()
    const quarterlyCard = wrapper.find('[data-testid="plan-pro_quarterly"]')
    expect(quarterlyCard.text()).toContain('立省 ¥4')
    // 季付角标使用统一的 badge-discount 蓝色品牌类
    const badge = quarterlyCard.find('.pur-tier-badge')
    expect(badge.classes()).toContain('badge-discount')

    wrapper.unmount()
  })

  it('7. 免费版不包含自动死链检测，PRO 方案包含精炼核心特权', async () => {
    const wrapper = mount(PurchaseModal, {
      props: { visible: true },
      attachTo: document.body,
    })
    await nextTick()

    // 免费版
    const freeCard = wrapper.find('[data-testid="plan-free"]')
    expect(freeCard.text()).not.toContain('每日 3 次自动检测')
    expect(freeCard.text()).not.toContain('基础死链巡检')
    expect(freeCard.text()).toContain('死链手动检测')

    // PRO 月付
    const monthlyCard = wrapper.find('[data-testid="plan-pro_monthly"]')
    expect(monthlyCard.text()).toContain('AI 智能提取与自动补齐')
    expect(monthlyCard.text()).toContain('AI 自然语言模糊搜索')
    expect(monthlyCard.text()).toContain('全自动定期死链检测')
    expect(monthlyCard.text()).not.toContain('每天50次')
    expect(monthlyCard.text()).not.toContain('5 GB')

    wrapper.unmount()
  })
})
