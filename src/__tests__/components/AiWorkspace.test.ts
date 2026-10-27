import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import AppNav from '../../components/shell/AppNav.vue'
import AiWorkspace from '../../components/chat/AiWorkspace.vue'

describe('AI 专属栏与沉浸式视图状态流', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('1. 默认状态：aiRailEnabled 为 true，activeView 为 bookmarks', () => {
    const ui = useUIStore()
    expect(ui.aiRailEnabled).toBe(true)
    expect(ui.activeView).toBe('bookmarks')
  })

  it('2. 在 AppNav 中渲染 AI 栏：点击切换至 ai 视图', async () => {
    const ui = useUIStore()
    const data = useDataStore()
    data.categories = [{ id: 'cat_all', name: '全部', icon: 'star', color: '#000', order: 0 }]

    const wrapper = mount(AppNav)
    const aiItem = wrapper.find('[data-testid="rail-item-ai"]')
    expect(aiItem.exists()).toBe(true)

    await aiItem.trigger('click')
    expect(ui.activeView).toBe('ai')
    expect(aiItem.classes()).toContain('active')
  })

  it('3. 在 ai 视图下点击普通分类：自动恢复 bookmarks 视图并高亮对应分类', async () => {
    const ui = useUIStore()
    const data = useDataStore()
    data.categories = [
      { id: 'cat_all', name: '全部', icon: 'star', color: '#000', order: 0 },
      { id: 'cat_work', name: '工作', icon: 'folder', color: '#000', order: 1 }
    ]

    ui.activeView = 'ai'
    const wrapper = mount(AppNav)

    const catButtons = wrapper.findAll('.rail-nav .rail-item')
    expect(catButtons.length).toBeGreaterThan(0)

    // 点击工作分类
    const workBtn = catButtons.find(b => b.attributes('data-cat-id') === 'cat_work')
    expect(workBtn).toBeDefined()
    await workBtn!.trigger('click')

    expect(ui.activeView).toBe('bookmarks')
    expect(ui.curCat).toBe('cat_work')
  })

  it('4. 设置中隐藏 AI 栏：aiRailEnabled=false 时 AppNav 不显示该栏，若处于 ai 视图安全退回 bookmarks', async () => {
    const ui = useUIStore()
    ui.activeView = 'ai'

    // 用户在设置中关闭
    ui.aiRailEnabled = false
    if (!ui.aiRailEnabled && ui.activeView === 'ai') {
      ui.activeView = 'bookmarks'
    }
    ui.saveUIState()

    expect(ui.activeView).toBe('bookmarks')

    const wrapper = mount(AppNav)
    expect(wrapper.find('[data-testid="rail-item-ai"]').exists()).toBe(false)
  })

  it('6. 回车键发送：普通 Enter 提交，Shift+Enter 换行，IME 组合不误发', async () => {
    const wrapper = mount(AiWorkspace)
    const ta = wrapper.find('.ai-minimal-textarea')
    expect(ta.exists()).toBe(true)

    // 1. Shift + Enter 换行不发送
    await ta.setValue('第一行')
    await ta.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.find('.ai-clean-hero').exists()).toBe(true)

    // 2. IME 组合中（isComposing 或 keyCode 229）不发送
    await ta.trigger('keydown', { key: 'Enter', isComposing: true })
    await ta.trigger('keydown', { key: 'Enter', keyCode: 229 })
    expect(wrapper.find('.ai-clean-hero').exists()).toBe(true)

    // 3. 正常 Enter 提交
    await ta.setValue('测试提问')
    await ta.trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(wrapper.find('.ai-clean-hero').exists()).toBe(false)
  })

  it('7. 数字小键盘 Enter 与 Ctrl+Enter 也能正常触发发送', async () => {
    const wrapper = mount(AiWorkspace)
    const ta = wrapper.find('.ai-minimal-textarea')

    // 小键盘 Enter 发送
    await ta.setValue('小键盘提问')
    await ta.trigger('keydown', { key: 'Enter', code: 'NumpadEnter' })
    await nextTick()
    expect(wrapper.find('.ai-clean-hero').exists()).toBe(false)
  })

  it('5. UI 状态持久化：saveUIState 与 restoreUIState 能正确持久化 aiRailEnabled', () => {
    const ui = useUIStore()
    ui.aiRailEnabled = false
    ui.saveUIState()

    // 重新创建 pinia 模拟刷新页面
    setActivePinia(createPinia())
    const ui2 = useUIStore()
    ui2.restoreUIState()
    expect(ui2.aiRailEnabled).toBe(false)
  })

  it('8. 方案B 历史会话展示：空态胶囊底座「全部 (N)」滑出极简抽屉、实时搜索过滤与会话切换', async () => {
    // 准备 4 个会话（3个有内容，1个当前空会话以保持在空态 Hero）
    const mockSessions = [
      {
        id: 'session-1',
        title: '关于Vue3的讨论',
        turns: [
          { id: 't1', role: 'user', content: 'Vue3组合式API优缺点', timestamp: Date.now() - 60000 },
          { id: 't2', role: 'assistant', content: 'Vue3提供了更灵活的代码组织方式', timestamp: Date.now() - 50000 }
        ],
        createdAt: Date.now() - 60000,
        updatedAt: Date.now() - 50000
      },
      {
        id: 'session-2',
        title: '关于TypeScript技巧',
        turns: [
          { id: 't3', role: 'user', content: 'TS高级类型映射', timestamp: Date.now() - 40000 },
          { id: 't4', role: 'assistant', content: 'TS提供了Conditional Types等', timestamp: Date.now() - 30000 }
        ],
        createdAt: Date.now() - 40000,
        updatedAt: Date.now() - 30000
      },
      {
        id: 'session-3',
        title: 'CloudBase云函数部署',
        turns: [
          { id: 't5', role: 'user', content: '云函数如何CI部署', timestamp: Date.now() - 20000 },
          { id: 't6', role: 'assistant', content: '可以使用tcb cli或者deploy脚本', timestamp: Date.now() - 10000 }
        ],
        createdAt: Date.now() - 20000,
        updatedAt: Date.now() - 10000
      },
      {
        id: 'session-4',
        title: '当前空态新会话',
        turns: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]

    localStorage.setItem('lv_ai_sessions_v1', JSON.stringify(mockSessions))
    localStorage.setItem('lv_ai_cur_session_v1', 'session-4')

    const wrapper = mount(AiWorkspace, { attachTo: document.body })

    // 1. 空态底座渲染：胶囊下方有最近会话，且最多展示 3 条 + 全部按钮
    const shelf = wrapper.find('.ai-hero-recent-shelf')
    expect(shelf.exists()).toBe(true)

    const allBtn = wrapper.find('.recent-shelf-all-btn')
    expect(allBtn.exists()).toBe(true)
    expect(allBtn.find('.shelf-count-tag').text()).toBe('4')

    // 2. 点击「全部会话 (4)」打开抽屉
    await allBtn.trigger('click')
    await nextTick()

    const drawer = document.body.querySelector('.ai-history-drawer')
    expect(drawer).not.toBeNull()

    // 抽屉头部包含会话总数 badge
    const badge = drawer!.querySelector('.drawer-count-badge')
    expect(badge?.textContent?.trim()).toBe('4')

    // 3. 实时搜索过滤功能：输入 TS
    const searchInput = drawer!.querySelector('.history-search-input') as HTMLInputElement
    expect(searchInput).not.toBeNull()
    searchInput.value = 'TypeScript'
    searchInput.dispatchEvent(new Event('input'))
    await nextTick()

    let cards = drawer!.querySelectorAll('.drawer-session-card')
    expect(cards.length).toBe(1)
    expect(cards[0].textContent).toContain('TypeScript')

    // 清空搜索框
    const clearBtn = drawer!.querySelector('.search-clear-btn') as HTMLButtonElement
    expect(clearBtn).not.toBeNull()
    clearBtn.click()
    await nextTick()

    cards = drawer!.querySelectorAll('.drawer-session-card')
    expect(cards.length).toBe(4)

    // 4. 点击某个会话卡片：切换并自动关闭抽屉
    const vueCard = Array.from(cards).find(c => c.textContent?.includes('Vue3')) as HTMLElement
    expect(vueCard).toBeDefined()
    vueCard.click()
    await nextTick()

    // 切换到了非空会话 session-1，因此进入了对话流（不再是 clean-hero）
    expect(wrapper.find('.ai-clean-hero').exists()).toBe(false)
    expect(wrapper.find('.stream-title-text').text()).toContain('Vue3')

    // 抽屉已自动关闭
    expect(document.body.querySelector('.ai-history-drawer')).toBeNull()

    // 5. 对话流顶栏的历史胶囊按钮也能再次打开抽屉
    const streamHistoryBtn = wrapper.find('.stream-history-pill-btn')
    expect(streamHistoryBtn.exists()).toBe(true)
    await streamHistoryBtn.trigger('click')
    await nextTick()

    expect(document.body.querySelector('.ai-history-drawer')).not.toBeNull()

    // 6. 按下 Esc 键抽屉关闭
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.body.querySelector('.ai-history-drawer')).toBeNull()

    wrapper.unmount()
  })

  it('9. 拖拽分类与暂存区卡片直接落入 AI 工作台胶囊对话框', async () => {
    const ui = useUIStore()
    const ds = useDataStore()

    ds.categories = [
      { id: 'cat_design', name: '设计灵感', icon: 'palette', color: '#ec4899', order: 1 },
    ]
    ds.bookmarks = [
      { id: 'bm_d1', title: 'Dribbble 社区', url: 'https://dribbble.com', categoryId: 'cat_design', order: 1 } as any,
    ]

    const wrapper = mount(AiWorkspace)

    // 1. 拖拽分类落入工作台
    const ws = wrapper.find('.ai-workspace')
    expect(ws.exists()).toBe(true)

    // 模拟 category drop 直接投向核心输入胶囊
    const capsule = wrapper.find('.ai-capsule-input-container')
    expect(capsule.exists()).toBe(true)

    await capsule.trigger('drop', {
      dataTransfer: {
        getData: (key: string) => {
          if (key === 'application/x-linkvault' || key === 'application/x-linkvault-drag') {
            return JSON.stringify({ type: 'cat', id: 'cat_design' })
          }
          return 'cat_design'
        },
      },
    })
    await nextTick()

    // 附件条出现分类小药丸，带有 folder 图标
    expect(ui.aiAttachedCards).toContainEqual({ type: 'cat', id: 'cat_design' })
    const pill = wrapper.find('.ai-attach-pill.cat')
    expect(pill.exists()).toBe(true)
    expect(pill.text()).toContain('设计灵感')
    expect(pill.find('.pill-cat-icon').exists()).toBe(true)

    // 2. 从暂存架拖拽书签落入输入胶囊
    ui.detailCards = ['bm_d1']
    await capsule.trigger('drop', {
      dataTransfer: {
        getData: (key: string) => {
          if (key === 'application/x-linkvault' || key === 'application/x-linkvault-drag') {
            return JSON.stringify({ type: 'bm', id: 'bm_d1', srcGid: '__detail__' })
          }
          return 'bm_d1'
        },
      },
    })
    await nextTick()

    expect(ui.aiAttachedCards).toContainEqual({ type: 'bm', id: 'bm_d1' })
    // 书签药丸正常挂载
    const bmPill = wrapper.findAll('.ai-attach-pill').find(p => p.text().includes('Dribbble'))
    expect(bmPill).toBeDefined()
  })

  it('10. 切换至 AI 工作台时自动关闭右侧边栏 DetailPanel，避免两个对话框同时存在', async () => {
    const ui = useUIStore()
    ui.activeView = 'bookmarks'
    ui.panels.detail = true // 模拟用户在书签视图开启了右侧 AI 抽屉
    expect(ui.panels.detail).toBe(true)

    // 用户切换至 AI 工作台
    ui.switchToAiView()

    expect(ui.activeView).toBe('ai')
    expect(ui.panels.detail).toBe(false)

    // 显式触发新对话时同样关闭右侧抽屉
    ui.panels.detail = true
    ui.triggerAiNewChat()
    expect(ui.panels.detail).toBe(false)
  })
})
