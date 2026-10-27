import { describe, it, expect, vi } from 'vitest'
import { cleanWebTitle, cleanWebDescription, fetchUrlMetadataAsync } from '../../lib/ai/smartIntake.js'
import * as jinaReader from '../../lib/ai/jinaReader.js'

describe('smartIntake — 全网通用 AI 智能页面摄入与清洗', () => {
  it('cleanWebTitle：正确剥离常见网站追加的 SEO 品牌尾巴', () => {
    expect(cleanWebTitle('如何系统学习 Vue 3？ - 知乎')).toBe('如何系统学习 Vue 3？')
    expect(cleanWebTitle('AI 时代的个人知识管理系统 | 少数派')).toBe('AI 时代的个人知识管理系统')
    expect(cleanWebTitle('2026 前端构建工具大盘点 - 稀土掘金')).toBe('2026 前端构建工具大盘点')
    expect(cleanWebTitle('Python 异步编程完全指南 - 博客园')).toBe('Python 异步编程完全指南')
    expect(cleanWebTitle('红烧肉的正宗家常做法 - 下厨房')).toBe('红烧肉的正宗家常做法')
    expect(cleanWebTitle('纯净标题无后缀')).toBe('纯净标题无后缀')
  })

  it('cleanWebTitle & cleanWebDescription：严格剔除一切 Emoji 表情符号', () => {
    expect(cleanWebTitle('🔥 2026 前端构建工具大盘点 - 稀土掘金 ✨')).toBe('2026 前端构建工具大盘点')
    expect(cleanWebTitle('🚀 高效工作，品质生活 - 少数派')).toBe('高效工作，品质生活')
    expect(cleanWebDescription('🚀 超快构建 ⚡ 极速体验 ✨')).toBe('超快构建 极速体验')
  })

  it('cleanWebDescription：压缩多余换行与空白，并在超长时适度截断', () => {
    const raw = '这是一段    包含很多\n\n\n连续空行和    空格的   描述文本。'
    const cleaned = cleanWebDescription(raw, 50)
    expect(cleaned).toBe('这是一段 包含很多 连续空行和 空格的 描述文本。')

    const longText = 'a'.repeat(300)
    const truncated = cleanWebDescription(longText, 50)
    expect(truncated.length).toBe(50)
    expect(truncated.endsWith('...')).toBe(true)
  })

  it('fetchUrlMetadataAsync：非法 URL 或空值安全返回错误', async () => {
    const res1 = await fetchUrlMetadataAsync('')
    expect(res1.success).toBe(false)
    expect(res1.reason).toBe('invalid_url')

    const res2 = await fetchUrlMetadataAsync('ftp://example.com')
    expect(res2.success).toBe(false)
  })

  it('fetchUrlMetadataAsync：内网/私有地址自动阻断（防 SSRF）', async () => {
    const res = await fetchUrlMetadataAsync('http://192.168.1.1/admin')
    expect(res.success).toBe(false)
    expect(res.reason).toBe('private_url_blocked')
  })

  it('fetchUrlMetadataAsync：正常抓取并清洗网页标题和描述', async () => {
    vi.spyOn(jinaReader, 'fetchPageContentViaJina').mockResolvedValueOnce({
      success: true,
      url: 'https://example.com/article',
      title: '从零开始学投资理财 - 雪球',
      description: '适合小白的投资入门指南，详细分析股票和基金的底层逻辑。',
    })

    const categories = [
      { id: 'cat-finance', name: '金融理财', icon: '', color: '', order: 0 },
    ]

    const res = await fetchUrlMetadataAsync('https://example.com/article', categories)
    expect(res.success).toBe(true)
    expect(res.title).toBe('从零开始学投资理财')
    expect(res.notes).toContain('适合小白的投资入门指南')
    expect(res.categoryId).toBe('cat-finance')
  })

  it('fetchUrlMetadataAsync：优先调取 /api/extract-metadata 端点真实元数据', async () => {
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/extract-metadata') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            title: '百度一下，你就知道',
            description: '全球领先的中文搜索引擎，致力于让网民更便捷地获取信息。',
            url: 'https://baidu.com',
          }),
        } as any
      }
      return originalFetch(url)
    })

    const res = await fetchUrlMetadataAsync('https://baidu.com')
    expect(res.success).toBe(true)
    expect(res.title).toBe('百度一下，你就知道')
    expect(res.notes).toContain('全球领先的中文搜索引擎')

    global.fetch = originalFetch
  })
})
