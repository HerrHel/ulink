import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useShareStore } from '../../stores/share.js'
import AppHeader from '../../components/shell/AppHeader.vue'

describe('AppHeader 笔记聚焦模式下书签计数与光标交互', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('笔记没有书签时，顶栏不显示 0 个书签的计数徽标', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    ds.siblingGroups = [
      {
        id: 'grp_empty',
        name: '未命名笔记',
        categoryId: 'cat_default',
        icon: '',
        order: 0,
        useCount: 0,
        isExpanded: true,
        attributes: {},
        bookmarkIds: [],
        notes: '',
        updatedAt: Date.now(),
      },
    ]
    ui.focusedGroupId = 'grp_empty'

    const w = mount(AppHeader)
    await nextTick()

    expect(w.find('.panel-count').exists()).toBe(false)
    expect(w.text()).not.toContain('0 个书签')
    expect(w.text()).not.toContain('0 bookmarks')

    // 未命名笔记占位兼容：带 focus-title-unnamed 样式且聚焦时清空占位
    const titleEl = w.find('.focus-title-input')
    expect(titleEl.classes()).toContain('focus-title-unnamed')
    await titleEl.trigger('focus')
    expect(titleEl.text()).toBe('')
    w.unmount()
  })

  it('笔记有书签时，顶栏正常显示计数且具备防光标交互保护 (contenteditable="false", @mousedown.prevent)', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    ds.siblingGroups = [
      {
        id: 'grp_with_bms',
        name: '工作台',
        categoryId: 'cat_default',
        icon: '',
        order: 0,
        useCount: 0,
        isExpanded: true,
        attributes: {},
        bookmarkIds: ['b1', 'b2'],
        notes: '',
        updatedAt: Date.now(),
      },
    ]
    ui.focusedGroupId = 'grp_with_bms'

    const w = mount(AppHeader)
    await nextTick()

    const countBadge = w.find('.panel-count')
    expect(countBadge.exists()).toBe(true)
    expect(countBadge.text()).toBe('2 个书签')
    expect(countBadge.attributes('contenteditable')).toBe('false')

    // 触发 mousedown 应被 preventDefault 拦截，避免光标进入徽标文本
    const event = new MouseEvent('mousedown', { cancelable: true, bubbles: true })
    countBadge.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)

    w.unmount()
  })

  it('双击笔记标题或计数徽标不会意外触发退出聚焦，双击顶栏空白处仍可退出聚焦', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    ds.siblingGroups = [
      {
        id: 'grp_dblclick',
        name: '设计规范',
        categoryId: 'cat_default',
        icon: '',
        order: 0,
        useCount: 0,
        isExpanded: true,
        attributes: {},
        bookmarkIds: ['b1'],
        notes: '',
        updatedAt: Date.now(),
      },
    ]
    ui.focusedGroupId = 'grp_dblclick'

    const w = mount(AppHeader)
    await nextTick()

    const titleInput = w.find('.focus-title-input')
    const countBadge = w.find('.panel-count')
    const header = w.find('header.panel-header')

    // 双击标题（用于选词编辑）
    await titleInput.trigger('dblclick')
    expect(w.emitted('exit-focus')).toBeFalsy()

    // 双击计数徽标
    await countBadge.trigger('dblclick')
    expect(w.emitted('exit-focus')).toBeFalsy()

    // 双击顶栏空白处
    await header.trigger('dblclick')
    expect(w.emitted('exit-focus')).toBeTruthy()

    w.unmount()
  })

  it('分享只读模式下：无书签不展示徽标，有书签展示徽标', async () => {
    const ui = useUIStore()
    const share = useShareStore()

    ui.shareMode = { kind: 'group', id: 'share_grp_1' }
    ui.focusedGroupId = 'share_grp_1'

    share.groups = [
      {
        id: 'share_grp_1',
        name: '公开笔记',
        categoryId: 'cat_1',
        icon: '',
        order: 0,
        useCount: 0,
        isExpanded: true,
        attributes: {},
        bookmarkIds: [],
        notes: '',
        updatedAt: Date.now(),
      },
    ]

    const w = mount(AppHeader)
    await nextTick()

    expect(w.find('.panel-count').exists()).toBe(false)

    // 添加书签
    share.groups[0].bookmarkIds = ['b1', 'b2', 'b3']
    await nextTick()

    const countBadge = w.find('.panel-count')
    expect(countBadge.exists()).toBe(true)
    expect(countBadge.text()).toBe('3 个书签')

    w.unmount()
  })
})
