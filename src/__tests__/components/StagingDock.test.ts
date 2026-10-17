import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import StagingDock from '../../components/shell/StagingDock.vue'
import type { Bookmark, SiblingGroup } from '../../types.js'

describe('StagingDock — 底部悬浮暂存搁架交互与渲染测试', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('空态：当 detailCards 为空时不渲染搁架', async () => {
    const ui = useUIStore()
    ui.detailCards = []

    const wrapper = mount(StagingDock)
    await nextTick()

    expect(wrapper.find('#stagingDock').exists()).toBe(false)
    wrapper.unmount()
  })

  it('激活态：当有暂存卡片时渲染 micro-capsules 与计数', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm1: Bookmark = {
      id: 'bm_1',
      title: 'GitHub 首页',
      url: 'https://github.com/trending',
      order: 0,
    } as Bookmark

    const group1: SiblingGroup = {
      id: 'grp_1',
      name: '设计灵感库',
      categoryId: 'cat_design',
      icon: '',
      bookmarkIds: [],
      order: 0,
      isExpanded: false,
      attributes: {},
      notes: '',
      updatedAt: Date.now(),
      useCount: 0,
    }

    ds.bookmarks = [bm1]
    ds.siblingGroups = [group1]
    ui.detailCards = ['bm_1', 'group:grp_1']

    const wrapper = mount(StagingDock)
    await nextTick()

    expect(wrapper.find('#stagingDock').exists()).toBe(true)
    expect(wrapper.find('.dock-count-badge').text()).toBe('2')

    const capsules = wrapper.findAll('.staging-capsule')
    expect(capsules).toHaveLength(2)

    // 书签胶囊
    expect(capsules[0].text()).toContain('GitHub 首页')
    expect(capsules[0].attributes('data-bm-id')).toBe('bm_1')
    expect(capsules[0].attributes('data-didx')).toBe('0')
    expect(capsules[0].attributes('draggable')).toBe('true')

    // 笔记组胶囊
    expect(capsules[1].text()).toContain('设计灵感库')
    expect(capsules[1].attributes('data-bm-id')).toBe('group:grp_1')
    expect(capsules[1].attributes('data-didx')).toBe('1')

    wrapper.unmount()
  })

  it('交互微操：点击胶囊上的移除按钮能精准从 detailCards 剔除', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm1: Bookmark = { id: 'bm_1', title: 'Card 1', url: 'https://a.com', order: 0 } as Bookmark
    const bm2: Bookmark = { id: 'bm_2', title: 'Card 2', url: 'https://b.com', order: 1 } as Bookmark

    ds.bookmarks = [bm1, bm2]
    ui.detailCards = ['bm_1', 'bm_2']

    const wrapper = mount(StagingDock)
    await nextTick()

    const removeBtns = wrapper.findAll('.capsule-action-btn.remove')
    expect(removeBtns).toHaveLength(2)

    // 移除第一张卡
    await removeBtns[0].trigger('click')
    await nextTick()

    expect(ui.detailCards).toEqual(['bm_2'])
    wrapper.unmount()
  })

  it('批处理：点击清空按钮一键清空 detailCards', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    ds.bookmarks = [
      { id: 'b1', title: 'One', url: 'https://one.com', order: 0 } as Bookmark,
      { id: 'b2', title: 'Two', url: 'https://two.com', order: 1 } as Bookmark,
    ]
    ui.detailCards = ['b1', 'b2']

    const wrapper = mount(StagingDock)
    await nextTick()

    const clearBtn = wrapper.find('.dock-tail-btn.is-clear')
    expect(clearBtn.exists()).toBe(true)

    await clearBtn.trigger('click')
    await nextTick()

    expect(ui.detailCards).toEqual([])
    wrapper.unmount()
  })
})
