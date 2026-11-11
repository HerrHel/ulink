import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'

const mockState = reactive({
  bookmarks: [] as any[],
  siblingGroups: [] as any[],
  bookmarkMap: {} as Record<string, any>,
  groupMap: {} as Record<string, any>,
  categories: [] as any[],
  customAttributes: [] as any[],
  curCat: 'all',
  searchQuery: '',
  aiAttachedCards: [] as Array<{ type: 'bm' | 'group'; id: string }>,
  clearAiAttachedCards: vi.fn(),
  batchMode: false,
  batchSelected: [] as string[],
  focusedGroupId: null as string | null,
  activeView: 'bookmarks',
})

vi.mock('../../stores/data.js', () => ({
  useDataStore: () => mockState,
}))

vi.mock('../../stores/ui.js', () => ({
  useUIStore: () => mockState,
}))

vi.mock('../../stores/app.js', () => ({
  useAppStore: () => ({ save: vi.fn() }),
  saveAppData: vi.fn(),
}))

vi.mock('../../lib/ai/mimoClient.js', () => ({
  askMiMoStream: vi.fn(),
  getMiMoConfig: vi.fn(() => ({ enabled: true, model: 'test-model', apiKey: '', baseUrl: '' })),
  sanitizeToolResult: (s: string) => s,
}))

import { useAiChat } from '../../composables/domain/useAiChat.js'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'

describe('useAiChat — revokeUserMessage 级联截断与回滚测试', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('撤回中间的用户消息时，应截断该轮及后续所有轮次，并将内容回填输入框', () => {
    const onTurnsChanged = vi.fn()
    const onQueryChanged = vi.fn()
    const focusInput = vi.fn()

    const ai = useAiChat({
      onTurnsChanged,
      onQueryChanged,
      focusInput,
    })

    const now = Date.now()
    const turn1User: ChatTurn = { id: 'u1', role: 'user', content: '第一轮提问', timestamp: now }
    const turn1Asst: ChatTurn = { id: 'a1', role: 'assistant', content: '第一轮回复', timestamp: now + 1 }
    const turn2User: ChatTurn = { id: 'u2', role: 'user', content: '第二轮提问', timestamp: now + 2 }
    const turn2Asst: ChatTurn = { id: 'a2', role: 'assistant', content: '第二轮回复', timestamp: now + 3 }
    const turn3User: ChatTurn = { id: 'u3', role: 'user', content: '第三轮提问', timestamp: now + 4 }
    const turn3Asst: ChatTurn = { id: 'a3', role: 'assistant', content: '第三轮回复', timestamp: now + 5 }

    ai.chatTurns.value = [turn1User, turn1Asst, turn2User, turn2Asst, turn3User, turn3Asst]

    // 用户在中间第 2 轮点击撤回
    ai.revokeUserMessage(turn2User)

    // 1. 输入框回填第 2 轮内容
    expect(ai.aiQuery.value).toBe('第二轮提问')
    expect(onQueryChanged).toHaveBeenCalled()

    // 2. 截断后续所有消息（u2, a2, u3, a3 全部被截断，只保留 u1 和 a1）
    expect(ai.chatTurns.value).toHaveLength(2)
    expect(ai.chatTurns.value[0].id).toBe('u1')
    expect(ai.chatTurns.value[1].id).toBe('a1')

    // 3. 触发副作用与聚焦
    expect(onTurnsChanged).toHaveBeenCalled()
    expect(focusInput).toHaveBeenCalled()
  })

  it('撤回首条消息时，整个对话流应被完整截断清空', () => {
    const onTurnsChanged = vi.fn()
    const onQueryChanged = vi.fn()
    const focusInput = vi.fn()

    const ai = useAiChat({
      onTurnsChanged,
      onQueryChanged,
      focusInput,
    })

    const now = Date.now()
    const turn1User: ChatTurn = { id: 'u1', role: 'user', content: '初始提问', timestamp: now }
    const turn1Asst: ChatTurn = { id: 'a1', role: 'assistant', content: '初始回复', timestamp: now + 1 }
    const turn2User: ChatTurn = { id: 'u2', role: 'user', content: '后续追问', timestamp: now + 2 }

    ai.chatTurns.value = [turn1User, turn1Asst, turn2User]

    ai.revokeUserMessage(turn1User)

    expect(ai.aiQuery.value).toBe('初始提问')
    expect(ai.chatTurns.value).toHaveLength(0)
    expect(onTurnsChanged).toHaveBeenCalled()
    expect(focusInput).toHaveBeenCalled()
  })

  it('撤回消息时若有在途请求，应先触发 abortInFlight 中止流式生成', () => {
    const ai = useAiChat()

    const now = Date.now()
    const turnUser: ChatTurn = { id: 'u1', role: 'user', content: '测试在途中提问', timestamp: now }
    const turnAsst: ChatTurn = { id: 'a1', role: 'assistant', content: '', loading: true, timestamp: now + 1 }

    ai.chatTurns.value = [turnUser, turnAsst]
    ai.aiLoading.value = true

    const mockAbort = vi.fn()
    ai.abortSlot.current = { abort: mockAbort } as unknown as AbortController

    ai.revokeUserMessage(turnUser)

    expect(mockAbort).toHaveBeenCalled()
    expect(ai.aiLoading.value).toBe(false)
    expect(ai.chatTurns.value).toHaveLength(0)
    expect(ai.aiQuery.value).toBe('测试在途中提问')
  })
})
