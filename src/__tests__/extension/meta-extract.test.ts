import { describe, it, expect } from 'vitest'
import {
  extractPageMetadataFromDoc,
  matchCategoryByKeywords,
} from '../../../extension/meta-extract.js'

describe('extension/meta-extract.js — 页面元数据现场提取器', () => {
  it('正确提取 og:title、og:description 与 keywords', () => {
    const doc = document.implementation.createHTMLDocument('Fallback Title')
    const ogTitle = doc.createElement('meta')
    ogTitle.setAttribute('property', 'og:title')
    ogTitle.setAttribute('content', 'Clean Docker Guide')
    doc.head.appendChild(ogTitle)

    const ogDesc = doc.createElement('meta')
    ogDesc.setAttribute('property', 'og:description')
    ogDesc.setAttribute('content', '全面了解 Docker 容器化技术与最佳实践。')
    doc.head.appendChild(ogDesc)

    const kw = doc.createElement('meta')
    kw.setAttribute('name', 'keywords')
    kw.setAttribute('content', 'docker, 容器, devops')
    doc.head.appendChild(kw)

    const meta = extractPageMetadataFromDoc(doc, window)
    expect(meta.title).toBe('Clean Docker Guide')
    expect(meta.description).toBe('全面了解 Docker 容器化技术与最佳实践。')
    expect(meta.keywords).toBe('docker, 容器, devops')
  })

  it('og:title 缺失时回退至 twitter:title，两者皆缺时回退至 document.title', () => {
    const doc1 = document.implementation.createHTMLDocument('Doc Title 1')
    const tw = doc1.createElement('meta')
    tw.setAttribute('name', 'twitter:title')
    tw.setAttribute('content', 'Twitter Card Title')
    doc1.head.appendChild(tw)

    expect(extractPageMetadataFromDoc(doc1, window).title).toBe('Twitter Card Title')

    const doc2 = document.implementation.createHTMLDocument('Raw Doc Title')
    expect(extractPageMetadataFromDoc(doc2, window).title).toBe('Raw Doc Title')
  })

  it('meta description 换行与连续空白自动压缩规整', () => {
    const doc = document.implementation.createHTMLDocument('Title')
    const desc = doc.createElement('meta')
    desc.setAttribute('name', 'description')
    desc.setAttribute('content', ' 第一行简介   \n\n  第二行简介 \t 结束。 ')
    doc.head.appendChild(desc)

    const meta = extractPageMetadataFromDoc(doc, window)
    expect(meta.description).toBe('第一行简介 第二行简介 结束。')
  })

  it('高清 apple-touch-icon 链接提取', () => {
    const doc = document.implementation.createHTMLDocument('Title')
    const link = doc.createElement('link')
    link.setAttribute('rel', 'apple-touch-icon')
    link.setAttribute('href', 'https://example.com/touch-icon.png')
    doc.head.appendChild(link)

    const meta = extractPageMetadataFromDoc(doc, window)
    expect(meta.icon).toContain('touch-icon.png')
  })

  it('根据 keywords 与 description 智能预选用户已有分类', () => {
    const categories = [
      { id: 'cat-dev', name: '开发' },
      { id: 'cat-design', name: '设计' },
      { id: 'cat-ai', name: 'AI' },
    ]

    const metaDocker = {
      title: 'Docker Docs',
      description: 'Container application development guide.',
      keywords: 'docker, dev, programming',
    }
    expect(matchCategoryByKeywords(metaDocker, categories)).toBe('cat-dev')

    const metaFigma = {
      title: 'Figma UI Community',
      description: 'Collaborative interface design templates.',
      keywords: 'ui, design, vector',
    }
    expect(matchCategoryByKeywords(metaFigma, categories)).toBe('cat-design')

    const metaGpt = {
      title: 'DeepSeek Chat',
      description: '大语言模型智能对话与推理系统',
      keywords: 'ai, llm, prompt',
    }
    expect(matchCategoryByKeywords(metaGpt, categories)).toBe('cat-ai')
  })

  it('空输入与空文档安全防御', () => {
    expect(extractPageMetadataFromDoc(null, null)).toEqual({
      title: '',
      description: '',
      keywords: '',
      selection: '',
      icon: '',
    })
    expect(matchCategoryByKeywords(null, [])).toBeNull()
  })
})
