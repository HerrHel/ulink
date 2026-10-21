/**
 * useAiChat-agent-loop — 真 Agent 多步工具链回归测试
 * 验收点（多步 agent 循环）：
 * 1. 续轮放开 Tool Calling（此前续轮 enableTools:false 只是「单臂假循环」）；
 * 2. 模型可在续轮继续请求工具，多步工具真实执行；
 * 3. 每轮工具结果以 role:'tool' 回传模型，且多轮工具链累积持久化到会话；
 * 4. 续轮失败不覆盖首轮已执行的真实结果。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 稳定共享 mock 状态（vi.hoisted）：附件槽位需跨调用保留并可断言 clearAiAttachedCards 行为
const mockState = vi.hoisted(() => {
  const state = {
    aiAttachedCards: [] as Array<{ type: 'bm' | 'group'; id: string }>,
    clearAiAttachedCards: vi.fn(() => {
      state.aiAttachedCards.length = 0
    }),
    curCat: 'all',
    focusedGroupId: null,
    batchMode: false,
    batchSelected: [],
    bookmarks: [] as unknown[],
    siblingGroups: [] as unknown[],
    categories: [] as unknown[],
    customAttributes: [] as unknown[],
    groupMap: {} as Record<string, unknown>,
    bookmarkMap: {
      bm1: {
        id: 'bm1',
        title: '测试书签',
        url: 'https://example.com',
        notes: '',
        categoryId: 'c1',
        attributes: {},
      },
    } as Record<string, unknown>,
  }
  return state
})

vi.mock('../../stores/ui.js', () => ({ useUIStore: () => mockState }))
vi.mock('../../stores/data.js', () => ({ useDataStore: () => mockState }))

vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn() }))

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(async () => true),
}))

vi.mock('../../lib/ai/cloudAiClient.js', () => ({
  searchWebsitesByIntent: vi.fn(async () => []),
  findSimilarWebsites: vi.fn(async () => []),
  extractBookmarksFromVideo: vi.fn(async () => ({ bookmarks: [], videoTitle: '' })),
}))

vi.mock('../../lib/ai/mimoClient.js', () => ({
  askMiMoStream: vi.fn(),
  getMiMoConfig: vi.fn(() => ({ enabled: true, model: 'test-model', apiKey: '', baseUrl: '' })),
  sanitizeToolResult: (s: string) => s,
}))

vi.mock('../../lib/ai/siteCommander.js', () => ({
  // 自然语言查询返回未处理（放行至 MiMo）；斜杠指令返回工具执行结果
  dispatchSiteCommand: vi.fn(async (cmd: string) =>
    cmd.startsWith('/') ? { handled: true, reply: `工具结果:${cmd}` } : { handled: false, reply: '' },
  ),
  mergeDuplicateBookmarks: vi.fn(),
  applyInboxZeroClustering: vi.fn(),
  createTopicWorkspace: vi.fn(),
  healDeadlink: vi.fn(),
}))

import { useAiChat } from '../../composables/domain/useAiChat.js'
import { askMiMoStream } from '../../lib/ai/mimoClient.js'
import { dispatchSiteCommand } from '../../lib/ai/siteCommander.js'
import { searchWebsitesByIntent } from '../../lib/ai/cloudAiClient.js'

const streamMock = vi.mocked(askMiMoStream)

interface FakeToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  argsParseFailed?: boolean
}

function aiRes(reply: string, toolCalls?: FakeToolCall[]) {
  return {
    reply,
    reasoning: '',
    cleanText: reply,
    candidates: [],
    rawText: reply,
    model: 'test-model',
    toolCalls: toolCalls as never,
  }
}

describe('useAiChat — 真 Agent 多步工具链循环', () => {
  beforeEach(() => {
    streamMock.mockReset()
    mockState.aiAttachedCards.length = 0
    mockState.clearAiAttachedCards.mockClear()
  })

  it('续轮放开 Tool Calling：模型可串联多步工具链，结果逐轮 role:tool 回传且累积持久化', async () => {
    streamMock
      .mockResolvedValueOnce(aiRes('先做全库体检', [{ id: 'c1', name: 'audit_vault', arguments: {} }]))
      .mockResolvedValueOnce(
        aiRes('体检完成，切换深色主题', [{ id: 'c2', name: 'toggle_theme', arguments: { mode: 'dark' } }]),
      )
      .mockResolvedValueOnce(aiRes('已体检并切换深色主题，全部完成'))

    const ai = useAiChat()
    ai.aiQuery.value = '帮我体检书签库并切换深色主题'
    await ai.handleAiSubmit()

    // 首轮 + 2 轮续轮：续轮不再被 enableTools:false 锁死为单臂
    expect(streamMock).toHaveBeenCalledTimes(3)

    const round2Ctx = streamMock.mock.calls[1][1]
    const round3Ctx = streamMock.mock.calls[2][1]
    expect(round2Ctx.enableTools).not.toBe(false)
    expect(round3Ctx.enableTools).not.toBe(false)

    // 每轮续轮都以 role:'tool' 回传上一轮工具真实结果
    const round2ToolMsgs = (round2Ctx.history || []).filter((m) => m.role === 'tool')
    expect(round2ToolMsgs.some((m) => m.tool_call_id === 'c1')).toBe(true)
    const round3ToolMsgs = (round3Ctx.history || []).filter((m) => m.role === 'tool')
    expect(round3ToolMsgs.some((m) => m.tool_call_id === 'c2')).toBe(true)

    // 两步工具都被真实执行
    expect(dispatchSiteCommand).toHaveBeenCalledWith('/health', expect.anything())
    expect(dispatchSiteCommand).toHaveBeenCalledWith('/theme dark', expect.anything())

    // 多轮工具链累积持久化：多轮对话回放 assistant→tool 协议链不失忆
    const assistantTurn = ai.chatTurns.value.find((t) => t.role === 'assistant')
    expect(assistantTurn?.toolCalls?.map((c) => c.name)).toEqual(['audit_vault', 'toggle_theme'])
    expect(assistantTurn?.toolResults?.map((r) => r.toolCallId)).toEqual(['c1', 'c2'])
    expect(assistantTurn?.content).toBe('已体检并切换深色主题，全部完成')
  })

  it('续轮失败不覆盖首轮已执行的真实结果', async () => {
    streamMock
      .mockResolvedValueOnce(aiRes('', [{ id: 'c1', name: 'inbox_zero', arguments: {} }]))
      .mockRejectedValueOnce(new Error('network down'))

    const ai = useAiChat()
    ai.aiQuery.value = '帮我清一下收件箱'
    await ai.handleAiSubmit()

    const assistantTurn = ai.chatTurns.value.find((t) => t.role === 'assistant')
    // 首轮工具真实结果保留，不被续轮错误覆盖
    expect(assistantTurn?.content).toBe('工具结果:/inbox')
    expect(assistantTurn?.toolResults?.[0]?.resultText).toBe('工具结果:/inbox')
    expect(assistantTurn?.toolCalls?.[0]?.name).toBe('inbox_zero')
  })

  it('本轮 user 消息不双份注入：首轮 history 不含本轮内容，续轮恰出现一次', async () => {
    streamMock
      .mockResolvedValueOnce(aiRes('收到', [{ id: 'c1', name: 'toggle_theme', arguments: { mode: 'dark' } }]))
      .mockResolvedValueOnce(aiRes('完成'))

    const ai = useAiChat()
    ai.aiQuery.value = '切换深色主题'
    await ai.handleAiSubmit()

    // 首轮：query 单独作为 user 消息发出，history 不得重复携带本轮内容
    const [firstQuery, firstCtx] = streamMock.mock.calls[0]
    expect(firstQuery).toBe('切换深色主题')
    expect((firstCtx.history || []).some((m) => m.role === 'user' && m.content === '切换深色主题')).toBe(false)

    // 续轮：roundHistory 补回本轮内容，全序列恰出现一次（不重复注入）
    const round2Ctx = streamMock.mock.calls[1][1]
    const userMsgs = (round2Ctx.history || []).filter((m) => m.role === 'user' && m.content === '切换深色主题')
    expect(userMsgs.length).toBe(1)
  })

  it('停止生成后不再执行后续工具副作用（已执行的照常持久化）', async () => {
    const cmdMock = vi.mocked(dispatchSiteCommand)
    cmdMock.mockReset()
    streamMock.mockResolvedValueOnce(
      aiRes('先体检再切主题', [
        { id: 'c1', name: 'audit_vault', arguments: {} },
        { id: 'c2', name: 'toggle_theme', arguments: { mode: 'dark' } },
      ]),
    )

    const ai = useAiChat()
    // 第一个工具执行时用户按下「停止生成」（自然语言查询放行给大模型，仅工具指令触发停止）
    cmdMock.mockImplementation(async (cmd: string) => {
      if (cmd === '/health') {
        ai.handleStopGenerating()
        return { handled: true, reply: '体检结果' }
      }
      return { handled: false, reply: '' }
    })

    ai.aiQuery.value = '体检并切换主题'
    await ai.handleAiSubmit()

    // 第二个工具不得再执行
    expect(cmdMock.mock.calls.some(([cmd]) => cmd.includes('/theme'))).toBe(false)
    // 已执行的第一个工具真实结果照常持久化，未执行的调用不得混入协议链
    const assistantTurn = ai.chatTurns.value.find((t) => t.role === 'assistant')
    expect(assistantTurn?.toolCalls?.map((c) => c.name)).toEqual(['audit_vault'])
    expect(assistantTurn?.toolResults?.map((r) => r.toolCallId)).toEqual(['c1'])
  })

  it('站内命令返回后若已停止生成，不把命令结果写入回复', async () => {
    const cmdMock = vi.mocked(dispatchSiteCommand)
    cmdMock.mockReset()
    streamMock.mockResolvedValueOnce(aiRes('不应走到大模型'))

    const ai = useAiChat()
    cmdMock.mockImplementation(async () => {
      // 模拟命令执行途中用户停止生成
      ai.handleStopGenerating()
      return { handled: true, reply: '停止后不应出现的命令回复' }
    })

    ai.aiQuery.value = '帮我看看库健康度'
    await ai.handleAiSubmit()

    const assistantTurn = ai.chatTurns.value.find((t) => t.role === 'assistant')
    expect(assistantTurn?.content).not.toBe('停止后不应出现的命令回复')
  })

  it('工具执行异常如实回传错误结果，不被本地甄选兜底改写', async () => {
    const cmdMock = vi.mocked(dispatchSiteCommand)
    const searchMock = vi.mocked(searchWebsitesByIntent)
    cmdMock.mockReset()
    searchMock.mockClear()
    streamMock
      .mockResolvedValueOnce(aiRes('执行体检', [{ id: 'c1', name: 'audit_vault', arguments: {} }]))
      .mockResolvedValueOnce(aiRes('体检工具执行出错，未能确认完成。'))

    const ai = useAiChat()
    // 工具执行抛异常（副作用可能已发生，绝不能被改写成「本地甄选」结果）
    cmdMock.mockImplementation(async (cmd: string) => {
      if (cmd === '/health') throw new Error('tool side effect exploded')
      return { handled: false, reply: '' }
    })

    ai.aiQuery.value = '帮我体检一下'
    await ai.handleAiSubmit()

    // 不落本地兜底：searchWebsitesByIntent 不得被调用
    expect(searchMock).not.toHaveBeenCalled()
    // 工具结果如实标注执行出错
    const assistantTurn = ai.chatTurns.value.find((t) => t.role === 'assistant')
    expect(assistantTurn?.toolResults?.[0]?.resultText).toMatch(/执行出错|failed/i)
    // 最终回复是基于真实工具结果的续轮结论，而非本地甄选文案
    expect(assistantTurn?.content).toBe('体检工具执行出错，未能确认完成。')
  })

  it('工具参数解析失败不执行副作用，如实回错误结果给模型', async () => {
    const cmdMock = vi.mocked(dispatchSiteCommand)
    cmdMock.mockReset()
    cmdMock.mockImplementation(async () => ({ handled: false, reply: '' }))
    streamMock
      .mockResolvedValueOnce(
        aiRes('调用工具', [{ id: 'c1', name: 'audit_vault', arguments: {}, argsParseFailed: true }]),
      )
      .mockResolvedValueOnce(aiRes('参数损坏未能执行'))

    const ai = useAiChat()
    ai.aiQuery.value = '帮我体检'
    await ai.handleAiSubmit()

    // 参数解析失败的调用不得执行任何副作用
    expect(cmdMock.mock.calls.some(([cmd]) => cmd === '/health')).toBe(false)
    // 如实回错误结果（role:'tool'），不静默置 {} 照常执行
    const assistantTurn = ai.chatTurns.value.find((t) => t.role === 'assistant')
    expect(assistantTurn?.toolResults?.[0]?.resultText).toMatch(/参数解析失败|could not be parsed/i)
  })

  it('工具必填参数缺失不静默兜底默认值，如实回「未执行」', async () => {
    const cmdMock = vi.mocked(dispatchSiteCommand)
    cmdMock.mockReset()
    cmdMock.mockImplementation(async () => ({ handled: false, reply: '' }))
    streamMock
      .mockResolvedValueOnce(aiRes('切换主题', [{ id: 'c1', name: 'toggle_theme', arguments: {} }]))
      .mockResolvedValueOnce(aiRes('缺少参数未能执行'))

    const ai = useAiChat()
    ai.aiQuery.value = '切换主题'
    await ai.handleAiSubmit()

    // 缺 mode（schema 标注 required）不得静默按 auto 执行
    expect(cmdMock.mock.calls.some(([cmd]) => cmd.startsWith('/theme'))).toBe(false)
    const assistantTurn = ai.chatTurns.value.find((t) => t.role === 'assistant')
    expect(assistantTurn?.toolResults?.[0]?.resultText).toMatch(/参数无效或缺失|invalid or missing/i)
    expect(assistantTurn?.toolResults?.[0]?.resultText).not.toMatch(/已切换|switched to/i)
  })

  it('命令未命中（非法枚举值）不伪报成功，如实回「未执行」', async () => {
    const cmdMock = vi.mocked(dispatchSiteCommand)
    cmdMock.mockReset()
    // 非法枚举：/theme banana 意图不匹配，dispatch 返回 handled:false
    cmdMock.mockImplementation(async () => ({ handled: false, reply: '' }))
    streamMock
      .mockResolvedValueOnce(aiRes('切换主题', [{ id: 'c1', name: 'toggle_theme', arguments: { mode: 'banana' } }]))
      .mockResolvedValueOnce(aiRes('参数不合法未能执行'))

    const ai = useAiChat()
    ai.aiQuery.value = '切换主题'
    await ai.handleAiSubmit()

    const assistantTurn = ai.chatTurns.value.find((t) => t.role === 'assistant')
    // 不得伪报「主题已切换为 banana」
    expect(assistantTurn?.toolResults?.[0]?.resultText).not.toMatch(/已切换|switched to/i)
    expect(assistantTurn?.toolResults?.[0]?.resultText).toMatch(/未执行|not executed/i)
  })

  it('生成中带附件按 Enter：附件槽位不丢、不新增对话轮（守卫前置）', async () => {
    const cmdMock = vi.mocked(dispatchSiteCommand)
    cmdMock.mockReset()
    cmdMock.mockImplementation(async () => ({ handled: false, reply: '' }))

    // 挂起第一次 askMiMoStream，模拟生成中
    let resolveFirst!: (v: Awaited<ReturnType<typeof askMiMoStream>>) => void
    streamMock.mockReturnValueOnce(
      new Promise<Awaited<ReturnType<typeof askMiMoStream>>>((r) => { resolveFirst = r }),
    )

    const ai = useAiChat()
    ai.aiQuery.value = '先看看这个'
    const p1 = ai.handleAiSubmit()
    // 等首问走到挂起的 askMiMoStream
    await new Promise((r) => setTimeout(r, 0))
    expect(streamMock).toHaveBeenCalledTimes(1)

    // 生成中拖入附件并按 Enter
    mockState.aiAttachedCards.push({ type: 'bm', id: 'bm1' })
    ai.aiQuery.value = '再分析一下这张卡'
    await ai.handleAiSubmit()

    // 守卫前置：附件槽位保持不动，且不新增 user 轮
    expect(mockState.clearAiAttachedCards).not.toHaveBeenCalled()
    expect(mockState.aiAttachedCards.length).toBe(1)
    expect(ai.chatTurns.value.filter((t) => t.role === 'user').length).toBe(1)

    resolveFirst(aiRes('完成'))
    await p1
  })

  it('首轮 MiMo API 异常如实报错，绝不调用 searchWebsitesByIntent 伪装成保底搜索且不推荐存笔记', async () => {
    const searchMock = vi.mocked(searchWebsitesByIntent)
    searchMock.mockClear()
    streamMock.mockReset()
    streamMock.mockRejectedValueOnce(new Error('Rate limit exceeded'))

    const ai = useAiChat()
    ai.aiQuery.value = '帮我找几个好用的工具'
    await ai.handleAiSubmit()

    const assistantTurn = ai.chatTurns.value.find((t) => t.role === 'assistant')
    expect(searchMock).not.toHaveBeenCalled()
    expect(assistantTurn?.candidates).toEqual([])
    expect(assistantTurn?.content).toMatch(/搜索失败|Rate limit/i)
    expect(assistantTurn?.suggestedReplies).toBeUndefined()
  })

  it('用户输入新提问时，历史轮次残留的 suggestedReplies 被自动清空', async () => {
    streamMock.mockReset()
    streamMock
      .mockResolvedValueOnce(aiRes('第一轮回答'))
      .mockResolvedValueOnce(aiRes('第二轮回答'))

    const ai = useAiChat()
    ai.aiQuery.value = '第一个问题'
    await ai.handleAiSubmit()

    const turns = ai.chatTurns.value
    expect(turns.length).toBe(2)
    const turn1 = turns[1]
    expect(turn1.role).toBe('assistant')
    expect(turn1.suggestedReplies?.length).toBeGreaterThan(0)

    // 用户自己输入新问题并提交
    ai.aiQuery.value = '第二个问题'
    await ai.handleAiSubmit()

    // 历史第一轮助手的 suggestedReplies 已被清空
    expect(turn1.suggestedReplies).toEqual([])
  })
})
