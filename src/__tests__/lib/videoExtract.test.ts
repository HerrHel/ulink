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

import {
  fetchVideoExtractServer,
  generateVideoSummary,
  isVideoPlatformUrl,
  buildVideoContentText,
} from '../../lib/ai/videoExtract.js'
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

  it('429 今日额度用完：返回 quotaExceeded 标记与上限（调用方不得再降级抓取绕过配额）', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'quota', quota: { limit: 10, scope: 'user' } }),
    })
    const res = await fetchVideoExtractServer('https://www.douyin.com/video/7701700795477003571')
    expect(res).toMatchObject({ quotaExceeded: true, quotaLimit: 10 })
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
    // 组装后的完整提示词必须低于转发层单条消息上限（mimo-guard MAX_MESSAGE_CHARS_DEFAULT = 4000），
    // 否则超长视频总结会被 guard 413 整条拒绝、静默失效（防回归：旧上限 6000 会使本断言失败）
    expect(prompt.length).toBeLessThan(4000)
    expect(prompt).not.toContain('x'.repeat(4000))
  })

  it('内容过短不发起请求；LLM 失败返回 null 不抛错', async () => {
    expect(await generateVideoSummary('短')).toBeNull()
    expect(mockAskMiMo).not.toHaveBeenCalled()

    // 内容需越过 40 字最小阈值，确保真正走到 LLM 调用再失败（否则本用例是假绿）
    const longEnough = '这里是一段足够长的视频简介公开文本，包含简介与评论的摘要内容，用于触发总结生成流程。'
    mockAskMiMo.mockRejectedValue(new Error('AI 服务未配置'))
    expect(await generateVideoSummary(longEnough)).toBeNull()
    expect(mockAskMiMo).toHaveBeenCalledTimes(1)
  })

  it('question 模式：用户问题进提示词做「回答提问」，问题同样截断防注入面扩大', async () => {
    mockAskMiMo.mockResolvedValue({
      reply: '', reasoning: '', cleanText: '视频里出现的网站有 js.design 等。', candidates: [], rawText: '', model: 'm',
    })

    const content = '这里是一段足够长的视频简介公开文本，包含简介与评论的摘要内容，用于触发总结生成流程。'
    const res = await generateVideoSummary(content, { question: '总结视频内出现的网站' })

    expect(res).toBe('视频里出现的网站有 js.design 等。')
    const prompt = mockAskMiMo.mock.calls[0][0] as string
    expect(prompt).toContain('用户提问：总结视频内出现的网站')
    expect(prompt).toContain('回答用户提问')

    // 超长问题截断：不整体进提示词
    mockAskMiMo.mockClear()
    mockAskMiMo.mockResolvedValue({
      reply: '', reasoning: '', cleanText: 'ok', candidates: [], rawText: '', model: 'm',
    })
    await generateVideoSummary(content, { question: '问'.repeat(1000) })
    const prompt2 = mockAskMiMo.mock.calls[0][0] as string
    expect(prompt2).not.toContain('问'.repeat(300))
  })
})

describe('videoExtract — 视频平台识别与结构化文本拼装', () => {
  it('isVideoPlatformUrl：识别抖音短链与主流视频平台，普通网页不误判', () => {
    expect(isVideoPlatformUrl('https://v.douyin.com/EMhJLA__J9g/')).toBe(true)
    expect(isVideoPlatformUrl('https://www.douyin.com/video/7701700795477003571')).toBe(true)
    expect(isVideoPlatformUrl('https://b23.tv/fuBzhYU')).toBe(true)
    expect(isVideoPlatformUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(isVideoPlatformUrl('https://xhslink.com/a1b2c3')).toBe(true)
    expect(isVideoPlatformUrl('https://example.com/page')).toBe(false)
    expect(isVideoPlatformUrl('not-a-url')).toBe(false)
  })

  it('buildVideoContentText：拼接标题/简介/字幕/评论，无内容返回空串', () => {
    const text = buildVideoContentText({
      source: 'douyin',
      url: 'https://www.douyin.com/video/1',
      title: '视频标题',
      description: '简介文本',
      subtitles: '字幕文本',
      comments: ['评论一'],
      degraded: false,
    })
    expect(text).toContain('标题：视频标题')
    expect(text).toContain('简介：简介文本')
    expect(text).toContain('字幕：字幕文本')
    expect(text).toContain('评论区：评论一')

    expect(
      buildVideoContentText({
        source: 'generic',
        url: 'https://example.com',
        title: '',
        description: '',
        subtitles: '',
        comments: [],
        degraded: true,
      })
    ).toBe('')
  })
})
