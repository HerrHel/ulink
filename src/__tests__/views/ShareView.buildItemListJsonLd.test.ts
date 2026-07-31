/**
 * D1-44 — ShareView `_applyShareHead` JSON-LD itemListElement 派洗护栏（buildItemListJsonLd 抽纯函数后直测）。
 *
 * 背景：ShareView.vue 原 `_applyShareHead`（SEO 注入核）内联构造 schema.org ItemList JSON-LD
 * 对象，`itemListElement` 把每条书签映射成 `{ '@type':'ListItem', position, name, url }`，
 * 其中 `url` 经 `fixUrl(b.url)` 派生（M5 二次过滤——把跨用户恶意书签的 javascript:/data:
 * 等危险 scheme url 过滤成空串，防其经 JSON-LD 注入成被搜索引擎收录/展示成可执行跳转链接）。
 * 此前该拼装逻辑随 ShareView.vue 黑盒间接运行，零护栏单测锁定——一旦有人改回内联或误改
 * itemListElement 派洗条件（尤其误把 `fixUrl` 换成 `b.url` 原值直透，绕过 M5 二次过滤），
 * 回归无测拦截，会把跨用户恶意书签 url 经 SEO JSON-LD 静默注入成 schema.org 收录项。
 *
 * 本护栏把抽取后行为契约直锁为可回归断言（参考 d1-43 同口径 / board d1-44 locks record）：
 *   1. itemListElement 派洗：position 从 1 单调递增 / name===b.title / url===fixUrl(b.url)。
 *   2. M5 安全二次过滤：dangerous scheme（javascript:/data:/vbscript:）→ fixUrl 返 '' →
 *      收录项 url 为空串不构成可执行跳转，防跨用户恶意书签经 SEO 注入成可点跳转链接。
 *   3. 顶层结构契约：@context/@type/ItemList 常量 + name 兜底 '分享组' + url===shareUrl
 *      入参透传 + numberOfItems===bms.length + desc 由 notes 派生 / notes 空走兜底文案。
 *   4. 纯函数：入参 bms 不被变异 / 同入参恒定返回 / 结构恒定键序。
 */
import { describe, it, expect } from 'vitest'
import { buildItemListJsonLd } from '../../views/buildItemListJsonLd.js'
import { fixUrl } from '../../utils.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

/** 构造最小合法测试书签（仅 set buildItemListJsonLd 读取的字段 b.url/b.title） */
function mkBook(url: string, title = 't', id = 'b1'): Bookmark {
  return {
    id,
    title,
    url,
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: 'uncategorized',
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 0,
    updatedAt: 0,
  } as Bookmark
}

/** 构造最小合法测试组（仅 set buildItemListJsonLd 读取的 g.name/g.notes 字段） */
function mkGroup(name: string, notes = '', id = 'g1'): SiblingGroup {
  return {
    id,
    name,
    categoryId: 'uncategorized',
    icon: '',
    order: 0,
    isExpanded: false,
    attributes: {},
    bookmarkIds: [],
    notes,
    updatedAt: 0,
    useCount: 0,
    isPublic: true,
  } as SiblingGroup
}

