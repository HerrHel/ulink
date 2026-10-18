import { describe, it, expect } from 'vitest'
import {
  validateInputUrl,
  detectPlatform,
  parseBilibiliVideoId,
  parseYouTubeVideoId,
  parseBilibiliView,
  parseBilibiliComments,
  parseBilibiliSubtitleDoc,
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

  // ── 平台识别 ──

  it('parseBilibiliVideoId：BV/av 号解析，非视频路径返回 null', () => {
    expect(parseBilibiliVideoId(new URL('https://www.bilibili.com/video/BV1xx411c7mD'))).toEqual({ bvid: 'BV1xx411c7mD' })
    expect(parseBilibiliVideoId(new URL('https://bilibili.com/video/av170001'))).toEqual({ aid: '170001' })
    expect(parseBilibiliVideoId(new URL('https://space.bilibili.com/12345'))).toBeNull()
    // b23.tv 短链无法离线解析 → 走 generic 降级
    expect(parseBilibiliVideoId(new URL('https://b23.tv/abcdef'))).toBeNull()
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

  it('parseBilibiliView：标题/简介/aid/字幕 URL（协议相对 URL 补 https）', () => {
    const json = {
      code: 0,
      data: {
        title: '5 个设计神器分享',
        desc: '本期介绍 5 个超好用的设计工具',
        aid: 170001,
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
      subtitleUrls: [
        'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/xxx.json',
        'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/yyy.json',
      ],
    })
    expect(parseBilibiliView({ code: -404, data: null })).toBeNull()
    expect(parseBilibiliView(null)).toBeNull()
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
