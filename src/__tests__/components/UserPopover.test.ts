import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { useUserPopoverStore } from '../../stores/overlay.js'
import { useUIStore } from '../../stores/ui.js'
import { useAuthStore } from '../../stores/auth.js'
import { useE2EStore } from '../../stores/e2e.js'
import UserPopover from '../../components/overlays/UserPopover.vue'

// 模拟 toast
vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
}))

// 模拟 useCloudSync
const fullSyncMock = vi.fn().mockResolvedValue(true)
const resetSyncStateMock = vi.fn().mockResolvedValue(true)
vi.mock('../../composables/domain/useCloudSync.js', () => ({
  useCloudSync: () => ({
    fullSync: fullSyncMock,
    resetSyncState: resetSyncStateMock,
    syncStatus: ref('idle'),
    syncErrorKind: ref(null),
    syncLabel: ref('已就绪'),
    realtimeStatus: ref('connected'),
    pendingCount: ref(0),
    pendingLockedCount: ref(0),
    conflicts: ref([]),
  }),
}))

describe('UserPopover.vue', () => {
  beforeEach(() => {
    fullSyncMock.mockClear()
    resetSyncStateMock.mockClear()
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

  it('triggers sync when clicking sync button', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()

    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const syncBtn = document.querySelector('.up-sync-trigger-btn') as HTMLButtonElement
    expect(syncBtn).not.toBeNull()
    await syncBtn.click()

    expect(fullSyncMock).toHaveBeenCalledTimes(1)
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
    const settingsItem = card?.querySelectorAll('.up-menu-item')[2]
    expect(settingsItem?.textContent).toContain('偏好设置')

    await (settingsItem as HTMLElement).click()
    await nextTick()

    expect(uiStore.panels.settings).toBe(true)
    expect(popoverStore.open).toBe(false)

    wrapper.unmount()
  })

  it('signs out when clicking sign out item', async () => {
    const popoverStore = useUserPopoverStore()
    const authStore = useAuthStore()
    const signOutSpy = vi.spyOn(authStore, 'signOut').mockResolvedValue(true)

    authStore.user = { id: 'u1', email: 'alice@example.com' } as any
    popoverStore.show()
    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    const card = document.querySelector('.user-popover-card')
    const signOutItem = card?.querySelector('.up-danger-item') as HTMLElement
    expect(signOutItem?.textContent).toContain('退出登录')

    await signOutItem.click()
    await nextTick()

    expect(signOutSpy).toHaveBeenCalledTimes(1)
    expect(popoverStore.open).toBe(false)

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
})