describe('buildItemListJsonLd — ShareView _applyShareHead JSON-LD itemListElement 派洗核', () => {
  describe('itemListElement 派洗契约', () => {
    it('position 从 1 单调递增（i+1）锁定数组序而非 bookmark order', () => {
      const bms = [mkBook('a.com', 'A', 'b1'), mkBook('b.com', 'B', 'b2'), mkBook('c.com', 'C', 'b3')]
      // 故意给乱序 order 确认 position 跟数组序走不跟 order
      bms[0].order = 9
      bms[1].order = 0
      bms[2].order = 5
      const ld = buildItemListJsonLd(mkGroup('g'), bms, 'https://h.co/s/g1')
      expect(ld.itemListElement.map((e) => e.position)).toEqual([1, 2, 3])
    })

    it('每条 name===b.title 原值透传（已是 sanitized 渲染域文本不需再处理）', () => {
      const bms = [mkBook('a.com', '标题A', 'b1'), mkBook('b.com', '标题B', 'b2')]
      const ld = buildItemListJsonLd(mkGroup('g'), bms, 'https://h.co/s/g1')
      expect(ld.itemListElement.map((e) => e.name)).toEqual(['标题A', '标题B'])
    })

    it('每条 url===fixUrl(b.url) 锁去重前后行为不变（http(s) 原值 / 无 scheme 补 https://）', () => {
      const bms = [
        mkBook('https://x.org/p', 't1', 'b1'),
        mkBook('http://y.com', 't2', 'b2'),
        mkBook('example.com', 't3', 'b3'), // 无 scheme → fixUrl 补 https://example.com
      ]
      const ld = buildItemListJsonLd(mkGroup('g'), bms, 'https://h.co/s/g1')
      expect(ld.itemListElement.map((e) => e.url)).toEqual([
        fixUrl('https://x.org/p'),
        fixUrl('http://y.com'),
        fixUrl('example.com'),
      ])
    })
  })

  describe('M5 安全二次过滤（危险 scheme url 经 fixUrl 派生入空，不构成可执行跳转）', () => {
    const dangerous = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msg(1)', 'JaVaScRiPt:alert(1)']

    dangerous.forEach((u) => {
      it(`危险 scheme ${u} → fixUrl 返 '' → JSON-LD 收录项 url 为空串不构成可点恶意 SEO 链接`, () => {
        const ld = buildItemListJsonLd(mkGroup('g'), [mkBook(u, '恶意', 'b1')], 'https://h.co/s/g1')
        expect(fixUrl(u)).toBe('') // 锚定前提：fixUrl 真过滤该 scheme
        expect(ld.itemListElement[0].url).toBe('')
      })
    })

    it('混合正常+危险书签：危险项 url 入空 / 正常项保留，互不影响', () => {
      const bms = [
        mkBook('https://safe.com', 'OK', 'b1'),
        mkBook('javascript:alert(1)', 'Bad', 'b2'),
        mkBook('https://other.com', 'OK2', 'b3'),
      ]
      const ld = buildItemListJsonLd(mkGroup('g'), bms, 'https://h.co/s/g1')
      expect(ld.itemListElement.map((e) => e.url)).toEqual(['https://safe.com', '', 'https://other.com'])
      // name 不受 url 危险与否影响仍透传 b.title
      expect(ld.itemListElement.map((e) => e.name)).toEqual(['OK', 'Bad', 'OK2'])
    })
  })

  describe('顶层结构契约', () => {
    it('@context / @type 常量锁 schema.org ItemList 注入标识', () => {
      const ld = buildItemListJsonLd(mkGroup('g'), [mkBook('https://a.com', 't', 'b1')], 'https://h.co/s/g1')
      expect(ld['@context']).toBe('https://schema.org')
      expect(ld['@type']).toBe('ItemList')
    })

    it('name===g.name 原值 / g.name 空时兜底 "分享组"', () => {
      const withName = buildItemListJsonLd(mkGroup('我的组'), [mkBook('https://a.com', 't', 'b1')], 'https://h.co/s/g1')
      expect(withName.name).toBe('我的组')
      const emptyName = buildItemListJsonLd(mkGroup(''), [mkBook('https://a.com', 't', 'b1')], 'https://h.co/s/g1')
      expect(emptyName.name).toBe('分享组')
    })

    it('url===shareUrl 入参透传（外层 location 副作用入参化绕开）', () => {
      const ld = buildItemListJsonLd(mkGroup('g'), [mkBook('https://a.com', 't', 'b1')], 'https://h.co:8443/base/s/g1#share/g1')
      expect(ld.url).toBe('https://h.co:8443/base/s/g1#share/g1')
    })

    it('numberOfItems===bms.length 锁入参长度', () => {
      const bms = Array.from({ length: 5 }, (_, i) => mkBook(`https://x${i}.com`, `t${i}`, `b${i}`))
      const ld = buildItemListJsonLd(mkGroup('g'), bms, 'https://h.co/s/g1')
      expect(ld.numberOfItems).toBe(5)
    })

    it('desc 由 g.notes 派生：去 HTML 标签 → trim → slice(0,120)，与 _applyShareHead 外层 desc 同形', () => {
      const notes = '<p>这是<b>描述</b>内容</p>'
      const ld = buildItemListJsonLd(mkGroup('g', notes), [mkBook('https://a.com', 't', 'b1')], 'https://h.co/s/g1')
      expect(ld.description).toBe('这是描述内容')
    })

    it('desc notes 纯文本超 120 字符截断到 120', () => {
      const long = '字'.repeat(200)
      const ld = buildItemListJsonLd(mkGroup('g', long), [mkBook('https://a.com', 't', 'b1')], 'https://h.co/s/g1')
      expect(ld.description).toBe('字'.repeat(120))
      expect(ld.description.length).toBe(120)
    })

    it('desc notes 空 / 全空白 → 兜底文案 `${bms.length} 个链接 · 由 LinkVault 公开分享`', () => {
      const a = buildItemListJsonLd(mkGroup('g', ''), [mkBook('https://a.com', 't', 'b1')], 'https://h.co/s/g1')
      expect(a.description).toBe('1 个链接 · 由 LinkVault 公开分享')
      const b = buildItemListJsonLd(mkGroup('g', '   '), [mkBook('https://a.com', 't', 'b1'), mkBook('https://b.com', 't2', 'b2')], 'https://h.co/s/g1')
      // notes '   ' replace 后 '' → trim 后 '' → 真值兜底
      expect(b.description).toBe('2 个链接 · 由 LinkVault 公开分享')
      expect(b.numberOfItems).toBe(2)
    })

    it('itemListElement 每项 @type 常量为 ListItem', () => {
      const bms = [mkBook('https://a.com', 't1', 'b1'), mkBook('https://b.com', 't2', 'b2')]
      const ld = buildItemListJsonLd(mkGroup('g'), bms, 'https://h.co/s/g1')
      expect(ld.itemListElement.map((e) => e['@type'])).toEqual(['ListItem', 'ListItem'])
    })
  })

  describe('纯函数不变量', () => {
    it('入参 bms 不被变异（map 非变异 / 不改 b.url b.title）', () => {
      const bms = [mkBook('https://a.com', '原标题', 'b1')]
      const origUrl = bms[0].url
      const origTitle = bms[0].title
      buildItemListJsonLd(mkGroup('g'), bms, 'https://h.co/s/g1')
      expect(bms[0].url).toBe(origUrl)
      expect(bms[0].title).toBe(origTitle)
    })

    it('同入参恒定返回（确定性，无随机性）', () => {
      const g = mkGroup('g', '<p>x</p>')
      const bms = [mkBook('https://a.com', 't', 'b1')]
      const a = buildItemListJsonLd(g, bms, 'https://h.co/s/g1')
      const b = buildItemListJsonLd(g, bms, 'https://h.co/s/g1')
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })

    it('顶层与 itemListElement 每项结构键序恒定', () => {
      const topKeys = Object.keys(buildItemListJsonLd(mkGroup('g'), [mkBook('https://a.com', 't', 'b1')], 'https://h.co/s/g1'))
      expect(topKeys).toEqual(['@context', '@type', 'name', 'description', 'url', 'numberOfItems', 'itemListElement'])
      const itemKeys = Object.keys(buildItemListJsonLd(mkGroup('g'), [mkBook('https://a.com', 't', 'b1')], 'https://h.co/s/g1').itemListElement[0])
      expect(itemKeys).toEqual(['@type', 'position', 'name', 'url'])
    })

    it('空书签列表：itemListElement=[] / numberOfItems=0 / desc 走兜底 "0 个链接..."', () => {
      const ld = buildItemListJsonLd(mkGroup('g', ''), [], 'https://h.co/s/g1')
      expect(ld.itemListElement).toEqual([])
      expect(ld.numberOfItems).toBe(0)
      expect(ld.description).toBe('0 个链接 · 由 LinkVault 公开分享')
    })
  })

  describe('等价性（与 _applyShareHead 外层 desc 计算同形验证）', () => {
    it('外层 _applyShareHead 与 buildItemListJsonLd 内 desc 计算逐字同形（notesPlain + slice + 兜底）', () => {
      // 复刻 _applyShareHead 外层原 desc 算式（ShareView.vue:192-194）断言等等价
      const g = mkGroup('我的组', '<b>嗨</b>')
      const bms = [mkBook('https://a.com', 't', 'b1')]
      const notesPlain = g.notes ? g.notes.replace(/<[^>]+>/g, '').trim() : ''
      const outerDesc = (notesPlain && notesPlain.slice(0, 120)) || `${bms.length} 个链接 · 由 LinkVault 公开分享`
      const ld = buildItemListJsonLd(g, bms, 'https://h.co/s/g1')
      expect(ld.description).toBe(outerDesc)
    })
  })
})
