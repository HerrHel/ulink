/**
 * static-assets.test.ts — 校验 public/ 静态 SEO 资源与 index.html meta 完整性
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..', '..')

describe('robots.txt', () => {
  it('存在并声明 Sitemap 入口', () => {
    const txt = fs.readFileSync(path.join(root, 'public', 'robots.txt'), 'utf8')
    expect(txt).toMatch(/User-agent:\s*\*/)
    expect(txt).toMatch(/Allow:\s*\//)
    expect(txt).toContain('Sitemap: https://herrhel.github.io/sitemap.xml')
  })
})

describe('sitemap.xml', () => {
  it('存在且含首页 URL', () => {
    const xml = fs.readFileSync(path.join(root, 'public', 'sitemap.xml'), 'utf8')
    expect(xml).toContain('<urlset')
    expect(xml).toContain('https://herrhel.github.io/')
  })
})

describe('index.html SEO meta', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')

  it('含基础 SEO meta', () => {
    expect(html).toContain('name="description"')
    expect(html).toContain('rel="canonical"')
    expect(html).toContain('property="og:title"')
    expect(html).toContain('property="og:url"')
    expect(html).toContain('name="twitter:card"')
  })

  it('含应用级 JSON-LD', () => {
    expect(html).toContain('application/ld+json')
    expect(html).toContain('data-lv-jsonld="app"')
    expect(html).toContain('"@type": "WebApplication"')
  })

  it('已移除 api.xinac.net 预连接（非首屏关键路径）', () => {
    expect(html).not.toContain('api.xinac.net')
  })
})
