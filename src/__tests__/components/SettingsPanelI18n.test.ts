/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SettingsPanel from '../../components/shell/SettingsPanel.vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useAuthStore } from '../../stores/auth.js'
import * as useDataShareModule from '../../composables/domain/useDataShare.js'
import { setLocale } from '../../i18n/index.js'

describe('SettingsPanel.vue — 英文模式下设置界面国际化', () => {
  let pinia: ReturnType<typeof createPinia>
  let ui: ReturnType<typeof useUIStore>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    ui = useUIStore()
    useDataStore()
    const auth = useAuthStore()
    auth.user = { id: 'u-test-1', email: 'test@example.com' } as any

    vi.restoreAllMocks()
    vi.spyOn(useDataShareModule, 'fetchUserCategoryShares').mockResolvedValue([])
  })

  it('在 en-US 语言下，设置面板渲染全英文标题、导言与说明文案', async () => {
    setLocale('en-US')
    ui.panels.settings = true

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [pinia],
        stubs: {
          Teleport: true,
          Transition: false,
          PurchaseModal: true,
        },
      },
    })

    // 弹窗主标题
    expect(wrapper.find('.settings-drawer-title').text()).toBe('Settings')

    // 选项卡名称
    const tabLabels = wrapper.findAll('.nav-item-label').map(el => el.text())
    expect(tabLabels).toContain('Account & Security')
    expect(tabLabels).toContain('Appearance')
    expect(tabLabels).toContain('Membership & Billing')
    expect(tabLabels).toContain('AI & Smart')
    expect(tabLabels).toContain('Maintenance & Sharing')
    expect(tabLabels).toContain('Data & Backup')
    expect(tabLabels).toContain('About & Help')

    // 导言段落 (Account Tab)
    const tabDesc = wrapper.find('.sp-tab-desc')
    expect(tabDesc.text()).toBe('Manage your cloud account, sync status, and end-to-end encryption')

    // 切换到外观页 Appearance
    const appearanceTab = wrapper.findAll('.settings-nav-item')[1]
    await appearanceTab.trigger('click')

    const appearanceCardHeads = wrapper.findAll('.sp-card-head').map(el => el.text())
    expect(appearanceCardHeads).toContain('Colors & Theme')
    expect(appearanceCardHeads).toContain('View & Sorting')

    // 恢复为 zh-CN
    setLocale('zh-CN')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.settings-drawer-title').text()).toBe('设置')
  })
})
