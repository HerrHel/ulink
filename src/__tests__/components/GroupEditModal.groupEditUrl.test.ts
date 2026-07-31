import { describe, it, expect } from 'vitest'
import { faviconUrl, domainName } from '../../components/modals/groupEditUrl.js'

// 护栏目标：锁定 GroupEditModal.vue「编辑组 → 内含书签」行项目两个用户可见 URL 承载
// 的真实行为契约——faviconUrl(bm.url) → <img :src>、domainName(bm.url) → <span>{{ }}。
// 两函数体是 utils favicon/domain 的薄包装，但其 `url || ''` 空安全防护是真实回归线
// （见 groupEditUrl.ts 顶部注释的 why）。本护栏把"空安全防护 + 转发到 favicon/domain 的精确
// 契约 + 纯函数无副作用"直锁为可回归断言，pattern 同 CommandPalette.extractHostname.test.ts
// （c8-cmdpalette-hostname-guard）。
describe('groupEditUrl faviconUrl', () => {
  it('合法 https URL 转 favicon 服务 URL（取 domain 拼 api.xinac.net）', () => {
    expect(faviconUrl('https://example.com')).toBe('https://api.xinac.net/icon/?url=example.com')
  })

  it('www 子域 favicon 用主张名（domain 去除 www. 前缀）', () => {
    expect(faviconUrl('https://www.sub.example.com/path')).toBe('https://api.xinac.net/icon/?url=sub.example.com')
  })

  it('非 URL 串也经 domain catch 透传后拼服务 URL（domain 对 not-a-url 返原串 truthy）', () => {
    expect(faviconUrl('not-a-url')).toBe('https://api.xinac.net/icon/?url=not-a-url')
  })

  it('空串入参返空串 favicon（不产非法 img src，domain("") 经 new URL("") catch 返 "" falsy → 返 ""）', () => {
    expect(faviconUrl('')).toBe('')
  })

  it('空安全防护核心：undefined 入参经 || "" 归一成空串返 ""，不触发 favicon(undefined) 信第三方服务取 "undefined" 域名', () => {
    // 若未来误删 `|| ''`：favicon(undefined) → domain(undefined) → new URL("undefined") catch 返
    //   "undefined" (truthy) → 拼成 'https://api.xinac.net/icon/?url=undefined' 即对真实第三方服务
    //   请求 udefined 域名图标，是用户可见 + 网络面泄露。本断言直锁空安全防护不漂移。
    expect(faviconUrl(undefined as unknown as string)).toBe('')
  })

  it('null 入参同样经 || "" 归一返空', () => {
    expect(faviconUrl(null as unknown as string)).toBe('')
  })

  it('返回恒为 string', () => {
    expect(typeof faviconUrl('https://example.com')).toBe('string')
    expect(typeof faviconUrl('')).toBe('string')
  })

  it('纯函数：重复调用同入参恒定，无副作用', () => {
    const a = faviconUrl('https://example.com')
    const b = faviconUrl('https://example.com')
    expect(a).toBe(b)
  })
})

describe('groupEditUrl domainName', () => {
  it('合法 https URL 取 hostname 去 www. 前缀', () => {
    expect(domainName('https://www.example.com/path')).toBe('example.com')
  })

  it('无 www 的 hostname 原样返回', () => {
    expect(domainName('https://api.example.com')).toBe('api.example.com')
  })

  it('协议非 http(s) 但合法的 URL 仍取 hostname（new URL 不关协议）', () => {
    expect(domainName('ftp://ftp.example.com')).toBe('ftp.example.com')
  })

  it('非 URL 串经 new URL 抛错 catch 透传原串返 not-a-url（domain catch 不重写）', () => {
    expect(domainName('not-a-url')).toBe('not-a-url')
  })

  it('空串入参返空串（new URL("") catch 返 ""）', () => {
    expect(domainName('')).toBe('')
  })

  it('空安全防护核心：undefined 入参经 || "" 归一成空串返 ""，不令 <span>{{ }} 显示 "undefined" 文本', () => {
    // 若未来误删 `|| ''`：domain(undefined) → new URL("undefined") catch 返原入参 "undefined"
    //   → <span>{{ domainName(bm.url) }} 直接渲染 "undefined" 文本，用户可见退化。
    expect(domainName(undefined as unknown as string)).toBe('')
  })

  it('null 入参同样经 || "" 归一返空', () => {
    expect(domainName(null as unknown as string)).toBe('')
  })

  it('返回恒为 string', () => {
    expect(typeof domainName('https://example.com')).toBe('string')
    expect(typeof domainName('')).toBe('string')
  })

  it('纯函数：重复调用同入参恒定', () => {
    const a = domainName('https://example.com')
    const b = domainName('https://example.com')
    expect(a).toBe(b)
  })
})

// 抽离与 utils 的关系护栏：faviconUrl/domainName 经 `|| ''` 防护后直接信 utils favicon/domain，
// 不重写自身逻辑，故行为与 utils favicon/domain 已测契约一致——此处补的是"调用层空安全防护"
// 这层增量，与 utils.test.ts 已测 favicon/domain 本体互补不冲突。
