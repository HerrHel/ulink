import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatDraftDiff from '../../components/chat/ChatDraftDiff.vue'
import ChatDagPlan from '../../components/chat/ChatDagPlan.vue'
import type { ChatActionCard } from '../../lib/ai/chatSessions.js'

function card(over: Partial<ChatActionCard> = {}): ChatActionCard {
  return {
    type: 'draft_diff',
    title: '整理方案',
    buttonText: '执行',
    actionName: 'applyDraftDiff',
    ...over,
  }
}

const diffCard = (completed: boolean) =>
  card({
    type: 'draft_diff',
    completed,
    payload: {
      diffPayload: {
        items: [
          { id: 'a', title: 'A', changeType: 'add', selected: true, detail: '新增' },
          { id: 'b', title: 'B', changeType: 'modify', selected: false, before: { categoryName: '旧' }, after: { categoryName: '新' } },
        ],
        stats: { toAdd: 1, toModify: 1, toRemove: 0, toNest: 0 },
      },
    },
  })

describe('行动卡片完成态：同一位置状态交接，且不吞内容', () => {
  it('ChatDraftDiff 未完成时渲染执行按钮，完成后切成已完成提示', () => {
    const pending = mount(ChatDraftDiff, { props: { card: diffCard(false) } })
    expect(pending.find('.diff-apply-btn').exists()).toBe(true)
    expect(pending.find('.diff-completed-notice').exists()).toBe(false)
    expect(pending.findAll('.diff-item-row')).toHaveLength(2)

    const done = mount(ChatDraftDiff, { props: { card: diffCard(true) } })
    expect(done.find('.diff-apply-btn').exists()).toBe(false)
    expect(done.find('.diff-completed-notice').exists()).toBe(true)
    expect(done.find('.diff-completed-notice').text()).toContain('✓')
  })

  it('ChatDagPlan 未完成时渲染一键执行，完成后切成已完成提示', () => {
    const pending = mount(ChatDagPlan, {
      props: {
        card: card({
          type: 'dag_plan',
          payload: { plan: { title: '计划', steps: [{ id: 's1', title: '步骤一', status: 'pending', actionName: 'x' }] } },
        }),
      },
    })
    expect(pending.find('.dag-execute-all-btn').exists()).toBe(true)
    expect(pending.find('.dag-completed-notice').exists()).toBe(false)

    const done = mount(ChatDagPlan, {
      props: {
        card: card({
          type: 'dag_plan',
          completed: true,
          payload: { plan: { title: '计划', steps: [{ id: 's1', title: '步骤一', status: 'success', actionName: 'x' }] } },
        }),
      },
    })
    expect(done.find('.dag-execute-all-btn').exists()).toBe(false)
    expect(done.find('.dag-completed-notice').exists()).toBe(true)
  })
})
