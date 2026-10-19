/**
 * useAiChat-routing-eval — AI 提示词评测集（一）：输入分流与提问透传
 *
 * 表驱动「输入 → 期望要点」断言，锁死历史上踩过的「答非所问」类回归：
 * 1. 分流路由：视频（B站/抖音/小红书/TikTok 含短链）→ extractBookmarksFromVideo；
 *    普通网址（含裸域名）→ findSimilarWebsites；自然语言 → MiMo 大模型；斜杠指令 → 站内调度；
 * 2. 提问透传：用户随链接/卡片提出的实际问题必须原样进入下游（不得被吞进 URL 或丢失）；
 * 3. 提示词组装：附件卡片、多选/聚焦/分类情境切片正确注入，且本轮提问不得双份注入 history。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 稳定共享 mock 状态（vi.hoisted）：与 useAiChat-agent-loop 同构的最小 Store 面
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
  askMiMoStream: vi.fn(async () => ({
    reply: '好的',
    reasoning: '',
    cleanText: '好的',
    candidates: [],
    rawText: '好的',
    model: 'test-model',
    toolCalls: undefined,
  })),
  getMiMoConfig: vi.fn(() => ({ enabled: true, model: 'test-model', apiKey: '', baseUrl: '' })),
  sanitizeToolResult: (s: string) => s,
  sanitizeForPrompt: (s: string, maxLen = 200) => String(s ?? '').slice(0, maxLen),
}))

vi.mock('../../lib/ai/siteCommander.js', () => ({
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
import {
  searchWebsitesByIntent,
  findSimilarWebsites,
  extractBookmarksFromVideo,
} from '../../lib/ai/cloudAiClient.js'

const streamMock = vi.mocked(askMiMoStream)
const cmdMock = vi.mocked(dispatchSiteCommand)
const _searchMock = vi.mocked(searchWebsitesByIntent)
const similarMock = vi.mocked(findSimilarWebsites)
const videoMock = vi.mocked(extractBookmarksFromVideo)

async function submit(input: string) {
  const ai = useAiChat()
  ai.aiQuery.value = input
  await ai.handleAiSubmit()
  return ai
}

describe('AI 提示词评测集（一）— 输入分流路由', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cmdMock.mockImplementation(async (cmd: string) =>
      cmd.startsWith('/') ? { handled: true, reply: `工具结果:${cmd}` } : { handled: false, reply: '' },
    )
    mockState.aiAttachedCards.length = 0
    mockState.curCat = 'all'
    mockState.focusedGroupId = null
    mockState.batchMode = false
    mockState.batchSelected = []
    mockState.categories = []
    mockState.groupMap = {}
  })

  const ROUTE_CASES: Array<{ name: string; input: string; route: 'video' | 'url' | 'nl' | 'cmd' | 'none' }> = [
    // ── 视频分流（含短链）──
    { name: 'B站短链', input: 'https://b23.tv/fuBzhYU', route: 'video' },
    {
      name: 'B站短链紧贴中文提问（真实用户粘贴）',
      input: '【10月最新Claude防封号最安全的！-哔哩哔哩】 https://b23.tv/fuBzhYU总结视频内出现的网站',
      route: 'video',
    },
    { name: 'B站视频页', input: 'https://www.bilibili.com/video/BV1xx411c7mD', route: 'video' },
    { name: '抖音分享链接', input: 'https://v.douyin.com/iRNBho6/ 大家看下这个', route: 'video' },
    { name: 'TikTok 链接', input: 'https://www.tiktok.com/@user/video/7123456789', route: 'video' },
    { name: '小红书分享', input: 'https://www.xiaohongshu.com/explore/64f123', route: 'video' },
    { name: '小红书短链', input: 'https://xhslink.com/abc123', route: 'video' },
    // ── 网址分流（含裸域名）──
    { name: '普通 https 网址', input: 'https://excalidraw.com', route: 'url' },
    { name: 'http 网址', input: 'http://example.org/tool', route: 'url' },
    { name: '裸域名', input: 'v0.dev', route: 'url' },
    { name: '带路径裸域名', input: 'www.foo.cn/page', route: 'url' },
    // ── 自然语言分流 ──
    { name: '自然语言求助', input: '帮我找一些做原型设计的工具', route: 'nl' },
    { name: '自然语言咨询', input: '有哪些好用的笔记软件推荐', route: 'nl' },
    { name: '问句含平台名但无链接（不得误判为视频）', input: 'bilibili上有哪些学编程的视频', route: 'nl' },
    // ── 站内指令与空输入 ──
    { name: '斜杠指令 /help', input: '/help', route: 'cmd' },
    { name: '斜杠指令 /dedup', input: '/dedup', route: 'cmd' },
    { name: '空输入不提交', input: '   ', route: 'none' },
  ]

  it.each(ROUTE_CASES)('分流：$name → $route', async ({ input, route }) => {
    await submit(input)

    if (route === 'video') {
      expect(videoMock).toHaveBeenCalledTimes(1)
      expect(videoMock.mock.calls[0][0]).toBe(input.trim())
      expect(similarMock).not.toHaveBeenCalled()
      expect(streamMock).not.toHaveBeenCalled()
    } else if (route === 'url') {
      expect(similarMock).toHaveBeenCalledTimes(1)
      expect(similarMock.mock.calls[0][0]).toBe(input.trim())
      expect(videoMock).not.toHaveBeenCalled()
      expect(streamMock).not.toHaveBeenCalled()
    } else if (route === 'nl') {
      expect(streamMock).toHaveBeenCalledTimes(1)
      expect(streamMock.mock.calls[0][0]).toBe(input.trim())
      expect(videoMock).not.toHaveBeenCalled()
      expect(similarMock).not.toHaveBeenCalled()
    } else if (route === 'cmd') {
      expect(cmdMock).toHaveBeenCalledWith(input.trim(), expect.anything())
      expect(streamMock).not.toHaveBeenCalled()
      expect(videoMock).not.toHaveBeenCalled()
      expect(similarMock).not.toHaveBeenCalled()
    } else {
      expect(streamMock).not.toHaveBeenCalled()
      expect(videoMock).not.toHaveBeenCalled()
      expect(similarMock).not.toHaveBeenCalled()
      expect(cmdMock).not.toHaveBeenCalled()
    }
  })

  it('视频分流提问透传：用户随链接提出的实际问题原样进入提取（不得吞进 URL 或丢失）', async () => {
    const raw = '【10月最新Claude防封号最安全的！-哔哩哔哩】 https://b23.tv/fuBzhYU总结视频内出现的网站'
    await submit(raw)
    expect(videoMock.mock.calls[0][0]).toBe(raw)
    expect(videoMock.mock.calls[0][0]).toContain('总结视频内出现的网站')
  })
})

describe('AI 提示词评测集（一）— 提问透传与情境注入', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cmdMock.mockImplementation(async () => ({ handled: false, reply: '' }))
    mockState.aiAttachedCards.length = 0
    mockState.curCat = 'all'
    mockState.focusedGroupId = null
    mockState.batchMode = false
    mockState.batchSelected = []
    mockState.categories = []
    mockState.groupMap = {}
  })

  it('拖入卡片 + 提问：卡片数据与「用户具体问题」进入 query，且本轮提问不双份注入 history', async () => {
    mockState.aiAttachedCards.push({ type: 'bm', id: 'bm1' })
    await submit('帮我分析这个书签的价值')

    expect(streamMock).toHaveBeenCalledTimes(1)
    const [query, ctx] = streamMock.mock.calls[0]
    // 用户实际提问透传（防答非所问）
    expect(query).toContain('用户具体问题：帮我分析这个书签的价值')
    // 附件卡片结构化数据注入
    expect(query).toContain('测试书签')
    expect(query).toContain('https://example.com')
    // 本轮 user 内容不重复出现在 history（双份注入回归锁）
    expect((ctx.history || []).some((m) => m.content.includes('帮我分析这个书签的价值'))).toBe(false)
  })

  it('仅拖卡片无文字：自动生成贴合卡片的缺省提问，不得空提交', async () => {
    mockState.aiAttachedCards.push({ type: 'bm', id: 'bm1' })
    await submit('   ')

    expect(streamMock).toHaveBeenCalledTimes(1)
    const [query] = streamMock.mock.calls[0]
    expect(query).toContain('测试书签')
    expect(query).toContain('分析')
  })

  it('多选情境注入：勾选的书签进入 contextSlice.selectedBookmarks', async () => {
    mockState.batchMode = true
    mockState.batchSelected = ['bm1']
    await submit('这些书签有什么共性')

    const [, ctx] = streamMock.mock.calls[0]
    expect(ctx.contextSlice?.selectedBookmarks?.[0]?.title).toBe('测试书签')
  })

  it('聚焦工作台注入：组名与组内书签进入 contextSlice.focusedGroup*', async () => {
    mockState.focusedGroupId = 'g1'
    mockState.groupMap = { g1: { id: 'g1', name: '前端工作台', bookmarkIds: ['bm1'] } }
    await submit('这个组里有什么')

    const [, ctx] = streamMock.mock.calls[0]
    expect(ctx.contextSlice?.focusedGroupName).toBe('前端工作台')
    expect(ctx.contextSlice?.focusedGroupBookmarks?.[0]?.title).toBe('测试书签')
  })

  it('当前分类注入：分类名进入 contextSlice.currentCategoryName（all/uncategorized 不注入）', async () => {
    mockState.curCat = 'c1'
    mockState.categories = [{ id: 'c1', name: '设计', order: 1, icon: 'folder', color: '#f00' }]
    await submit('当前分类下有什么')

    const [, ctx] = streamMock.mock.calls[0]
    expect(ctx.contextSlice?.currentCategoryName).toBe('设计')

    mockState.curCat = 'all'
    streamMock.mockClear()
    await submit('再看看')
    expect(streamMock.mock.calls[0][1].contextSlice?.currentCategoryName).toBeUndefined()
  })
})
