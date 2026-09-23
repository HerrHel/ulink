/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ShareModal from '../../components/modals/ShareModal.vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useAuthStore } from '../../stores/auth.js'
import * as syncShare from '../../composables/domain/syncShare.js'
import * as toastLib from '../../lib/toast.js'
import * as utils from '../../utils.js'

describe('ShareModal.vue — 分享管理弹窗', () => {
  let pinia: ReturnType<typeof createPinia>
  let ui: ReturnType<typeof useUIStore>
  let ds: ReturnType<typeof useDataStore>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    ui = useUIStore()
    ds = useDataStore()
    const auth = useAuthStore()
    auth.user = { id: 'u-test-1', email: 'test@example.com' } as any

    // 注入假组数据
    ds.addGroup({
      id: 'g-test-1',
      name: '测试公开组',
      categoryId: 'uncategorized',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: ['b1', 'b2'],
      notes: '<p>组笔记内容</p>',
      useCount: 0,
      isPublic: false,
      updatedAt: 1000,
    } as any)

    // 注入分类数据
    ds.addCategory({
      id: 'c-test-1',
      name: '开发工具',
      icon: '',
      color: '',
      order: 0,
    } as any)

    vi.restoreAllMocks()
  })

  it('展示未公开的组信息及开启公开访问', async () => {
    ui.openShareModal('group', 'g-test-1')

    const setGroupPublicSpy = vi.spyOn(syncShare, 'setGroupPublic').mockResolvedValue(true)
    const copySpy = vi.spyOn(utils, 'copyToClipboard').mockImplementation(() => true)

    const wrapper = mount(ShareModal, {
      global: { plugins: [pinia] }
    })

    // 验证标题与组信息
    expect(wrapper.find('.modal-head h2').text()).toContain('分享书签组')
    expect(wrapper.find('.share-target-name').text()).toBe('测试公开组')
    expect(wrapper.find('.share-target-meta').text()).toContain('2')

    // 当前未公开
    expect(wrapper.find('.share-toggle-title').text()).toContain('当前处于私密状态')
    expect(wrapper.find('.share-disabled-section .btn-primary').text()).toContain('开启公开访问')

    // 点击开启公开访问
    await wrapper.find('.share-disabled-section .btn-primary').trigger('click')

    expect(setGroupPublicSpy).toHaveBeenCalledWith('g-test-1', true)
    expect(copySpy).toHaveBeenCalled()
  })

  it('处于公开状态的组：展示链接，支持复制与停止公开分享', async () => {
    // 设为公开组
    ds.groupMap['g-test-1'].isPublic = true
    ui.openShareModal('group', 'g-test-1')

    const setGroupPublicSpy = vi.spyOn(syncShare, 'setGroupPublic').mockResolvedValue(true)
    const confirmSpy = vi.spyOn(toastLib, 'showConfirm').mockResolvedValue(true)
    const copySpy = vi.spyOn(utils, 'copyToClipboard').mockImplementation(() => true)

    const wrapper = mount(ShareModal, {
      global: { plugins: [pinia] }
    })

    // 处于公开状态
    expect(wrapper.find('.share-toggle-title').text()).toContain('公开访问已开启')
    const input = wrapper.find<HTMLInputElement>('.share-link-input')
    expect(input.exists()).toBe(true)
    expect(input.element.value).toContain('g-test-1')

    // 复制链接
    await wrapper.find('.share-btn-copy').trigger('click')
    expect(copySpy).toHaveBeenCalledWith(expect.stringContaining('g-test-1'), expect.anything())

    // 点击停止分享
    await wrapper.find('.share-btn-stop').trigger('click')
    expect(confirmSpy).toHaveBeenCalled()
    expect(setGroupPublicSpy).toHaveBeenCalledWith('g-test-1', false)
  })

  it('分类分享：支持查询状态、生成与取消分类公开分享', async () => {
    ui.openShareModal('category', 'c-test-1')

    const getCatShareSpy = vi.spyOn(syncShare, 'getCategoryShareId').mockResolvedValue('share-cat-123')
    const deleteCatShareSpy = vi.spyOn(syncShare, 'deletePublicCategoryShare').mockResolvedValue(true)
    const confirmSpy = vi.spyOn(toastLib, 'showConfirm').mockResolvedValue(true)

    const wrapper = mount(ShareModal, {
      global: { plugins: [pinia] }
    })

    // 等待异步 checkCategoryShare
    await new Promise((r) => setTimeout(r, 10))
    await wrapper.vm.$nextTick()

    expect(getCatShareSpy).toHaveBeenCalledWith('c-test-1')
    expect(wrapper.find('.share-target-name').text()).toBe('开发工具')
    expect(wrapper.find('.share-toggle-title').text()).toContain('公开访问已开启')
    expect(wrapper.find<HTMLInputElement>('.share-link-input').element.value).toContain('share-cat-123')

    // 停止分类分享
    await wrapper.find('.share-btn-stop').trigger('click')
    expect(confirmSpy).toHaveBeenCalled()
    expect(deleteCatShareSpy).toHaveBeenCalledWith('c-test-1')
  })

  it('点击关闭按钮或遮罩能正确关闭弹窗', async () => {
    ui.openShareModal('group', 'g-test-1')
    const wrapper = mount(ShareModal, {
      global: { plugins: [pinia] }
    })

    expect(ui.modals.share).toBe(true)
    await wrapper.find('.modal-close').trigger('click')
    expect(ui.modals.share).toBe(false)
    expect(ui.shareModalTarget).toBeNull()
  })

  it('未登录时点击开关直接拦截，不调用远程 API 且开关保持未激活', async () => {
    const auth = useAuthStore()
    auth.user = null // 模拟未登录

    ui.openShareModal('group', 'g-test-1')
    const setGroupPublicSpy = vi.spyOn(syncShare, 'setGroupPublic')

    const wrapper = mount(ShareModal, {
      global: { plugins: [pinia] }
    })

    // 点击受控开关
    await wrapper.find('.switch-toggle-btn').trigger('click')

    // 验证未调用远程接口，且按钮未激活
    expect(setGroupPublicSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.switch-toggle-btn').classes()).not.toContain('active')
  })
})
