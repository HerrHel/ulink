import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import DetailPanel from '../../components/shell/DetailPanel.vue'

// 模拟外部 toast 与 siteCommander
vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  showConfirm: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../lib/ai/siteCommander.js', () => ({
  createTopicWorkspace: vi.fn().mockResolvedValue({
    group: { id: 'sg_target_1', name: 'UI设计 工作台', categoryId: 'cat_design' },
    totalBookmarks: 3,
    newBookmarksCount: 2,
    message: '创建成功',
  }),
  mergeDuplicateBookmarks: vi.fn().mockResolvedValue({
    mergedCount: 1,
    message: '已合并',
  }),
  healDeadlink: vi.fn().mockResolvedValue({
    message: '已修复',
  }),
  dispatchSiteCommand: vi.fn().mockResolvedValue({
    success: true,
    reply: '已清空回收站',
    steps: [{ text: '完成', done: true }],
  }),
  applyInboxZeroClustering: vi.fn().mockResolvedValue({
    movedCount: 2,
    message: '已归类',
  }),
}))

describe('DetailPanel — AI 交互体验升维 (Action Card & Context Hints & Tab Completion)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('情境感知：聚焦在某个笔记组时，优先推荐专属工具与查重清理', async () => {
    const ds = useDataStore()
    const ui = useUIStore()

    ds.siblingGroups.push({
      id: 'sg_ai',
      name: 'AI绘画精选',
      categoryId: 'cat_art',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '',
      updatedAt: Date.now(),
      useCount: 0,
    })
    ui.focusedGroupId = 'sg_ai'
    ui.panels.detail = true

    const wrapper = mount(DetailPanel)
    await nextTick()

    const hintButtons = wrapper.findAll('.hint-text-btn')
    expect(hintButtons.length).toBeGreaterThan(0)
    expect(hintButtons[0].text()).toContain('AI绘画')
    wrapper.unmount()
  })

  it('情境感知：选定特定分类时，优先推荐该分类的探索提示', async () => {
    const ds = useDataStore()
    const ui = useUIStore()

    ds.categories.push({
      id: 'cat_design',
      name: '设计灵感',
      icon: '',
      color: '#000000',
      order: 0,
    })
    ui.focusedGroupId = null
    ui.curCat = 'cat_design'
    ui.panels.detail = true

    const wrapper = mount(DetailPanel)
    await nextTick()

    const hintButtons = wrapper.findAll('.hint-text-btn')
    expect(hintButtons.length).toBeGreaterThan(0)
    expect(hintButtons[0].text()).toContain('设计灵感')
    wrapper.unmount()
  })

  it('行动卡片执行微交互：点击后展示转圈并防二次点击，完成后支持一键前往工作台', async () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.panels.detail = true

    ds.siblingGroups.push({
      id: 'sg_target_1',
      name: 'UI设计 工作台',
      categoryId: 'cat_design',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '',
      updatedAt: Date.now(),
      useCount: 0,
    })

    const wrapper = mount(DetailPanel)
    await nextTick()

    // 注入包含 actionCard 的助手消息
    const vm = wrapper.vm as any
    vm.chatTurns = [
      {
        id: 'turn-user-1',
        role: 'user',
        content: '/pack UI设计',
        timestamp: Date.now(),
      },
      {
        id: 'turn-asst-1',
        role: 'assistant',
        content: '已为你找到精选工具，可一键建组：',
        timestamp: Date.now(),
        actionCard: {
          type: 'custom',
          title: '一键创建「UI设计 工作台」',
          buttonText: '立即创建',
          actionName: 'create_topic_workspace',
          payload: { topic: 'UI设计' },
        },
      },
    ]
    await nextTick()

    const card = wrapper.find('.chat-action-card')
    expect(card.exists()).toBe(true)

    const btn = card.find('.action-card-btn')
    expect(btn.exists()).toBe(true)

    // 触发点击执行
    await btn.trigger('click')
    await nextTick()

    // 验证完成状态
    expect(vm.chatTurns[1].actionCard.completed).toBe(true)
    expect(vm.chatTurns[1].actionCard.resultGid).toBe('sg_target_1')

    await nextTick()
    const navBtn = wrapper.find('.action-card-nav-btn')
    expect(navBtn.exists()).toBe(true)

    // 点击「前往工作台」
    await navBtn.trigger('click')
    expect(ui.focusedGroupId).toBe('sg_target_1')
    expect(ui.curCat).toBe('cat_design')

    wrapper.unmount()
  })

  it('工作台行动卡片：支持候选多选框微操勾选与全选/反选交互', async () => {
    const ui = useUIStore()
    ui.panels.detail = true

    const wrapper = mount(DetailPanel)
    await nextTick()

    const vm = wrapper.vm as any
    vm.chatTurns = [
      {
        id: 'turn-asst-curation',
        role: 'assistant',
        content: '推荐 3 款工具：',
        timestamp: Date.now(),
        actionCard: {
          type: 'custom',
          title: '一键装配「设计工作台」',
          buttonText: '一键装配',
          actionName: 'create_topic_workspace',
          payload: {
            topic: '设计工作台',
            candidates: [
              { title: 'Figma', url: 'https://figma.com' },
              { title: 'Penpot', url: 'https://penpot.app' },
              { title: 'Sketch', url: 'https://sketch.com' },
            ],
          },
        },
      },
    ]
    await nextTick()

    // 验证多选微操区域已渲染
    const curationArea = wrapper.find('.action-card-curation')
    expect(curationArea.exists()).toBe(true)

    // 默认全选 3 项
    const checkboxes = wrapper.findAll('.action-candidate-checkbox')
    expect(checkboxes.length).toBe(3)
    expect(vm.getSelectedCandidateCount(vm.chatTurns[0].actionCard)).toBe(3)

    // 取消勾选第 2 项 (Penpot)
    await checkboxes[1].trigger('change')
    await nextTick()
    expect(vm.isCandidateSelected(vm.chatTurns[0].actionCard, 'https://penpot.app')).toBe(false)
    expect(vm.getSelectedCandidateCount(vm.chatTurns[0].actionCard)).toBe(2)

    // 点击“全不选 / 全选”切换按钮
    const toggleBtn = wrapper.find('.action-card-curation-toggle')
    expect(toggleBtn.exists()).toBe(true)

    // 当前未全选，点击触发全选
    await toggleBtn.trigger('click')
    await nextTick()
    expect(vm.getSelectedCandidateCount(vm.chatTurns[0].actionCard)).toBe(3)

    // 再次点击触发全不选
    await toggleBtn.trigger('click')
    await nextTick()
    expect(vm.getSelectedCandidateCount(vm.chatTurns[0].actionCard)).toBe(0)

    wrapper.unmount()
  })

  it('斜杠指令在输入框按 Tab 键自动补全', async () => {
    const ui = useUIStore()
    ui.panels.detail = true

    const wrapper = mount(DetailPanel)
    await nextTick()

    const textarea = wrapper.find('.chat-textarea')
    await textarea.setValue('/dead')
    await nextTick()

    // 按下 Tab 键
    await textarea.trigger('keydown', { key: 'Tab' })
    await nextTick()

    const vm = wrapper.vm as any
    expect(vm.aiQuery).toBe('/deadlink ')
    wrapper.unmount()
  })

  it('拖入卡片与笔记：输入框上方展示附件胶囊，支持移除与就地回车提问', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    ui.panels.detail = true

    ds.bookmarks.push({
      id: 'bm_github',
      title: 'GitHub 开源社区',
      url: 'https://github.com',
      order: 1,
    } as any)
    ds.siblingGroups.push({
      id: 'sg_notes',
      name: '架构复盘笔记',
      notes: '<p>笔记正文</p>',
      bookmarkIds: [],
      order: 1,
      categoryId: '',
      icon: '',
      isExpanded: false,
      attributes: {},
      updatedAt: Date.now(),
      useCount: 0,
    })

    // 模拟拖入关联书签与笔记
    ui.attachCardToAi('bm', 'bm_github')
    ui.attachCardToAi('group', 'sg_notes')

    const wrapper = mount(DetailPanel)
    await nextTick()

    // 验证附件栏已渲染
    const bar = wrapper.find('.chat-attached-cards-bar')
    expect(bar.exists()).toBe(true)

    const chips = wrapper.findAll('.chat-attached-chip')
    expect(chips.length).toBe(2)
    expect(chips[0].text()).toContain('GitHub 开源社区')
    expect(chips[1].text()).toContain('架构复盘笔记')

    // 点击移除其中一个
    const removeBtns = wrapper.findAll('.chip-remove-btn')
    await removeBtns[0].trigger('click')
    await nextTick()
    expect(ui.aiAttachedCards).toEqual([{ type: 'group', id: 'sg_notes' }])

    // 输入框未键入文字时，发送按钮依然可用
    const sendBtn = wrapper.find('.chat-send-btn')
    expect(sendBtn.attributes('disabled')).toBeUndefined()

    // 回车发送：自动带出默认分析提问并清空输入框胶囊栏
    await wrapper.find('.chat-textarea').trigger('keydown', { key: 'Enter' })
    await nextTick()

    const vm = wrapper.vm as any
    // 对话流中生成 user turn 并且带上了 attachedCards 元数据
    const userTurn = vm.chatTurns.find((t: any) => t.role === 'user')
    expect(userTurn).toBeDefined()
    expect(userTurn.attachedCards.length).toBe(1)
    expect(userTurn.attachedCards[0].title).toBe('架构复盘笔记')
    expect(userTurn.content).toContain('架构复盘笔记')

    // 输入框附带槽位已清空
    expect(ui.aiAttachedCards.length).toBe(0)

    wrapper.unmount()
  })
})
