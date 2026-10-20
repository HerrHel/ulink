import { describe, it, expect, beforeEach } from 'vitest'
import {
  htmlToPlainText,
  tokenizeText,
  VaultKnowledgeEngine,
} from '../../lib/ai/localRAG.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../../types.js'

describe('localRAG.ts — 端侧混合 RAG 引擎单元测试', () => {
  describe('htmlToPlainText', () => {
    it('清理 HTML 标签并保留换行与符号', () => {
      const html = '<p>第一段内容</p><br/><div>第二段列表：<ul><li>项目一</li><li>项目二</li></ul></div>'
      const plain = htmlToPlainText(html)
      expect(plain).toContain('第一段内容')
      expect(plain).toContain('第二段列表：')
      expect(plain).toContain('• 项目一')
      expect(plain).toContain('• 项目二')
      expect(plain).not.toContain('<p>')
      expect(plain).not.toContain('</div>')
    })

    it('对空值与异常值安全兜底', () => {
      expect(htmlToPlainText('')).toBe('')
      expect(htmlToPlainText(undefined)).toBe('')
    })
  })

  describe('tokenizeText', () => {
    it('对英文与技术词项按词切分并转小写', () => {
      const tokens = tokenizeText('Vue3.5 Pinia State Management and Docker')
      expect(tokens).toContain('vue3.5')
      expect(tokens).toContain('pinia')
      expect(tokens).toContain('state')
      expect(tokens).toContain('management')
      expect(tokens).toContain('docker')
    })

    it('对中文文本执行 2-gram 双字滑窗切分并过滤停用词', () => {
      const tokens = tokenizeText('前端架构工程化设计')
      expect(tokens).toContain('前端')
      expect(tokens).toContain('端架')
      expect(tokens).toContain('架构')
      expect(tokens).toContain('构工')
      expect(tokens).toContain('工程')
      expect(tokens).toContain('程化')
      expect(tokens).toContain('化设')
      expect(tokens).toContain('设计')
    })

    it('过滤无意义单字停用词', () => {
      const tokens = tokenizeText('我想找一个相关的网站')
      expect(tokens).not.toContain('我想')
      expect(tokens).not.toContain('一个')
    })
  })

  describe('VaultKnowledgeEngine', () => {
    let engine: VaultKnowledgeEngine
    const mockCategories: Category[] = [
      { id: 'cat-dev', name: '开发', order: 1, icon: '', color: '' },
      { id: 'cat-design', name: '设计', order: 2, icon: '', color: '' },
    ]
    const mockAttrs: CustomAttribute[] = [
      { id: 'attr-daily', name: '常用', type: 'boolean' },
    ]

    const mockBookmarks: Bookmark[] = [
      {
        id: 'bm-vue',
        title: 'Vue.js 渐进式前端框架',
        url: 'https://vuejs.org',
        username: '',
        password: '',
        notes: '<p>易用且灵活的 JavaScript 界面渲染框架，适合单页应用。</p>',
        icon: '',
        categoryId: 'cat-dev',
        parentId: null,
        order: 1,
        useCount: 10,
        attributes: { 'attr-daily': true },
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'bm-pinia',
        title: 'Pinia 状态管理库',
        url: 'https://pinia.vuejs.org',
        username: '',
        password: '',
        notes: '<p>Vue 官方推荐的直观类型安全状态树管理工具。</p>',
        icon: '',
        categoryId: 'cat-dev',
        parentId: null,
        order: 2,
        useCount: 5,
        attributes: {},
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'bm-figma',
        title: 'Figma 协作设计平台',
        url: 'https://figma.com',
        username: '',
        password: '',
        notes: '<p>云端原型交互与矢量 UI 设计利器。</p>',
        icon: '',
        categoryId: 'cat-design',
        parentId: null,
        order: 3,
        useCount: 8,
        attributes: { 'attr-daily': true },
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'bm-secret',
        title: '内网凭证测试',
        url: 'https://admin:pass123456@internal.corp.net',
        username: '',
        password: '',
        notes: '<p>API Key: sk-1234567890abcdef1234567890abcdef</p>',
        icon: '',
        categoryId: 'cat-dev',
        parentId: null,
        order: 4,
        useCount: 1,
        attributes: {},
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]

    const mockGroups: SiblingGroup[] = [
      {
        id: 'grp-frontend',
        name: '现代前端工程化方案',
        categoryId: 'cat-dev',
        icon: '',
        order: 1,
        isExpanded: true,
        attributes: { 'attr-daily': true },
        bookmarkIds: ['bm-vue', 'bm-pinia'],
        notes: '<p>这里记录了现代前端工程化的组件规范与状态流转约定。包含 Vue 与 Pinia 的协同最佳实践。</p>',
        updatedAt: 1000,
        useCount: 15,
      },
    ]

    beforeEach(() => {
      engine = new VaultKnowledgeEngine()
      engine.buildIndex(mockBookmarks, mockGroups, mockCategories, mockAttrs)
    })

    it('根据自然语言关键词精确命中全库书签与笔记 (BM25)', () => {
      const results = engine.queryRelevantContext('状态管理与 Pinia 怎么配合')
      expect(results.length).toBeGreaterThan(0)
      const topTitles = results.map(r => r.title)
      expect(topTitles.some(t => t.includes('Pinia'))).toBe(true)
      expect(topTitles.some(t => t.includes('现代前端工程化方案'))).toBe(true)
    })

    it('命中概念本体时自适应提权 (Concept Ontology Boost)', () => {
      // 'ui设计' 命中 CONCEPT_ONTOLOGY 中的 'UI/UX 界面原型设计'，包含 figma.com 域名
      const results = engine.queryRelevantContext('找 UI 设计画原型的工具')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].title).toContain('Figma')
      expect(results[0].matchedReason).toContain('概念')
    })

    it('格式化召回切片时严格执行脱敏与预算剪裁', () => {
      const results = engine.queryRelevantContext('内网凭证')
      const formatted = engine.formatChunksForPrompt(results, 1000)

      expect(formatted).toContain('全库关联知识参考')
      // 敏感信息必须已被脱敏
      expect(formatted).not.toContain('pass123456')
      expect(formatted).not.toContain('sk-1234567890abcdef1234567890abcdef')
      expect(formatted).toContain('[REDACTED]')
    })

    it('分类名与标签同样脱敏截断（不得绕过 secretFilter 直出）', () => {
      const chunk = {
        sourceType: 'bookmark',
        title: '正常标题',
        url: 'https://ok.example.com',
        content: '正常内容',
        category: '分类 api_key: sk-abcdefghij1234567890',
        tags: ['Bearer abcdefghijklmnop123456', '正常标签'],
      } as any
      const formatted = engine.formatChunksForPrompt([chunk], 1000)

      expect(formatted).not.toContain('sk-abcdefghij1234567890')
      expect(formatted).not.toContain('abcdefghijklmnop123456')
      expect(formatted).toContain('[REDACTED')
      expect(formatted).toContain('正常标签')
    })

    it('空查询或未命中时优雅返回空数组', () => {
      expect(engine.queryRelevantContext('')).toEqual([])
      expect(engine.queryRelevantContext('   ')).toEqual([])
      const emptyResults = engine.queryRelevantContext('完全不相关的随机生僻字xyz123')
      expect(emptyResults).toEqual([])
    })
  })
})
