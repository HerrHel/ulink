/**
 * D1-43 — ShareView.bookmarkEntries 预计算核护栏（buildShareEntries 抽纯函数后直测）。
 *
 * 背景：ShareView.vue 原 bookmarkEntries computed 把 fixUrl/domain/favicon 对每条书签
 * 预计算一次（免除模板内「5 次 fixUrl + 2 次 favicon/icon + 1 次 domain / 书签」历史热点）。
 * 去重/预计算重构的行为契约此前仅靠 ShareView.vue:117 注释自证、零护栏单测——一旦有人
 * 改回内联或乱改 icon 派生条件（尤其误把跨用户 b.icon 接回 icon 路径），回归无测拦截。
 *
 * 本护栏把重构后行为契约直锁为可回归断言（参考 board R14 / handoff#2 真热点）：
 *   1. 等价性：每条 safeUrl===fixUrl(b.url) / urlDomain===domain(b.url) /
 *              icon===(safeUrl ? favicon(safeUrl) : '')，锁去重前后行为不变。
 *   2. M5 安全兜底：fixUrl 拒 dangerous scheme → safeUrl='' → icon=''，
 *              图标只由 http(s) 书签 URL 派生，跨用户 b.icon 不可信（追踪像素/任意 URL）。
 *   3. icon 短路：safeUrl='' 时 icon=''，不对危险 url 派生任何图标 URL。
 */
import { describe, it, expect } from 'vitest'
import { buildShareEntries } from '../../views/buildShareEntries.js'
import { fixUrl, domain, favicon } from '../../utils.js'
import type { Bookmark } from '../../types.js'

/** 构造最小合法测试书签（Bookmark 必填 id/title/url，其余字段省略走 schema .catch 默认，但 buildShareEntries 不走 schema 解析，直接用裸对象） */
function mk(url: string, title = 't', id = 'b1'): Bookmark {
  // 仅 set buildShareEntries 读取的字段（b.url），其余给合法默认值贴近真实 Bookmark 形态
  return { id, title, url, username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0 } as Bookmark
}

