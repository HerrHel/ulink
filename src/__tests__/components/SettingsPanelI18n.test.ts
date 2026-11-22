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
    expect(tabLabels).toHaveLength(5)
    expect(tabLabels).toContain('Account & Membership')
    expect(tabLabels).toContain('Appearance')
    expect(tabLabels).toContain('AI')
    expect(tabLabels).toContain('Data & Maintenance')
    expect(tabLabels).toContain('About & Help')

    // 标签页只有标题，不再有导言段落 (Account Tab)
    expect(wrapper.find('.sp-tab-title').text()).toBe('Account & Membership')
    expect(wrapper.find('.sp-tab-desc').exists()).toBe(false)

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
