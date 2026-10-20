/**
 * ChatStreamSendSummary.test.ts — 发送前透明摘要 UI 渲染与展开交互测试。
 * 覆盖：有 sendSummary 的用户气泡渲染可展开摘要条、点击展开披露数据构成行
 * （含截断标注）、无 sendSummary 的轮次不渲染摘要条。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatStream from '../../components/chat/ChatStream.vue'
import { t, setLocale } from '../../i18n/index.js'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'
import type { AiSendSummary } from '../../lib/ai/sendSummary.js'

function makeSummary(overrides: Partial<AiSendSummary> = {}): AiSendSummary {
  return {
    categoriesCount: 3,
    attributesCount: 2,
    focusedGroup: { name: '效率工具箱', shown: 2, total: 7 },
    selected: { shown: 1, total: 5 },
    attachedCardsCount: 1,
    vaultKnowledgeChars: 320,
    profileEntries: 2,
    historyTurnsIncluded: 4,
    userPromptChars: 80,
    systemPromptChars: 1200,
    estimatedTotalChars: 2600,
    ...overrides,
  }
}

function mountStream(turns: ChatTurn[]) {
  return mount(ChatStream, {
    props: {
      chatTurns: turns,
      dynamicQuickHints: [],
      copiedActionKey: null,
      loadingText: '',
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

describe('ChatStream — 发送前透明摘要条', () => {
  beforeEach(() => {
    setLocale('zh-CN')
  })

  it('有 sendSummary 的用户气泡渲染摘要入口，展开后披露数据构成与截断情况', async () => {
    const turn: ChatTurn = {
      id: 'turn-1-user',
      role: 'user',
      content: '帮我推荐工具',
      timestamp: Date.now(),
      sendSummary: makeSummary(),
    }
    const wrapper = mountStream([turn])

    const toggle = wrapper.get('.send-summary-toggle')
    expect(toggle.text()).toContain(t('ai.sendSummaryTitle'))
    // 初始折叠：不披露明细
    expect(wrapper.find('.send-summary-body').exists()).toBe(false)

    await toggle.trigger('click')
    const body = wrapper.get('.send-summary-body')
    const bodyText = body.text()
    // 数据构成行：分类/标签、工作台（含截断标注）、多选、关联卡片、全库检索、历史、字符规模
    expect(bodyText).toContain(t('ai.sendSummaryTaxonomy', { cats: 3, attrs: 2 }))
    expect(bodyText).toContain(
      t('ai.sendSummaryWorkspace', { name: '效率工具箱', shown: 2, total: 7 }) + t('ai.sendSummaryTruncated'),
    )
    expect(bodyText).toContain(
      t('ai.sendSummarySelected', { shown: 1, total: 5 }) + t('ai.sendSummaryTruncated'),
    )
    expect(bodyText).toContain(t('ai.sendSummaryCards', { n: 1 }))
    expect(bodyText).toContain(t('ai.sendSummaryRagOn', { chars: 320 }))
    expect(bodyText).toContain(t('ai.sendSummaryMemory', { n: 2 }))
    expect(bodyText).toContain(t('ai.sendSummaryHistory', { n: 4 }))
    expect(bodyText).toContain(
      t('ai.sendSummaryChars', { prompt: 80, system: 1200, total: 2600 }),
    )
    expect(bodyText).toContain(t('ai.sendSummaryNote'))

    // 再点收起
    await toggle.trigger('click')
    expect(wrapper.find('.send-summary-body').exists()).toBe(false)
  })

  it('未截断的切片不显示截断标注，未注入全库检索如实标注', async () => {
    const turn: ChatTurn = {
      id: 'turn-1-user',
      role: 'user',
      content: 'hi',
      timestamp: Date.now(),
      sendSummary: makeSummary({
        focusedGroup: { name: '收件箱', shown: 3, total: 3 },
        selected: undefined,
        vaultKnowledgeChars: 0,
      }),
    }
    const wrapper = mountStream([turn])
    await wrapper.get('.send-summary-toggle').trigger('click')
    const bodyText = wrapper.get('.send-summary-body').text()
    expect(bodyText).toContain(t('ai.sendSummaryWorkspace', { name: '收件箱', shown: 3, total: 3 }))
    expect(bodyText).not.toContain(t('ai.sendSummaryTruncated'))
    expect(bodyText).toContain(t('ai.sendSummaryRagOff'))
  })

  it('无 sendSummary 的轮次不渲染摘要条', () => {
    const wrapper = mountStream([
      { id: 'turn-1-user', role: 'user', content: 'hi', timestamp: Date.now() },
    ])
    expect(wrapper.find('.send-summary-toggle').exists()).toBe(false)
  })

  it('旧持久化摘要缺 profileEntries 字段时不渲染个人记忆行', async () => {
    const legacy: Partial<AiSendSummary> = makeSummary()
    delete legacy.profileEntries
    const turn: ChatTurn = {
      id: 'turn-1-user',
      role: 'user',
      content: 'hi',
      timestamp: Date.now(),
      sendSummary: legacy as AiSendSummary,
    }
    const wrapper = mountStream([turn])
    await wrapper.get('.send-summary-toggle').trigger('click')
    expect(wrapper.get('.send-summary-body').text()).not.toContain(t('ai.sendSummaryMemory', { n: 0 }))
  })
})
