/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SettingsPanel from '../../components/shell/SettingsPanel.vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useAuthStore } from '../../stores/auth.js'
import * as useDataShareModule from '../../composables/domain/useDataShare.js'
import * as toastLib from '../../lib/toast.js'
import * as utils from '../../utils.js'

describe('SettingsPanel.vue — 分享管理 (进阶方案3)', () => {
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

    vi.restoreAllMocks()
    vi.spyOn(useDataShareModule, 'fetchUserCategoryShares').mockResolvedValue([])
  })

  it('没有公开内容时显示暂无公开分享', async () => {
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

    const shareSection = wrapper.find('.sp-section-shares')
    expect(shareSection.exists()).toBe(true)
    expect(shareSection.find('.sp-shares-empty').exists()).toBe(true)
    expect(shareSection.find('.sp-shares-stop-all').exists()).toBe(false)
  })

  it('存在公开组时在列表中展示', async () => {
    ds.addGroup({
      id: 'g-pub-1',
      name: '前端工具库',
      categoryId: 'uncategorized',
      order: 0,
      bookmarkIds: [],
      isPublic: true,
    } as any)

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

    const items = wrapper.findAll('.sp-share-item')
    expect(items.length).toBe(1)
    expect(items[0].text()).toContain('前端工具库')
    expect(items[0].find('.sp-share-badge--group').exists()).toBe(true)
  })

  it('存在多个公开项时展示全部停止公开按钮并可一键撤回', async () => {
    ds.addGroup({
      id: 'g-pub-1',
      name: '前端工具库',
      categoryId: 'uncategorized',
      order: 0,
      bookmarkIds: [],
      isPublic: true,
    } as any)
    ds.addGroup({
      id: 'g-pub-2',
      name: '设计资源',
      categoryId: 'uncategorized',
      order: 1,
      bookmarkIds: [],
      isPublic: true,
    } as any)

    const stopAllSpy = vi.spyOn(useDataShareModule, 'stopAllUserShares').mockImplementation(async () => {
      for (const g of ds.siblingGroups) {
        g.isPublic = false
      }
      return true
    })
    const confirmSpy = vi.spyOn(toastLib, 'showConfirm').mockResolvedValue(true)

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

    const stopAllBtn = wrapper.find('.sp-shares-stop-all')
    expect(stopAllBtn.exists()).toBe(true)

    await stopAllBtn.trigger('click')
    expect(confirmSpy).toHaveBeenCalled()
    expect(stopAllSpy).toHaveBeenCalled()
  })

  it('单项停止分享会弹出二次确认并调用对应 stop 方法', async () => {
    ds.addGroup({
      id: 'g-pub-1',
      name: '前端工具库',
      categoryId: 'uncategorized',
      order: 0,
      bookmarkIds: [],
      isPublic: true,
    } as any)

    const stopGroupSpy = vi.spyOn(useDataShareModule, 'stopShareGroup').mockImplementation(async (gid: string) => {
      const g = ds.groupMap[gid]
      if (g) g.isPublic = false
      return true
    })
    const confirmSpy = vi.spyOn(toastLib, 'showConfirm').mockResolvedValue(true)

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

    const stopItemBtn = wrapper.find('.sp-share-btn--danger')
    expect(stopItemBtn.exists()).toBe(true)

    await stopItemBtn.trigger('click')
    expect(confirmSpy).toHaveBeenCalled()
    expect(stopGroupSpy).toHaveBeenCalledWith('g-pub-1')
  })

  it('点击复制按钮调用 copyToClipboard', async () => {
    ds.addGroup({
      id: 'g-pub-1',
      name: '前端工具库',
      categoryId: 'uncategorized',
      order: 0,
      bookmarkIds: [],
      isPublic: true,
    } as any)

    const copySpy = vi.spyOn(utils, 'copyToClipboard').mockImplementation(() => {})

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

    const copyBtn = wrapper.find('.sp-share-actions .sp-share-btn')
    expect(copyBtn.exists()).toBe(true)

    await copyBtn.trigger('click')
    expect(copySpy).toHaveBeenCalledWith(expect.stringContaining('/s/g-pub-1'), expect.any(String))
  })
})
