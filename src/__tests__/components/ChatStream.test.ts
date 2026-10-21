import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatStream from '../../components/chat/ChatStream.vue'
import { setLocale } from '../../i18n/index.js'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'

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
    }
    const wrapper = mountStream([turn])
    const newNoteBtn = wrapper.find('.writeback-new')
    expect(newNoteBtn.exists()).toBe(true)
    expect(newNoteBtn.html()).toContain('<svg')
    expect(newNoteBtn.text()).not.toContain('📝')
  })

  it('预判按钮仅在最新且无后续用户回复的助手轮次渲染，用户输入后隐藏', () => {
    const turns: ChatTurn[] = [
      { id: 'u1', role: 'user', content: '第一问' },
      { id: 'a1', role: 'assistant', content: '第一答', suggestedReplies: ['✨ 好的，执行', '🔄 换个方案'] },
    ]
    const wrapper = mountStream(turns)
    const pillsBefore = wrapper.findAll('.suggested-reply-pill')
    expect(pillsBefore.length).toBe(2)
    expect(pillsBefore[0].text()).toBe('✨ 好的，执行')

    // 随后用户输入并提交了新消息 u2
    turns.push({ id: 'u2', role: 'user', content: '第二问' })
    const wrapperAfter = mountStream(turns)
    // a1 下方的预判按钮不再展示
    expect(wrapperAfter.findAll('.suggested-reply-pill').length).toBe(0)
  })
})
