import { describe, it, expect } from 'vitest'
import {
  validateInputUrl,
  isUrlDnsSafe,
  type DnsResolver,
  detectPlatform,
  isShortLinkHost,
  parseBilibiliVideoId,
  parseYouTubeVideoId,
  parseBilibiliView,
  parseBilibiliComments,
  parseBilibiliSubtitleDoc,
  parseBilibiliAiConclusion,
  parseYouTubeVideo,
  parseYouTubeComments,
} from '../../../supabase/functions/extract-video/video-adapters.js'

describe('extract-video 平台适配器纯逻辑', () => {
  // ── 输入 URL 校验（轻量 SSRF 防护）──

  it('validateInputUrl：放行正常 http/https 视频链接', () => {
    expect(validateInputUrl('https://www.bilibili.com/video/BV1xx411c7mD').hostname).toContain('bilibili.com')
    expect(validateInputUrl('http://example.com/watch').protocol).toBe('http:')
  })

  it('validateInputUrl：拒绝非 http(s)、认证信息与非常用端口', () => {
    expect(() => validateInputUrl('ftp://example.com/x')).toThrow()
    expect(() => validateInputUrl('javascript:alert(1)')).toThrow()
    expect(() => validateInputUrl('https://user:pass@example.com/x')).toThrow()
    expect(() => validateInputUrl('https://example.com:8080/x')).toThrow()
  })

  it('validateInputUrl：拒绝内网字面地址（防滥用第三方抓取探测内网）', () => {
    expect(() => validateInputUrl('http://localhost/x')).toThrow(/内网/)
    expect(() => validateInputUrl('http://127.0.0.1/x')).toThrow(/内网/)
    expect(() => validateInputUrl('http://10.0.0.5/x')).toThrow(/内网/)
    expect(() => validateInputUrl('http://192.168.1.1/x')).toThrow(/内网/)
    expect(() => validateInputUrl('http://169.254.169.254/latest/meta-data')).toThrow(/内网/)
    expect(() => validateInputUrl('http://[::1]/x')).toThrow(/内网/)
  })

  // ── DNS 重绑定校验（fail-closed）──

  it('isUrlDnsSafe：域名解析到公网 IP 判安全', async () => {
    const resolver: DnsResolver = {
      resolve: async (_h, type) => (type === 'A' ? ['93.184.216.34'] : ['2606:2800:220:1:248:1893:25c8:1946']),
    }
    expect(await isUrlDnsSafe(new URL('https://example.com/watch'), resolver)).toBe(true)
  })

  it('isUrlDnsSafe：解析到内网 IP（10./127./169.254 等）判不安全', async () => {
    for (const ip of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '192.168.1.1']) {
      const resolver: DnsResolver = { resolve: async () => [ip] }
      expect(await isUrlDnsSafe(new URL('https://evil.example.com/x'), resolver)).toBe(false)
    }
  })

  it('isUrlDnsSafe：resolver 抛错/无记录一律判不安全（fail-closed）', async () => {
    const throwing: DnsResolver = {
      resolve: async () => { throw new Error('dns failure') },
    }
    expect(await isUrlDnsSafe(new URL('https://nx.example.com/x'), throwing)).toBe(false)
    const empty: DnsResolver = { resolve: async () => [] }
    expect(await isUrlDnsSafe(new URL('https://no-record.example.com/x'), empty)).toBe(false)
  })

  it('isUrlDnsSafe：公网 IP 字面量直接放行且不触发 DNS 解析', async () => {
    let calls = 0
    const resolver: DnsResolver = {
      resolve: async () => { calls++; return ['127.0.0.1'] },
    }
    expect(await isUrlDnsSafe(new URL('http://93.184.216.34/x'), resolver)).toBe(true)
    expect(calls).toBe(0)
  })

  it('isUrlDnsSafe：内网 IP 字面量与 [::1] 一律判不安全', async () => {
    const resolver: DnsResolver = { resolve: async () => ['93.184.216.34'] }
    expect(await isUrlDnsSafe(new URL('http://127.0.0.1/x'), resolver)).toBe(false)
    expect(await isUrlDnsSafe(new URL('http://[::1]/x'), resolver)).toBe(false)
    expect(await isUrlDnsSafe(new URL('http://169.254.169.254/latest/meta-data'), resolver)).toBe(false)
  })

  // ── 平台识别 ──

  it('parseBilibiliVideoId：BV/av 号解析，非视频路径返回 null', () => {
    expect(parseBilibiliVideoId(new URL('https://www.bilibili.com/video/BV1xx411c7mD'))).toEqual({ bvid: 'BV1xx411c7mD' })
    expect(parseBilibiliVideoId(new URL('https://bilibili.com/video/av170001'))).toEqual({ aid: '170001' })
    expect(parseBilibiliVideoId(new URL('https://space.bilibili.com/12345'))).toBeNull()
    // b23.tv 短链本函数不解析（由 index.ts resolveShortLink 先做重定向解析）
    expect(parseBilibiliVideoId(new URL('https://b23.tv/abcdef'))).toBeNull()
  })

  it('isShortLinkHost：已知分享短链域识别（驱动服务端重定向解析）', () => {
    expect(isShortLinkHost('b23.tv')).toBe(true)
    expect(isShortLinkHost('www.b23.tv')).toBe(true)
    expect(isShortLinkHost('xhslink.com')).toBe(true)
    expect(isShortLinkHost('v.douyin.com')).toBe(true)
    expect(isShortLinkHost('vm.tiktok.com')).toBe(true)
    expect(isShortLinkHost('bilibili.com')).toBe(false)
    expect(isShortLinkHost('evil-b23.tv.example.com')).toBe(false)
    expect(isShortLinkHost('example.com')).toBe(false)
  })

  it('parseYouTubeVideoId：watch/youtu.be/shorts/embed 各形态解析', () => {
    expect(parseYouTubeVideoId(new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId(new URL('https://youtu.be/dQw4w9WgXcQ'))).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId(new URL('https://www.youtube.com/shorts/dQw4w9WgXcQ'))).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId(new URL('https://www.youtube.com/embed/dQw4w9WgXcQ'))).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId(new URL('https://example.com/watch?v=dQw4w9WgXcQ'))).toBeNull()
  })

  it('detectPlatform：B站/YouTube/其他平台分流', () => {
    expect(detectPlatform(new URL('https://www.bilibili.com/video/BV1xx411c7mD'))).toBe('bilibili')
    expect(detectPlatform(new URL('https://youtu.be/dQw4w9WgXcQ'))).toBe('youtube')
    expect(detectPlatform(new URL('https://b23.tv/abcdef'))).toBe('generic')
    expect(detectPlatform(new URL('https://www.xiaohongshu.com/explore/abc'))).toBe('generic')
  })

  // ── B站响应解析 ──

  it('parseBilibiliView：标题/简介/aid/cid/字幕 URL（协议相对 URL 补 https）', () => {
    const json = {
      code: 0,
      data: {
        title: '5 个设计神器分享',
        desc: '本期介绍 5 个超好用的设计工具',
        aid: 170001,
        cid: 28991122,
        subtitle: {
          subtitles: [
            { subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/xxx.json' },
            { subtitle_url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/yyy.json' },
          ],
        },
      },
    }
    expect(parseBilibiliView(json)).toEqual({
      title: '5 个设计神器分享',
      desc: '本期介绍 5 个超好用的设计工具',
      aid: 170001,
      cid: 28991122,
      subtitleUrls: [
        'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/xxx.json',
        'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/yyy.json',
      ],
    })
    expect(parseBilibiliView({ code: -404, data: null })).toBeNull()
    expect(parseBilibiliView(null)).toBeNull()
  })

  it('parseBilibiliAiConclusion：提取官方 ASR 语音核心速览与时间戳分段大纲', () => {
    const json = {
      code: 0,
      data: {
        code: 0,
        model_result: {
          result_type: 1,
          summary: '本视频分享了 3 款超实用的在线设计与图表工具：Excalidraw、即时设计与 v0.dev。',
          outline: [
            {
              title: '工具 1：手绘白板 Excalidraw',
              part_outline: [
                { timestamp: 15, content: '介绍 Excalidraw 的核心功能与在线免登录特性' },
                { timestamp: 78, content: '演示如何导出 SVG 与协作' },
              ],
            },
            {
              title: '工具 2：前端代码生成 v0.dev',
              part_outline: [
                { timestamp: 145, content: '演示通过自然语言提示词生成页面' },
              ],
            },
          ],
        },
      },
    }

    const text = parseBilibiliAiConclusion(json)
    expect(text).toContain('【视频语音核心速览】')
    expect(text).toContain('Excalidraw、即时设计与 v0.dev')
    expect(text).toContain('【内容分段大纲】')
    expect(text).toContain('### 工具 1：手绘白板 Excalidraw')
    expect(text).toContain('- [00:15] 介绍 Excalidraw 的核心功能与在线免登录特性')
    expect(text).toContain('- [01:18] 演示如何导出 SVG 与协作')
    expect(text).toContain('- [02:25] 演示通过自然语言提示词生成页面')

    // 异常/空数据防崩兜底
    expect(parseBilibiliAiConclusion(null)).toBe('')
    expect(parseBilibiliAiConclusion({})).toBe('')
    expect(parseBilibiliAiConclusion({ data: {} })).toBe('')
    expect(parseBilibiliAiConclusion({ data: { model_result: {} } })).toBe('')
  })

  it('parseBilibiliComments：提取热评文本，过滤空串', () => {
    const json = {
      data: {
        replies: [
          { content: { message: '求第一个工具的链接' } },
          { content: { message: '   ' } },
          { content: { message: '补充：https://www.alipan.com 找资源' } },
        ],
      },
    }
    expect(parseBilibiliComments(json)).toEqual([
      '求第一个工具的链接',
      '补充：https://www.alipan.com 找资源',
    ])
    expect(parseBilibiliComments({ data: { replies: [] } })).toEqual([])
  })

  it('parseBilibiliSubtitleDoc：CC 字幕 JSON 平铺为文本，坏 JSON 返回空串', () => {
    const doc = JSON.stringify({ body: [{ content: '你们可以直接上' }, { content: 'v0.dev 生成页面' }] })
    expect(parseBilibiliSubtitleDoc(doc)).toBe('你们可以直接上\nv0.dev 生成页面')
    expect(parseBilibiliSubtitleDoc('not-json')).toBe('')
  })

  // ── YouTube 响应解析 ──

  it('parseYouTubeVideo：snippet 标题/描述', () => {
    const json = { items: [{ snippet: { title: 'Top 5 Tools', description: 'Links below:\nhttps://excalidraw.com' } }] }
    expect(parseYouTubeVideo(json)).toEqual({
      title: 'Top 5 Tools',
      description: 'Links below:\nhttps://excalidraw.com',
    })
    expect(parseYouTubeVideo({ items: [] })).toBeNull()
  })

  it('parseYouTubeComments：顶层热评文本提取', () => {
    const json = {
      items: [
        { snippet: { topLevelComment: { snippet: { textDisplay: 'What is the second tool?' } } } },
        { snippet: { topLevelComment: { snippet: { textDisplay: '  ' } } } },
      ],
    }
    expect(parseYouTubeComments(json)).toEqual(['What is the second tool?'])
    expect(parseYouTubeComments({})).toEqual([])
  })
})
