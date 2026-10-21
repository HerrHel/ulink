import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatStream from '../../components/chat/ChatStream.vue'
import { setLocale } from '../../i18n/index.js'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'
import { parseTurnContentSegments } from '../../lib/ai/chatStreamParser.js'

function mountStream(turns: ChatTurn[]) {
  return mount(ChatStream, {
    props: {
      chatTurns: turns,
      dynamicQuickHints: [],
      copiedActionKey: null,
      loadingText: '思考中…',
      formatReasoningSec: () => '',
      getCleanCopyText: (s?: string) => s || '',
      getTurnSegments: () => [],
      getTurnAttachedCards: () => [],
      getAttachedNotes: () => [],
      hasUnaddedInTurn: () => false,
      getCardCandidateList: () => [],
      getSelectedCandidateCount: () => 0,
      isAllCandidatesSelected: () => false,
      isCandidateSelected: () => false,
      formatDomain: () => '',
      getActionCardNavTarget: () => null,
    },
  })
}

describe('ChatStream — 预判建议按钮与写回笔记图标', () => {
  beforeEach(() => {
    setLocale('zh-CN')
  })

  it('存为新笔记按钮渲染主站统一的 I.note SVG 图标而非 emoji', () => {
    const turn: ChatTurn = {
      id: 'turn-asst-1',
      role: 'assistant',
      content: '这是总结内容',
      loading: false,
      timestamp: Date.now(),
    }
    const wrapper = mountStream([turn])
    const newNoteBtn = wrapper.find('.writeback-new')
    expect(newNoteBtn.exists()).toBe(true)
    expect(newNoteBtn.html()).toContain('<svg')
    expect(newNoteBtn.text()).not.toContain('📝')
  })

  it('预判按钮仅在最新且无后续用户回复的助手轮次渲染，用户输入后隐藏', () => {
    const turns: ChatTurn[] = [
      { id: 'u1', role: 'user', content: '第一问', timestamp: 1000 },
      { id: 'a1', role: 'assistant', content: '第一答', suggestedReplies: ['✨ 好的，执行', '🔄 换个方案'], timestamp: 2000 },
    ]
    const wrapper = mountStream(turns)
    const pillsBefore = wrapper.findAll('.suggested-reply-pill')
    expect(pillsBefore.length).toBe(2)
    expect(pillsBefore[0].text()).toBe('✨ 好的，执行')

    // 随后用户输入并提交了新消息 u2
    turns.push({ id: 'u2', role: 'user', content: '第二问', timestamp: 3000 })
    const wrapperAfter = mountStream(turns)
    // a1 下方的预判按钮不再展示
    expect(wrapperAfter.findAll('.suggested-reply-pill').length).toBe(0)
  })

  it('正确渲染包含 Markdown 表格的助手回复内容', () => {
    const md = `| 书签 | 建议标签 |\n|---|---|\n| 抖音 | 需要登录 |`
    const { segments } = parseTurnContentSegments(md, [], [])
    const turn: ChatTurn = {
      id: 'turn-asst-table',
      role: 'assistant',
      content: md,
      loading: false,
      timestamp: Date.now(),
    }
    const wrapper = mount(ChatStream, {
      props: {
        chatTurns: [turn],
        dynamicQuickHints: [],
        copiedActionKey: null,
        loadingText: '思考中…',
        formatReasoningSec: () => '',
        getCleanCopyText: (s?: string) => s || '',
        getTurnSegments: () => segments,
        getTurnAttachedCards: () => [],
        getAttachedNotes: () => [],
        hasUnaddedInTurn: () => false,
        getCardCandidateList: () => [],
        getSelectedCandidateCount: () => 0,
        isAllCandidatesSelected: () => false,
        isCandidateSelected: () => false,
        formatDomain: () => '',
        getActionCardNavTarget: () => null,
      },
    })
    expect(wrapper.find('.chat-flow-table-wrap').exists()).toBe(true)
    expect(wrapper.find('.chat-flow-table').exists()).toBe(true)
    expect(wrapper.find('th').text()).toBe('书签')
    expect(wrapper.find('td').text()).toBe('抖音')
  })

  it('深度思考生成中，若内容超出容器高度自动滚动吸底；用户主动上滑后暂停吸底', async () => {
    const turn: ChatTurn = {
      id: 'turn-thinking-1',
      role: 'assistant',
      content: '',
      reasoning: '正在思考第1步...',
      isThinking: true,
      _thinkingOpen: true,
      loading: true,
      timestamp: Date.now(),
    }
    const wrapper = mountStream([turn])
    const bodyEl = wrapper.find('.chat-thinking-body').element as HTMLElement
    expect(bodyEl).toBeDefined()

    // 模拟容器产生滚动条
    Object.defineProperty(bodyEl, 'scrollHeight', { value: 600, configurable: true })
    Object.defineProperty(bodyEl, 'clientHeight', { value: 240, configurable: true })

    // reasoning 内容持续增长
    turn.reasoning = '正在思考第1步...\n正在深入分析第2步...\n正在整理第3步...'
    await wrapper.setProps({ chatTurns: [{ ...turn }] })

    // 验证自动吸底
    expect(bodyEl.scrollTop).toBe(600)

    // 模拟用户手动往上滚动（距离底部 > 40px）
    bodyEl.scrollTop = 100
    await wrapper.find('.chat-thinking-body').trigger('scroll')

    // reasoning 再次更新
    Object.defineProperty(bodyEl, 'scrollHeight', { value: 800, configurable: true })
    turn.reasoning += '\n用户正在回看，此时新生成的第4步...'
    await wrapper.setProps({ chatTurns: [{ ...turn }] })

    // 验证用户向上翻看期间不会被强行拽到底部
    expect(bodyEl.scrollTop).toBe(100)

    // 模拟用户滚回底部（距离底部 <= 40px）
    bodyEl.scrollTop = 580 // 800 - 580 - 240 = -20 <= 40
    await wrapper.find('.chat-thinking-body').trigger('scroll')

    // 再次流式生成，应恢复自动滚到底部
    Object.defineProperty(bodyEl, 'scrollHeight', { value: 1000, configurable: true })
    turn.reasoning += '\n重新恢复吸底第5步...'
    await wrapper.setProps({ chatTurns: [{ ...turn }] })

    expect(bodyEl.scrollTop).toBe(1000)
  })
})
