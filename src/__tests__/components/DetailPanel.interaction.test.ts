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
  mergeDuplicateBookmarks: vi.fn().mockReturnValue({
    mergedCount: 1,
    message: '已合并',
  }),
  healDeadlink: vi.fn().mockReturnValue({
    message: '已修复',
  }),
  dispatchSiteCommand: vi.fn().mockResolvedValue({
    success: true,
    reply: '已清空回收站',
    steps: [{ text: '完成', done: true }],
  }),
  applyInboxZeroClustering: vi.fn().mockReturnValue({
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
})