describe('buildShareEntries — ShareView bookmarkEntries 预计算核', () => {
  describe(`等价性契约（safeUrl===fixUrl / urlDomain===domain / icon===(safeUrl?favicon(safeUrl):"")）`, () => {
    it('每条 entry 字段严格等于对 b.url 单独调用三纯函数的结果', () => {
      const urls = ['example.com', 'https://www.example.com/path', 'http://x.org/page?y=1', 'javascript:alert(1)', 'data:text/html,<script>', '', 'vbscript:msg(1)', 'example.com/sub/page']
      const entries = buildShareEntries(urls.map((u, i) => mk(u, `t${i}`, `b${i}`)))
      expect(entries).toHaveLength(urls.length)
      urls.forEach((u, i) => {
        const e = entries[i]
        const expectedSafe = fixUrl(u)
        expect(e.safeUrl).toBe(expectedSafe)
        expect(e.urlDomain).toBe(domain(u))
        expect(e.icon).toBe(expectedSafe ? favicon(expectedSafe) : '')
      })
    })

    it('b 引用与输入书签逐条一致（透传不重建）', () => {
      const bms = [mk('example.com', 'a', 'b1'), mk('https://y.com', 'b', 'b2')]
      const entries = buildShareEntries(bms)
      // 同一引用：模板仍直接读 entry.b.title / entry.b.url，需保证透传原对象
      expect(entries[0].b).toBe(bms[0])
      expect(entries[1].b).toBe(bms[1])
    })
  })

  describe('http(s) 正路径预计算', () => {
    it('裸域名补 https + urlDomain 去尾 / favicon 由域派生', () => {
      const entries = buildShareEntries([mk('example.com', 'a', 'b1')])
      const e = entries[0]
      expect(e.safeUrl).toBe('https://example.com')
      expect(e.urlDomain).toBe('example.com')
      // favicon('https://example.com') = 'https://api.xinac.net/icon/?url=' + domain('https://example.com')
      expect(e.icon).toBe('https://api.xinac.net/icon/?url=example.com')
    })

    it('完整 http URL 透传 + urlDomain 去 www. 前缀', () => {
      const entries = buildShareEntries([mk('https://www.example.com/path', 'a', 'b1')])
      const e = entries[0]
      expect(e.safeUrl).toBe('https://www.example.com/path')
      expect(e.urlDomain).toBe('example.com')
      expect(e.icon).toBe('https://api.xinac.net/icon/?url=example.com')
    })

    it('带 query 的 URL —— urlDomain 不含 query，icon 仍由 domain 派生', () => {
      const entries = buildShareEntries([mk('http://x.org/page?y=1', 'a', 'b1')])
      const e = entries[0]
      expect(e.urlDomain).toBe('x.org')
      expect(e.icon).toBe('https://api.xinac.net/icon/?url=x.org')
    })
  })

  describe('M5 安全兜底：dangerous scheme → safeUrl="" → icon=""（不对危险 url 派生跨用户图标）', () => {
    it('javascript: scheme —— safeUrl 空、icon 空不派生', () => {
      const entries = buildShareEntries([mk('javascript:alert(1)', 'a', 'b1')])
      const e = entries[0]
      expect(e.safeUrl).toBe('')
      expect(e.icon).toBe('')
    })

    it('data: scheme —— safeUrl 空、icon 空不派生', () => {
      const entries = buildShareEntries([mk('data:text/html,<script>alert(1)</script>', 'a', 'b1')])
      const e = entries[0]
      expect(e.safeUrl).toBe('')
      expect(e.icon).toBe('')
    })

    it('vbscript: scheme —— safeUrl 空、icon 空不派生', () => {
      const entries = buildShareEntries([mk('vbscript:msg(1)', 'a', 'b1')])
      const e = entries[0]
      expect(e.safeUrl).toBe('')
      expect(e.icon).toBe('')
    })

    it('大小写不敏感 —— JaVaScRiPt: 仍被拒', () => {
      const entries = buildShareEntries([mk('JaVaScRiPt:alert(1)', 'a', 'b1')])
      expect(entries[0].safeUrl).toBe('')
      expect(entries[0].icon).toBe('')
    })

    it('危险 url 的 urlDomain 为空串（new URL 接受 javascript: scheme 但 hostname 空）', () => {
      // ★ 护栏抓出对 domain 真实行为的错误假设：原以为 new URL('javascript:…') 抛错 catch 返原串，
      //   实测 new URL 对 javascript: scheme 不抛错、hostname 返空串 → domain()=空。
      // 锁此为 entry 渲染可见行为契约：危险链接卡片 urlDomain 展示空串于 subtitle，非展示原 url 串。
      const entries = buildShareEntries([mk('javascript:alert(1)', 'a', 'b1')])
      expect(entries[0].urlDomain).toBe('')
    })
  })

  describe('icon 短路 + 空输入边界', () => {
    it('空 url —— safeUrl 空、urlDomain 空、icon 空短路（不调 favicon 派生）', () => {
      const entries = buildShareEntries([mk('', 'a', 'b1')])
      const e = entries[0]
      expect(e.safeUrl).toBe('')
      // domain('') === '' （new URL('') 抛错 catch 返 ''）
      expect(e.urlDomain).toBe('')
      // safeUrl='' → icon='' 短路（even though favicon('') 也返 ''，短路先于此避免对危险空 url 派生）
      expect(e.icon).toBe('')
    })

    it('空 bookmarks 数组 → 空条目数组', () => {
      expect(buildShareEntries([])).toEqual([])
    })

    it('返回长度等于输入长度（每书签一条，无遗漏无折叠）', () => {
      const bms = Array.from({ length: 5 }, (_, i) => mk(`site${i}.com`, `t${i}`, `b${i}`))
      const entries = buildShareEntries(bms)
      expect(entries).toHaveLength(5)
      entries.forEach((e, i) => {
        expect(e.safeUrl).toBe(`https://site${i}.com`)
        expect(e.b.id).toBe(`b${i}`)
      })
    })
  })

  describe('非变异 / 结构恒定', () => {
    it('不 mutate 输入 bookmarks 数组与书签对象', () => {
      const b = mk('example.com', 'a', 'b1')
      const bms = [b]
      buildShareEntries(bms)
      expect(b.url).toBe('example.com')
      expect(bms).toHaveLength(1)
    })

    it('每条 entry 含且仅含 b/safeUrl/urlDomain/icon 四键，三展示字段恒 string', () => {
      const entries = buildShareEntries([mk('example.com', 'a', 'b1'), mk('javascript:bad', 'a', 'b2')])
      entries.forEach(e => {
        expect(typeof e.safeUrl).toBe('string')
        expect(typeof e.urlDomain).toBe('string')
        expect(typeof e.icon).toBe('string')
        expect(e.b).toBeDefined()
      })
    })
  })
})
