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
import { confirmDestructiveTool, resetDestructiveConfirmations } from '../../composables/domain/useAiChatAgent.js'

const streamMock = vi.mocked(askMiMoStream)
const cmdMock = vi.mocked(dispatchSiteCommand)

describe('useAiChat — merge_duplicates confirm 参数落地执行分发', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDestructiveConfirmations() // #9：确认许可为模块级状态，用例间复位
    cmdMock.mockImplementation(async (cmd: string) =>
      cmd.startsWith('/') ? { handled: true, reply: `工具结果:${cmd}` } : { handled: false, reply: '' },
    )
  })

  it('#9 merge_duplicates confirm:true 未经用户显式确认 → 拒绝执行（不合并），仅生成待确认卡片', async () => {
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

    // #9 注入防护：模型参数里的 confirm:true 不算用户确认，绝不落地合并
    expect(mockMergeDuplicateBookmarks).not.toHaveBeenCalled()
    const lastTurn = ai.chatTurns.value[ai.chatTurns.value.length - 1]
    expect(lastTurn.actionCard?.actionName).toBe('confirm_destructive_tool')
    expect(lastTurn.toolResults?.[0]?.resultText).toContain('未执行')
  })

  it('#9 用户经 confirmDestructiveTool 显式确认后，同一 confirm:true 调用才落地合并', async () => {
    const args = { confirm: true, reason: '用户要求全部一键合并' }
    // UI 点击 actionCard 确认按钮 → 登记一次性许可（模型无法伪造）
    confirmDestructiveTool({ name: 'merge_duplicates', arguments: args })

    const ai = useAiChat()
    streamMock.mockResolvedValueOnce({
      reply: '准备合并',
      reasoning: '',
      cleanText: '准备合并',
      candidates: [],
      rawText: '准备合并',
      model: 'test-model',
      toolCalls: [
        { id: 'call_dedup_confirm_2', name: 'merge_duplicates', arguments: args },
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
