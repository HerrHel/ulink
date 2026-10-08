import { describe, it, expect } from 'vitest'
import { getSmartPrefill } from '../../lib/ai/smartPrefill.js'
import type { Bookmark, Category, CustomAttribute } from '../../types.js'

function makeBm(partial: Partial<Bookmark> & { id: string; title: string; url: string }): Bookmark {
  return {
    notes: '',
    username: '',
    password: '',
    icon: '',
    categoryId: 'uncategorized',
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

describe('smartPrefill — 智能书签预填引擎', () => {
  const dummyCategories: Category[] = [
    { id: 'cat-ai', name: 'AI 工具', icon: 'sparkles', color: '#ff0000', order: 0 },
    { id: 'cat-dev', name: '开发技术', icon: 'code', color: '#00ff00', order: 1 },
    { id: 'cat-design', name: '设计美工', icon: 'palette', color: '#0000ff', order: 2 },
  ]

  const dummyAttributes: CustomAttribute[] = [
    { id: 'attr-ai', name: 'AI', type: 'boolean' },
    { id: 'attr-code', name: '代码', type: 'boolean' },
    { id: 'attr-doc', name: '文档', type: 'boolean' },
  ]

  it('精选热门站点预填：自动匹配高置信度标题、描述、分类与属性标签', () => {
    const res = getSmartPrefill('https://chatgpt.com', [], dummyCategories, dummyAttributes)
    expect(res.title).toBe('ChatGPT')
    expect(res.notes).toContain('OpenAI')
    expect(res.categoryId).toBe('cat-ai')
    expect(res.suggestedAttrIds).toContain('attr-ai')
    expect(res.confidence).toBe('high')
  })

  it('精选设计类工具预填：Excalidraw 匹配', () => {
    const res = getSmartPrefill('https://excalidraw.com')
    expect(res.title).toContain('Excalidraw')
    expect(res.notes).toContain('白板')
    expect(res.confidence).toBe('high')
  })

  it('GitHub 路径语义解析：仓库、PR、Issue', () => {
    const repoRes = getSmartPrefill('https://github.com/vuejs/core')
    expect(repoRes.title).toBe('core (vuejs/core)')
    expect(repoRes.notes).toContain('GitHub 开源项目仓库')
    expect(repoRes.confidence).toBe('high')

    const prRes = getSmartPrefill('https://github.com/vuejs/core/pull/1234')
    expect(prRes.title).toBe('core #1234 · Pull Request')
    expect(prRes.notes).toContain('代码合入请求')

    const issueRes = getSmartPrefill('https://github.com/vuejs/core/issues/567')
    expect(issueRes.title).toBe('core #567 · Issue')
    expect(issueRes.notes).toContain('Issue')
  })

  it('V2EX 与 B站路径语义解析', () => {
    const v2exRes = getSmartPrefill('https://v2ex.com/t/998877')
    expect(v2exRes.title).toBe('V2EX 讨论帖')
    expect(v2exRes.notes).toContain('交流主题帖')

    const biliRes = getSmartPrefill('https://www.bilibili.com/video/BV1xx411c7mD')
    expect(biliRes.title).toBe('Bilibili 视频教程与精选')
    expect(biliRes.notes).toContain('视频')
  })

  it('同源书签继承：继承同域历史书签的常用账号与分类偏好', () => {
    const existingBookmarks: Bookmark[] = [
      makeBm({
        id: 'bm-1',
        title: 'My Vercel Project 1',
        url: 'https://vercel.com/project-a',
        categoryId: 'cat-dev',
        username: 'dev_user_777',
        attributes: { 'attr-code': true },
      }),
      makeBm({
        id: 'bm-2',
        title: 'My Vercel Project 2',
        url: 'https://vercel.com/project-b',
        categoryId: 'cat-dev',
        username: 'dev_user_777',
        attributes: { 'attr-code': true },
      }),
    ]

    const res = getSmartPrefill(
      'https://vercel.com/dashboard/settings',
      existingBookmarks,
      dummyCategories,
      dummyAttributes
    )

    // 应继承常用账号和历史分类
    expect(res.suggestedUsername).toBe('dev_user_777')
    expect(res.categoryId).toBe('cat-dev')
    expect(res.suggestedAttrIds).toContain('attr-code')
  })

  it('中英文双语适配：中文环境推荐地道中文名，英文环境推荐纯正英文名', () => {
    // Bilibili
    const biliZh = getSmartPrefill('https://www.bilibili.com', [], [], [], 'zh-CN')
    expect(biliZh.title).toBe('哔哩哔哩 (B站)')
    expect(biliZh.notes).toContain('视频')

    const biliEn = getSmartPrefill('https://www.bilibili.com', [], [], [], 'en-US')
    expect(biliEn.title).toBe('Bilibili')
    expect(biliEn.notes).toContain('video')

    // 知乎
    const zhihuZh = getSmartPrefill('https://www.zhihu.com', [], [], [], 'zh-CN')
    expect(zhihuZh.title).toBe('知乎')
    const zhihuEn = getSmartPrefill('https://www.zhihu.com', [], [], [], 'en-US')
    expect(zhihuEn.title).toBe('Zhihu')

    // Notion
    const notionZh = getSmartPrefill('https://www.notion.so', [], [], [], 'zh-CN')
    expect(notionZh.title).toBe('Notion 笔记空间')
    const notionEn = getSmartPrefill('https://www.notion.so', [], [], [], 'en-US')
    expect(notionEn.title).toBe('Notion')
  })

  it('子域名精准识别：docs.* 不误截为 Docs，正确提取主品牌', () => {
    const dockerDocZh = getSmartPrefill('https://docs.docker.com/engine/install/', [], [], [], 'zh-CN')
    expect(dockerDocZh.title).toBe('Docker 官方开发文档')
    expect(dockerDocZh.notes).toContain('Docker')

    const dockerDocEn = getSmartPrefill('https://docs.docker.com/engine/install/', [], [], [], 'en-US')
    expect(dockerDocEn.title).toBe('Docker Official Docs')
  })

  it('文章 Slug 提炼：长路径文章自动转换为清晰单词标题', () => {
    const slugRes = getSmartPrefill('https://mydevblog.org/articles/how-to-learn-modern-vue')
    expect(slugRes.title).toContain('How To Learn Modern Vue')
  })

  it('冷门站点与兜底：精准品牌大写回退', () => {
    const res = getSmartPrefill('https://myawesomecoolsite.xyz/posts/abc')
    expect(res.title).toBe('Myawesomecoolsite')
    expect(res.notes).toBe('')
    expect(res.confidence).toBe('medium')
  })

  it('非法输入或空 URL 安全回退', () => {
    const res1 = getSmartPrefill('')
    expect(res1.title).toBe('')
    expect(res1.notes).toBe('')

    const res2 = getSmartPrefill('just-a-plain-string')
    expect(res2.title).toBeTruthy()
  })
})
