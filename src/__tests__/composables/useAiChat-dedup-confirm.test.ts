import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'

const mockState = reactive({
  bookmarks: [] as any[],
  siblingGroups: [] as any[],
  bookmarkMap: {} as Record<string, any>,
  groupMap: {} as Record<string, any>,
  categories: [] as any[],
  customAttributes: [] as any[],
  filteredBookmarks: [] as any[],
  filteredGroups: [] as any[],
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
}))

vi.mock('../../lib/ai/mimoClient.js', () => ({
  askMiMoStream: vi.fn(async () => ({
    reply: '完成',
    reasoning: '',
    cleanText: '完成',
    candidates: [],
    rawText: '完成',
    model: 'test-model',
  })),
  getMiMoConfig: vi.fn(() => ({ enabled: true, model: 'test-model', apiKey: '', baseUrl: '' })),
  sanitizeToolResult: (s: string) => s,
}))

vi.mock('../../lib/ai/siteCommander.js', () => ({
  dispatchSiteCommand: vi.fn(async (cmd: string) =>
    cmd.startsWith('/') ? { handled: true, reply: `工具结果:${cmd}` } : { handled: false, reply: '' },
  ),
  mergeDuplicateBookmarks: vi.fn(),
}))

const mockMergeDuplicateBookmarks = vi.fn(async () => ({
  mergedCount: 3,
  message: '已成功合并 3 个重复副本',
}))

vi.mock('../../lib/ai/siteActions.js', () => ({
  mergeDuplicateBookmarks: vi.fn(async () => mockMergeDuplicateBookmarks()),
}))

import { useAiChat } from '../../composables/domain/useAiChat.js'
import { askMiMoStream } from '../../lib/ai/mimoClient.js'
import { dispatchSiteCommand } from '../../lib/ai/siteCommander.js'

const streamMock = vi.mocked(askMiMoStream)
const cmdMock = vi.mocked(dispatchSiteCommand)

describe('useAiChat — merge_duplicates confirm 参数落地执行分发', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cmdMock.mockImplementation(async (cmd: string) =>
      cmd.startsWith('/') ? { handled: true, reply: `工具结果:${cmd}` } : { handled: false, reply: '' },
    )
  })

  it('merge_duplicates 传 confirm: true 时，调用 mergeDuplicateBookmarks 执行落地合并', async () => {
    const ai = useAiChat()
    streamMock.mockResolvedValueOnce({
      reply: '准备合并',
      reasoning: '',
      cleanText: '准备合并',
      candidates: [],
      rawText: '准备合并',
      model: 'test-model',
      toolCalls: [
        {
          id: 'call_dedup_confirm_1',
          name: 'merge_duplicates',
          arguments: { confirm: true, reason: '用户要求全部一键合并' },
        },
      ] as never,
    })

    ai.aiQuery.value = '方案A全部合并'
    await ai.handleAiSubmit()

    expect(mockMergeDuplicateBookmarks).toHaveBeenCalled()
    const lastTurn = ai.chatTurns.value[ai.chatTurns.value.length - 1]
    expect(lastTurn.toolResults?.[0]?.resultText).toContain('已成功合并 3 个重复副本')
  })

  it('merge_duplicates 不传 confirm 或 confirm: false 时，仅调用 /dedup 查重巡检而不删除', async () => {
    const ai = useAiChat()
    streamMock.mockResolvedValueOnce({
      reply: '扫描全库',
      reasoning: '',
      cleanText: '扫描全库',
      candidates: [],
      rawText: '扫描全库',
      model: 'test-model',
      toolCalls: [
        {
          id: 'call_dedup_scan_1',
          name: 'merge_duplicates',
          arguments: { reason: '扫描重复' },
        },
      ] as never,
    })

    ai.aiQuery.value = '帮我查一下重复书签'
    await ai.handleAiSubmit()

    expect(mockMergeDuplicateBookmarks).not.toHaveBeenCalled()
    expect(cmdMock).toHaveBeenCalledWith('/dedup', expect.anything())
  })
})
