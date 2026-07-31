import { describe, it, expect } from 'vitest'
import { faviconUrl, domainName } from '../../components/modals/groupEditUrl.js'
import { favicon, domain } from '../../utils.js'

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

  it('空安全防护核心：undefined 入参经 || "" 归一成空串返 ""（与源模块顶部注释 catch-透传链一致）', () => {
    // 真实链路（经 r8-d1-52 + r8-d1-53 两轮 node 实测确证，与 groupEditUrl.ts 顶部注释一致）：
    //   若未来误删 `|| ''`：favicon(undefined) → domain(undefined) → new URL(undefined) 抛错被 catch
    //   透传入参 `undefined`（falsy，非字符串 "undefined"）→ favicon 内 `dm ? '' : ''` 走空 → 仍返 ''。
    //   即 faviconUrl 侧 `|| ''` 是「冗余但无害的双保险」——底层 favicon 的 `dm ?: ''` 已对 falsy 兜底，
    //   删了 `|| ''` 对 undefined/null 入参仍返 '' 不退化（对照下方 it「删防护仍等价」断言钉死）。
    //   故此断言锁的是「undefined 经 `|| ''` 归一返空串」行为契约本身，非 faviconUrl 侧独有防护——
    //   domainName 侧 `|| ''` 才是真正兜底（见 domainName describe 同款 it 旁的反向退化断言）。
    expect(faviconUrl(undefined as unknown as string)).toBe('')
  })

  it('faviconUrl 侧 || "" 冗余双保险诚实诊断：删防护直调 favicon(undefined) 与有防护输出相等', () => {
    // 守则诚实化（r8-d1-53 候选）：原 it:5 注释曾假设「删 `|| ''` 会拼成 `?url=undefined` 第三方请求」
    // 是 WHATWG 错误假设——实测 `new URL(undefined)` 抛错而非把 undefined 当 "undefined" 串，故
    // domain(undefined) catch 透传 `undefined`(falsy) → favicon `dm ?: ''` 返 '' 仍空，不拼 `?url=`。
    // 本断言用「有防护 faviconUrl(undefined)」vs「删防护直调 favicon(undefined)」两表达式输出相等，
    // 直锁「faviconUrl 侧 `|| ''` 冗余无害」这一真实隐特性，防未来误信 it:5 旧注释以为 faviconUrl
    // 防护有效而放松 domainName 侧（domainName 侧才是真退化面）。
    const withGuard = faviconUrl(undefined as unknown as string)
    const withoutGuard = favicon(undefined as unknown as string)
    expect(withGuard).toBe(withoutGuard)
    expect(withGuard).toBe('')
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

  it('空安全防护核心：undefined 入参经 || "" 归一成空串返 ""，不令 <span>{{ }} 显示空/非 string（与源模块注释一致）', () => {
    // 真实链路（经 r8-d1-52 + r8-d1-53 两轮 node 实测确证，与 groupEditUrl.ts 顶部注释一致）：
    //   若未来误删 `|| ''`：domainName(undefined) → domain(undefined) → new URL(undefined) 抛错被 catch
    //   透传入参 `undefined`（falsy，非字符串 "undefined"）→ domainName 直接返 `undefined` 进
    //   `<span>{{ undefined }}` 渲染空、`<img :src="undefined">` 非法 src（真实用户可见退化）。
    //   与 faviconUrl 侧不同——domain 无 `dm ?: ''` 兜底，删 `|| ''` 后 undefined 透传不归一成 string。
    //   故 domainName 侧 `|| ''` 是「真正兜底」非冗余，本断言锁其不可漂移（见下方反向退化对照断言）。
    expect(domainName(undefined as unknown as string)).toBe('')
    expect(typeof domainName(undefined as unknown as string)).toBe('string')
  })

  it('domainName 侧 || "" 真有效反向对照：删防护直调 domain(undefined) 返 undefined 真实退化（与有防护 "" 不等）', () => {
    // 守则诚实化（r8-d1-53 候选）：旧 it 注释曾假设「删 `|| ''` → <span> 渲染 "undefined" 文本」同属
    // WHATWG 错误假设——实测 domain(undefined) catch 透传 `undefined`（非字符串 "undefined"），进
    // `<span>{{ undefined }}` 实际渲染**空**而非 "undefined" 字面、`<img :src>` 拿到 undefined 非法。
    // 但真实退化点是「返回值从 string '' 退化为 undefined（非 string 类型）」破坏 string 返回契约 +
    // 非 string 透传下游的非法 src/空 span，非渲染 "undefined" 字面。本断言用「有防护 domainName(undefined)」
    // vs「删防护直调 domain(undefined)」两表达式输出**不等**直锁「domainName 侧 `|| ''` 真有效」，
    // 与上方 faviconUrl 「删防护仍等价」对照断言对称，钉死两侧防护真实作用域差异。
    const withGuard = domainName(undefined as unknown as string)
    const withoutGuard = domain(undefined as unknown as string)
    expect(withGuard).toBe('')
    expect(withoutGuard).toBe(undefined)
    expect(withGuard).not.toBe(withoutGuard)
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
