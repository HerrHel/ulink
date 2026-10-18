import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractDeepLinksFromText, extractBookmarksFromVideo } from '../../lib/ai/cloudAiClient.js'
import { fetchPageContentViaJina } from '../../lib/ai/jinaReader.js'
import { fetchVideoExtractServer, generateVideoSummary } from '../../lib/ai/videoExtract.js'
import type { Category, CustomAttribute } from '../../types.js'

vi.mock('../../lib/ai/jinaReader.js', () => ({
  fetchPageContentViaJina: vi.fn(),
}))

vi.mock('../../lib/ai/videoExtract.js', () => ({
  fetchVideoExtractServer: vi.fn(async () => null),
  generateVideoSummary: vi.fn(async () => null),
}))

const mockFetch = vi.mocked(fetchPageContentViaJina)
const mockServerExtract = vi.mocked(fetchVideoExtractServer)
const mockSummary = vi.mocked(generateVideoSummary)

const testCategories: Category[] = [
  { id: 'cat-design', name: '设计灵感', order: 1, icon: 'folder', color: '#ff5500' },
]
const testAttributes: CustomAttribute[] = [{ id: 'attr-free', name: '免费', type: 'boolean' }]

describe('视频深度提取 — 简介/字幕/评论区链接抓取', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks 只清调用记录不还原实现，这里显式恢复默认降级行为，防跨用例状态泄漏
    mockServerExtract.mockResolvedValue(null)
    mockSummary.mockResolvedValue(null)
  })

  // ── 纯函数：extractDeepLinksFromText ──

  it('分区标注：简介/字幕/评论区的链接分别标注来源', () => {
    const text = [
      '## 简介',
      '工具一：https://js.design 即时设计',
      '## 字幕',
      '你们可以直接上 v0.dev 生成页面',
      '## 评论区',
      '网友补充：https://www.alipan.com 找资源',
    ].join('\n')
    const hits = extractDeepLinksFromText(text, { defaultSource: '正文' })
    const byUrl = new Map(hits.map(h => [h.url, h.source]))
    expect(byUrl.get('https://js.design')).toBe('简介')
    expect(byUrl.get('https://v0.dev')).toBe('字幕')
    expect(byUrl.get('https://www.alipan.com')).toBe('评论区')
  })

  it('Markdown 锚链接保留锚文本，可直接当候选标题', () => {
    const hits = extractDeepLinksFromText(
      '[CloudConvert 在线转换](https://cloudconvert.com) 好用',
      { defaultSource: '正文' }
    )
    expect(hits[0]).toMatchObject({
      url: 'https://cloudconvert.com',
      anchor: 'CloudConvert 在线转换',
    })
  })

  it('噪声过滤：图片/压缩包等资源链接不是可收藏网站', () => {
    const text = '封面 https://i0.example.com/cover.jpg 下载 https://dl.example.com/tool.zip 站点 https://keep.example.com'
    const hits = extractDeepLinksFromText(text, { defaultSource: '正文' })
    expect(hits.map(h => h.url)).toEqual(['https://keep.example.com'])
  })

  it('站内自链过滤：抓取正文里同站/子域导航链接剔除（用户输入不受影响）', () => {
    const body = 'UP 主 https://space.bilibili.com/123 相关视频 https://www.bilibili.com/video/BV2xx 外部 https://excalidraw.com'
    const hits = extractDeepLinksFromText(body, {
      defaultSource: '正文',
      targetHost: 'bilibili.com',
      dropSameSite: true,
    })
    expect(hits.map(h => h.url)).toEqual(['https://excalidraw.com'])

    const inputHits = extractDeepLinksFromText(body, {
      defaultSource: '输入文本',
      targetHost: 'bilibili.com',
      dropSameSite: false,
    })
    expect(inputHits.map(h => h.url)).toContain('https://space.bilibili.com/123')
  })

  // ── 集成：extractBookmarksFromVideo（mock Jina 抓取正文）──

  it('深度提取：简介/字幕/评论区链接全部提取，来源标注进 highlight，噪声被过滤', async () => {
    mockFetch.mockResolvedValue({
      success: true,
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      title: '5 个设计神器分享',
      description: '本期介绍 5 个超好用的设计工具',
      markdown: [
        'Title: 5 个设计神器分享',
        '',
        '## 简介',
        '第一个工具是 [即时设计](https://js.design) 国产协作 UI 设计',
        '封面图 ![cover](https://i0.hdslb.com/bfs/archive/cover.jpg)',
        'UP 主主页 https://space.bilibili.com/12345',
        '',
        '## 字幕',
        '你们可以直接上 v0.dev 生成页面',
        '',
        '## 评论区',
        '网友补充 [CloudConvert 在线转换](https://cloudconvert.com) 还有 https://www.alipan.com 找资源',
      ].join('\n'),
    })

    const res = await extractBookmarksFromVideo(
      'https://www.bilibili.com/video/BV1xx411c7mD',
      testCategories,
      testAttributes
    )

    const urls = res.bookmarks.map(b => b.url)
    expect(urls).toContain('https://js.design')
    expect(urls).toContain('https://v0.dev')
    expect(urls).toContain('https://cloudconvert.com')
    expect(urls).toContain('https://www.alipan.com')
    // 噪声：封面图（资源链接）、UP 主主页（站内自链）不得混入
    expect(urls.some(u => u.includes('hdslb.com'))).toBe(false)
    expect(urls.some(u => u.includes('space.bilibili.com'))).toBe(false)
    // 目标页自身不重复出现在提取结果里
    expect(urls).not.toContain('https://www.bilibili.com/video/BV1xx411c7mD')

    // 来源分区标注
    const cloud = res.bookmarks.find(b => b.url === 'https://cloudconvert.com')!
    expect(cloud.highlight).toContain('提取自评论区')
    const v0 = res.bookmarks.find(b => b.url === 'https://v0.dev')!
    expect(v0.highlight).toContain('提取自字幕')

    // 非精选站点优先用锚文本（博主原话）当标题
    expect(cloud.title).toBe('CloudConvert 在线转换')
    expect(res.videoTitle).toBe('5 个设计神器分享')
  })

  it('抓取失败降级：仍从用户输入文本提取链接，不伪造结果', async () => {
    mockFetch.mockResolvedValue({
      success: false,
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      error: '页面读取超时或已被用户取消',
    })

    const res = await extractBookmarksFromVideo(
      'https://www.bilibili.com/video/BV1xx411c7mD 推荐 v0.dev 和摹客',
      testCategories,
      testAttributes
    )

    const urls = res.bookmarks.map(b => b.url)
    expect(urls).toContain('https://v0.dev')
    expect(urls).toContain('https://www.mockplus.cn') // 中文工具名「摹客」
    expect(res.bookmarks.length).toBeGreaterThanOrEqual(2)
  })

  it('深度抓取放宽读取长度以覆盖评论区（maxChars 超出旧 8000 上限）', async () => {
    mockFetch.mockResolvedValue({ success: false, url: '', error: 'x' })
    await extractBookmarksFromVideo('https://www.bilibili.com/video/BV1xx411c7mD', testCategories, testAttributes)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.bilibili.com/video/BV1xx411c7mD',
      expect.objectContaining({ maxChars: expect.any(Number) })
    )
    expect(mockFetch.mock.calls[0][1]!.maxChars!).toBeGreaterThan(8000)
  })

  // ── 服务端 extract-video 优先链路 ──

  it('服务端适配器优先：B站简介/字幕/评论区结构化内容按段标注来源，成功时不再走本地 Jina', async () => {
    mockServerExtract.mockResolvedValue({
      source: 'bilibili',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      title: '5 个设计神器分享',
      description: '第一个工具是 https://js.design 即时设计',
      subtitles: '你们可以直接上 v0.dev 生成页面',
      comments: ['网友补充 https://www.alipan.com 找资源'],
      degraded: false,
    })

    const res = await extractBookmarksFromVideo(
      'https://www.bilibili.com/video/BV1xx411c7mD',
      testCategories,
      testAttributes
    )

    // 服务端成功 → 本地 Jina 直连不再触发
    expect(mockFetch).not.toHaveBeenCalled()

    const byUrl = new Map(res.bookmarks.map(b => [b.url, b]))
    expect(byUrl.get('https://js.design')?.highlight).toContain('提取自简介')
    expect(byUrl.get('https://v0.dev')?.highlight).toContain('提取自字幕')
    expect(byUrl.get('https://www.alipan.com')?.highlight).toContain('提取自评论区')
    expect(res.videoTitle).toBe('5 个设计神器分享')
  })

  it('服务端链路异常降级：fetchVideoExtractServer 抛错不崩溃，回退本地 Jina 抓取', async () => {
    mockServerExtract.mockRejectedValue(new Error('network down'))
    mockFetch.mockResolvedValue({
      success: true,
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      title: '工具分享',
      markdown: '推荐 https://excalidraw.com 白板',
    })

    const res = await extractBookmarksFromVideo(
      'https://www.bilibili.com/video/BV1xx411c7mD',
      testCategories,
      testAttributes
    )

    expect(mockFetch).toHaveBeenCalled()
    expect(res.bookmarks.map(b => b.url)).toContain('https://excalidraw.com')
  })

  it('文字源总结：有抓取内容时生成 summary，失败/无内容时缺省不伪造', async () => {
    mockSummary.mockResolvedValue('本期推荐即时设计、v0.dev 等 5 款设计工具。')
    mockFetch.mockResolvedValue({
      success: true,
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      title: '工具分享',
      markdown: '推荐 https://excalidraw.com 白板工具，还有很多好用的站点值得一试。',
    })
    const withSummary = await extractBookmarksFromVideo(
      'https://www.bilibili.com/video/BV1xx411c7mD',
      testCategories,
      testAttributes
    )
    expect(withSummary.summary).toBe('本期推荐即时设计、v0.dev 等 5 款设计工具。')

    mockSummary.mockResolvedValue(null)
    const withoutSummary = await extractBookmarksFromVideo(
      'https://www.bilibili.com/video/BV1xx411c7mD',
      testCategories,
      testAttributes
    )
    expect(withoutSummary.summary).toBeUndefined()
  })
})
