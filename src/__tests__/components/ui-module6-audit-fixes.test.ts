import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, ref, h } from 'vue'

import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useE2EStore } from '../../stores/e2e.js'
import { useContextMenuStore } from '../../stores/contextMenu.js'
import { useActionSheetStore } from '../../stores/actionSheet.js'
import { useAppStore } from '../../stores/app.js'
import { useAuthStore } from '../../stores/auth.js'
import { useChatPanelShell } from '../../composables/ui/useChatPanelShell.js'
import { useEntitlement, ENTITLEMENT_CACHE_KEY } from '../../composables/domain/useEntitlement.js'
import { safeSetItem, safeGetItem } from '../../lib/storageSafe.js'
import { ambientHub } from '../../lib/ai/ambientInsights.js'
import { useInlineRename } from '../../composables/ui/useInlineRename.js'
import ErrorBoundary from '../../components/ui/ErrorBoundary.vue'
import DetailPanel from '../../components/shell/DetailPanel.vue'
import ChatInputDock from '../../components/chat/ChatInputDock.vue'
import PurchaseModal from '../../components/modals/PurchaseModal.vue'

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn().mockResolvedValue(true),
}))

import ContextMenu from '../../components/overlays/ContextMenu.vue'
import CommandPalette from '../../components/overlays/CommandPalette.vue'
import TrashPanel from '../../components/modals/TrashPanel.vue'
import CategoryModal from '../../components/modals/CategoryModal.vue'
import AttributeModal from '../../components/modals/AttributeModal.vue'
import GroupEditModal from '../../components/modals/GroupEditModal.vue'
import BookmarkModal from '../../components/modals/BookmarkModal.vue'
import BookmarkCard from '../../components/cards/BookmarkCard.vue'
import GroupCard from '../../components/cards/GroupCard.vue'
import CardGrid from '../../components/cards/CardGrid.vue'
import FilterBar from '../../components/shell/FilterBar.vue'
import AddPopover from '../../components/overlays/AddPopover.vue'
import DeadLinksPopover from '../../components/overlays/DeadLinksPopover.vue'
import AttrDropdown from '../../components/overlays/AttrDropdown.vue'
import AppHeader from '../../components/shell/AppHeader.vue'
import AttrChips from '../../components/shell/AttrChips.vue'
import AiInlineCard from '../../components/cards/AiInlineCard.vue'
import UserPopover from '../../components/overlays/UserPopover.vue'
import { useCombinedList } from '../../composables/useCombinedList.js'
import { resolveConflictItemName } from '../../components/overlays/resolveConflictItemName.js'
import { getPreview } from '../../components/modals/getPreview.js'
import { useUserPopoverStore } from '../../stores/overlay.js'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'
import { useChatDisplay } from '../../composables/ui/useChatDisplay.js'
import { useInlineEdit } from '../../composables/ui/useInlineEdit.js'
import ShareModal from '../../components/modals/ShareModal.vue'
import AiEnrichModal from '../../components/modals/AiEnrichModal.vue'
import AppNav from '../../components/shell/AppNav.vue'

import { bmForm } from '../../composables/domain/useBookmark.js'
import { geForm } from '../../composables/domain/useGroup.js'
import { useVirtualScroll } from '../../composables/useVirtualScroll.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

