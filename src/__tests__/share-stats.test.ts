/**
 * share-ssr 访问统计纯函数（cloudbase/functions/share-ssr/share-stats.js）
 *
 * 锁住的契约：
 *   1. UA 分类：社交预览 → preview；搜索爬虫 / 脚本工具 / 空 UA → ignore；其余 human
 *   2. 来源优先级：utm_source > from > ref > 外站 Referer 主机 > 微信/QQ/微博内置浏览器 > direct
 *   3. 来源规范化为 [a-z0-9._-]{1,40}，杜绝把任意字符串写进统计表
 *   4. /go 跳转目标是白名单：只认 to=start，其余一律回到「保存」，绝不跳外部 URL
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { classifyAgent, normSource, resolveSource, resolveGoSource, goTarget } = require(
  '../../cloudbase/functions/share-ssr/share-stats.js',
) as {
  classifyAgent: (ua: string | undefined) => 'human' | 'preview' | 'ignore'
  normSource: (v: string) => string
  resolveSource: (url: URL, headers: Record<string, string>, appHost: string) => string
  resolveGoSource: (headers: Record<string, string>) => string
  goTarget: (kind: 'g' | 'c', id: string, to: string | null, origin: string) => { event: string; location: string }
}

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const WECHAT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50'

describe('classifyAgent', () => {
  it.each([
    [CHROME, 'human'],
    [WECHAT, 'human'],
    ['facebookexternalhit/1.1', 'preview'],
    ['Twitterbot/1.0', 'preview'],
    ['Slackbot-LinkExpanding 1.0', 'preview'],
    ['TelegramBot (like TwitterBot)', 'preview'],
    ['WhatsApp/2.23.20.0', 'preview'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'ignore'],
    ['Mozilla/5.0 (compatible; Baiduspider/2.0)', 'ignore'],
    ['curl/8.4.0', 'ignore'],
    ['python-requests/2.31', 'ignore'],
    ['node-fetch/1.0', 'ignore'],
    ['Mozilla/5.0 HeadlessChrome/120.0', 'ignore'],
    ['', 'ignore'],
  ])('%s → %s', (ua, expected) => {
    expect(classifyAgent(ua)).toBe(expected)
  })

  it('缺 UA 视为脚本，不计数', () => {
    expect(classifyAgent(undefined)).toBe('ignore')
  })
})

describe('normSource', () => {
  it('小写、去 www.、剔非法字符、截 40 位', () => {
    expect(normSource('WWW.Zhihu.com')).toBe('zhihu.com')
    expect(normSource("x'; DROP TABLE--")).toBe('xdroptable--')
    expect(normSource('a'.repeat(60))).toHaveLength(40)
    expect(normSource('')).toBe('')
  })
})

describe('resolveSource', () => {
  const host = 'ulink.ren'
  const u = (q = '') => new URL(`https://ulink.ren/s/g1${q}`)

  it('utm_source 优先于 from / ref / Referer', () => {
    expect(resolveSource(u('?utm_source=XHS&from=x&ref=y'), { referer: 'https://t.co/a' }, host)).toBe('xhs')
    expect(resolveSource(u('?from=newsletter&ref=y'), {}, host)).toBe('newsletter')
    expect(resolveSource(u('?ref=v2ex'), {}, host)).toBe('v2ex')
  })

  it('外站 Referer 取主机名；本站与子域 Referer 不算外部来源', () => {
    expect(resolveSource(u(), { referer: 'https://www.v2ex.com/t/1' }, host)).toBe('v2ex.com')
    expect(resolveSource(u(), { referer: 'https://ulink.ren/app' }, host)).toBe('direct')
    expect(resolveSource(u(), { referer: 'https://www.ulink.ren/' }, host)).toBe('direct')
  })

  it('非法 Referer 忽略', () => {
    expect(resolveSource(u(), { referer: 'not a url' }, host)).toBe('direct')
  })

  it('无 Referer 时按 App 内置浏览器识别', () => {
    expect(resolveSource(u(), { 'user-agent': WECHAT }, host)).toBe('wechat')
    expect(resolveSource(u(), { 'user-agent': 'Mozilla/5.0 Mobile QQ/9.0.0' }, host)).toBe('qq')
    expect(resolveSource(u(), { 'user-agent': 'Mozilla/5.0 Weibo (iPhone)' }, host)).toBe('weibo')
    expect(resolveSource(u(), { 'user-agent': CHROME }, host)).toBe('direct')
  })
})

describe('resolveGoSource', () => {
  it('从分享页 URL 继承显式来源，否则 direct', () => {
    expect(resolveGoSource({ referer: 'https://ulink.ren/s/g1?utm_source=xhs' })).toBe('xhs')
    expect(resolveGoSource({ referer: 'https://ulink.ren/s/g1' })).toBe('direct')
    expect(resolveGoSource({})).toBe('direct')
    expect(resolveGoSource({ referer: '::bad' })).toBe('direct')
  })
})

describe('goTarget', () => {
  const O = 'https://ulink.ren'
  it('save：组 / 分类分别回到应用内的分享只读态', () => {
    expect(goTarget('g', 'g1', 'save', O)).toEqual({ event: 'cta', location: `${O}/app#share/g1` })
    expect(goTarget('c', 's1', 'save', O)).toEqual({ event: 'cta', location: `${O}/app#share/c/s1` })
  })

  it('start：去应用首页并带 from=share', () => {
    expect(goTarget('g', 'g1', 'start', O)).toEqual({ event: 'start', location: `${O}/?from=share` })
  })

  it('未知 / 恶意 to 值一律按 save 处理，绝不跳外部地址', () => {
    for (const to of [null, '', 'https://evil.example', '//evil.example', 'javascript:alert(1)']) {
      const t = goTarget('g', 'g1', to, O)
      expect(t.location.startsWith(`${O}/`)).toBe(true)
      expect(t.event).toBe('cta')
    }
  })
})
