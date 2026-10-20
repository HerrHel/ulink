/**
 * ai-send-summary.test.ts — 发送前透明摘要纯逻辑单测（零网络）。
 * 覆盖：历史裁剪单一真源（selectHistorySlice）与摘要组装（buildSendSummary）的
 * 计数 / 截断披露 / 字符规模口径——「披露的即所发」由共用同一裁剪函数保障。
 */
import { describe, it, expect } from 'vitest'
import { buildSendSummary } from '../../lib/ai/sendSummary.js'
import { selectHistorySlice, type MiMoChatMessage } from '../../lib/ai/mimoStream.js'
import type { Category, CustomAttribute } from '../../types.js'

const CATEGORIES: Category[] = [
  { id: 'all', name: '全部', icon: '', color: '', order: 0 },
  { id: 'uncategorized', name: '未分类', icon: '', color: '', order: 1 },
  { id: 'c1', name: '开发工具', icon: '', color: '', order: 2 },
  { id: 'c2', name: '设计资源', icon: '', color: '', order: 3 },
]

const ATTRIBUTES: CustomAttribute[] = [
  { id: 'a1', name: '开源', type: 'boolean' },
  { id: 'a2', name: '免费', type: 'boolean' },
]

function msg(role: MiMoChatMessage['role'], content: string): MiMoChatMessage {
  return { role, content }
}

describe('selectHistorySlice — 历史裁剪单一真源', () => {
  it('空历史返回空数组', () => {
    expect(selectHistorySlice([])).toEqual([])
  })

  it('≤4 条全量保留（剔除空消息）', () => {
    const history = [msg('user', 'q1'), msg('assistant', ''), msg('assistant', 'a1')]
    const slice = selectHistorySlice(history)
    expect(slice.map((m) => m.content)).toEqual(['q1', 'a1'])
  })

  it('>4 条只保留最近 4 条', () => {
    const history = ['q1', 'a1', 'q2', 'a2', 'q3', 'a3'].map((c, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', c),
    )
    const slice = selectHistorySlice(history)
    expect(slice.map((m) => m.content)).toEqual(['q2', 'a2', 'q3', 'a3'])
  })

  it('切片边界不得落在 tool 链中间：起点回退到链头，绝不以 tool 开头', () => {
    // 6 条：user1 → assistant(tool_calls) → tool → assistant结论 → user2 → assistant2
    const history: MiMoChatMessage[] = [
      msg('user', 'q1'),
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'audit_vault', arguments: '{}' } }] },
      { role: 'tool', content: '体检结果', tool_call_id: 'c1' },
      msg('assistant', '结论'),
      msg('user', 'q2'),
      msg('assistant', 'a2'),
    ]
    const slice = selectHistorySlice(history)
    // 原始窗口从 tool 开始，必须回退：绝不出现以 tool 打头的非法协议链
    expect(slice[0].role).not.toBe('tool')
    // tool 消息必须紧跟在带 tool_calls 的 assistant 之后（链完整）
    const toolIdx = slice.findIndex((m) => m.role === 'tool')
    expect(toolIdx).toBeGreaterThan(0)
    expect(slice[toolIdx - 1].tool_calls?.length).toBe(1)
  })

  it('字符预算超限时丢弃更旧消息，且新起点不得落在 tool 链中间', () => {
    const big = (n: number) => 'x'.repeat(n)
    const history: MiMoChatMessage[] = [
      msg('user', big(40000)),
      { role: 'assistant', content: big(40000), tool_calls: [{ id: 'c1', type: 'function', function: { name: 'audit_vault', arguments: '{}' } }] },
      { role: 'tool', content: big(40000), tool_call_id: 'c1' },
      msg('assistant', big(40000)),
    ]
    const slice = selectHistorySlice(history)
    expect(slice.length).toBeLessThan(4)
    expect(slice[0].role).not.toBe('tool')
  })
})

describe('buildSendSummary — 发送摘要组装', () => {
  const baseInput = {
    categories: CATEGORIES,
    customAttributes: ATTRIBUTES,
    contextSlice: {},
    history: [] as MiMoChatMessage[],
    userPrompt: '帮我推荐工具',
  }

  it('分类/标签计数与系统提示词注入口径一致（虚拟项不计）', () => {
    const s = buildSendSummary(baseInput)
    expect(s.categoriesCount).toBe(2)
    expect(s.attributesCount).toBe(2)
  })

  it('工作台切片披露注入条数与截断前总数', () => {
    const s = buildSendSummary({
      ...baseInput,
      contextSlice: {
        focusedGroupName: '效率工具箱',
        focusedGroupBookmarks: [{ title: 'A', url: 'https://a.com' }, { title: 'B', url: 'https://b.com' }],
      },
      focusedGroupTotal: 7,
    })
    expect(s.focusedGroup).toEqual({ name: '效率工具箱', shown: 2, total: 7 })
  })

  it('未截断时 total 回退为注入条数（不虚报截断）', () => {
    const s = buildSendSummary({
      ...baseInput,
      contextSlice: {
        focusedGroupName: '收件箱',
        focusedGroupBookmarks: [{ title: 'A', url: 'https://a.com' }],
      },
    })
    expect(s.focusedGroup).toEqual({ name: '收件箱', shown: 1, total: 1 })
  })

  it('多选书签披露 shown/total，未选时不出现该字段', () => {
    const withSelected = buildSendSummary({
      ...baseInput,
      contextSlice: { selectedBookmarks: [{ title: 'A', url: 'https://a.com' }] },
      selectedTotal: 5,
    })
    expect(withSelected.selected).toEqual({ shown: 1, total: 5 })
    expect(buildSendSummary(baseInput).selected).toBeUndefined()
  })

  it('全库检索注入量按实际字符数披露，未注入为 0', () => {
    const on = buildSendSummary({ ...baseInput, contextSlice: { retrievedVaultKnowledge: 'abcde' } })
    expect(on.vaultKnowledgeChars).toBe(5)
    expect(buildSendSummary(baseInput).vaultKnowledgeChars).toBe(0)
  })

  it('历史上下文条数与 selectHistorySlice 真源一致（披露的即所发）', () => {
    const history = ['q1', 'a1', 'q2', 'a2', 'q3', 'a3'].map((c, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', c),
    )
    const s = buildSendSummary({ ...baseInput, history })
    expect(s.historyTurnsIncluded).toBe(selectHistorySlice(history).length)
    expect(s.historyTurnsIncluded).toBe(4)
  })

  it('估算总字符 = 系统提示 + 本轮提问 + 历史切片 + 全库检索', () => {
    const history = [msg('user', 'q1'), msg('assistant', 'a1')]
    const s = buildSendSummary({
      ...baseInput,
      history,
      contextSlice: { retrievedVaultKnowledge: 'KNOW' },
      userPrompt: 'PROMPT',
    })
    const historyChars = selectHistorySlice(history).reduce((n, m) => n + m.content.length, 0)
    expect(s.userPromptChars).toBe('PROMPT'.length)
    expect(s.systemPromptChars).toBeGreaterThan(0)
    expect(s.estimatedTotalChars).toBe(s.systemPromptChars + s.userPromptChars + historyChars + 4)
  })
})
