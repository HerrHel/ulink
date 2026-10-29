/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computed } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SettingsPanel from '../../components/shell/SettingsPanel.vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useAuthStore } from '../../stores/auth.js'
import { useSyncStore } from '../../stores/sync.js'
import * as useCloudSyncMod from '../../composables/domain/useCloudSync.js'
import * as useDataShareModule from '../../composables/domain/useDataShare.js'
import { useEntitlement } from '../../composables/domain/useEntitlement.js'

describe('SettingsPanel.vue — 双栏大弹窗与分类选项卡', () => {
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

  it('1. 默认展示大弹窗结构，且包含 6 个分类导航项（无 emoji）', async () => {
    ui.panels.settings = true
    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [pinia],
        stubs: {
          Teleport: true,
          Transition: false,
        },
      },
    })

    // 弹窗与遮罩
    expect(wrapper.find('.settings-dialog').exists()).toBe(true)
    expect(wrapper.find('.settings-nav').exists()).toBe(true)

    // 6 个选项卡
    const tabs = wrapper.findAll('.settings-nav-item')
    expect(tabs.length).toBe(7)

    // 检查选项卡不含任何 emoji
    const emojiRegex = /[\uD83C-\uDBFF\uDC00-\uDFFF]/
    for (const tab of tabs) {
      expect(emojiRegex.test(tab.text())).toBe(false)
    }

    // 默认激活第一项 (account)
    expect(tabs[0].classes()).toContain('active')
    const accountPanel = wrapper.find('[data-testid="settings-panel-account"]')
    expect(accountPanel.exists()).toBe(true)
    expect(accountPanel.isVisible()).toBe(true)
  })

  it('2. 点击导航项可流畅切换至不同分类面板', async () => {
    ui.panels.settings = true
    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [pinia],
        stubs: {
          Teleport: true,
          Transition: false,
        },
      },
    })

    // 切换至会员与账单 (billing)
    const billingTab = wrapper.find('[data-testid="settings-tab-billing"]')
    expect(billingTab.exists()).toBe(true)
    await billingTab.trigger('click')
    expect(billingTab.classes()).toContain('active')
    const billingPanel = wrapper.find('[data-testid="settings-panel-billing"]')
    expect(billingPanel.isVisible()).toBe(true)

    // 切换至外观 (appearance)
    const appearanceTab = wrapper.find('[data-testid="settings-tab-appearance"]')
    expect(appearanceTab.exists()).toBe(true)
    await appearanceTab.trigger('click')

    expect(appearanceTab.classes()).toContain('active')
    const appearancePanel = wrapper.find('[data-testid="settings-panel-appearance"]')
    expect(appearancePanel.isVisible()).toBe(true)

    // 切换至 AI (ai)
    const aiTab = wrapper.find('[data-testid="settings-tab-ai"]')
    await aiTab.trigger('click')
    expect(aiTab.classes()).toContain('active')
    const aiPanel = wrapper.find('[data-testid="settings-panel-ai"]')
    expect(aiPanel.isVisible()).toBe(true)

    // 切换至数据 (data)
    const dataTab = wrapper.find('[data-testid="settings-tab-data"]')
    await dataTab.trigger('click')
    expect(dataTab.classes()).toContain('active')
    const dataPanel = wrapper.find('[data-testid="settings-panel-data"]')
    expect(dataPanel.isVisible()).toBe(true)
  })

  it('3. 点击右上角关闭按钮与快捷键问号按钮行为正常', async () => {
    ui.panels.settings = true
    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [pinia],
        stubs: {
          Teleport: true,
          Transition: false,
        },
      },
    })

    // 点击问号打开快捷键帮助
    const helpBtn = wrapper.find('.sp-help-btn')
    expect(helpBtn.exists()).toBe(true)
    await helpBtn.trigger('click')
    expect(ui.panels.shortcutHelp).toBe(true)
    expect(ui.panels.settings).toBe(false)

    // 重新打开并测试关闭按钮
    ui.panels.settings = true
    await wrapper.vm.$nextTick()
    const closeBtn = wrapper.find('.modal-close')
    expect(closeBtn.exists()).toBe(true)
    await closeBtn.trigger('click')
    expect(ui.panels.settings).toBe(false)
  })

  it('4. 快速连续切换浅色/深色主题，设置弹窗绝不意外关闭', async () => {
    ui.panels.settings = true
    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [pinia],
        stubs: {
          Teleport: true,
          Transition: false,
        },
      },
    })

    // 切换到外观 tab
    const appearanceTab = wrapper.find('[data-testid="settings-tab-appearance"]')
    await appearanceTab.trigger('click')

    // 查找主题按钮
    const segButtons = wrapper.findAll('.sp-seg-btn')
    expect(segButtons.length).toBeGreaterThanOrEqual(2)
    const lightBtn = segButtons[0]
    const darkBtn = segButtons[1]

    // 快速交替点击多次
    await darkBtn.trigger('click')
    await lightBtn.trigger('click')
    await darkBtn.trigger('click')
    await lightBtn.trigger('click')
    await darkBtn.trigger('click')

    // 设置弹窗仍应保持打开
    expect(ui.panels.settings).toBe(true)
    expect(wrapper.find('.settings-dialog').exists()).toBe(true)
  })

  it('5. 遮罩层防误触：在弹窗内部 mousedown 并移出到遮罩层松开不会误关闭弹窗，只有在遮罩本身按下且松开才关闭', async () => {
    ui.panels.settings = true
    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [pinia],
        stubs: {
          Teleport: true,
          Transition: false,
        },
      },
    })

    const wrap = wrapper.find('.settings-modal-wrap')
    const dialog = wrapper.find('.settings-dialog')

    // 场景 A：用户在弹窗内部（如按钮/内容区）按下鼠标
    await dialog.trigger('mousedown')
    // 鼠标拖拽到遮罩并触发 click
    await wrap.trigger('click')
    // 弹窗必须保持打开！
    expect(ui.panels.settings).toBe(true)

    // 场景 B：用户明确在遮罩层外部区域按下鼠标并松开
    await wrap.trigger('mousedown')
    await wrap.trigger('click')
    // 弹窗关闭
    expect(ui.panels.settings).toBe(false)
  })

  it('6. 同步异常时展示错误提示横幅，支持一键重试同步与全量重传', async () => {
    ui.panels.settings = true
    const syncStore = useSyncStore()
    syncStore.setSyncStatus('error')
    syncStore.setSyncError('网络请求超时，请检查连接')
    syncStore.setSyncErrorKind('network')

    const fullSyncSpy = vi.fn().mockResolvedValue(true)
    const resyncAllSpy = vi.fn().mockResolvedValue(true)

    vi.spyOn(useCloudSyncMod, 'useCloudSync').mockReturnValue({
      syncStatus: computed(() => syncStore.syncStatus) as any,
      lastSyncAt: syncStore.lastSyncAt as any,
      syncError: computed(() => syncStore.syncError) as any,
      syncErrorKind: computed(() => syncStore.syncErrorKind) as any,
      autoSync: syncStore.autoSync as any,
      pendingCount: syncStore.pendingCount as any,
      pendingLockedCount: syncStore.pendingLockedCount as any,
      realtimeStatus: syncStore.realtimeStatus as any,
      syncLabel: { value: '同步失败' } as any,
      conflicts: { value: [] } as any,
      conflictBannerDismissed: { value: false } as any,
      lastClaim: { value: null } as any,
      fullSync: fullSyncSpy,
      resyncAllToCloud: resyncAllSpy,
      resetConflictBannerDismissed: vi.fn(),
      pushToCloud: vi.fn(),
      pullFromCloud: vi.fn(),
      debouncedSync: vi.fn(),
      syncImmediate: vi.fn(),
      initialSync: vi.fn(),
      resetSyncState: vi.fn(),
      initOnlineListener: vi.fn(),
      destroyOnlineListener: vi.fn(),
      refreshPendingCount: vi.fn(),
      subscribeRealtime: vi.fn(),
      unsubscribeRealtime: vi.fn(),
      fetchHistory: vi.fn(),
      restoreFromHistory: vi.fn(),
      resolveConflict: vi.fn(),
      resolveAllConflicts: vi.fn(),
      setGroupPublic: vi.fn(),
      fetchPublicGroup: vi.fn(),
    } as any)

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [pinia],
        stubs: {
          Teleport: true,
          Transition: false,
        },
      },
    })

    // 验证错误横幅出现
    const banner = wrapper.find('[data-testid="lv-sync-error-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('网络')

    // 点击重试同步按钮
    const retryBtn = wrapper.find('[data-testid="sp-retry-sync-btn"]')
    expect(retryBtn.exists()).toBe(true)
    await retryBtn.trigger('click')
    expect(fullSyncSpy).toHaveBeenCalledTimes(1)

    // 点击强制全量重传按钮
    const resyncBtn = wrapper.find('[data-testid="sp-resync-all-btn"]')
    expect(resyncBtn.exists()).toBe(true)
    await resyncBtn.trigger('click')
    expect(resyncAllSpy).toHaveBeenCalledTimes(1)
  })

  it('7. 凭证失效时展示重新登录按钮，点击打开登录弹窗', async () => {
    ui.panels.settings = true
    const authStore = useAuthStore()
    const syncStore = useSyncStore()
    syncStore.setSyncStatus('error')
    syncStore.setSyncError('401 Unauthorized token expired')
    syncStore.setSyncErrorKind('auth')

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [pinia],
        stubs: {
          Teleport: true,
          Transition: false,
        },
      },
    })

    const reauthBtn = wrapper.find('[data-testid="sp-reauth-btn"]')
    expect(reauthBtn.exists()).toBe(true)
    await reauthBtn.trigger('click')
    expect(authStore.authModalOpen).toBe(true)
    expect(ui.panels.settings).toBe(false)
  })
  it('8. 非 PRO 用户在 AI 设置中点击自然语言搜索开关会被拦截并提示升级', async () => {
    ui.panels.settings = true
    const { clear } = useEntitlement()
    clear()

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [pinia],
        stubs: { Teleport: true, Transition: false },
      },
    })

    const aiTab = wrapper.findAll('.settings-nav-item')[3]
    await aiTab.trigger('click')

    const toggle = wrapper.find('[data-testid="lv-semantic-search-toggle"]')
    expect(toggle.exists()).toBe(true)
    const pill = toggle.find('.sp-toggle-pill')
    expect(pill.classes()).not.toContain('active')

    const row = toggle.element.closest('.sp-card-row') as HTMLElement
    row.click()
    await wrapper.vm.$nextTick()

    expect(pill.classes()).not.toContain('active')
  })

  it('9. PRO 会员在 AI 设置中可正常开启/关闭自然语言搜索', async () => {
    ui.panels.settings = true
    const { entitlement } = useEntitlement()
    entitlement.value = {
      planId: 'pro_yearly',
      planName: 'PRO 年付',
      status: 'active',
      expiresAt: '2099-01-01',
      features: {},
      isPaid: true,
    }

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [pinia],
        stubs: { Teleport: true, Transition: false },
      },
    })

    const aiTab = wrapper.findAll('.settings-nav-item')[3]
    await aiTab.trigger('click')

    const toggle = wrapper.find('[data-testid="lv-semantic-search-toggle"]')
    expect(toggle.exists()).toBe(true)
    const pill = toggle.find('.sp-toggle-pill')

    ui.semanticSearchEnabled = true
    await wrapper.vm.$nextTick()
    expect(pill.classes()).toContain('active')

    const row = toggle.element.closest('.sp-card-row') as HTMLElement
    row.click()
    await wrapper.vm.$nextTick()
    expect(ui.semanticSearchEnabled).toBe(false)
    expect(pill.classes()).not.toContain('active')

    row.click()
    await wrapper.vm.$nextTick()
    expect(ui.semanticSearchEnabled).toBe(true)
    expect(pill.classes()).toContain('active')
  })
})
