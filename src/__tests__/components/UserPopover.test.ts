import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { useUserPopoverStore } from '../../stores/overlay.js'
import { useUIStore } from '../../stores/ui.js'
import { useAuthStore } from '../../stores/auth.js'
import { useE2EStore } from '../../stores/e2e.js'
// 模拟 fetchMyEntitlement
const fetchMyEntitlementMock = vi.fn().mockResolvedValue({
  planId: 'free',
  planName: 'free',
  status: 'active',
  expiresAt: null,
  features: {},
  isPaid: false,
})
vi.mock('../../composables/domain/useRedeem.js', () => ({
  fetchMyEntitlement: () => fetchMyEntitlementMock(),
}))

import UserPopover from '../../components/overlays/UserPopover.vue'

// PurchaseModal 已改为异步组件（首屏瘦身）：预热模块缓存，避免加载晚于用例卸载而串扰后续用例
beforeAll(async () => { await import('../../components/modals/PurchaseModal.vue') })
import { useEntitlement } from '../../composables/domain/useEntitlement.js'

// 模拟 toast（hoisted 引用，便于断言「远端失败不提示成功」）
const toastMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/toast.js', () => ({
  toast: toastMock,
}))

// 模拟 useCloudSync
const fullSyncMock = vi.fn().mockResolvedValue(true)
const resetSyncStateMock = vi.fn().mockResolvedValue(true)
// 登出唯一入口：signOutAndReset（登出 + 无条件清同步态），见 useCloudSync 注释
const signOutAndResetMock = vi.fn().mockResolvedValue(true)
const pendingLockedCountMock = ref(0)
vi.mock('../../composables/domain/useCloudSync.js', () => ({
  useCloudSync: () => ({
    fullSync: fullSyncMock,
    resetSyncState: resetSyncStateMock,
    signOutAndReset: signOutAndResetMock,
    syncStatus: ref('idle'),
    syncErrorKind: ref(null),
    syncLabel: ref('已就绪'),
    realtimeStatus: ref('connected'),
    pendingCount: ref(0),
    pendingLockedCount: pendingLockedCountMock,
    conflicts: ref([]),
  }),
}))

