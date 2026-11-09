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
    expect(txt).toContain('Sitemap: https://ulink.ren/sitemap.xml')
  })
})

describe('sitemap.xml', () => {
  const xml = fs.readFileSync(path.join(root, 'public', 'sitemap.xml'), 'utf8')

  it('存在且含首页 URL', () => {
    expect(xml).toContain('<urlset')
    expect(xml).toContain('https://ulink.ren/')
  })

  it('包含对外法律合规文档 URL', () => {
    expect(xml).toContain('https://ulink.ren/legal/')
    expect(xml).toContain('https://ulink.ren/legal/terms-of-service.html')
    expect(xml).toContain('https://ulink.ren/legal/privacy-policy.html')
    expect(xml).toContain('https://ulink.ren/legal/refund-policy.html')
  })
})

describe('public/_headers', () => {
  const headers = fs.readFileSync(path.join(root, 'public', '_headers'), 'utf8').replace(/\r\n/g, '\n')

  it('声明安全头与双入口 HTML no-cache', () => {
    expect(headers).toContain('Content-Security-Policy:')
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('/app\n  Cache-Control: no-cache')
  })

  it('落地页核心脚本包含 300s 短缓存', () => {
    const scripts = [
      '/landing.js',
      '/hero-visual.js',
      '/manage-visual.js',
      '/sync-visual.js',
      '/share-visual.js'
    ]
    for (const s of scripts) {
      expect(headers).toContain(s)
    }
  })
})

describe('index.html SEO meta & JSON-LD', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')

  it('含基础 SEO meta', () => {
    expect(html).toContain('name="description"')
    expect(html).toContain('rel="canonical"')
    expect(html).toContain('property="og:title"')
    expect(html).toContain('property="og:url"')
    expect(html).toContain('name="twitter:card"')
  })

  it('含应用级合法 JSON-LD', () => {
    expect(html).toContain('application/ld+json')
    expect(html).toContain('data-lv-jsonld="app"')
    const match = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html)
    expect(match).toBeTruthy()
    const parsed = JSON.parse(match![1])
    expect(parsed['@context']).toBe('https://schema.org')
    expect(parsed['@type']).toBe('WebApplication')
    expect(parsed.name).toContain('ulink')
    expect(parsed.offers).toBeDefined()
    expect(parsed.featureList).toBeDefined()
  })

  it('已移除 api.xinac.net 预连接（非首屏关键路径）', () => {
    expect(html).not.toContain('api.xinac.net')
  })
})

describe('落地页国际化字典对称性 (index.html ⇄ landing.js)', () => {
  it('index.html 的所有 data-i18n 与 landing.js EN 字典严格一一对应', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    const landingJs = fs.readFileSync(path.join(root, 'public', 'landing.js'), 'utf8')

    // 提取 index.html 中的所有 data-i18n 与 data-i18n-aria
    const htmlKeys = new Set<string>()
    const reI18n = /data-i18n(?:-aria)?=["']([^"']+)["']/g
    let m: RegExpExecArray | null
    while ((m = reI18n.exec(html)) !== null) {
      htmlKeys.add(m[1])
    }

    // 提取 landing.js 中的 EN 字典键名
    const enBlockMatch = /var EN = \{([\s\S]*?)\};/.exec(landingJs)
    expect(enBlockMatch).toBeTruthy()
    const enBlock = enBlockMatch![1]
    const enKeys = new Set<string>()
    const reKey = /['"]([a-zA-Z0-9._-]+)['"]\s*:/g
    while ((m = reKey.exec(enBlock)) !== null) {
      enKeys.add(m[1])
    }

    const missingInEn = Array.from(htmlKeys).filter(k => !enKeys.has(k))
    const unusedInEn = Array.from(enKeys).filter(k => !htmlKeys.has(k))

    expect(missingInEn).toEqual([])
    expect(unusedInEn).toEqual([])
  })
})
