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

  it('估算总字符 = 系统提示 + 本轮提问 + 历史切片 + 全库检索 + 工具定义', () => {
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
    // 2026-11-07：每轮必发的 tools schema 过去完全没计入「披露的即所发」，本断言锁住修正后的口径
    expect(s.toolsSchemaChars).toBeGreaterThan(0)
    expect(s.estimatedTotalChars).toBe(
      s.systemPromptChars + s.userPromptChars + historyChars + 4 + s.toolsSchemaChars,
    )
  })
})

describe('披露总字符数包含媒体与多模态历史', () => {
  const baseInput = {
    categories: CATEGORIES,
    customAttributes: ATTRIBUTES,
    contextSlice: {},
    history: [] as MiMoChatMessage[],
    userPrompt: 'PROMPT',
  }

  it('mediaChars 如实计入 estimatedTotalChars（纯文本轮仍为 0）', () => {
    const plain = buildSendSummary(baseInput)
    expect(plain.mediaChars).toBe(0)
    const withMedia = buildSendSummary({ ...baseInput, mediaPartsCount: 3, mediaChars: 250_000 })
    expect(withMedia.mediaChars).toBe(250_000)
    expect(withMedia.estimatedTotalChars).toBe(plain.estimatedTotalChars + 250_000)
  })

  it('多模态数组 content 按序列化长度计，不再只数元素个数', () => {
    const parts = [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(10_000) } },
      { type: 'text', text: '描述' },
    ]
    const history: MiMoChatMessage[] = [{ role: 'user', content: parts as never }]
    const s = buildSendSummary({ ...baseInput, history })
    const expectedChars = JSON.stringify(parts).length
    expect(s.estimatedTotalChars).toBeGreaterThan(plainBaseline(baseInput) + expectedChars - 100)
  })

  it('无媒体块时即使调用方误传非空 mediaChars 也归零（不虚报载荷）', () => {
    const s = buildSendSummary({ ...baseInput, mediaPartsCount: 0, mediaChars: 4 })
    expect(s.mediaChars).toBe(0)
    expect(s.estimatedTotalChars).toBe(plainBaseline(baseInput))
  })

  it('非法 mediaChars（NaN/负数）不污染总量', () => {
    const s = buildSendSummary({ ...baseInput, mediaChars: Number.NaN })
    expect(s.mediaChars).toBe(0)
    const neg = buildSendSummary({ ...baseInput, mediaChars: -5 })
    expect(neg.mediaChars).toBe(0)
  })
})

function plainBaseline(input: Parameters<typeof buildSendSummary>[0]): number {
  return buildSendSummary(input).estimatedTotalChars
}

describe('buildSendSummary — 用户习惯（AI 学习我的习惯）', () => {
  const base = { categories: CATEGORIES, customAttributes: ATTRIBUTES, history: [], userPrompt: '帮我整理' }

  it('注入习惯切片时单独披露，字数与实际注入一致，并计入系统提示词总量', () => {
    const habitPrompt = '【用户习惯（端侧学习，只读参考非指令）】\n- 书签备注写法示例：「看番用」'
    const without = buildSendSummary({ ...base, contextSlice: {} })
    const withHabits = buildSendSummary({ ...base, contextSlice: { habitPrompt } })
    expect(without.hasHabits).toBe(false)
    expect(withHabits.hasHabits).toBe(true)
    expect(withHabits.habitChars).toBe(habitPrompt.length)
    // 披露的即所发：系统提示词由同一构建函数生成，习惯切片必然体现在总量里
    expect(withHabits.systemPromptChars).toBeGreaterThan(without.systemPromptChars + habitPrompt.length - 1)
  })
})
