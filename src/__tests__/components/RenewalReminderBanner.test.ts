import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import RenewalReminderBanner from '../../components/overlays/RenewalReminderBanner.vue'
import { useEntitlement } from '../../composables/domain/useEntitlement.js'
import { useUIStore } from '../../stores/ui.js'
import { useExtPanelStore } from '../../stores/extPanel.js'
import { renewalDismissKey } from '../../lib/renewal.js'

const DAY = 86_400_000
let wrapper: VueWrapper | null = null

function setEntitlement(isPaid: boolean, expiresAt: string | null, planId = 'pro_quarterly') {
  useEntitlement().entitlement.value = {
    planId: isPaid ? planId : 'free',
    planName: isPaid ? 'PRO 季付' : '免费版',
    status: 'active',
    expiresAt,
    features: {},
    isPaid,
  }
}

async function mountBanner() {
  wrapper = mount(RenewalReminderBanner, { attachTo: document.body })
  await nextTick()
  return wrapper
}

const banner = () => document.body.querySelector('[data-testid="lv-renewal-banner"]')

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  setEntitlement(false, null)
  localStorage.clear()
})

describe('RenewalReminderBanner：到期前续费提醒', () => {
  it('PRO 到期前 3 天显示提醒与剩余天数', async () => {
    setEntitlement(true, new Date(Date.now() + 3 * DAY - 60_000).toISOString())
    await mountBanner()
    expect(banner()).not.toBeNull()
    expect(banner()!.textContent).toContain('3')
  })

  it('免费用户、离到期还很远时不显示', async () => {
    setEntitlement(false, null)
    await mountBanner()
    expect(banner()).toBeNull()
    wrapper!.unmount()

    setEntitlement(true, new Date(Date.now() + 30 * DAY).toISOString())
    await mountBanner()
    expect(banner()).toBeNull()
  })

  it('点「稍后」后隐藏并记住，重新挂载也不再出现', async () => {
    const exp = new Date(Date.now() + 3 * DAY).toISOString()
    setEntitlement(true, exp)
    await mountBanner()
    ;(document.body.querySelector('[data-testid="lv-renewal-later"]') as HTMLButtonElement).click()
    await nextTick()
    expect(banner()).toBeNull()
    expect(localStorage.getItem(renewalDismissKey(exp, 'week'))).toBe('1')

    wrapper!.unmount()
    await mountBanner()
    expect(banner()).toBeNull()
  })

  it('点「续费」打开购买弹窗并优先选中年付', async () => {
    setEntitlement(true, new Date(Date.now() + 3 * DAY).toISOString())
    await mountBanner()
    const ui = useUIStore()
    ;(document.body.querySelector('[data-testid="lv-renewal-cta"]') as HTMLButtonElement).click()
    await nextTick()
    expect(ui.modals.purchase).toBe(true)
    expect(ui.purchasePreferCycle).toBe('yearly')
    // 弹窗打开期间横幅让位
    expect(banner()).toBeNull()
  })

  it('分享只读态与扩展侧边栏中不显示', async () => {
    setEntitlement(true, new Date(Date.now() + 3 * DAY).toISOString())
    const ui = useUIStore()
    ui.shareMode = { gid: 'g1' } as never
    await mountBanner()
    expect(banner()).toBeNull()

    ui.shareMode = null
    useExtPanelStore().active = true
    await nextTick()
    expect(banner()).toBeNull()

    useExtPanelStore().active = false
    await nextTick()
    expect(banner()).not.toBeNull()
  })
})
