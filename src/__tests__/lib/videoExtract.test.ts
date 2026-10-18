import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// supabase 客户端桩：登录态可控
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'test-token' } } })),
    },
  },
  isSupabaseConfigured: true,
}))

// askMiMo 桩（避免真实 LLM 请求），其余（含 sanitizeForPrompt 消毒截断）保留真实现
const mockAskMiMo = vi.fn()
vi.mock('../../lib/ai/mimoClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ai/mimoClient.js')>()
  return {
    ...actual,
    askMiMo: (...args: unknown[]) => mockAskMiMo(...args),
  }
})

import { fetchVideoExtractServer, generateVideoSummary } from '../../lib/ai/videoExtract.js'
import { supabase } from '../../lib/supabase.js'

const fetchMock = vi.fn()

describe('videoExtract — 服务端提取客户端与文字源总结', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    } as never)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── fetchVideoExtractServer ──

  it('未登录：返回 null 且不发请求（由调用方降级本地链路）', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null } } as never)
    const res = await fetchVideoExtractServer('https://www.bilibili.com/video/BV1xx411c7mD')
    expect(res).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('正常链路：POST extract-video 并解析简介/字幕/评论区结构化结果', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        source: 'bilibili',
        url: 'https://www.bilibili.com/video/BV1xx411c7mD',
        title: '工具分享',
        description: '简介文本',
        subtitles: '字幕文本',
        comments: ['评论一', 42, '评论二'],
        degraded: false,
      }),
    })

    const res = await fetchVideoExtractServer('https://www.bilibili.com/video/BV1xx411c7mD')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/extract-video'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://www.bilibili.com/video/BV1xx411c7mD' }),
      })
    )
    expect(res).toMatchObject({
      source: 'bilibili',
      title: '工具分享',
      description: '简介文本',
      subtitles: '字幕文本',
      // 非字符串评论被过滤，不污染链接提取
      comments: ['评论一', '评论二'],
      degraded: false,
    })
  })

  it('服务端非 2xx / 网络异常：返回 null，不伪造结果', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: 'x' }) })
    expect(await fetchVideoExtractServer('https://example.com/v')).toBeNull()

    fetchMock.mockRejectedValue(new Error('network down'))
    expect(await fetchVideoExtractServer('https://example.com/v')).toBeNull()
  })

  // ── generateVideoSummary ──

  it('总结输入注入提示词前消毒截断（防页面内容全量外送），并返回 cleanText', async () => {
    mockAskMiMo.mockResolvedValue({
      reply: '', reasoning: '', cleanText: '本期推荐 5 款设计工具。', candidates: [], rawText: '', model: 'm',
    })

    const longText = 'x'.repeat(20000)
    const res = await generateVideoSummary(longText)

    expect(res).toBe('本期推荐 5 款设计工具。')
    expect(mockAskMiMo).toHaveBeenCalledTimes(1)
    const prompt = mockAskMiMo.mock.calls[0][0] as string
    // 截断上限 6000：全文 20000 字符绝不整体进提示词
    expect(prompt.length).toBeLessThan(7000)
    expect(prompt).not.toContain('x'.repeat(7000))
  })

  it('内容过短不发起请求；LLM 失败返回 null 不抛错', async () => {
    expect(await generateVideoSummary('短')).toBeNull()
    expect(mockAskMiMo).not.toHaveBeenCalled()

    mockAskMiMo.mockRejectedValue(new Error('AI 服务未配置'))
    expect(await generateVideoSummary('这里是一段足够长的视频简介文本，用于触发总结生成流程。')).toBeNull()
  })
})
