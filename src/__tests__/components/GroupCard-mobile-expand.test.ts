/**
 * GroupCard-mobile-expand.test.ts — 移动端列表视图下笔记卡片「统一三点 ⋯ 呼出速览抽屉 + 轻触就地快速编辑」契约测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import GroupCard from '../../components/cards/GroupCard.vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import type { SiblingGroup } from '../../types.js'

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

function makeGroup(overrides: Partial<SiblingGroup> = {}): SiblingGroup {
  return {
    id: 'grp_mobile_1',
    name: '旅行备忘录',
    categoryId: 'c1',
    icon: '',
    order: 0,
    isExpanded: false,
    attributes: {},
    bookmarkIds: [],
    notes: '<p>出发前检查护照和充电宝</p>',
    updatedAt: 1000,
    useCount: 0,
    ...overrides,
  }
}

describe('GroupCard 移动端列表视图 — 统一三点「⋯」唤出速览抽屉 + 就地快速编辑契约', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('1. 移动端列表模式下：组卡片统一渲染 card-menu-btn（三点 ⋯ 按钮），隐藏 list-expand-btn', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const group = makeGroup()
    ds.siblingGroups = [group]

    ui.isMobile = true
    ui.layoutMode = 'list'
    ui.batchMode = false

    const wrapper = mount(GroupCard, {
      props: { group },
    })
    await flushPromises()

    // 必须统一渲染三点详情按钮
    const menuBtn = wrapper.find('.card-menu-btn')
    expect(menuBtn.exists()).toBe(true)

    // 移动端不渲染 list-expand-btn
    const expandBtn = wrapper.find('.list-expand-btn')
    expect(expandBtn.exists()).toBe(false)

    wrapper.unmount()
  })

  it('2. 点击 card-menu-btn：在移动端呼出 QuickLook 抽屉（设置 quickLookBmId = "group:xxx"）', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const group = makeGroup()
    ds.siblingGroups = [group]

    ui.isMobile = true
    ui.layoutMode = 'list'
    ui.batchMode = false
    ui.modals.quickLook = false
    ui.quickLookBmId = null

    const wrapper = mount(GroupCard, {
      props: { group },
    })
    await flushPromises()

    const menuBtn = wrapper.find('.card-menu-btn')
    expect(menuBtn.exists()).toBe(true)

    // 点击三点按钮
    await menuBtn.trigger('click')
    await flushPromises()

    // 呼出速览抽屉
    expect(ui.modals.quickLook).toBe(true)
    expect(ui.quickLookBmId).toBe('group:grp_mobile_1')

    wrapper.unmount()
  })

  it('3. 在 detailMode（抽屉速览内）点击正文：直接触发 toggleFocus 进入编辑态', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const group = makeGroup()
    ds.siblingGroups = [group]

    ui.focusedGroupId = null

    const wrapper = mount(GroupCard, {
      props: {
        group,
        detailMode: true,
      },
    })
    await flushPromises()

    const readonlyBody = wrapper.find('.group-body-readonly')
    expect(readonlyBody.exists()).toBe(true)
    expect(readonlyBody.classes()).toContain('can-edit')

    // 点击正文触发快速编辑
    await readonlyBody.trigger('click')
    await flushPromises()

    expect(ui.focusedGroupId).toBe('grp_mobile_1')

    wrapper.unmount()
  })
})