describe('UserPopover.vue', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    fullSyncMock.mockClear()
    resetSyncStateMock.mockClear()
    signOutAndResetMock.mockClear()
    toastMock.mockClear()
    useEntitlement().clear()
  })

  it('does not render popover when store.open is false or not logged in', async () => {
    const wrapper = mount(UserPopover, { attachTo: document.body })
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()

    // 默认未登录且未打开
    expect(document.querySelector('.user-popover-card')).toBeNull()

    // 登录但未打开
    authStore.user = { id: 'u1', email: 'test@example.com' } as any
    await nextTick()
    expect(document.querySelector('.user-popover-card')).toBeNull()

    // 打开但未登录
    authStore.user = null
    popoverStore.open = true
    await nextTick()
    expect(document.querySelector('.user-popover-card')).toBeNull()

    wrapper.unmount()
  })

  it('renders correctly when open and logged in', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    authStore.user = { id: 'u1', email: 'alice@example.com', user_metadata: {} } as any

    popoverStore.show({ left: 50, top: 500, right: 200, bottom: 540, width: 150, height: 40 } as DOMRect)
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const card = document.querySelector('.user-popover-card')
    expect(card).not.toBeNull()

    // 检查邮箱与昵称
    expect(card?.querySelector('.up-name')?.textContent).toBe('alice')
    expect(card?.querySelector('.up-email')?.textContent).toBe('alice@example.com')

    wrapper.unmount()
  })

  it('handles e2e state when disabled (not setup)', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    const e2eStore = useE2EStore()
    const uiStore = useUIStore()

    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    e2eStore.setEnabled(false)
    e2eStore.setUnlocked(false)

    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const card = document.querySelector('.user-popover-card')
    const e2eItem = card?.querySelectorAll('.up-menu-item')[1]
    expect(e2eItem?.textContent).toContain('数据解密')
    expect(e2eItem?.textContent).toContain('未设置主密码')
    expect(e2eItem?.textContent).toContain('开启')

    // 点击 e2e 选项，唤起 e2eSetup 弹窗并关闭 popover
    await (e2eItem as HTMLElement).click()
    await nextTick()

    expect(uiStore.modals.e2eSetup).toBe(true)
    expect(popoverStore.open).toBe(false)

    wrapper.unmount()
  })

  it('handles e2e state when locked', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    const e2eStore = useE2EStore()
    const uiStore = useUIStore()

    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    e2eStore.setEnabled(true)
    e2eStore.setUnlocked(false)

    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const card = document.querySelector('.user-popover-card')
    const e2eItem = card?.querySelectorAll('.up-menu-item')[1]
    expect(e2eItem?.textContent).toContain('数据解密')
    expect(e2eItem?.textContent).toContain('数据已加密保护')
    expect(e2eItem?.textContent).toContain('解密')

    // 点击 e2e 选项，唤起 e2eUnlock 弹窗并关闭 popover
    await (e2eItem as HTMLElement).click()
    await nextTick()

    expect(uiStore.modals.e2eUnlock).toBe(true)
    expect(popoverStore.open).toBe(false)

    wrapper.unmount()
  })

  it('handles e2e state when unlocked and allows locking', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    const e2eStore = useE2EStore()

    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    e2eStore.setEnabled(true)
    e2eStore.setUnlocked(true)

    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const card = document.querySelector('.user-popover-card')
    const e2eItem = card?.querySelectorAll('.up-menu-item')[1]
    expect(e2eItem?.textContent).toContain('数据解密')
    expect(e2eItem?.textContent).toContain('已解密可用')
    expect(e2eItem?.textContent).toContain('加锁')

    // 点击加锁
    await (e2eItem as HTMLElement).click()
    await nextTick()

    expect(e2eStore.isUnlocked).toBe(false)
    expect(popoverStore.open).toBe(false)

    wrapper.unmount()
  })

  it('triggers sync when clicking sync button and aligns icon with text', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()

    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const syncBtn = document.querySelector('.up-sync-trigger-btn') as HTMLButtonElement
    expect(syncBtn).not.toBeNull()
    expect(syncBtn.querySelector('.up-spin-icon')).not.toBeNull()
    expect(syncBtn.querySelector('.up-sync-btn-text')).not.toBeNull()
    await syncBtn.click()

    expect(fullSyncMock).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('renders concise pending locked label with tooltip when items are locked', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    pendingLockedCountMock.value = 2

    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const statusText = document.querySelector('.up-status-text') as HTMLElement
    expect(statusText).not.toBeNull()
    expect(statusText.textContent).toContain('2 项待解锁')
    expect(statusText.getAttribute('title')).toContain('等待解锁后同步')

    pendingLockedCountMock.value = 0
    wrapper.unmount()
  })

  it('toggles theme when clicking quick theme switch item', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    const uiStore = useUIStore()
    const toggleSpy = vi.spyOn(uiStore, 'toggleTheme').mockImplementation(() => {})

    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const themeItem = document.querySelector('[data-testid="up-theme-item"]') as HTMLElement
    expect(themeItem).not.toBeNull()
    await themeItem.click()
    await nextTick()

    expect(toggleSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('navigates to preferences settings when clicking settings item', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    const uiStore = useUIStore()

    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const card = document.querySelector('.user-popover-card')
    const menuItems = Array.from(card?.querySelectorAll('.up-menu-item') || [])
    const settingsItem = menuItems.find((el) => el.textContent?.includes('偏好设置'))
    expect(settingsItem?.textContent).toContain('偏好设置')

    await (settingsItem as HTMLElement).click()
    await nextTick()

    expect(uiStore.panels.settings).toBe(true)
    expect(popoverStore.open).toBe(false)

    wrapper.unmount()
  })

  it('点「退出登录」走 signOutAndReset（登出 + 无条件清同步态）', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()

    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const card = document.querySelector('.user-popover-card')
    const signOutItem = card?.querySelector('.up-danger-item') as HTMLElement
    expect(signOutItem?.textContent).toContain('退出登录')

    await signOutItem.click()
    await nextTick()

    // 必须走统一入口：远端登出失败时也要清同步态（离线登出回归的保护点）
    expect(signOutAndResetMock).toHaveBeenCalledTimes(1)
    expect(popoverStore.open).toBe(false)

    wrapper.unmount()
  })

  it('远端登出未确认（返回 false）时不弹「已退出」成功提示', async () => {
    signOutAndResetMock.mockResolvedValueOnce(false)
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const signOutItem = document.querySelector('.user-popover-card .up-danger-item') as HTMLElement
    await signOutItem.click()
    await nextTick()

    expect(signOutAndResetMock).toHaveBeenCalledTimes(1)
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining('已退出'), true)

    wrapper.unmount()
  })

  it('supports inline editing of profile nickname and avatar', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    const updateProfileSpy = vi.spyOn(authStore, 'updateProfile').mockResolvedValue(true)

    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    // 点击“编辑资料”按钮
    const editBtn = document.querySelector('.up-edit-btn') as HTMLButtonElement
    await editBtn.click()
    await nextTick()

    // 应该展示编辑区域
    const editBox = document.querySelector('.up-edit-box')
    expect(editBox).not.toBeNull()

    // 修改输入框
    const input = editBox?.querySelector('input.up-input') as HTMLInputElement
    input.value = 'Alice Cooper'
    input.dispatchEvent(new Event('input'))
    await nextTick()

    // 选择第一个预设 emoji
    const emojiBtn = editBox?.querySelectorAll('.up-emoji-btn')[0] as HTMLButtonElement
    await emojiBtn.click()
    await nextTick()

    // 保存
    const saveBtn = editBox?.querySelector('.btn-primary') as HTMLButtonElement
    await saveBtn.click()
    await nextTick()

    expect(updateProfileSpy).toHaveBeenCalledWith({
      nickname: 'Alice Cooper',
      avatar: emojiBtn.textContent?.trim(),
    })

    wrapper.unmount()
  })
  it('renders upgrade entry and opens purchase modal on click', async () => {
    fetchMyEntitlementMock.mockResolvedValueOnce({
      planId: 'free',
      planName: 'free',
      status: 'active',
      expiresAt: null,
      features: {},
      isPaid: false,
    })

    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    authStore.user = { id: 'u1', email: 'alice@example.com' } as any

    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()
    // 等待 loadMember 异步微任务完成
    await new Promise(r => setTimeout(r, 10))
    await nextTick()

    const card = document.querySelector('.user-popover-card')
    const upgradeBtn = card?.querySelector('[data-testid="up-upgrade-btn"]') as HTMLButtonElement
    expect(upgradeBtn).not.toBeNull()
    expect(upgradeBtn.textContent).toContain('升级套餐')
    expect(upgradeBtn.textContent).toContain('解锁 AI 额度与无限同步')

    // 点击升级项：关闭 popover 并打开 PurchaseModal
    await upgradeBtn.click()
    await flushPromises()
    await nextTick()

    expect(popoverStore.open).toBe(false)
    const purchaseModal = document.querySelector('.pur-modal')
    expect(purchaseModal).not.toBeNull()

    wrapper.unmount()
  })

  it('renders PRO member badge when user is paid', async () => {
    fetchMyEntitlementMock.mockResolvedValueOnce({
      planId: 'pro_yearly',
      planName: 'PRO 年付方案',
      status: 'active',
      expiresAt: null,
      features: {},
      isPaid: true,
    })

    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    authStore.user = { id: 'u1', email: 'alice@example.com' } as any

    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()
    await new Promise(r => setTimeout(r, 10))
    await nextTick()

    const card = document.querySelector('.user-popover-card')
    const upgradeBtn = card?.querySelector('[data-testid="up-upgrade-btn"]') as HTMLButtonElement
    expect(upgradeBtn).not.toBeNull()
    expect(upgradeBtn.classList.contains('is-paid')).toBe(true)
    expect(upgradeBtn.textContent).toContain('PRO 会员')
    expect(upgradeBtn.textContent).toContain('PRO 年付方案')

    const heroProBadge = card?.querySelector('.up-hero .up-pro-badge')
    expect(heroProBadge).not.toBeNull()
    expect(heroProBadge?.textContent).toBe('PRO')

    wrapper.unmount()
  })
})

// #45 调用方：updateProfile 返回 false 时不得无条件弹「已保存」
describe('UserPopover 保存失败不弹「已保存」（#45）', () => {
  it('updateProfile 返回 false → 弹失败提示且保持编辑态', async () => {
    const { toast } = await import('../../lib/toast.js')
    ;(toast as any).mockClear?.()
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    vi.spyOn(authStore, 'updateProfile').mockResolvedValue(false)
    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()
    ;(document.querySelector('.up-edit-btn') as HTMLButtonElement).click()
    await nextTick()
    ;(document.querySelector('.up-edit-box .btn-primary') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    expect(toast).not.toHaveBeenCalledWith('个人资料已更新')
    expect(toast).toHaveBeenCalledWith('操作失败', false)
    expect(document.querySelector('.up-edit-box')).not.toBeNull()
    wrapper.unmount()
  })
})