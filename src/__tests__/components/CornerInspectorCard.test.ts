/**
 * CornerInspectorCard.test.ts — 主区域右下角 1:1 单卡展开框交互与契约测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import CornerInspectorCard from '../../components/shell/CornerInspectorCard.vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
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
    id: 'bm_1',
    title: 'Vue 官网',
    url: 'https://vuejs.org',
    categoryId: 'c1',
    parentId: null,
    icon: '',
    username: 'developer',
    password: 'secret-password',
    notes: '前端渐进式框架文档',
    order: 0,
    useCount: 3,
    attributes: {},
    isExpanded: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function makeGroup(overrides: Partial<SiblingGroup> = {}): SiblingGroup {
  return {
    id: 'grp_1',
    name: '项目技术笔记',
    categoryId: 'c1',
    icon: '',
    order: 0,
    isExpanded: false,
    attributes: {},
    bookmarkIds: [],
    notes: '',
    updatedAt: 1000,
    useCount: 0,
    ...overrides,
  }
}

describe('CornerInspectorCard — 主区域右下角 1:1 单卡展开框', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('1. 默认关闭态：不渲染 DOM', () => {
    const ui = useUIStore()
    ui.modals.quickLook = false
    ui.quickLookBmId = null

    const wrapper = mount(CornerInspectorCard)
    expect(wrapper.find('[data-testid="corner-inspector-card"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="corner-inspector-handle"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('2. 打开展开态：在右下角正常渲染标准 BookmarkCard 1:1 框', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const bm = makeBm()
    ds.bookmarks = [bm]
    ui.quickLookBmId = bm.id
    ui.modals.quickLook = true

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    const frame = wrapper.find('[data-testid="corner-inspector-card"]')
    expect(frame.exists()).toBe(true)

    // 检查卡片标题与内容
    expect(frame.text()).toContain('Vue 官网')
    expect(frame.find('.card').exists()).toBe(true)
    // 账号信息默认展开
    expect(frame.find('.card').classes()).toContain('acct-open')
    expect(frame.text()).toContain('developer')

    wrapper.unmount()
  })

  it('3. 子书签形态：渲染所属主网站标题与子书签徽标', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const parentBm = makeBm({ id: 'parent_1', title: 'Google 开发者套件' })
    const subBm = makeBm({
      id: 'sub_1',
      title: 'Google Cloud 控制台',
      url: 'https://console.cloud.google.com',
      parentId: 'parent_1',
    })

    ds.bookmarks = [parentBm, subBm]
    ui.quickLookBmId = subBm.id
    ui.modals.quickLook = true

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    expect(wrapper.find('.inspector-badge').text()).toContain('子书签')
    expect(wrapper.find('.inspector-parent-name').text()).toBe('Google 开发者套件')
    expect(wrapper.text()).toContain('Google Cloud 控制台')

    wrapper.unmount()
  })

  it('4. 点击另一个子书签详字时：卡片就地平滑替换，且自动展开', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm1 = makeBm({ id: 'bm_a', title: '子书签 A' })
    const bm2 = makeBm({ id: 'bm_b', title: '子书签 B' })

    ds.bookmarks = [bm1, bm2]
    ui.quickLookBmId = bm1.id
    ui.modals.quickLook = true

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    expect(wrapper.text()).toContain('子书签 A')
    expect(wrapper.text()).not.toContain('子书签 B')

    // 点击另一个子书签
    ui.openQuickLook('bm_b')
    await flushPromises()

    // 自动就地替换内容
    expect(wrapper.find('[data-testid="corner-inspector-card"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('子书签 B')
    expect(wrapper.text()).not.toContain('子书签 A')

    wrapper.unmount()
  })

  it('5. 智能吸附定位：当暂存架展开时贴在左侧（right: 236px），未展开时贴在右边缘（right: 8px）', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const bm = makeBm()
    ds.bookmarks = [bm]
    ui.quickLookBmId = bm.id
    ui.modals.quickLook = true

    // 1. 暂存架展开态：吸附在暂存架左侧 (right: 236px)
    const wrapper = mount(CornerInspectorCard, {
      props: {
        isDockVisible: true,
        dockPanelStyle: { top: '80px', bottom: 'auto' },
      },
    })
    await flushPromises()

    const el = wrapper.find('.corner-inspector-wrapper')
    expect(el.attributes('style')).toContain('right: 236px')
    expect(el.attributes('style')).toContain('top: 80px')
    wrapper.unmount()

    // 2. 暂存架未展开态：贴在右边缘 (right: 8px)
    const wrapper2 = mount(CornerInspectorCard, {
      props: {
        isDockVisible: false,
        dockPanelStyle: { top: '50px', bottom: 'auto' },
      },
    })
    await flushPromises()
    const el2 = wrapper2.find('.corner-inspector-wrapper')
    expect(el2.attributes('style')).toContain('right: 8px')
    expect(el2.attributes('style')).toContain('top: 50px')
    wrapper2.unmount()
  })

  it('6. 常驻视口：页面滚动时不随滚动意外折叠关闭，保持稳定常驻', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const bm = makeBm()
    ds.bookmarks = [bm]
    ui.quickLookBmId = bm.id
    ui.modals.quickLook = true

    const scrollEl = document.createElement('div')
    scrollEl.id = 'panelContent'
    document.body.appendChild(scrollEl)

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    expect(wrapper.find('[data-testid="corner-inspector-card"]').exists()).toBe(true)

    // 派发滚动事件：详情窗口保持展开稳定常驻
    scrollEl.dispatchEvent(new Event('scroll'))
    await flushPromises()

    expect(wrapper.find('[data-testid="corner-inspector-card"]').exists()).toBe(true)

    document.body.removeChild(scrollEl)
    wrapper.unmount()
  })

  it('7. 关闭与快捷键：点击 [✕] 或按下 Escape 关闭速览', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const bm = makeBm()
    ds.bookmarks = [bm]
    ui.quickLookBmId = bm.id
    ui.modals.quickLook = true

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    // 点击右上角 [✕]
    const closeBtn = wrapper.find('.close-btn')
    await closeBtn.trigger('click')
    await flushPromises()

    expect(ui.modals.quickLook).toBe(false)
    expect(ui.quickLookBmId).toBe(null)

    // 重新打开后按 Escape 测试
    ui.openQuickLook(bm.id)
    await flushPromises()
    expect(ui.modals.quickLook).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(ui.modals.quickLook).toBe(false)

    wrapper.unmount()
  })

  it('8. 暂存联动：点击暂存图标将书签添加到右侧边缘侧边栏 detailCards', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const bm = makeBm()
    ds.bookmarks = [bm]
    ui.detailCards = []
    ui.quickLookBmId = bm.id
    ui.modals.quickLook = true

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    const stageBtn = wrapper.findAll('.inspector-action-btn')[0]
    expect(stageBtn.classes()).not.toContain('is-staged')

    // 点击添加
    await stageBtn.trigger('click')
    await flushPromises()
    expect(ui.detailCards).toContain(bm.id)
    expect(stageBtn.classes()).toContain('is-staged')

    // 再次点击移除
    await stageBtn.trigger('click')
    await flushPromises()
    expect(ui.detailCards).not.toContain(bm.id)
    expect(stageBtn.classes()).not.toContain('is-staged')

    wrapper.unmount()
  })

  it('9. 移动端自适应模式（Bottom Sheet）：移动端展示背景遮罩与下滑抓手条，隐藏暂存按钮与右侧吸附样式，点击遮罩关闭', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const bm = makeBm()
    ds.bookmarks = [bm]
    ui.isMobile = true // 激活移动端
    ui.quickLookBmId = bm.id
    ui.modals.quickLook = true

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    // 1. 移动端特有半透明遮罩与下拉抓手条渲染
    const backdrop = wrapper.find('.corner-inspector-backdrop')
    expect(backdrop.exists()).toBe(true)
    expect(wrapper.find('.mobile-drag-bar').exists()).toBe(true)

    // 2. 移动端隐藏拖拽手柄点和加入暂存按钮（仅保留关闭 [✕]）
    expect(wrapper.find('.inspector-grip').exists()).toBe(false)
    expect(wrapper.findAll('.inspector-action-btn')).toHaveLength(1)
    expect(wrapper.find('.close-btn').exists()).toBe(true)

    // 3. 移动端样式类与行内样式解绑（不再有 right: 236px 等桌面吸附样式）
    const aside = wrapper.find('.corner-inspector-wrapper')
    expect(aside.classes()).toContain('is-mobile-sheet')
    const style = aside.attributes('style') || ''
    expect(style).not.toContain('right:')

    // 4. 点击遮罩触发关闭
    await backdrop.trigger('click')
    await flushPromises()
    expect(ui.modals.quickLook).toBe(false)
    expect(ui.quickLookBmId).toBe(null)

    wrapper.unmount()
  })

  it('10. 移动端触控轻扫手势：触控下滑超过 70px 触发关闭，禁用 PC 端 pointerdown 坐标拖拽', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const bm = makeBm()
    ds.bookmarks = [bm]
    ui.isMobile = true
    ui.quickLookBmId = bm.id
    ui.modals.quickLook = true

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    const grabBar = wrapper.find('.mobile-drag-bar')
    expect(grabBar.exists()).toBe(true)

    // 模拟触摸向下滑动 100px
    const touchStartEvt = new TouchEvent('touchstart', {
      touches: [{ clientY: 100 } as Touch],
      bubbles: true,
    })
    const touchMoveEvt = new TouchEvent('touchmove', {
      touches: [{ clientY: 200 } as Touch],
      bubbles: true,
    })
    const touchEndEvt = new TouchEvent('touchend', { bubbles: true })

    grabBar.element.dispatchEvent(touchStartEvt)
    grabBar.element.dispatchEvent(touchMoveEvt)
    grabBar.element.dispatchEvent(touchEndEvt)
    await flushPromises()

    // 下滑超过 70px，触发关闭
    expect(ui.modals.quickLook).toBe(false)
    expect(ui.quickLookBmId).toBe(null)

    wrapper.unmount()
  })

  it('11. 移动端列表模式：详情抽屉内不渲染 card-menu-btn（三点详情菜单）与 card-preview（纯文本摘要），杜绝三颗大黑球与文本双重渲染', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const bm = makeBm({ notes: '微软 Edge 官方扩展商店安装入口' })
    ds.bookmarks = [bm]
    ui.isMobile = true
    ui.layoutMode = 'list'
    ui.quickLookBmId = bm.id
    ui.modals.quickLook = true

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    // 1. 确保不渲染 .card-menu-btn（即包含 I.dotsV 三点图标的详情按钮）与 .list-expand-btn
    expect(wrapper.find('.card-menu-btn').exists()).toBe(false)
    expect(wrapper.find('.list-expand-btn').exists()).toBe(false)

    // 2. 确保不渲染 .card-preview（避免与 .card-notes 双重渲染相同文本）
    expect(wrapper.find('.card-preview').exists()).toBe(false)
    // 但 .card-notes 正常展示
    expect(wrapper.find('.card-notes').exists()).toBe(true)
    expect(wrapper.find('.card-notes').text()).toBe('微软 Edge 官方扩展商店安装入口')

    wrapper.unmount()
  })

  it('12. 组卡片（SiblingGroup）速览形态：支持传入 group:xxx，正常渲染 GroupCard、展示分组徽标、组名称及只读笔记', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const group = makeGroup({
      id: 'grp_1',
      name: '项目技术笔记',
      notes: '<p>技术栈包含 Vue 3 与 TypeScript</p>',
      bookmarkIds: ['b1', 'b2'],
    })
    ds.siblingGroups = [group]
    ui.quickLookBmId = 'group:grp_1'
    ui.modals.quickLook = true

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    const frame = wrapper.find('[data-testid="corner-inspector-card"]')
    expect(frame.exists()).toBe(true)
    expect(wrapper.find('.inspector-badge').text()).toContain('笔记')
    expect(wrapper.find('.inspector-parent-name').text()).toBe('项目技术笔记')
    expect(frame.find('.group-card').exists()).toBe(true)
    expect(frame.find('.group-body-readonly').text()).toContain('技术栈包含 Vue 3 与 TypeScript')

    wrapper.unmount()
  })

  it('13. 组卡片聚焦联动：当聚焦该分组时（ui.focusedGroupId 变更），自动关闭抽屉', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const group = makeGroup({
      id: 'grp_1',
      name: '项目技术笔记',
      notes: '<p>技术栈</p>',
    })
    ds.siblingGroups = [group]
    ui.quickLookBmId = 'group:grp_1'
    ui.modals.quickLook = true

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    expect(wrapper.find('[data-testid="corner-inspector-card"]').exists()).toBe(true)

    // 用户在抽屉内或通过外部操作聚焦了该组
    ui.focusedGroupId = 'grp_1'
    await flushPromises()

    // 自动平滑关闭速览抽屉
    expect(ui.modals.quickLook).toBe(false)
    expect(ui.quickLookBmId).toBe(null)

    wrapper.unmount()
  })

  it('14. 多级导航与返回功能：点击子书签后展示返回按钮，点击返回回到父级书签详情，清空历史后返回按钮自动隐藏', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const parentBm = makeBm({ id: 'parent_1', title: '主书签' })
    const subBm = makeBm({ id: 'sub_1', title: '子书签', parentId: 'parent_1' })
    ds.bookmarks = [parentBm, subBm]

    // 1. 打开主书签
    ui.openQuickLook('parent_1')
    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    expect(wrapper.text()).toContain('主书签')
    expect(wrapper.find('.inspector-back-btn').exists()).toBe(false)

    // 2. 在抽屉内点击子书签详情
    ui.openQuickLook('sub_1')
    await flushPromises()

    expect(wrapper.text()).toContain('子书签')
    const backBtn = wrapper.find('.inspector-back-btn')
    expect(backBtn.exists()).toBe(true)

    // 3. 点击返回按钮回到主书签
    await backBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('主书签')
    expect(ui.quickLookBmId).toBe('parent_1')
    expect(wrapper.find('.inspector-back-btn').exists()).toBe(false)

    wrapper.unmount()
  })

  it('15. 桌面端吸附右边距适配纤细悬浮手柄（right: 29px）', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const bm = makeBm({ id: 'bm_1', title: '书签' })
    ds.bookmarks = [bm]
    ui.openQuickLook('bm_1')

    const wrapper = mount(CornerInspectorCard, {
      props: {
        isDockVisible: false,
        hasHandle: true,
      },
    })
    await flushPromises()

    const aside = wrapper.find('.corner-inspector-wrapper')
    expect(aside.attributes('style')).toContain('right: 29px')

    wrapper.unmount()
  })

  it('16. 子书签面包屑层级展示与推入转场容器', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const parentBm = makeBm({ id: 'parent_bm', title: '父级工作台' })
    const subBm = makeBm({ id: 'sub_bm', title: '子级控制台', parentId: 'parent_bm' })
    ds.bookmarks = [parentBm, subBm]

    ui.openQuickLook('sub_bm')
    const wrapper = mount(CornerInspectorCard)
    await flushPromises()

    // 检查面包屑展示：父书签 › 子书签
    expect(wrapper.find('.inspector-parent-name').text()).toBe('父级工作台')
    expect(wrapper.find('.inspector-breadcrumb-sep').text()).toBe('›')
    expect(wrapper.find('.inspector-breadcrumb-current').text()).toBe('子级控制台')

    // 检查平滑转场包裹容器
    const content = wrapper.find('.inspector-card-content')
    expect(content.exists()).toBe(true)

    wrapper.unmount()
  })

  it('17. 点击空白处收起：在桌面端展开时，点击详情窗外部空白区域自动关闭详情窗', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    const bm = makeBm({ id: 'bm_1', title: '测试卡片' })
    ds.bookmarks = [bm]
    ui.openQuickLook('bm_1')

    const wrapper = mount(CornerInspectorCard)
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(wrapper.find('[data-testid="corner-inspector-card"]').exists()).toBe(true)

    // 点击详情窗内部：不关闭
    await wrapper.find('.corner-inspector-frame').trigger('click')
    expect(ui.modals.quickLook).toBe(true)

    // 模拟点击页面外部空白区域
    const blankEl = document.createElement('div')
    document.body.appendChild(blankEl)
    blankEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    // 成功关闭详情窗
    expect(ui.modals.quickLook).toBe(false)
    expect(ui.quickLookBmId).toBe(null)

    document.body.removeChild(blankEl)
    wrapper.unmount()
  })
})
