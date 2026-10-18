import { describe, it, expect } from 'vitest'
import {
  htmlToCleanText,
  resolveCardContext,
  formatAttachedCardsForPrompt,
  getDefaultAttachedPrompt,
  type ResolvedCardContext,
} from '../../lib/ai/cardReader.js'

describe('cardReader — 卡片解析与 AI 读取上下文构建', () => {
  it('1. htmlToCleanText：将富文本 HTML 干净转化为纯文本并保留列表与段落结构', () => {
    const html = `
      <h3>前端架构要点</h3>
      <p>第一段：关于 <strong>Vue3</strong> 的响应式。</p>
      <ul>
        <li>支持 Proxy 代理</li>
        <li>性能比 Vue2 提升 2 倍&nbsp;&amp;&nbsp;内存占用减半</li>
      </ul>
      <p>第二段：结束总结。<br/>请留意细节。</p>
    `
    const clean = htmlToCleanText(html)
    expect(clean).toContain('前端架构要点')
    expect(clean).toContain('第一段：关于 Vue3 的响应式。')
    expect(clean).toContain('- 支持 Proxy 代理')
    expect(clean).toContain('- 性能比 Vue2 提升 2 倍 & 内存占用减半')
    expect(clean).toContain('第二段：结束总结。\n请留意细节。')
    expect(clean).not.toContain('<p>')
    expect(clean).not.toContain('&nbsp;')
  })

  it('2. resolveCardContext：精准提取书签完整元数据', () => {
    const bookmarkMap: Record<string, any> = {
      bm_1: {
        id: 'bm_1',
        title: 'Vue 官网',
        url: 'https://vuejs.org',
        categoryId: 'cat_tech',
        attributes: { attr_fe: true },
        notes: '深入理解组合式 API',
        order: 1,
      },
    }
    const categories: any[] = [
      { id: 'cat_tech', name: '技术开发' },
    ]
    const customAttributes: any[] = [
      { id: 'attr_fe', name: '前端' },
    ]

    const res = resolveCardContext('bm', 'bm_1', {
      bookmarkMap,
      groupMap: {},
      categories,
      customAttributes,
    })

    expect(res).not.toBeNull()
    expect(res?.type).toBe('bm')
    expect(res?.id).toBe('bm_1')
    expect(res?.title).toBe('Vue 官网')
    expect(res?.url).toBe('https://vuejs.org')
    expect(res?.categoryName).toBe('技术开发')
    expect(res?.tags).toEqual(['前端'])
    expect(res?.notes).toBe('深入理解组合式 API')
  })

  it('3. resolveCardContext：精准提取笔记全文正文与组内书签清单', () => {
    const bookmarkMap: Record<string, any> = {
      bm_sub1: { id: 'bm_sub1', title: 'Vite 官方文档', url: 'https://vite.dev', notes: '', order: 1 },
      bm_sub2: { id: 'bm_sub2', title: 'Rollup 打包工具', url: 'https://rollupjs.org', notes: '新一代打包工具', order: 2 },
    }
    const groupMap: Record<string, any> = {
      sg_build: {
        id: 'sg_build',
        name: '构建工具全景笔记',
        categoryId: 'cat_infra',
        notes: '<p>现代打包工具主要分为基于 ESM 的 dev server 与生产环境 bundler。</p><ul><li>开发环境以极速热更新为主</li><li>生产环境进行代码压缩混淆</li></ul>',
        bookmarkIds: ['bm_sub1', 'bm_sub2'],
        order: 1,
      },
    }
    const categories: any[] = [
      { id: 'cat_infra', name: '基础设施' },
    ]

    const res = resolveCardContext('group', 'group:sg_build', {
      bookmarkMap,
      groupMap,
      categories,
      customAttributes: [],
    })

    expect(res).not.toBeNull()
    expect(res?.type).toBe('group')
    expect(res?.title).toBe('构建工具全景笔记')
    expect(res?.categoryName).toBe('基础设施')
    expect(res?.notes).toContain('现代打包工具主要分为基于 ESM')
    expect(res?.notes).toContain('- 开发环境以极速热更新为主')
    expect(res?.childBookmarks?.length).toBe(2)
    expect(res?.childBookmarks?.[0]).toEqual({ title: 'Vite 官方文档', url: 'https://vite.dev', desc: '' })
  })

  it('4. formatAttachedCardsForPrompt：组装符合 LLM 深度阅读的结构化上下文', () => {
    const cards: ResolvedCardContext[] = [
      {
        type: 'bm',
        id: 'bm_1',
        title: 'MDN Web Docs',
        url: 'https://developer.mozilla.org',
        categoryName: '文档库',
        desc: '权威前端开发参考指南',
        tags: ['官方', '免费'],
        notes: '查阅 CSS 与 JS API 首选',
      },
      {
        type: 'group',
        id: 'sg_1',
        title: '前端架构设计思考',
        categoryName: '架构',
        notes: '核心围绕解耦、复用与性能监控展开。',
        childBookmarks: [
          { title: '微前端方案', url: 'https://qiankun.umijs.org', desc: '阿里微前端' },
        ],
      },
    ]

    const promptTextZh = formatAttachedCardsForPrompt(cards, true)
    expect(promptTextZh).toContain('【用户在对话中拖入并关联的卡片/笔记附件（请深度阅读并基于这些内容回答）】')
    expect(promptTextZh).toContain('[附件 1] 🔖 书签卡片：MDN Web Docs')
    expect(promptTextZh).toContain('- 网址：https://developer.mozilla.org')
    expect(promptTextZh).toContain('- 分类：文档库')
    expect(promptTextZh).toContain('- 标签：官方、免费')
    expect(promptTextZh).toContain('查阅 CSS 与 JS API 首选')
    expect(promptTextZh).toContain('[附件 2] 📝 笔记卡片：前端架构设计思考')
    expect(promptTextZh).toContain('核心围绕解耦、复用与性能监控展开。')
    expect(promptTextZh).toContain('* 微前端方案 (https://qiankun.umijs.org) - 阿里微前端')

    const promptTextEn = formatAttachedCardsForPrompt(cards, false)
    expect(promptTextEn).toContain('[User Attached Cards & Notes for Reference')
  })

  it('5. getDefaultAttachedPrompt：用户仅拖入卡片未键入文本时，智能生成高质量默认问询', () => {
    const singleBm: ResolvedCardContext[] = [
      { type: 'bm', id: '1', title: 'Linear' },
    ]
    expect(getDefaultAttachedPrompt(singleBm, true)).toContain('请阅读并分析此书签「Linear」的内容与用途')

    const singleNote: ResolvedCardContext[] = [
      { type: 'group', id: '2', title: '读书笔记' },
    ]
    expect(getDefaultAttachedPrompt(singleNote, true)).toContain('请详细阅读并分析这篇笔记「读书笔记」的内容')

    const multiple: ResolvedCardContext[] = [
      { type: 'bm', id: '1', title: 'Linear' },
      { type: 'group', id: '2', title: '读书笔记' },
    ]
    expect(getDefaultAttachedPrompt(multiple, true)).toContain('请详细阅读并分析我关联的这 2 张卡片与笔记的内容')
  })
})
