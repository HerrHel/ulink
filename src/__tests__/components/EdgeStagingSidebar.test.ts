/**
 * EdgeStagingSidebar.test.ts — 主区域右侧边缘侧边栏与暂存悬浮交互测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import EdgeStagingSidebar from '../../components/shell/EdgeStagingSidebar.vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

const mocks = vi.hoisted(() => ({
  openBookmark: vi.fn(),
  openQuickLook: vi.fn(),
}))

vi.mock('../../composables/domain/useBookmark.js', () => ({
  openBookmark: mocks.openBookmark,
}))

vi.mock('../../composables/ui/useUI.js', () => ({
  openQuickLook: mocks.openQuickLook,
}))

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

describe('EdgeStagingSidebar — 右侧智能边缘侧边栏交互与渲染测试', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubGlobal('open', vi.fn())
    mocks.openQuickLook.mockImplementation((id: string) => {
      useUIStore().openQuickLook(id)
    })
  })

  it('1. 空态且未拖拽：侧边栏与放置区均不渲染', async () => {
    const ui = useUIStore()
    ui.detailCards = []
    ui.isDraggingCard = false

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    expect(wrapper.find('.edge-staging-drop-zone').exists()).toBe(false)
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(false)
    wrapper.unmount()
  })

  it('2. 拖拽唤出 [+] 放置区：当拖拽卡片时，右边缘滑出带加号的放置靶点', async () => {
    const ui = useUIStore()
    ui.detailCards = []
    ui.isDraggingCard = true

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    const dropZone = wrapper.find('.edge-staging-drop-zone')
    expect(dropZone.exists()).toBe(true)
    expect(dropZone.text()).toContain('拖入暂存')
    wrapper.unmount()
  })

  it('3. 暂存状态常态化悬浮：展示完整标题、笔记组标识、域名与拖拽属性', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm1: Bookmark = {
      id: 'bm_1',
      title: 'GitHub 趋势榜',
      url: 'https://github.com/trending',
      order: 0,
    } as Bookmark

    const group1: SiblingGroup = {
      id: 'grp_1',
      name: '设计灵感库',
      categoryId: 'cat_design',
      icon: '',
      bookmarkIds: ['bm_sub_1', 'bm_sub_2'],
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

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(true)
    expect(wrapper.find('.dock-count-badge').text()).toBe('2')

    const items = wrapper.findAll('.staged-card-row')
    expect(items).toHaveLength(2)

    // 书签项
    expect(items[0].attributes('data-bm-id')).toBe('bm_1')
    expect(items[0].attributes('data-didx')).toBe('0')
    expect(items[0].attributes('draggable')).toBe('true')
    expect(items[0].find('.staged-title').text()).toBe('GitHub 趋势榜')
    expect(items[0].find('.staged-sub-text').text()).toContain('github.com')

    // 笔记分组项
    expect(items[1].attributes('data-bm-id')).toBe('group:grp_1')
    expect(items[1].attributes('data-didx')).toBe('1')
    expect(items[1].find('.group-tag').text()).toContain('组')
    expect(items[1].find('.staged-title').text()).toBe('设计灵感库')
    expect(items[1].find('.staged-sub-text').text()).toContain('2 项书签')

    wrapper.unmount()
  })

  it('4. 手动收起与展开：点击收起按钮变为边缘小竖条，点击小竖条恢复展开', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = { id: 'bm_1', title: 'BM 1', url: 'https://a.com' } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_1']

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    // 默认常驻展开
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(true)
    expect(wrapper.find('.edge-staging-handle').exists()).toBe(false)

    // 点击收起按钮
    await wrapper.find('.dock-collapse-btn').trigger('click')
    await flushPromises()

    // 变为小竖条
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(false)
    const handle = wrapper.find('.edge-staging-handle')
    expect(handle.exists()).toBe(true)
    expect(handle.text()).toContain('1')

    // 点击小竖条展开
    await handle.trigger('click')
    await flushPromises()
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(true)

    wrapper.unmount()
  })

  it('5. 点击卡片行为：点击书签与笔记均调用 openQuickLook 在左侧飞窗展开 1:1 详情卡片', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = { id: 'bm_1', title: 'BM 1', url: 'https://a.com' } as Bookmark
    const grp: SiblingGroup = { id: 'grp_1', name: 'Group 1' } as SiblingGroup

    ds.bookmarks = [bm]
    ds.siblingGroups = [grp]
    ui.detailCards = ['bm_1', 'group:grp_1']

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    const items = wrapper.findAll('.staged-card-row')

    // 点击书签 -> openQuickLook('bm_1')
    await items[0].trigger('click')
    expect(mocks.openQuickLook).toHaveBeenCalledWith('bm_1')

    // 点击笔记分组 -> openQuickLook('group:grp_1')
    await items[1].trigger('click')
    expect(mocks.openQuickLook).toHaveBeenCalledWith('group:grp_1')

    // 检查书签与笔记卡片均展示速览眼睛按钮，点击也调用 openQuickLook
    const inspectBtns = wrapper.findAll('.staged-act-btn.inspect')
    expect(inspectBtns).toHaveLength(2)
    await inspectBtns[1].trigger('click')
    expect(mocks.openQuickLook).toHaveBeenCalledWith('group:grp_1')

    wrapper.unmount()
  })

  it('6. 单项删除：点击卡片右侧的 [✕] 按钮直接从 detailCards 精准剔除', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm1: Bookmark = { id: 'bm_1', title: 'Card 1', url: 'https://a.com' } as Bookmark
    const bm2: Bookmark = { id: 'bm_2', title: 'Card 2', url: 'https://b.com' } as Bookmark

    ds.bookmarks = [bm1, bm2]
    ui.detailCards = ['bm_1', 'bm_2']

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    const removeBtns = wrapper.findAll('.staged-act-btn.remove')
    expect(removeBtns).toHaveLength(2)

    await removeBtns[0].trigger('click')
    await flushPromises()

    expect(ui.detailCards).toEqual(['bm_2'])
    wrapper.unmount()
  })

  it('7. 批处理：一键清空暂存架（全部打开已移除）', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm1: Bookmark = { id: 'b1', title: 'One', url: 'https://one.com' } as Bookmark
    const bm2: Bookmark = { id: 'b2', title: 'Two', url: 'https://two.com' } as Bookmark

    ds.bookmarks = [bm1, bm2]
    ui.detailCards = ['b1', 'b2']

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    // 确认「全部打开」已彻底移除
    expect(wrapper.find('.dock-foot-btn.open-all').exists()).toBe(false)

    // 一键清空暂存卡片
    const clearBtn = wrapper.find('.dock-foot-btn.clear-all')
    expect(clearBtn.exists()).toBe(true)
    expect(clearBtn.text()).toContain('清空')
    await clearBtn.trigger('click')
    await flushPromises()

    expect(ui.detailCards).toEqual([])
    wrapper.unmount()
  })

  it('8. 拖拽暂存区内卡片：不会触发外部 isDraggingCard，侧边栏保持完全稳定不跳动', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = { id: 'bm_1', title: 'BM 1', url: 'https://a.com' } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_1']
    ui.isDraggingCard = false

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    const item = wrapper.find('.staged-card-row')
    expect(item.attributes('draggable')).toBe('true')

    // 触发 dragstart
    const dt = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '' }
    await item.trigger('dragstart', { dataTransfer: dt })

    // isDraggingCard 应保持 false（不推挤侧边栏）
    expect(ui.isDraggingCard).toBe(false)
    expect(wrapper.find('.dock-drop-slot').exists()).toBe(false)

    wrapper.unmount()
  })

  it('9. 边缘收起手柄可自由上下拖拽调整高度并持久化到 localStorage（最小安全间距 6px 紧贴属性栏）', async () => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = { id: 'bm_1', title: 'BM 1', url: 'https://a.com' } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_1']

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    // 默认展开面板也同步采用 panelTop
    expect(wrapper.find('.edge-staging-dock-panel').attributes('style')).toContain('top: 24px')

    // 收起面板
    await wrapper.find('.dock-collapse-btn').trigger('click')
    await flushPromises()

    const handle = wrapper.find('.edge-staging-handle')
    expect(handle.exists()).toBe(true)
    // 默认高度为 24px (舒适靠近上方属性栏)
    expect(handle.attributes('style')).toContain('top: 24px')

    // 模拟向上拖拽到最顶端：验证不会被过大安全距离截断，能贴近属性栏（6px）
    handle.element.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }))
    handle.element.dispatchEvent(new PointerEvent('pointermove', { clientY: 50, bubbles: true }))
    handle.element.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    await flushPromises()

    expect(handle.attributes('style')).toContain('top: 6px')
    expect(localStorage.getItem('ulink_staging_handle_top')).toBe('6')

    // 模拟向下拖拽：pointerdown (Y=100) -> pointermove (Y=160, delta=+60) -> pointerup
    handle.element.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }))
    handle.element.dispatchEvent(new PointerEvent('pointermove', { clientY: 160, bubbles: true }))
    handle.element.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    await flushPromises()

    expect(handle.attributes('style')).toContain('top: 66px')
    expect(localStorage.getItem('ulink_staging_handle_top')).toBe('66')
    // 拖拽结束不会意外展开面板
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(false)

    wrapper.unmount()
  })

  it('10. 拖拽微动（< 4px）视为点击展开，并能从 localStorage 恢复已保存高度', async () => {
    localStorage.setItem('ulink_staging_handle_top', '150')
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = { id: 'bm_1', title: 'BM 1', url: 'https://a.com' } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_1']

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    await wrapper.find('.dock-collapse-btn').trigger('click')
    await flushPromises()

    const handle = wrapper.find('.edge-staging-handle')
    // 恢复为 150px
    expect(handle.attributes('style')).toContain('top: 150px')

    // 模拟轻触无移动或微移 1px
    handle.element.dispatchEvent(new PointerEvent('pointerdown', { clientY: 150, pointerId: 1, bubbles: true }))
    handle.element.dispatchEvent(new PointerEvent('pointermove', { clientY: 151, bubbles: true }))
    handle.element.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    await handle.trigger('click')
    await flushPromises()

    // 视为点击，面板展开且保持在 150px
    const panel = wrapper.find('.edge-staging-dock-panel')
    expect(panel.exists()).toBe(true)
    expect(panel.attributes('style')).toContain('top: 150px')

    wrapper.unmount()
    localStorage.clear()
  })

  it('11. 展开态面板顶部 Header 亦可拖拽调整高度，展开与收起高度始终无缝一致', async () => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = { id: 'bm_1', title: 'BM 1', url: 'https://a.com' } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_1']

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    const panel = wrapper.find('.edge-staging-dock-panel')
    const header = wrapper.find('.dock-header')
    expect(panel.attributes('style')).toContain('top: 24px')

    // 拖拽面板 Header 向下移动 80px
    header.element.dispatchEvent(new PointerEvent('pointerdown', { clientY: 120, pointerId: 2, bubbles: true }))
    header.element.dispatchEvent(new PointerEvent('pointermove', { clientY: 200, bubbles: true }))
    header.element.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, bubbles: true }))
    await flushPromises()

    // 面板高度变为 24 + 80 = 104px
    expect(panel.attributes('style')).toContain('top: 104px')
    expect(localStorage.getItem('ulink_staging_handle_top')).toBe('104')

    // 点击收起，收起手柄也在 104px，毫无割裂感
    await wrapper.find('.dock-collapse-btn').trigger('click')
    await flushPromises()

    const handle = wrapper.find('.edge-staging-handle')
    expect(handle.exists()).toBe(true)
    expect(handle.attributes('style')).toContain('top: 104px')

    wrapper.unmount()
  })

  it('12. 小米侧边栏机制：底半区展开时从底部向上展开，样式锁定 bottom 且不遮挡滚动条', async () => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = { id: 'bm_1', title: 'BM 1', url: 'https://a.com' } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_1']

    // 设置在下半区 (例如 500px)
    localStorage.setItem('ulink_staging_handle_top', '500')

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    // 面板初始渲染即为下半区
    const panel = wrapper.find('.edge-staging-dock-panel')
    expect(panel.exists()).toBe(true)
    expect(panel.classes()).toContain('is-anchor-bottom')
    const panelStyle = panel.attributes('style') || ''
    expect(panelStyle).toContain('bottom:')
    expect(panelStyle).toContain('top: auto')
    expect(panelStyle).toContain('transform-origin: bottom right')

    // 收起后在下半区展开：验证 expandShelf 正确识别下半区
    await wrapper.find('.dock-collapse-btn').trigger('click')
    await flushPromises()

    const handle = wrapper.find('.edge-staging-handle')
    expect(handle.exists()).toBe(true)
    expect(handle.attributes('style')).toContain('top: 500px')

    // 点击展开
    await handle.trigger('click')
    await flushPromises()

    const expandedPanel = wrapper.find('.edge-staging-dock-panel')
    expect(expandedPanel.exists()).toBe(true)
    expect(expandedPanel.classes()).toContain('is-anchor-bottom')
    expect(expandedPanel.attributes('style')).toContain('bottom:')

    wrapper.unmount()
    localStorage.clear()
  })

  it('13. 拖拽手柄至视口最底端并点击展开：面板牢牢锚定在底部安全区（bottom: 24px），绝不倒灌飞至屏幕顶端', async () => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = { id: 'bm_1', title: 'BM 1', url: 'https://a.com' } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_1']

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    // 1. 点击收起
    await wrapper.find('.dock-collapse-btn').trigger('click')
    await flushPromises()

    const handle = wrapper.find('.edge-staging-handle')
    expect(handle.exists()).toBe(true)

    // 2. 模拟大幅向下拖拽至最底端 (Y 从 50 拖到 1500)
    handle.element.dispatchEvent(new PointerEvent('pointerdown', { clientY: 50, pointerId: 1, bubbles: true }))
    handle.element.dispatchEvent(new PointerEvent('pointermove', { clientY: 1500, bubbles: true }))
    handle.element.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    await new Promise(r => setTimeout(r, 80))
    await flushPromises()

    // 3. 点击展开
    await handle.trigger('click')
    await flushPromises()

    // 4. 验证展开后的面板属性：必须处于底部锚定，且 bottom 为 24px (MIN_BOTTOM)，top 为 auto
    const panel = wrapper.find('.edge-staging-dock-panel')
    expect(panel.exists()).toBe(true)
    expect(panel.classes()).toContain('is-anchor-bottom')
    const style = panel.attributes('style') || ''
    expect(style).toContain('bottom: 24px')
    expect(style).toContain('top: auto')
    expect(style).toContain('transform-origin: bottom right')

    wrapper.unmount()
    localStorage.clear()
  })

  it('14. 方案 A 联动：点击暂存卡片行在左侧飞出详情卡片并高亮当前行，收起暂存架时详情飞窗同步收起', async () => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()

    const bm1: Bookmark = { id: 'bm_1', title: '卡片 1', url: 'https://1.com' } as Bookmark
    const bm2: Bookmark = { id: 'bm_2', title: '卡片 2', url: 'https://2.com' } as Bookmark
    ds.bookmarks = [bm1, bm2]
    ui.detailCards = ['bm_1', 'bm_2']

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    const rows = wrapper.findAll('.staged-card-row')
    expect(rows).toHaveLength(2)

    // 初始状态没有查看详情
    expect(wrapper.find('[data-testid="corner-inspector-card"]').exists()).toBe(false)
    expect(rows[0].classes()).not.toContain('is-active')

    // 点击第一项卡片 -> 触发 openQuickLook并在左侧飞出详情卡片
    await rows[0].trigger('click')
    await flushPromises()

    expect(ui.modals.quickLook).toBe(true)
    expect(ui.quickLookBmId).toBe('bm_1')
    expect(wrapper.find('[data-testid="corner-inspector-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="corner-inspector-card"]').text()).toContain('卡片 1')

    // 当前行高亮
    expect(rows[0].classes()).toContain('is-active')
    expect(rows[1].classes()).not.toContain('is-active')

    // 详情卡片智能吸附在暂存架左侧 (right: 236px)
    const inspectorWrapper = wrapper.find('.corner-inspector-wrapper')
    expect(inspectorWrapper.attributes('style')).toContain('right: 236px')

    // 点击收起暂存架 -> 详情卡片同步收起
    await wrapper.find('.dock-collapse-btn').trigger('click')
    await flushPromises()

    expect(ui.modals.quickLook).toBe(false)
    expect(wrapper.find('[data-testid="corner-inspector-card"]').exists()).toBe(false)

    wrapper.unmount()
    localStorage.clear()
  })

  it('15. 有内容才常驻：暂存架为空时不常驻展示悬浮手柄（保持界面清爽），只有有卡片暂存且收起时才悬浮展示', async () => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()
    ui.detailCards = []
    ui.isDraggingCard = false
    ui.modals.quickLook = false
    ui.quickLookBmId = null

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    // 1. 空态：侧边栏与手柄均彻底不展示（界面完全清爽）
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(false)
    expect(wrapper.find('.edge-staging-handle').exists()).toBe(false)

    // 2. 唤出详情窗速览（但暂存仍为空）：手柄依然不出现，详情窗停靠在右边缘（right: 8px）
    const bm: Bookmark = {
      id: 'bm_1',
      title: '测试书签',
      url: 'https://example.com',
      order: 0,
    } as Bookmark
    ds.bookmarks = [bm]
    ui.openQuickLook('bm_1')
    await flushPromises()

    expect(wrapper.find('.edge-staging-handle').exists()).toBe(false)
    expect(wrapper.find('.corner-inspector-wrapper').exists()).toBe(true)
    expect(wrapper.find('.corner-inspector-wrapper').attributes('style')).toContain('right: 8px')

    // 3. 有卡片暂存并收起后：悬浮手柄常驻出现（带数字角标），详情窗自动避让贴在手柄左侧（right: 29px）
    ui.detailCards = ['bm_1']
    await flushPromises()
    // 默认展开，点击收起
    await wrapper.find('.dock-collapse-btn').trigger('click')
    await flushPromises()

    const handle = wrapper.find('.edge-staging-handle')
    expect(handle.exists()).toBe(true)
    expect(handle.text()).toContain('1')

    // 此时从主区域唤出卡片速览：详情窗自动避让贴在悬浮手柄左侧 (right: 29px)
    ui.openQuickLook('bm_1')
    await flushPromises()
    expect(wrapper.find('.corner-inspector-wrapper').attributes('style')).toContain('right: 29px')

    wrapper.unmount()
    localStorage.clear()
  })

  it('16. 当有暂存内容且手柄在最上方收起时唤出详情框，将手柄移至最下面，详情窗随手柄平滑到最底部（bottom: 24px），不与手柄分离', async () => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = {
      id: 'bm_lone',
      title: '独立书签',
      url: 'https://example.com',
      order: 0,
      useCount: 1,
    } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_lone'] // 暂存架有内容

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    // 收起暂存架为悬浮手柄
    await wrapper.find('.dock-collapse-btn').trigger('click')
    await flushPromises()

    // 悬浮手柄存在
    const handle = wrapper.find('.edge-staging-handle')
    expect(handle.exists()).toBe(true)

    // 从主区域唤出详情框速览
    ui.openQuickLook('bm_lone')
    await flushPromises()

    // 详情卡片在右侧贴着悬浮手柄 (right: 29px, top: 24px)
    const inspectorWrapper = wrapper.find('.corner-inspector-wrapper')
    expect(inspectorWrapper.exists()).toBe(true)
    expect(inspectorWrapper.attributes('style')).toContain('right: 29px')
    expect(inspectorWrapper.attributes('style')).toContain('top: 24px')

    // 模拟大幅向下拖拽手柄至最底端 (从 clientY=50 拖到 clientY=1500)
    handle.element.dispatchEvent(new PointerEvent('pointerdown', { clientY: 50, pointerId: 1, bubbles: true }))
    handle.element.dispatchEvent(new PointerEvent('pointermove', { clientY: 1500, bubbles: true }))
    handle.element.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    await flushPromises()

    // 重点验证：详情窗与手柄均成功切换为底部锚定，定位到 bottom: 24px，绝不与手柄分离！
    expect(inspectorWrapper.classes()).toContain('is-anchor-bottom')
    expect(inspectorWrapper.attributes('style')).toContain('bottom: 24px')
    expect(inspectorWrapper.attributes('style')).toContain('top: auto')

    wrapper.unmount()
    localStorage.clear()
  })

  it('17. 翻转平滑性验证：在中点翻转阈值前后 1px，物理渲染垂直位置连续无缝（< 2px 误差），杜绝卡顿与跳变', async () => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = {
      id: 'bm_test',
      title: '测试翻转平滑度',
      url: 'https://example.com',
      order: 0,
    } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_test']

    // 动态计算测试环境容器高度与翻转阈值
    const ch = Math.max(200, window.innerHeight - 98)
    const threshold = Math.floor(ch / 2 - 31) // HANDLE_HEIGHT / 2 = 31
    const valBefore = threshold - 1
    const valAfter = threshold + 1

    // 1. 设置在翻转临界点前 (top 模式)
    localStorage.setItem('ulink_staging_handle_top', String(valBefore))
    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    const panelBefore = wrapper.find('.edge-staging-dock-panel')
    expect(panelBefore.classes()).not.toContain('is-anchor-bottom')
    const styleBefore = panelBefore.attributes('style') || ''
    expect(styleBefore).toContain('top:')
    const topBefore = parseInt(styleBefore.match(/top:\s*(\d+)px/)?.[1] || '0', 10)

    wrapper.unmount()

    // 2. 设置在翻转临界点后 (bottom 模式)
    localStorage.setItem('ulink_staging_handle_top', String(valAfter))
    const wrapperAfter = mount(EdgeStagingSidebar)
    await flushPromises()

    const panelAfter = wrapperAfter.find('.edge-staging-dock-panel')
    expect(panelAfter.classes()).toContain('is-anchor-bottom')
    const styleAfter = panelAfter.attributes('style') || ''
    expect(styleAfter).toContain('bottom:')
    expect(styleAfter).toContain('top: auto')
    const bottomAfter = parseInt(styleAfter.match(/bottom:\s*(\d+)px/)?.[1] || '0', 10)

    // 物理 top 位置 = ch - bottomVal - panelH (220)
    const visualTopAfter = ch - bottomAfter - 220

    // 重点验证：在跨越翻转中点瞬间（手柄移动 2px），物理屏幕 Top 差值 <= 2px，绝无旧版 158px 的剧烈跳跃与撕裂感！
    expect(Math.abs(visualTopAfter - topBefore)).toBeLessThanOrEqual(2)

    wrapperAfter.unmount()
    localStorage.clear()
  })

  it('18. 移动端自适应：在移动端（ui.isMobile = true）彻底隐藏手柄、放置区与面板，杜绝手势干扰与遮挡', async () => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = {
      id: 'bm_mob',
      title: '移动端书签',
      url: 'https://m.example.com',
      order: 0,
    } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_mob'] // 即使有暂存卡片
    ui.isMobile = true // 切换为移动端
    ui.isDraggingCard = true // 即使正在拖拽卡片

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    // 1. 移动端面板、手柄与放置区全都不存在
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(false)
    expect(wrapper.find('.edge-staging-handle').exists()).toBe(false)
    expect(wrapper.find('.edge-staging-drop-zone').exists()).toBe(false)

    // 2. 即使唤出 quickLook 详情，小竖条也绝对不出现
    ui.openQuickLook('bm_mob')
    await flushPromises()
    expect(wrapper.find('.edge-staging-handle').exists()).toBe(false)

    wrapper.unmount()
    localStorage.clear()
  })

  it('19. 展开态拖拽详情窗优化：当暂存架展开且详情窗打开时，上下拖拽详情窗 1:1 跟手，且跨越中点翻转时详情窗与主面板水平对齐无断层跳跃', async () => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = {
      id: 'bm_sync',
      title: '同步测试书签',
      url: 'https://sync.test',
      order: 0,
    } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_sync'] // 展开暂存架
    ui.quickLookBmId = 'bm_sync'
    ui.modals.quickLook = true

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()

    // 1. 验证两者同时展开
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(true)
    const inspector = wrapper.find('.corner-inspector-wrapper')
    expect(inspector.exists()).toBe(true)

    // 2. 初始顶部状态 (top: 24px)
    const dockPanel = wrapper.find('.edge-staging-dock-panel')
    expect(dockPanel.attributes('style')).toContain('top: 24px')
    expect(inspector.attributes('style')).toContain('top: 24px')

    // 3. 拖拽详情窗 Header 向下移动 100px (24 -> 124px)，验证 1:1 绝对跟手无迟滞
    const inspHeader = wrapper.find('.inspector-header')
    inspHeader.element.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }))
    inspHeader.element.dispatchEvent(new PointerEvent('pointermove', { clientY: 200, bubbles: true }))
    inspHeader.element.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    await flushPromises()

    expect(dockPanel.attributes('style')).toContain('top: 124px')
    expect(inspector.attributes('style')).toContain('top: 124px')
    expect(localStorage.getItem('ulink_staging_handle_top')).toBe('124')

    // 4. 模拟在下半区（如 500px）：两者均使用 bottom 锚定，且各自顶部物理位置完全一致
    wrapper.unmount()
    localStorage.setItem('ulink_staging_handle_top', '500')
    const wrapperBottom = mount(EdgeStagingSidebar)
    await flushPromises()

    const dockBottom = wrapperBottom.find('.edge-staging-dock-panel')
    const inspBottom = wrapperBottom.find('.corner-inspector-wrapper')

    expect(dockBottom.classes()).toContain('is-anchor-bottom')
    expect(inspBottom.classes()).toContain('is-anchor-bottom')

    const ch = Math.max(200, window.innerHeight - 98)
    const dockBStyle = dockBottom.attributes('style') || ''
    const inspBStyle = inspBottom.attributes('style') || ''
    const dockBVal = parseInt(dockBStyle.match(/bottom:\s*(\d+)px/)?.[1] || '0', 10)
    const inspBVal = parseInt(inspBStyle.match(/bottom:\s*(\d+)px/)?.[1] || '0', 10)

    const visualTopDock = ch - dockBVal - 220
    const visualTopInsp = ch - inspBVal - 380
    // 核心断言：展开态下半区两飞窗物理 Top 绝对对齐！
    expect(visualTopDock).toBe(visualTopInsp)
    expect(inspBVal).toBeGreaterThanOrEqual(24) // 绝不触底穿透

    wrapperBottom.unmount()
    localStorage.clear()
  })

  it('20. 点击空白处收起：在展开暂存架时，点击外部空白区域自动收起为悬浮手柄', async () => {
    localStorage.clear()
    const ui = useUIStore()
    const ds = useDataStore()
    const bm: Bookmark = { id: 'bm_1', title: '测试书签', url: 'https://example.com' } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_1']

    const wrapper = mount(EdgeStagingSidebar)
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 10))

    // 默认常驻展开
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(true)

    // 点击暂存面板内部：不收起
    await wrapper.find('.edge-staging-dock-panel').trigger('click')
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(true)

    // 模拟点击页面外部空白区域
    const blankEl = document.createElement('div')
    document.body.appendChild(blankEl)
    blankEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    // 验证暂存架收起为悬浮手柄
    expect(wrapper.find('.edge-staging-dock-panel').exists()).toBe(false)
    expect(wrapper.find('.edge-staging-handle').exists()).toBe(true)

    document.body.removeChild(blankEl)
    wrapper.unmount()
    localStorage.clear()
  })

  it('21. 收起状态持久化：收起后写入 localStorage，刷新重新挂载保持收起态不自动展开', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    const bm: Bookmark = { id: 'bm_1', title: 'BM 1', url: 'https://a.com' } as Bookmark
    ds.bookmarks = [bm]
    ui.detailCards = ['bm_1']

    const wrapper1 = mount(EdgeStagingSidebar)
    await flushPromises()

    // 初始展开
    expect(wrapper1.find('.edge-staging-dock-panel').exists()).toBe(true)
    expect(wrapper1.find('.edge-staging-handle').exists()).toBe(false)

    // 点击收起按钮
    await wrapper1.find('.dock-collapse-btn').trigger('click')
    await flushPromises()

    // 验证状态已持久化到 localStorage
    expect(localStorage.getItem('ulink_staging_collapsed')).toBe('1')
    expect(wrapper1.find('.edge-staging-handle').exists()).toBe(true)

    wrapper1.unmount()

    // 模拟刷新页面（重新 mount 组件）
    const wrapper2 = mount(EdgeStagingSidebar)
    await flushPromises()

    // 验证刷新后依然保持收起状态，不自动展开
    expect(wrapper2.find('.edge-staging-dock-panel').exists()).toBe(false)
    expect(wrapper2.find('.edge-staging-handle').exists()).toBe(true)

    // 点击手柄展开
    await wrapper2.find('.edge-staging-handle').trigger('click')
    await flushPromises()

    // 验证展开后状态更新为 0
    expect(localStorage.getItem('ulink_staging_collapsed')).toBe('0')
    expect(wrapper2.find('.edge-staging-dock-panel').exists()).toBe(true)
    expect(wrapper2.find('.edge-staging-handle').exists()).toBe(false)

    wrapper2.unmount()
    localStorage.clear()
  })
})

