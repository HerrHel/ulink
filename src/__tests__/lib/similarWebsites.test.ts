import { describe, it, expect } from 'vitest'
import { getSimilarExternalWebsites } from '../../lib/ai/similarWebsites.js'

describe('similarWebsites — 外部类似网站推荐引擎', () => {
  it('精确域名命中：chatgpt.com 推荐 Claude、DeepSeek、Perplexity 等', () => {
    const list = getSimilarExternalWebsites('https://chatgpt.com/c/123')
    expect(list.length).toBeGreaterThan(0)
    const titles = list.map(item => item.title)
    expect(titles).toContain('Claude')
    expect(titles).toContain('DeepSeek')
  })

  it('精确域名命中：github.com 推荐 GitLab 与 Gitee', () => {
    const list = getSimilarExternalWebsites('https://github.com/HerrHel/ulink')
    expect(list.length).toBeGreaterThan(0)
    const domains = list.map(item => item.domain)
    expect(domains).toContain('gitlab.com')
  })

  it('泛域名模糊命中：chat.openai.com 命中 chatgpt.com 推荐群组', () => {
    const list = getSimilarExternalWebsites('https://chat.openai.com')
    expect(list.length).toBeGreaterThan(0)
    expect(list.some(item => item.domain === 'claude.ai')).toBe(true)
  })

  it('分类兜底：未匹配到具体域名但传入“开发”分类时返回开发类工具', () => {
    const list = getSimilarExternalWebsites('https://unknown-random-dev-blog.net', '开发工具')
    expect(list.length).toBeGreaterThan(0)
    const titles = list.map(item => item.title)
    expect(titles).toContain('GitHub')
  })

  it('空或非法输入返回空数组', () => {
    expect(getSimilarExternalWebsites('')).toEqual([])
    expect(getSimilarExternalWebsites('invalid-url-xyz-123')).toEqual([])
  })
})
