/**
 * useAiChatSendSummary.test.ts — 发送前透明摘要的接线回归锁。
 * 覆盖：真实提交主流程（mock 网络通道）中，MiMo 分支必须为用户轮挂上 sendSummary，
 * 且计数/字符规模与实际注入一致；历史轮次披露随会话增长。
 * 断言确认 askMiMoStream 被真实调用（目标分支确被执行，防「测试通过但从未走到被测逻辑」假绿）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { selectHistorySlice } from '../../lib/ai/mimoStream.js'

const mockState = vi.hoisted(() => {
  const state = {
    aiAttachedCards: [] as Array<{ type: 'bm' | 'group'; id: string }>,
    clearAiAttachedCards: vi.fn(() => {
      state.aiAttachedCards.length = 0
    }),
    curCat: 'all',
    focusedGroupId: null as string | null,
    batchMode: false,
    batchSelected: [] as string[],
    bookmarks: [] as unknown[],
    siblingGroups: [] as unknown[],
    categories: [{ id: 'c1', name: '开发工具', icon: '', color: '', order: 0 }],
    customAttributes: [{ id: 'a1', name: '开源', type: 'boolean' }],
    groupMap: {} as Record<string, any>,
    bookmarkMap: {} as Record<string, any>,
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
  askMiMoStream: vi.fn(async () => ({
    reply: '回答',
    reasoning: '',
    cleanText: '回答',
    candidates: [],
    rawText: '回答',
    model: 'test-model',
    toolCalls: undefined,
  })),
  getMiMoConfig: vi.fn(() => ({ enabled: true, model: 'test-model', apiKey: '', baseUrl: '' })),
  sanitizeToolResult: (s: string) => s,
}))

vi.mock('../../lib/ai/siteCommander.js', () => ({
  dispatchSiteCommand: vi.fn(async () => ({ handled: false, reply: '' })),
  mergeDuplicateBookmarks: vi.fn(),
  applyInboxZeroClustering: vi.fn(),
  createTopicWorkspace: vi.fn(),
  healDeadlink: vi.fn(),
}))

import { useAiChat } from '../../composables/domain/useAiChat.js'
import { askMiMoStream } from '../../lib/ai/mimoClient.js'
import { K_AI_SESSIONS, K_AI_CUR_SESSION } from '../../lib/ai/chatSessions.js'

const streamMock = vi.mocked(askMiMoStream)

describe('useAiChat — 发送前透明摘要接线', () => {
  beforeEach(() => {
    streamMock.mockClear()
    // 会话持久化跨用例隔离：上一用例存盘的会话不得被下一用例恢复进来
    localStorage.removeItem(K_AI_SESSIONS)
    localStorage.removeItem(K_AI_CUR_SESSION)
    mockState.aiAttachedCards.length = 0
    mockState.focusedGroupId = null
    mockState.batchMode = false
    mockState.batchSelected.length = 0
    mockState.groupMap = {}
    mockState.bookmarkMap = {}
  })

  it('MiMo 提交后用户轮挂载 sendSummary，计数与实际注入一致', async () => {
    const ai = useAiChat()
    ai.aiQuery.value = '帮我推荐工具'
    await ai.handleAiSubmit()

    // 目标分支确被执行（防假绿：mock 未被调用则本断言先失败）
    expect(streamMock).toHaveBeenCalledTimes(1)

    const userTurn = ai.chatTurns.value.find((t) => t.role === 'user')
    expect(userTurn?.sendSummary).toBeTruthy()
    const s = userTurn!.sendSummary!
    expect(s.categoriesCount).toBe(1)
    expect(s.attributesCount).toBe(1)
    expect(s.focusedGroup).toBeUndefined()
    expect(s.selected).toBeUndefined()
    expect(s.attachedCardsCount).toBe(0)
    expect(s.historyTurnsIncluded).toBe(0)
    expect(s.userPromptChars).toBe('帮我推荐工具'.length)
    expect(s.systemPromptChars).toBeGreaterThan(0)
  })

  it('聚焦工作台超量时披露截断情况 shown < total', async () => {
    // 组内 12 个有效书签 → 注入上限 10，摘要须披露 10/12
    const bookmarkIds: string[] = []
    for (let i = 0; i < 12; i++) {
      const id = `bm${i}`
      bookmarkIds.push(id)
      mockState.bookmarkMap[id] = { id, title: `工具${i}`, url: `https://t${i}.com`, deletedAt: 0 }
    }
    mockState.groupMap = { g1: { id: 'g1', name: '效率工具箱', bookmarkIds } }
    mockState.focusedGroupId = 'g1'

    const ai = useAiChat()
    ai.aiQuery.value = '我工作台里有什么'
    await ai.handleAiSubmit()
    expect(streamMock).toHaveBeenCalledTimes(1)

    const userTurn = ai.chatTurns.value.find((t) => t.role === 'user')
    expect(userTurn?.sendSummary?.focusedGroup).toEqual({ name: '效率工具箱', shown: 10, total: 12 })
  })

  it('多轮会话中历史上下文披露随轮次增长，且与 selectHistorySlice 真源一致', async () => {
    const ai = useAiChat()
    ai.aiQuery.value = '第一问'
    await ai.handleAiSubmit()
    ai.aiQuery.value = '第二问'
    await ai.handleAiSubmit()

    expect(streamMock).toHaveBeenCalledTimes(2)
    const userTurns = ai.chatTurns.value.filter((t) => t.role === 'user')
    expect(userTurns).toHaveLength(2)

    // 第二轮：历史来自第一轮的 user+assistant 两条
    const second = userTurns[1].sendSummary
    expect(second?.historyTurnsIncluded).toBe(2)

    // 与真源一致：按 mock 请求实参回放历史再裁剪，条数必须相等（披露的即所发）
    const firstCallHistory = streamMock.mock.calls[1][1].history || []
    expect(second?.historyTurnsIncluded).toBe(selectHistorySlice(firstCallHistory).length)
  })
})
