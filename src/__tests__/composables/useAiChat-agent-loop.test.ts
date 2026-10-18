/**
 * useAiChat-agent-loop — 真 Agent 多步工具链回归测试
 * 验收点（多步 agent 循环）：
 * 1. 续轮放开 Tool Calling（此前续轮 enableTools:false 只是「单臂假循环」）；
 * 2. 模型可在续轮继续请求工具，多步工具真实执行；
 * 3. 每轮工具结果以 role:'tool' 回传模型，且多轮工具链累积持久化到会话；
 * 4. 续轮失败不覆盖首轮已执行的真实结果。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../stores/ui.js', () => ({
  useUIStore: () => ({
    aiAttachedCards: [],
    clearAiAttachedCards: vi.fn(),
    curCat: 'all',
    focusedGroupId: null,
    batchMode: false,
    batchSelected: [],
  }),
}))

vi.mock('../../stores/data.js', () => ({
  useDataStore: () => ({
    bookmarks: [],
    siblingGroups: [],
    categories: [],
    customAttributes: [],
    groupMap: {},
    bookmarkMap: {},
  }),
}))

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

const streamMock = vi.mocked(askMiMoStream)

interface FakeToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
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
})
