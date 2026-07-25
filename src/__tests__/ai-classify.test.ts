import { describe, it, expect } from 'vitest'
import { suggestCategory, suggestAttributes } from '../lib/ai-classify.js'
import type { Category } from '../types.js'

const CATS: Category[] = [
  { id: 'c-dev', name: '开发', icon: '', color: '', order: 0 },
  { id: 'c-ai', name: 'AI', icon: '', color: '', order: 1 },
  { id: 'c-shop', name: '购物', icon: '', color: '', order: 2 },
  { id: 'c-social', name: '娱乐', icon: '', color: '', order: 3 },
  { id: 'c-design', name: '设计', icon: '', color: '', order: 4 },
]

describe('suggestCategory', () => {
  it('空 url+title 返回 null', () => {
    expect(suggestCategory('', '', CATS)).toBeNull()
  })

  it('按域名命中（github → 开发）', () => {
    expect(suggestCategory('https://github.com/foo/bar', '', CATS)).toBe('c-dev')
  })

  it('按域名命中（claude.ai → AI）', () => {
    expect(suggestCategory('https://claude.ai/chat', '随便', CATS)).toBe('c-ai')
  })

  it('按标题关键词命中', () => {
    expect(suggestCategory('https://example.com/x', 'Vue 开发教程', CATS)).toBe('c-dev')
  })

  it('M9：短英文词边界，email 不误命中 ai', () => {
    // 「email」含 ai 子串，但词边界规则应避免命中 AI 类
    const id = suggestCategory('https://example.com/mailbox', 'email notification', CATS)
    expect(id).not.toBe('c-ai')
  })

  it('categories 中无对应名时返回 null', () => {
    expect(suggestCategory('https://github.com/x', '', [{ id: 'other', name: '其他', icon: '', color: '', order: 0 }])).toBeNull()
  })

  it('无任何匹配返回 null', () => {
    expect(suggestCategory('https://unknown.example/zzz', 'zzzz', CATS)).toBeNull()
  })

  it('M9+审计#13：平局时按 categories order 升序选用户排前者，不偏向常量声明序', () => {
    // title 同时命中「开发」(github, +1) 与「设计」(设计, +1)，两者同分 1。
    // CATS 中开发 order=0 排在设计 order=4 之前，故选开发；不依赖 DOMAIN/TITLE_KEYWORDS
    // 常量声明序（开发在两表均先声明，旧实现因 Map 先入序也偶合选开发，此用例以 order 语义固化，
    // 防 bestName 决胜退化回 score > bestScore 的偶然偏向）。
    expect(suggestCategory('https://example.com/x', 'github 设计', CATS)).toBe('c-dev')
  })

  it('审计#13：平局时 order 较小者胜，与 categories 声明顺序无关', () => {
    // 调换 categories 顺序让设计排在前面但 order 仍 4>0，应仍选 order 小的开发，
    // 证明决胜按 order 而非 categories 数组下标（数组下标是另一种偶然序）。
    const reordered = [
      { id: 'c-design', name: '设计', icon: '', color: '', order: 4 },
      { id: 'c-dev', name: '开发', icon: '', color: '', order: 0 },
    ]
    expect(suggestCategory('https://example.com/x', 'github 设计', reordered)).toBe('c-dev')
  })
})

describe('suggestAttributes', () => {
  const attrs = [
    { id: 'a-daily', name: '常用' },
    { id: 'a-work', name: '工作' },
    { id: 'a-learn', name: '学习' },
    { id: 'a-temp', name: '临时' },
    { id: 'a-other', name: '自定义无关' },
  ]

  it('空输入返回 []', () => {
    expect(suggestAttributes('', '', attrs)).toEqual([])
  })

  it('域名命中 github → 常用', () => {
    expect(suggestAttributes('https://github.com/x', '', attrs)).toContain('a-daily')
  })

  it('标题命中 教程 → 学习', () => {
    expect(suggestAttributes('https://example.com', 'TypeScript 教程', attrs)).toContain('a-learn')
  })

  it('未知属性名跳过', () => {
    expect(suggestAttributes('https://github.com', '', attrs)).not.toContain('a-other')
  })
})
