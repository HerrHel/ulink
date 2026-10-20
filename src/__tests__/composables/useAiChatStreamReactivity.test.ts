/**
 * useAiChatStreamReactivity — 流式写入响应性回归锁
 * 背景：assistantTurn 曾以原始对象 push 进 reactive 数组后由闭包直接写属性，
 * 绕过 proxy 不触发依赖更新。同组件时代靠「其他 reactive 变化搭车重渲染」掩盖；
 * DetailPanel 拆出 ChatStream 子组件后（props 引用不变则子不更新），流式内容永不渲染
 * （e2e ai-chat 4 用例全挂）。修复为 reactive 代理创建后，本测试锁定：
 * 流式回调写入必须能触发 chatTurns 依赖更新，禁止退回 raw 写入。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { watch, nextTick } from 'vue'

const mockState = vi.hoisted(() => {
  const state = {
    aiAttachedCards: [] as Array<{ type: 'bm' | 'group'; id: string }>,
    clearAiAttachedCards: vi.fn(() => {
      state.aiAttachedCards.length = 0
    }),
    curCat: 'all',
    focusedGroupId: null,
    batchMode: false,
    batchSelected: [] as string[],
    bookmarks: [] as unknown[],
    siblingGroups: [] as unknown[],
    categories: [] as unknown[],
    customAttributes: [] as unknown[],
    groupMap: {} as Record<string, unknown>,
    bookmarkMap: {} as Record<string, unknown>,
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
  dispatchSiteCommand: vi.fn(async () => ({ handled: false, reply: '' })),
  mergeDuplicateBookmarks: vi.fn(),
  applyInboxZeroClustering: vi.fn(),
  createTopicWorkspace: vi.fn(),
  healDeadlink: vi.fn(),
}))

import { useAiChat } from '../../composables/domain/useAiChat.js'
import { askMiMoStream } from '../../lib/ai/mimoClient.js'

const streamMock = vi.mocked(askMiMoStream)

describe('useAiChat — 流式写入响应性（子组件拆分渲染回归锁）', () => {
  beforeEach(() => {
    streamMock.mockReset()
    mockState.aiAttachedCards.length = 0
  })

  it('流式回调对 assistant 轮的写入触发 chatTurns 依赖更新（raw 写入绕过 proxy 时 watch 零触发）', async () => {
    streamMock.mockImplementation(async (_messages, _config, cb) => {
      // 模拟 SSE 流：逐段回调 onContentDelta（accumulated 形态）
      cb?.onContentDelta?.('推荐', '推荐')
      cb?.onContentDelta?.('两个', '推荐两个')
      return {
        reply: '推荐两个',
        reasoning: '',
        cleanText: '推荐两个',
        candidates: [],
        rawText: '推荐两个',
        model: 'test-model',
        toolCalls: undefined,
      }
    })

    const ai = useAiChat()
    const observed: string[] = []
    const stop = watch(
      () => String(ai.chatTurns.value.find((t) => t.role === 'assistant')?.content ?? ''),
      (v) => observed.push(v),
    )

    ai.aiQuery.value = '帮我推荐画图的网站'
    await ai.handleAiSubmit()
    await nextTick()
    stop()

    // 数据正确落地
    const assistant = ai.chatTurns.value.find((t) => t.role === 'assistant')
    expect(assistant?.content).toBe('推荐两个')
    expect(assistant?.loading).toBe(false)
    // 响应性正确：流式写入触发了依赖回调（修复前闭包 raw 写入 → 此断言 0 命中而失败）
    expect(observed.length).toBeGreaterThan(0)
    expect(observed).toContain('推荐两个')
  })
})