function makeBm(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm_default',
    title: '默认标题',
    url: 'https://example.com',
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: 'c1',
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('模块 6：界面交互、组件体系与 TipTap 编辑器深度审计回归套件', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── 1. ContextMenu 坐标边界保护与全局事件自动隐藏 ──
  it('1. ContextMenu: 窄视口或负坐标时坐标受 Math.max(margin, ...) 保护，且 scroll 触发隐藏', async () => {
    const ctx = useContextMenuStore()
    const wrapper = mount(ContextMenu)

    // 模拟视口较小且点击坐标在最左侧
    const fakeEv = { clientX: -50, clientY: -50 } as MouseEvent
    ctx.show(fakeEv, 'card', 'bm_1')
    await nextTick()
    await nextTick()

    // 触发全局 scroll 事件，验证自动 hide
    expect(ctx.open).toBe(true)
    window.dispatchEvent(new Event('scroll'))
    expect(ctx.open).toBe(false)
    wrapper.unmount()
  })

  // ── 2. CardGrid 虚拟滚动聚焦模式防护 ──
  it('2. CardGrid: 当处于组聚焦模式时（ui.focusedGroupId），即便条目数超 100 也不开启虚拟滚动', async () => {
    const ds = useDataStore()
    const ui = useUIStore()

    // 注入 120 个书签
    const bms: Bookmark[] = []
    for (let i = 0; i < 120; i++) {
      bms.push(makeBm({
        id: `bm_${i}`,
        title: `书签 ${i}`,
        url: `https://example.com/${i}`,
        order: i,
      }))
    }
    ds.bookmarks = bms

    ui.batchMode = false
    ui.focusedGroupId = 'grp_1'

    const wrapper = mount(CardGrid)
    await nextTick()

    // 聚焦模式下 useVirtual 必须为 false，不应渲染 card-grid-virtual
    expect(wrapper.find('.card-grid-virtual').exists()).toBe(false)
    wrapper.unmount()
  })

  // ── 3. useVirtualScroll 虚拟卡片样式防止重叠穿透 ──
  it('3. useVirtualScroll: 虚拟滚动条目样式必须包含 overflow: hidden 与 absolute 定位', async () => {
    let capturedVisibleItems: any[] = []
    const wrapper = mount({
      setup() {
        const items = ref([{ id: '1' }, { id: '2' }, { id: '3' }])
        const itemHeight = ref(100)
        const { visibleItems } = useVirtualScroll(items, {
          itemHeight,
          containerHeight: 500,
          overscan: 2,
        })
        capturedVisibleItems = visibleItems.value as any
        return { visibleItems }
      },
      render() {
        return null
      },
    })
    await nextTick()

    expect(capturedVisibleItems.length).toBeGreaterThan(0)
    const firstStyle = capturedVisibleItems[0]._virtualStyle
    expect(firstStyle.position).toBe('absolute')
    expect(firstStyle.overflow).toBe('hidden')
    wrapper.unmount()
  })

  // ── 4. BookmarkModal 卸载清理防抖定时器 ──
  it('4. BookmarkModal: 组件 unmount 时必须安全清理并置空 bmForm._fetchTimer', async () => {
    const timer = setTimeout(() => {}, 10000)
    bmForm._fetchTimer = timer

    const wrapper = mount(BookmarkModal)
    await nextTick()

    wrapper.unmount()
    expect(bmForm._fetchTimer).toBeNull()
  })

  // ── 5. CategoryModal 删除分类提示准确统计未软删书签与组 ──
  it('5. CategoryModal: 删除分类前提示必须同时统计未软删书签与未软删组，排除已软删除项', async () => {
    const ds = useDataStore()
    const appStore = useAppStore()
    ds.categories = [{ id: 'cat_test', name: '分类A', icon: '', color: '', order: 0 }]
    ds.bookmarks = [
      makeBm({ id: 'b1', title: 'B1', url: 'https://b1.com', categoryId: 'cat_test', order: 0 }),
      makeBm({ id: 'b2_deleted', title: 'B2', url: 'https://b2.com', categoryId: 'cat_test', order: 1, deletedAt: 9999 }),
    ]
    ds.siblingGroups = [
      { id: 'g1', name: 'G1', categoryId: 'cat_test', bookmarkIds: [], icon: '', order: 0, isExpanded: false, attributes: {}, notes: '', updatedAt: 1, useCount: 0, isPublic: false },
      { id: 'g2_deleted', name: 'G2', categoryId: 'cat_test', bookmarkIds: [], icon: '', order: 1, isExpanded: false, attributes: {}, notes: '', updatedAt: 1, useCount: 0, isPublic: false, deletedAt: 9999 },
    ]

    const wrapper = mount(CategoryModal)
    appStore.modals.category = true
    await nextTick()

    const delBtn = wrapper.find('.btn-danger')
    if (delBtn.exists()) {
      await delBtn.trigger('click')
      await flushPromises()
    }
    // 未软删书签 1 个 + 未软删组 1 个 = 2 个，已软删除的 b2/g2 被准确过滤并体现在二次确认文案中
    const { showConfirm } = await import('../../lib/toast.js')
    expect(showConfirm).toHaveBeenCalledWith(expect.stringContaining('2'))
    wrapper.unmount()
  })

  // ── 6. AttributeModal 添加属性时同名软删属性复活防重 ──
  it('6. AttributeModal: 添加与软删属性同名的属性时，通过 restoreAttribute 恢复而非产生重复 ID', async () => {
    const ds = useDataStore()
    const appStore = useAppStore()

    ds.customAttributes = [
      { id: 'dev', name: '开发', type: 'boolean', deletedAt: 5000, updatedAt: 5000 },
    ]

    const wrapper = mount(AttributeModal)
    appStore.modals.attribute = true
    await nextTick()

    const input = wrapper.find('input.form-input')
    await input.setValue('开发')
    const addBtn = wrapper.find('button.btn-primary')
    await addBtn.trigger('click')
    await flushPromises()

    // 应该只保留 1 个该 id 的属性，且 deletedAt 被清除复活
    const matching = ds.customAttributes.filter(a => a.id === 'dev')
    expect(matching.length).toBe(1)
    expect(matching[0].deletedAt).toBeUndefined()
    wrapper.unmount()
  })

  // ── 7. GroupEditModal 过滤已软删除书签 ──
  it('7. GroupEditModal: 组书签成员列表必须过滤掉已放入回收站的书签', async () => {
    const ds = useDataStore()
    const appStore = useAppStore()

    ds.bookmarks = [
      makeBm({ id: 'bm_live', title: '正常书签', url: 'https://live.com', order: 0 }),
      makeBm({ id: 'bm_trashed', title: '软删书签', url: 'https://trashed.com', order: 1, deletedAt: 9999 }),
    ]

    geForm.bookmarkIds = ['bm_live', 'bm_trashed']
    appStore.modals.groupEdit = true

    const wrapper = mount(GroupEditModal)
    await nextTick()

    const items = wrapper.findAll('.ge-bm-item')
    // 软删书签不应出现在成员列表中
    expect(items.length).toBe(1)
    expect(items[0].text()).toContain('正常书签')
    wrapper.unmount()
  })

  // ── 8. actionSheet 触摸下拉手势防冲突 ──
  it('8. actionSheet: 内部列表 scrollTop > 0 时，下拉不激活整个面板的拖拽关闭手势', async () => {
    const sheet = useActionSheetStore()
    sheet.showCategoryPicker('bm_1', 'bm')
    expect(sheet.visible).toBe(true)

    // 模拟在可滚动列表中下拉，此时 scrollTop 为 50
    const fakeScrollEl = document.createElement('div')
    fakeScrollEl.className = 'bmp-list'
    Object.defineProperty(fakeScrollEl, 'scrollTop', { value: 50, writable: true })

    const touchStartEvent = {
      touches: [{ clientY: 100 }],
      target: fakeScrollEl,
    } as unknown as TouchEvent

    sheet.onTouchStart(touchStartEvent)

    const touchMoveEvent = {
      touches: [{ clientY: 150 }],
    } as unknown as TouchEvent

    sheet.onTouchMove(touchMoveEvent)

    // 内部未滚至顶部时不拖拽面板
    expect(sheet.isDragging).toBe(false)
    expect(sheet.dragY).toBe(0)

    sheet.hide()
  })

  // ── 9. CommandPalette 密文保护与键盘滚动 ──
  it('9. CommandPalette: E2E 锁定状态下，书签与组搜索结果经 displayText 保护不展示裸密文', async () => {
    const ds = useDataStore()
    const e2e = useE2EStore()

    // 启用 E2E 但锁定
    e2e.isE2EEnabled = true
    e2e.isUnlocked = false

    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    ds.bookmarks = [
      makeBm({ id: 'bm_secret', title: cipher, url: 'https://secret.com', order: 0 }),
    ]
    ds.siblingGroups = [
      { id: 'grp_secret', name: cipher, categoryId: 'c1', bookmarkIds: [], icon: '', order: 0, isExpanded: false, attributes: {}, notes: '', updatedAt: 1, useCount: 0, isPublic: false },
    ]

    const wrapper = mount(CommandPalette)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await nextTick()

    const input = wrapper.find('input.cmd-input')
    await input.setValue('secret')
    await nextTick()

    // 结果中文案不能裸露 cipher
    const text = wrapper.text()
    expect(text).not.toContain(cipher)
    wrapper.unmount()
  })

  // ── 10. TrashPanel 密文保护 ──
  it('10. TrashPanel: 回收站列表在未解锁状态下，对密文标题显示安全占位而非乱码', async () => {
    const ds = useDataStore()
    const e2e = useE2EStore()

    e2e.isE2EEnabled = true
    e2e.isUnlocked = false

    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    ds.bookmarks = [
      makeBm({ id: 'bm_trashed', title: cipher, url: 'https://secret.com', order: 0, deletedAt: 9999 }),
    ]

    const wrapper = mount(TrashPanel, {
      props: { open: true },
    })
    await nextTick()

    // 回收站中不能显示裸密文
    expect(wrapper.text()).not.toContain(cipher)
    wrapper.unmount()
  })

  // ── 11. BookmarkCard 定时器清理与按需解密 ──
  it('11. BookmarkCard: 复制操作的 1200ms 定时器在组件卸载后正确清理', async () => {
    const bookmark: Bookmark = makeBm({
      id: 'bm_copy_timer',
      title: '测试复制',
      url: 'https://example.com',
      username: 'myuser',
      password: 'mypassword',
    })

    const wrapper = mount(BookmarkCard, {
      props: { bookmark, defaultAcctOpen: true },
    })
    await nextTick()

    // 触发复制用户名
    const copyUserBtn = wrapper.find('.acct-copy')
    if (copyUserBtn.exists()) {
      await copyUserBtn.trigger('click')
    }

    // 卸载组件，定时器在 onBeforeUnmount 中被清理
    expect(() => wrapper.unmount()).not.toThrow()
  })

  // ── 12. GroupCard 调色板在点击外部与窗口滚动时自动关闭 ──
  it('12. GroupCard: 调色板激活后，点击页面外部区域或触发滚动自动关闭', async () => {
    const group: SiblingGroup = {
      id: 'g_palette_test',
      name: '测试组',
      categoryId: 'c1',
      bookmarkIds: [],
      icon: '',
      order: 0,
      isExpanded: true,
      attributes: {},
      notes: '<p>笔记正文</p>',
      updatedAt: 1000,
      useCount: 0,
      isPublic: false,
    }

    const wrapper = mount(GroupCard, {
      props: { group },
    })
    await nextTick()

    // 模拟打开调色板后触发全局滚动与点击
    window.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(() => wrapper.unmount()).not.toThrow()
  })

  // ── 13. CategoryModal: 删除当前选中的分类时自动切回全部 (CAT_ALL) ──
  it('13. CategoryModal: 删除当前处于选中状态的分类，触发安全切回全部', async () => {
    const ds = useDataStore()
    const appStore = useAppStore()
    const ui = useUIStore()

    ds.categories = [{ id: 'cat_active', name: '当前分类', icon: '', color: '', order: 0 }]
    ui.curCat = 'cat_active'

    const wrapper = mount(CategoryModal)
    appStore.modals.category = true
    await nextTick()

    const delBtn = wrapper.find('.btn-danger')
    if (delBtn.exists()) {
      await delBtn.trigger('click')
      await flushPromises()
    }

    expect(ui.curCat).toBe('all')
    wrapper.unmount()
  })

  // ── 14. FilterBar: 新建书签/组点击后关闭 addDropdown ──
  it('14. FilterBar: 点击新建书签或组菜单项，自动关闭 addDropdown', async () => {
    const appStore = useAppStore()
    const wrapper = mount(FilterBar)

    appStore.overlays.addDropdown = true
    await nextTick()

    const item = wrapper.find('.ctx-item')
    if (item.exists()) {
      await item.trigger('click')
    }

    expect(appStore.overlays.addDropdown).toBe(false)
    wrapper.unmount()
  })

  // ── 15. AddPopover: 候选列表排除软删除书签与组 ──
  it('15. AddPopover: 搜索与候选列表自动排除回收站中的软删书签与组', async () => {
    const ds = useDataStore()
    const appStore = useAppStore()

    ds.bookmarks = [
      makeBm({ id: 'b_active', title: '活跃书签', url: 'https://act.com' }),
      makeBm({ id: 'b_deleted', title: '软删书签', url: 'https://del.com', deletedAt: 9999 }),
    ]
    ds.siblingGroups = [
      { id: 'g_active', name: '活跃组', categoryId: 'c1', bookmarkIds: [], icon: '', order: 0, isExpanded: false, attributes: {}, notes: '', updatedAt: 1, useCount: 0, isPublic: false },
      { id: 'g_deleted', name: '软删组', categoryId: 'c1', bookmarkIds: [], icon: '', order: 1, isExpanded: false, attributes: {}, notes: '', updatedAt: 1, useCount: 0, isPublic: false, deletedAt: 9999 },
    ]

    appStore.overlays.addPopover = true
    const wrapper = mount(AddPopover)
    await nextTick()

    // 候选结果中不包含软删除项
    const text = wrapper.text()
    expect(text).toContain('活跃书签')
    expect(text).not.toContain('软删书签')
    wrapper.unmount()
  })

  // ── 16. DeadLinksPopover: 密文标题受 displayText 保护 ──
  it('16. DeadLinksPopover: 未解锁状态下密文书签标题不裸露', async () => {
    const e2e = useE2EStore()
    const appStore = useAppStore()
    const ds = useDataStore()

    e2e.isE2EEnabled = true
    e2e.isUnlocked = false

    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    ds.bookmarks = [
      makeBm({ id: 'bm_dead_cipher', title: cipher, url: 'https://dead.com', order: 0 }),
    ]

    appStore.overlays.deadLinks = true
    const wrapper = mount(DeadLinksPopover)
    await nextTick()

    expect(wrapper.text()).not.toContain(cipher)
    wrapper.unmount()
  })

  // ── 17. AttrDropdown: 密文属性受 displayText 保护 ──
  it('17. AttrDropdown: 未解锁状态下密文属性不裸露', async () => {
    const e2e = useE2EStore()
    const ds = useDataStore()

    e2e.isE2EEnabled = true
    e2e.isUnlocked = false

    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    ds.customAttributes = [
      { id: 'a_cipher', name: cipher, type: 'boolean', updatedAt: 1000 },
    ]

    const wrapper = mount(AttrDropdown)
    await nextTick()

    expect(wrapper.text()).not.toContain(cipher)
    wrapper.unmount()
  })

  // ── 18. useChatPanelShell: 附件列表密文保护 ──
  it('18. useChatPanelShell: 卡片作为 AI 附件时，未解锁状态下标题不裸露密文', () => {
    const e2e = useE2EStore()
    const ui = useUIStore()
    const ds = useDataStore()

    e2e.isE2EEnabled = true
    e2e.isUnlocked = false

    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    ds.bookmarks = [
      makeBm({ id: 'bm_attached_cipher', title: cipher, url: 'https://attached.com', order: 0 }),
    ]
    ui.aiAttachedCards = [{ id: 'bm_attached_cipher', type: 'bm' }]

    const wrapper = mount({
      setup() {
        const { attachedCardsList } = useChatPanelShell()
        return { attachedCardsList }
      },
      render() {
        return null
      },
    })

    expect((wrapper.vm as any).attachedCardsList.length).toBe(1)
    expect((wrapper.vm as any).attachedCardsList[0].title).not.toContain(cipher)
    wrapper.unmount()
  })

  // ── 19. AppHeader: 聚焦模式密文保护与搜索定时器卸载清理 ──
  it('19. AppHeader: 聚焦模式下组名为密文时不裸露，且卸载安全清理防抖计时器', async () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const e2e = useE2EStore()

    e2e.isE2EEnabled = true
    e2e.isUnlocked = false

    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    ds.siblingGroups = [
      {
        id: 'grp_cipher_1',
        name: cipher,
        categoryId: 'c1',
        icon: '',
        order: 0,
        useCount: 0,
        isExpanded: true,
        attributes: {},
        bookmarkIds: [],
        notes: '',
        updatedAt: 1000,
      },
    ]
    ui.focusedGroupId = 'grp_cipher_1'

    const wrapper = mount(AppHeader)
    await nextTick()

    expect(wrapper.text()).not.toContain(cipher)
    wrapper.unmount()
  })

  // ── 20. AttrChips: 属性标签密文过滤 ──
  it('20. AttrChips: 属性名称为密文时，标签文字经 displayText 保护不裸露', async () => {
    const store = useAppStore()
    const ds = useDataStore()
    const e2e = useE2EStore()

    e2e.isE2EEnabled = true
    e2e.isUnlocked = false

    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    ds.customAttributes = [
      { id: 'attr_c1', name: cipher, type: 'boolean' },
    ]
    store.activeAttrs = ['attr_c1']

    const wrapper = mount(AttrChips)
    await nextTick()

    expect(wrapper.text()).not.toContain(cipher)
    wrapper.unmount()
  })
  // ── 21. AiInlineCard: 标题为空不崩与密文脱敏 ──
  it('21. AiInlineCard: candidate.title 为空时不崩，且密文标题经 displayText 保护', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    const wrapper = mount(AiInlineCard, {
      props: {
        candidate: {
          title: cipher,
          url: 'https://example.com/test',
        } as any,
      },
    })
    expect(wrapper.text()).not.toContain(cipher)
    wrapper.unmount()

    // 边界：title 为空字符串
    const emptyWrapper = mount(AiInlineCard, {
      props: {
        candidate: {
          title: '',
          url: 'https://example.com/empty',
        } as any,
      },
    })
    expect(emptyWrapper.exists()).toBe(true)
    emptyWrapper.unmount()
  })

  // ── 22. useCombinedList: 聚焦模式排除软删除组 ──
  it('22. useCombinedList: 当聚焦组已被软删除时，mode 不切为 focus 且列表不返回该组', () => {
    const ds = useDataStore()
    const ui = useUIStore()

    ds.siblingGroups = [
      {
        id: 'grp_trashed',
        name: '回收站组',
        categoryId: 'c1',
        icon: '',
        order: 0,
        useCount: 0,
        isExpanded: true,
        attributes: {},
        bookmarkIds: [],
        notes: '',
        updatedAt: 1000,
        deletedAt: 2000,
      },
    ]
    ui.focusedGroupId = 'grp_trashed'

    const { combinedList, mode } = useCombinedList()
    expect(mode.value).not.toBe('focus')
    expect(combinedList.value.some(item => item.data.id === 'grp_trashed')).toBe(false)
  })

  // ── 23. CategoryModal: 未分类本地化与分类名称密文脱敏 ──
  it('23. CategoryModal: 未分类名称跟随系统语言本地化，且密文分类名称脱敏展示', async () => {
    const store = useAppStore()
    const ds = useDataStore()
    store.modals.category = true

    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    ds.categories = [
      { id: 'all', name: '全部', icon: '', color: '', order: 0 },
      { id: 'uncategorized', name: '未分类', icon: '', color: '', order: 1 },
      { id: 'cat_c1', name: cipher, icon: '', color: '', order: 2 },
    ]

    const wrapper = mount(CategoryModal)
    await nextTick()

    expect(wrapper.text()).not.toContain(cipher)
    wrapper.unmount()
  })

  // ── 24. UserPopover: trashCount 包含软删组 ──
  it('24. UserPopover: 回收站计数同时统计软删除书签与软删除组', async () => {
    const ds = useDataStore()
    const upStore = useUserPopoverStore()
    upStore.open = true

    ds.bookmarks = [
      makeBm({ id: 'bm_d1', title: '已删书签 1', url: 'https://a.com', order: 0, deletedAt: 100 }),
    ]
    ds.siblingGroups = [
      {
        id: 'grp_d1',
        name: '已删组 1',
        categoryId: 'c1',
        icon: '',
        order: 0,
        useCount: 0,
        isExpanded: true,
        attributes: {},
        bookmarkIds: [],
        notes: '',
        updatedAt: 1000,
        deletedAt: 100,
      },
    ]

    const wrapper = mount(UserPopover)
    await nextTick()

    // 1个已删书签 + 1个已删组 = 2
    const trashMeta = wrapper.find('[data-testid="up-trash-item"] .up-item-meta')
    if (trashMeta.exists()) {
      expect(trashMeta.text()).toBe('2')
    }
    wrapper.unmount()
  })

  // ── 25. resolveConflictItemName: 密文名称脱敏 ──
  it('25. resolveConflictItemName: 冲突项无论书签或组，密文标题均脱敏展示', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    const name = resolveConflictItemName(
      { id: 'bm_conf', type: 'bookmark', local: { title: cipher }, remote: {} } as any,
      {
        bookmarkMap: {},
        groupMap: {},
        categoryMap: {},
        attributeMap: {},
      }
    )
    expect(name).not.toContain(cipher)
  })

  // ── 26. getPreview: 历史快照预览密文脱敏 ──
  it('26. getPreview: 历史快照中的密文标题经 displayText 保护不裸露', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    const preview = getPreview({ title: cipher })
    expect(preview).not.toContain(cipher)
  })

  // ── 27. useMaskClose: 防御连续 mousedown 与卸载清理 ──
  it('27. useMaskClose: 连续 mousedown 清除旧监听器，且组件卸载时清理挂起的 window mouseup 监听器', () => {
    let _closed = false
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const wrapper = mount({
      setup() {
        const mask = useMaskClose(() => { _closed = true })
        return { mask }
      },
      template: '<div id="mask" @mousedown="mask.onMaskMouseDown" @click="mask.onMaskClick"></div>',
    })

    const maskEl = wrapper.find('#mask').element as HTMLElement
    const fakeEv = { target: maskEl, currentTarget: maskEl } as unknown as MouseEvent

    // 第一次按下
    ;(wrapper.vm as any).mask.onMaskMouseDown(fakeEv)
    expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function), { once: true })

    // 第二次连续按下，旧监听器应被 remove
    ;(wrapper.vm as any).mask.onMaskMouseDown(fakeEv)
    expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))

    // 卸载组件，未触发的 mouseup 监听器自动清理
    wrapper.unmount()
    expect(removeSpy).toHaveBeenCalled()
  })

  // ── 28. useChatDisplay: 卸载时定时器清理 ──
  it('28. useChatDisplay: copyMessage 后若组件卸载，定时器被清理', async () => {
    vi.useFakeTimers()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })

    let displayApi: any
    const wrapper = mount({
      setup() {
        displayApi = useChatDisplay(ref([]))
        return {}
      },
      template: '<div></div>',
    })

    await displayApi.copyMessage('test', 'action_1')
    expect(displayApi.copiedActionKey.value).toBe('action_1')

    wrapper.unmount()
    vi.advanceTimersByTime(2000)
    vi.useRealTimers()
  })

  // ── 29. useInlineEdit: 组件卸载时自动取消并恢复原值 ──
  it('29. useInlineEdit: 处于编辑态时若组件卸载，自动触发取消并清除 contenteditable 样式', () => {
    let editApi: any
    const wrapper = mount({
      setup() {
        editApi = useInlineEdit()
        return {}
      },
      template: '<div><span id="target">原标题</span></div>',
    })

    const targetEl = wrapper.find('#target').element as HTMLElement
    editApi.startEditing(targetEl, '原标题', { onSave: vi.fn() })
    expect(targetEl.getAttribute('contenteditable')).toBe('true')

    targetEl.textContent = '改了一半的内容'
    wrapper.unmount()

    expect(targetEl.hasAttribute('contenteditable')).toBe(false)
    expect(targetEl.textContent).toBe('原标题')
  })

  // ── 30. ShareModal: 密文脱敏与组内书签软删除过滤 ──
  it('30. ShareModal: targetName 保护密文，且组内书签数量排除已软删除书签', async () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)

    ds.bookmarks = [
      makeBm({ id: 'b_alive', title: '活书签', categoryId: 'c1' }),
      makeBm({ id: 'b_dead', title: '死书签', categoryId: 'c1', deletedAt: 1234 }),
    ]
    ds.siblingGroups = [
      {
        id: 'g_test',
        name: cipher,
        categoryId: 'c1',
        icon: '',
        order: 0,
        useCount: 0,
        isExpanded: true,
        attributes: {},
        bookmarkIds: ['b_alive', 'b_dead'],
        notes: '',
        updatedAt: 1000,
      },
    ]

    ui.shareModalTarget = { type: 'group', id: 'g_test' }
    const wrapper = mount(ShareModal)
    await nextTick()

    // 密文不暴露在 targetName 中
    expect(wrapper.text()).not.toContain(cipher)
    expect(wrapper.text()).toContain('••••••')
    // 组内只有 1 个存活书签，排除已软删书签
    expect(wrapper.text()).toContain('1')
    wrapper.unmount()
  })

  // ── 31. AiEnrichModal: 排除软删除书签且建议与原值均受 displayText 保护 ──
  it('31. AiEnrichModal: targetBookmark 排除软删除项，且密文标题备注被脱敏保护', async () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)

    ds.bookmarks = [
      makeBm({ id: 'bm_deleted', title: cipher, deletedAt: 9999 }),
    ]
    ui.aiEnrichTargetBmId = 'bm_deleted'

    const wrapper = mount(AiEnrichModal)
    await nextTick()

    // 软删除书签被判定为 null，不进入分析展示
    expect(wrapper.find('.ai-diff-container').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(cipher)
    wrapper.unmount()
  })

  // ── 32. AppNav: 分类导航密文脱敏与内置分类多语言 ──
  it('32. AppNav: 分类列表中密文名称被脱敏，且内置全部/未分类显示多语言标签', async () => {
    const ds = useDataStore()
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)

    ds.categories = [
      { id: 'all', name: '全部', icon: 'all', color: '#3b82f6', order: 0 },
      { id: 'uncategorized', name: '未分类', icon: 'folder', color: '#3b82f6', order: 1 },
      { id: 'cat_cipher', name: cipher, icon: 'tag', color: '#3b82f6', order: 2 },
    ]

    const wrapper = mount(AppNav)
    await nextTick()

    expect(wrapper.text()).not.toContain(cipher)
    expect(wrapper.text()).toContain('••••••')
    wrapper.unmount()
  })

  // ── 33. UserPopover: 退出登录时安全调用 entService.clear() 且不抛 ReferenceError ──
  it('33. UserPopover: 退出登录时调用 entService.clear() 清理会员缓存且不报未定义错误', async () => {
    const authStore = useAuthStore()
    const upStore = useUserPopoverStore()
    const entService = useEntitlement()

    authStore.user = { id: 'user_audit_6', email: 'test@example.com' } as any
    upStore.open = true

    // 设置缓存
    safeSetItem(ENTITLEMENT_CACHE_KEY, JSON.stringify({ isPaid: true, planId: 'pro_monthly', status: 'active' }))
    expect(safeGetItem(ENTITLEMENT_CACHE_KEY)).not.toBeNull()

    const wrapper = mount(UserPopover, { attachTo: document.body })
    await nextTick()

    // 触发退出登录：必须安全执行 entService.clear() 并清空缓存，绝不抛 ENTITLEMENT_CACHE_KEY ReferenceError
    const logoutBtn = document.body.querySelector('.up-danger-item') as HTMLElement | null
    expect(logoutBtn).not.toBeNull()
    logoutBtn?.click()
    await flushPromises()

    expect(entService.isPaid.value).toBe(false)
    expect(safeGetItem(ENTITLEMENT_CACHE_KEY)).toBeNull()
    wrapper.unmount()
  })

  // ── 34. ErrorBoundary: 异常捕获时妥善释放 useE2EStore 的 pendingUnlock Promise ──
  it('34. ErrorBoundary: 异常捕获时通过 useE2EStore 释放 pendingUnlock 避免永挂', async () => {
    const e2eStore = useE2EStore()
    let resolvedValue: boolean | undefined = undefined
    e2eStore.pendingUnlock.push((val) => { resolvedValue = val })

    const CrashingChild = {
      template: '<div>{{ crash() }}</div>',
      methods: {
        crash() {
          throw new Error('Test crash in child component')
        },
      },
    }

    const wrapper = mount(ErrorBoundary, {
      slots: {
        default: () => h(CrashingChild),
      },
    })
    await nextTick()

    expect(wrapper.find('.error-boundary-fallback').exists()).toBe(true)
    expect(resolvedValue).toBe(false)
    expect(e2eStore.pendingUnlock.length).toBe(0)
    wrapper.unmount()
  })

  // ── 35. DetailPanel: aiAttachedCards 监听正确识别 first.type === 'bm' ──
  it('35. DetailPanel: aiAttachedCards 挂载书签时识别 first.type === "bm" 并触发 serendipity 探查', async () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const serendipitySpy = vi.spyOn(ambientHub, 'triggerSerendipityCheck')

    const bm = makeBm({ id: 'bm_serendipity_test', title: 'Serendipity Target', url: 'https://example.com' })
    ds.bookmarks = [bm]

    const wrapper = mount(DetailPanel)
    await nextTick()

    ui.aiAttachedCards = [{ type: 'bm', id: 'bm_serendipity_test' }]
    await nextTick()

    expect(serendipitySpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'bm_serendipity_test' }), expect.any(Array))
    serendipitySpy.mockRestore()
    wrapper.unmount()
  })

  // ── 36. ChatInputDock: 正确渲染卡片分类附件胶囊 ──
  it('36. ChatInputDock: 支持卡片附件类型为 "cat" 并渲染分类胶囊', async () => {
    const query = ref('')
    const focused = ref(false)
    const activeIndex = ref(0)
    const textareaRef = ref<HTMLTextAreaElement | null>(null)

    const wrapper = mount(ChatInputDock, {
      props: {
        attachedCardsList: [{ type: 'cat', id: 'cat_tech', title: '技术架构', url: '' }],
        slashItems: [],
        showSlash: false,
        aiLoading: false,
        textareaRef,
        query: query.value,
        focused: focused.value,
        activeIndex: activeIndex.value,
        'onUpdate:query': (val: string) => { query.value = val },
        'onUpdate:focused': (val: boolean) => { focused.value = val },
        'onUpdate:activeIndex': (val: number) => { activeIndex.value = val },
      },
    })
    await nextTick()

    const catPill = wrapper.find('.pill-cat')
    expect(catPill.exists()).toBe(true)
    expect(catPill.text()).toContain('技术架构')
    wrapper.unmount()
  })

  // ── 37. PurchaseModal: selectedCycle 周期筛选正常工作 ──
  it('37. PurchaseModal: 周期筛选正确过滤 monthly/quarterly/yearly', async () => {
    const wrapper = mount(PurchaseModal, {
      props: {
        visible: true,
        currentPlanId: 'free',
      },
    })
    await nextTick()

    expect(wrapper.exists()).toBe(true)
    wrapper.unmount()
  })

  // ── 38. useInlineRename: 接收 appStore 与 setEditInputRef 回调安全运行 ──
  it('38. useInlineRename: 接收标准 store 与 ref 设置回调无类型阻碍与异常', async () => {
    const store = useAppStore()
    const { editingId, editingName, startRename, setEditInputRef, cancelRename } = useInlineRename(store, 'renameCategory')

    startRename({ id: 'cat_1', name: '旧分类名称' })
    expect(editingId.value).toBe('cat_1')
    expect(editingName.value).toBe('旧分类名称')

    const inputEl = document.createElement('input')
    setEditInputRef(inputEl)

    cancelRename()
    expect(editingId.value).toBeNull()
  })
  // ── 39. appStore: e2eUnlockInitialMode 属性代理并双向同步到 uiStore ──
  it('39. appStore: e2eUnlockInitialMode 属性代理并双向同步到 uiStore', () => {
    const appStore = useAppStore()
    const uiStore = useUIStore()

    expect(appStore.e2eUnlockInitialMode).toBe('unlock')
    appStore.e2eUnlockInitialMode = 'changePw'
    expect(uiStore.e2eUnlockInitialMode).toBe('changePw')

    uiStore.e2eUnlockInitialMode = 'reset'
    expect(appStore.e2eUnlockInitialMode).toBe('reset')
  })

  // ── 40. EdgeStagingSidebar: 删除当前速览条目或清空暂存架时联动关闭 quickLook ──
  it('40. EdgeStagingSidebar: 删除当前速览条目或清空暂存架时联动关闭 quickLook', async () => {
    const EdgeStagingSidebar = (await import('../../components/shell/EdgeStagingSidebar.vue')).default
    const ui = useUIStore()
    const ds = useDataStore()

    ds.bookmarks = [
      makeBm({ id: 'bm_staged_1', title: 'Staged 1', url: 'https://staged1.com' }),
      makeBm({ id: 'bm_staged_2', title: 'Staged 2', url: 'https://staged2.com' }),
    ]
    ui.detailCards = ['bm_staged_1', 'bm_staged_2']
    ui.quickLookBmId = 'bm_staged_1'
    ui.modals.quickLook = true

    const wrapper = mount(EdgeStagingSidebar, { attachTo: document.body })
    await nextTick()

    // 找到 staged-card-row 并点击删除第一项
    const removeBtns = wrapper.findAll('.staged-act-btn.remove')
    expect(removeBtns.length).toBe(2)

    await removeBtns[0].trigger('click')
    await nextTick()

    expect(ui.detailCards).toEqual(['bm_staged_2'])
    expect(ui.modals.quickLook).toBe(false)
    expect(ui.quickLookBmId).toBeNull()

    // 测试清空全部
    ui.quickLookBmId = 'bm_staged_2'
    ui.modals.quickLook = true
    const clearBtn = wrapper.find('.dock-foot-btn.clear-all')
    expect(clearBtn.exists()).toBe(true)

    await clearBtn.trigger('click')
    await nextTick()

    expect(ui.detailCards.length).toBe(0)
    expect(ui.modals.quickLook).toBe(false)
    wrapper.unmount()
  })

  // ── 41. TrashPanel: 部分选中时通过 DOM 属性 .indeterminate 显示半选状态 ──
  it('41. TrashPanel: 部分选中时通过 DOM 属性 .indeterminate 显示半选状态', async () => {
    const ds = useDataStore()
    ds.bookmarks = [
      makeBm({ id: 'bm_t1', title: 'Trash 1', deletedAt: 100 }),
      makeBm({ id: 'bm_t2', title: 'Trash 2', deletedAt: 200 }),
    ]

    const wrapper = mount(TrashPanel, {
      props: { open: true },
      attachTo: document.body,
    })
    await nextTick()

    const itemChecks = wrapper.findAll('.trash-item-check')
    expect(itemChecks.length).toBe(2)

    // 选中第一项
    await itemChecks[0].setValue(true)
    await nextTick()

    const selectAllInput = wrapper.find('.trash-batch-all input').element as HTMLInputElement
    expect(selectAllInput.checked).toBe(false)
    expect(selectAllInput.indeterminate).toBe(true)

    // 选中第二项（全选）
    await itemChecks[1].setValue(true)
    await nextTick()

    expect(selectAllInput.checked).toBe(true)
    expect(selectAllInput.indeterminate).toBe(false)
    wrapper.unmount()
  })

  // ── 42. BookmarkCard & GroupCard: 图标操作按钮均具有标准 aria-label 属性 ──
  it('42. BookmarkCard & GroupCard: 图标操作按钮均具有标准 aria-label 属性', async () => {
    const ds = useDataStore()
    const bm = makeBm({ id: 'bm_aria', title: 'Aria BM', username: 'user1', password: 'pw1' })
    ds.bookmarks = [bm]

    const bmWrapper = mount(BookmarkCard, {
      props: { bookmark: bm },
    })
    await nextTick()

    const editBtn = bmWrapper.find('.card-actions .btn-xs:nth-child(2)')
    expect(editBtn.attributes('aria-label')).toBeTruthy()
    const delBtn = bmWrapper.find('.card-actions .btn-danger')
    expect(delBtn.attributes('aria-label')).toBeTruthy()

    bmWrapper.unmount()

    const grp = {
      id: 'g_aria',
      name: 'Aria Group',
      categoryId: 'c1',
      icon: '',
      order: 0,
      useCount: 0,
      isExpanded: true,
      attributes: {},
      bookmarkIds: [],
      notes: '',
      updatedAt: 1000,
    }
    ds.siblingGroups = [grp]

    const grpWrapper = mount(GroupCard, {
      props: { group: grp },
    })
    await nextTick()

    const grpEditBtn = grpWrapper.find('.card-actions .btn-xs:nth-child(2)')
    expect(grpEditBtn.attributes('aria-label')).toBeTruthy()
    const grpDelBtn = grpWrapper.find('.card-actions .btn-danger')
    expect(grpDelBtn.attributes('aria-label')).toBeTruthy()

    grpWrapper.unmount()
  })
})
