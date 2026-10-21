import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  searchWebsitesByIntent,
  findSimilarWebsites,
  extractBookmarksFromVideo,
  enrichBookmarkMetadata,
} from '../lib/ai/cloudAiClient.js'
import { setLocale } from '../i18n/index.js'
import { useUIStore } from '../stores/ui.js'
import type { Bookmark, Category, CustomAttribute } from '../types.js'

// 测试不联网：Jina Reader 一律按抓取失败降级，验证纯本地提取路径
vi.mock('../lib/ai/jinaReader.js', () => ({
  fetchPageContentViaJina: vi.fn(async () => ({ success: false, url: '', error: 'test 不联网' })),
}))

// 测试不联网：服务端 extract-video 链路与文字源总结一并桩掉，走纯输入文本提取
vi.mock('../lib/ai/videoExtract.js', () => ({
  fetchVideoExtractServer: vi.fn(async () => null),
  generateVideoSummary: vi.fn(async () => null),
}))

describe('AI Pro Matrix & Smart Candidate Ingestion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const testCategories: Category[] = [
    { id: 'cat-design', name: '设计灵感', order: 1, icon: 'folder', color: '#ff5500' },
    { id: 'cat-dev', name: '开发工具', order: 2, icon: 'code', color: '#0088ff' },
    { id: 'cat-ai', name: 'AI工具', order: 3, icon: 'sparkle', color: '#8800ff' },
  ]

  const testAttributes: CustomAttribute[] = [
    { id: 'attr-free', name: '免费', type: 'boolean' },
    { id: 'attr-tool', name: '在线工具', type: 'boolean' },
  ]

  it('1. 意图寻站：能按意图甄选站点，并全自动预先绑定分类与属性标签（零摩擦准备）', async () => {
    const results = await searchWebsitesByIntent(
      '画图 白板',
      ['free'],
      testCategories,
      testAttributes
    )

    expect(results.length).toBeGreaterThan(0)
    const first = results[0]
    expect(first.title).toBeDefined()
    expect(first.url).toContain('http')
    expect(first.notes).toBeDefined()
    // 验证自动配齐逻辑
    expect(first.categoryId).toBeDefined()
  })

  it('2. 查找类似网站：支持挖掘目标网站的同类优秀工具或平替', async () => {
    const results = await findSimilarWebsites(
      'https://chatgpt.com',
      'ChatGPT',
      ['free', 'no_proxy'],
      testCategories,
      testAttributes
    )

    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.title === 'Claude' || r.title === 'DeepSeek')).toBe(true)
    for (const r of results) {
      expect(r.url).toBeDefined()
      expect(r.notes).toBeDefined()
    }
  })

  it('2b. 查找类似网站：无真实平替数据时诚实返回空，不拼猜假 URL', async () => {
    const results = await findSimilarWebsites(
      'https://totally-unknown-site-xyz.example',
      '未知站点',
      [],
      testCategories,
      testAttributes
    )

    expect(results).toEqual([])
  })

  it('3. 视频工具收割：能从视频分享文本中解析多个工具并打包', async () => {
    const videoText = 'https://www.bilibili.com/video/BV1xx411c7mD 推荐 5 个超神神器：即时设计、摹客、v0.dev'
    const result = await extractBookmarksFromVideo(videoText, testCategories, testAttributes)

    expect(result.bookmarks.length).toBeGreaterThanOrEqual(2)
    expect(result.groupTitle).toBeDefined()
    expect(result.groupNotes).toBeDefined()
    expect(result.bookmarks[0].url).toContain('http')
  })

  it('4. 存量旧书签信息主动补齐：仅生成 Diff 对比，绝不修改原始书签数据', async () => {
    const oldBookmark: Bookmark = {
      id: 'bm-old-1',
      title: 'excalidraw.com', // 裸域名
      url: 'https://excalidraw.com',
      icon: '',
      username: '',
      password: '',
      notes: '', // 空备注
      categoryId: 'uncategorized',
      parentId: null,
      order: 1,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }

    const diff = await enrichBookmarkMetadata(oldBookmark, testCategories, testAttributes)

    expect(diff.bookmarkId).toBe('bm-old-1')
    expect(diff.currentTitle).toBe('excalidraw.com')
    // 建议地道中文标题或首字母大写
    expect(diff.suggestedTitle).toBeDefined()
    // 建议丰富备注
    expect(diff.suggestedNotes.length).toBeGreaterThan(0)
    // 原始数据不变
    expect(oldBookmark.title).toBe('excalidraw.com')
    expect(oldBookmark.notes).toBe('')
  })

  it('5. UI Store 补齐弹窗 Actions 正常驱动状态', () => {
    const ui = useUIStore()
    expect(ui.modals.aiEnrich).toBe(false)

    ui.openAiEnrich('bm-old-1')
    expect(ui.modals.aiEnrich).toBe(true)
    expect(ui.aiEnrichTargetBmId).toBe('bm-old-1')
  })

  it('6. 静态知识库文案 i18n：zh/en 下 notes/tag/highlight 均随语言切换且不残留硬编码中文', async () => {
    // zh-CN（测试 setup 默认）：文案与语言包一致
    setLocale('zh-CN')
    const zhResults = await searchWebsitesByIntent('画图 白板', [], testCategories, testAttributes)
    expect(zhResults.length).toBeGreaterThan(0)
    expect(zhResults[0].notes).toContain('白板')
    expect(zhResults[0].tag).toBe('开源免费')

    // en-US：同一条目出英文文案，无中文残留
    setLocale('en-US')
    try {
      const enResults = await searchWebsitesByIntent('画图 白板', [], testCategories, testAttributes)
      expect(enResults.length).toBe(zhResults.length)
      expect(enResults[0].title).toBe(zhResults[0].title)
      expect(enResults[0].notes).toMatch(/whiteboard/i)
      expect(enResults[0].notes).not.toMatch(/[一-鿿]/)
      expect(enResults[0].highlight).not.toMatch(/[一-鿿]/)
      expect(enResults[0].tag).toBe('Open Source & Free')

      // 通用发现入口（无强匹配）也走 i18n，且 {query} 占位符正常插值
      const enGeneric = await searchWebsitesByIntent('xyzzy-no-match', [], testCategories, testAttributes)
      expect(enGeneric.length).toBe(2)
      expect(enGeneric[0].generic).toBe(true)
      expect(enGeneric[0].notes).toContain('xyzzy-no-match')
      expect(enGeneric[0].notes).not.toMatch(/[一-鿿]/)
    } finally {
      setLocale('zh-CN')
    }
  })

  it('7. 补齐建议文案 i18n：en-US 下 fallback notes 与 reason 不含硬编码中文', async () => {
    // 用无 smartPrefill 预置数据的站点，确保走 enrichFallbackNotes 兜底路径
    const oldBookmark: Bookmark = {
      id: 'bm-i18n-1',
      title: 'unknown-tool.example',
      url: 'https://unknown-tool.example',
      icon: '',
      username: '',
      password: '',
      notes: '',
      categoryId: 'uncategorized',
      parentId: null,
      order: 1,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 100,
      updatedAt: 100,
    }

    setLocale('en-US')
    try {
      const diff = await enrichBookmarkMetadata(oldBookmark, testCategories, testAttributes)
      expect(diff.suggestedNotes.length).toBeGreaterThan(0)
      expect(diff.suggestedNotes).not.toMatch(/[一-鿿]/)
      expect(diff.reason).not.toMatch(/[一-鿿]/)
    } finally {
      setLocale('zh-CN')
    }
  })

  it('8. 类似网站描述 i18n：zh/en 下 notes/highlight 随语言切换且 en 无中文残留', async () => {
    setLocale('zh-CN')
    const zhResults = await findSimilarWebsites('https://chatgpt.com', 'ChatGPT', [], testCategories, testAttributes)
    expect(zhResults.length).toBeGreaterThan(0)
    expect(zhResults[0].notes).toMatch(/[一-鿿]/)

    setLocale('en-US')
    try {
      const enResults = await findSimilarWebsites('https://chatgpt.com', 'ChatGPT', [], testCategories, testAttributes)
      expect(enResults.length).toBe(zhResults.length)
      expect(enResults[0].title).toBe(zhResults[0].title)
      expect(enResults[0].notes).not.toMatch(/[一-鿿]/)
      expect(enResults[0].highlight).not.toMatch(/[一-鿿]/)
      expect(enResults[0].notes.length).toBeGreaterThan(0)
    } finally {
      setLocale('zh-CN')
    }
  })
})
