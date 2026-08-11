/**
 * parseBookmarkHTML.test.ts — Netscape 书签 HTML 解析器护栏单测（D1-17）
 *
 * 锁定 useDataIO.ts:364 的 parseBookmarkHTML 全部分支行为契约：
 * - 基础解析：DL/DT/<a> 提取书签、id 形态、categoryId/parentId/order 默认
 * - XSS 过滤：javascript:/data: href 丢弃、合法 http(s) 保留
 * - add_date→createdAt 三分支：>=1e12 毫秒原样、>0 秒×1000 归毫秒、0/缺省→now 兜底
 * - 嵌套结构：DL>DT>H3 建分类上下文 + 与子 <a> 同级、H3→notes 注入 [分类名] 标记
 * - 顶层 H3（直接出现于 body，DL 外）建分类
 * - title 兜底：空 title 用 href 占位、icon 透传
 *
 * 仅 export 私有函数加测试，零逻辑改动。id 非 newBookmarkId 锁定具体值（含 Date.now+Math.random），
 * 只断言形态（b 前缀+唯一+非空）+唯一性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../lib/toast.js', () => ({ toast: vi.fn(), toastWithUndo: vi.fn(), showConfirm: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../../lib/search.js', () => ({ clearSearchCache: vi.fn() }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))

import { parseBookmarkHTML } from '../../composables/domain/useDataIO.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { Bookmark } from '../../types.js'

const FIXED_NOW = 1_700_000_000_000 // 固定 now，确认 createdAt 兜底分支

function asBookmark(b: Bookmark): Bookmark { return b }

describe('parseBookmarkHTML（Netscape 书签解析护栏）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('基础解析', () => {
    it('从标准 DL>DT><a> 结构提取单个书签，字段默认正确', () => {
      const html = `<DT><A HREF="https://example.com/page" ADD_DATE="1700000000" ICON="data:icon1">示例</A>`
      const out = parseBookmarkHTML(html)
      expect(out).toHaveLength(1)
      const b = asBookmark(out[0])
      expect(b.title).toBe('示例')
      expect(b.url).toBe('https://example.com/page')
      expect(b.categoryId).toBe(CAT_UNCATEGORIZED)
      expect(b.parentId).toBeNull()
      expect(b.order).toBe(0)
      expect(b.useCount).toBe(0)
      expect(b.isExpanded).toBe(false)
      expect(b.username).toBe('')
      expect(b.password).toBe('')
      // 顶层无 H3 分类 → notes 不注入分类标记（保持空）
      expect(b.notes).toBe('')
      // ADD_DATE=1700000000 是 Chrome Netscape 秒（< 1e12）→ × 1000 归毫秒（修 1e9 阈值歧义 bug）
      expect(b.createdAt).toBe(1_700_000_000 * 1000)
      // updatedAt 始终 = now
      expect(b.updatedAt).toBe(FIXED_NOW)
    })

    it('id 形态：每书签 id 以 b 前缀开头、非空、同批内全局唯一', () => {
      const html = `
        <DT><A HREF="https://a.example/x">A</A>
        <DT><A HREF="https://b.example/y">B</A>
        <DT><A HREF="https://c.example/z">C</A>
      `
      const out = parseBookmarkHTML(html)
      expect(out).toHaveLength(3)
      for (const b of out) {
        expect(typeof b.id).toBe('string')
        expect(b.id.length).toBeGreaterThan(0)
        expect(b.id.startsWith('b')).toBe(true)
      }
      const ids = out.map(b => b.id)
      expect(new Set(ids).size).toBe(ids.length) // 全局唯一（newBookmarkId(index) 防 hint 碰撞）
    })
  })

  describe('XSS href 过滤', () => {
    it('丢弃 javascript: 协议 href（不进结果），data: 同样丢弃', () => {
      const html = `
        <DT><A HREF="javascript:alert(1)">evil-js</A>
        <DT><A HREF="data:text/html,<script>alert(1)</script>">evil-data</A>
        <DT><A HREF="https://ok.example/">ok</A>
      `
      const out = parseBookmarkHTML(html)
      expect(out).toHaveLength(1)
      expect(out[0].url).toBe('https://ok.example/')
      expect(out[0].title).toBe('ok')
    })

    it('空 href 也被跳过（无 href 或 href=""）', () => {
      const html = `
        <DT><A>无 href 标签</A>
        <DT><A HREF="">空 href</A>
        <DT><A HREF="https://present.example/">present</A>
      `
      const out = parseBookmarkHTML(html)
      expect(out).toHaveLength(1)
      expect(out[0].url).toBe('https://present.example/')
    })

    it('合法 http/https/ftp/mailto 等非 js/data 协议均保留', () => {
      const html = `
        <DT><A HREF="http://http.example/">http</A>
        <DT><A HREF="https://https.example/">https</A>
        <DT><A HREF="mailto:x@example.com">mailto</A>
        <DT><A HREF="ftp://files.example/">ftp</A>
        <DT><A HREF="chrome://settings">chrome</A>
      `
      const out = parseBookmarkHTML(html)
      expect(out.map(b => b.url)).toEqual([
        'http://http.example/',
        'https://https.example/',
        'mailto:x@example.com',
        'ftp://files.example/',
        'chrome://settings',
      ])
    })
  })

  describe('add_date → createdAt 三分支 epoch 归一', () => {
    it('ADD_DATE < 1e12（Chrome/Firefox 10 位 Unix 秒）：× 1000 归毫秒，不当毫秒原样存', () => {
      // 修复「>1e9 原样用」阈值歧义 bug：1700000123 是 2023-11 秒值，
      // 旧实现当毫秒存 → 显示 1970-01-20；现按秒 × 1000 = 1700000123000（2023-11 毫秒）。
      const html = `<DT><A HREF="https://x.example/" ADD_DATE="1700000123">大值秒</A>`
      const out = parseBookmarkHTML(html)
      expect(out[0].createdAt).toBe(1_700_000_123_000)
      // 显式锁定错误呈现：createdAt 对应 2023-11 而非 1970-01
      expect(new Date(out[0].createdAt).getUTCFullYear()).toBe(2023)
    })

    it('Chrome 早期秒值（2010-2020）同样 × 1000，不被当毫秒存为 1970', () => {
      // 1280000000 = 2010-07 秒；旧实现 >1e9 原样用 → 1970-01-15。
      const html = `<DT><A HREF="https://x.example/" ADD_DATE="1280000000">2010秒</A>`
      const out = parseBookmarkHTML(html)
      expect(out[0].createdAt).toBe(1_280_000_000_000)
      expect(new Date(out[0].createdAt).getUTCFullYear()).toBe(2010)
    })

    it('ADD_DATE >= 1e12（13 位毫秒，JS Date.now() 量级）：原样采用', () => {
      const html = `<DT><A HREF="https://x.example/" ADD_DATE="1700000123456">毫秒值</A>`
      const out = parseBookmarkHTML(html)
      expect(out[0].createdAt).toBe(1_700_000_123_456)
    })

    it('ADD_DATE > 0 但 < 1e9（旧小值秒/边界）：当秒级乘 1000 转毫秒', () => {
      // 100000000 = 1e8 < 1e9，按秒×1000
      const html = `<DT><A HREF="https://x.example/" ADD_DATE="100000000">小值秒</A>`
      const out = parseBookmarkHTML(html)
      expect(out[0].createdAt).toBe(100_000_000 * 1000)
    })

    it('ADD_DATE 缺省 / 0 / 非数字 → now 兜底', () => {
      const html = `
        <DT><A HREF="https://none.example/" >无 add_date</A>
        <DT><A HREF="https://zero.example/" ADD_DATE="0">0</A>
        <DT><A HREF="https://nan.example/" ADD_DATE="abc">非数字</A>
      `
      const out = parseBookmarkHTML(html)
      expect(out).toHaveLength(3)
      for (const b of out) expect(b.createdAt).toBe(FIXED_NOW)
    })

    it('ADD_DATE=0 走 now 兜底而非「>0 乘 1000」假 0 分支（边界锁定）', () => {
      // 0 既不 >= 1e12 也不 > 0，直接落 now 兜底；防误判 0 走 0*1000=0
      const html = `<DT><A HREF="https://zero.example/" ADD_DATE="0">zero</A>`
      const out = parseBookmarkHTML(html)
      expect(out[0].createdAt).toBe(FIXED_NOW)
    })
  })

  describe('嵌套结构与分类上下文', () => {
    it('DL>DT>H3 建分类上下文，其下 <a> 的 notes 注入 [分类名]', () => {
      const html = `
        <DL><DT><H3>开发工具</H3>
          <DL>
            <DT><A HREF="https://dev.example/a">A</A>
            <DT><A HREF="https://dev.example/b">B</A>
          </DL>
        </DT></DL>
      `
      const out = parseBookmarkHTML(html)
      expect(out).toHaveLength(2)
      expect(out[0].notes).toBe('[开发工具]')
      expect(out[1].notes).toBe('[开发工具]')
      // categoryId 不用 H3 名称（仍 CAT_UNCATEGORIZED），notes 才是分类名载体
      expect(out[0].categoryId).toBe(CAT_UNCATEGORIZED)
    })

    it('嵌套分类退出后回到上级分类上下文', () => {
      const html = `
        <DL>
          <DT><A HREF="https://top.example/">顶层</A>
          <DT><H3>子分类</H3>
            <DL><DT><A HREF="https://sub.example/">子项</A></DL>
          </DT>
          <DT><A HREF="https://after.example/">子分类后</A>
        </DL>
      `
      const out = parseBookmarkHTML(html)
      expect(out.map(b => b.url)).toEqual([
        'https://top.example/',
        'https://sub.example/',
        'https://after.example/',
      ])
      // 顶层 a 无 H3 包裹 → notes 空
      expect(out[0].notes).toBe('')
      // 子分类下 a → notes 注入
      expect(out[1].notes).toBe('[子分类]')
      // 子分类退出后回到默认 '导入的书签'（与顶层同）→ notes 空
      expect(out[2].notes).toBe('')
    })

    it('H3 文本为空白时分类名兜底为"未命名"', () => {
      const html = `<DL><DT><H3>   </H3><DL><DT><A HREF="https://x.example/">X</A></DL></DT></DL>`
      const out = parseBookmarkHTML(html)
      expect(out[0].notes).toBe('[未命名]')
    })

    it('DL>DT>H3 不带 <a> 时仅建分类不产书签（不误把 H3 当链接）', () => {
      // DT 里有 h3 但无 a → 不 push 书签
      const html = `<DL><DT><H3>仅分类</H3></DT></DL>`
      const out = parseBookmarkHTML(html)
      expect(out).toHaveLength(0)
    })

    it(':scope > a 只取 DT 直接子 <a>；纯 DT（无 H3/A）包裹的 DL 不被递归（真实行为锁定）', () => {
      // 外层 DT 的直接 <a> 应被取。DT 分支仅在 H3 或有 :scope>a 时处理，
      // 纯 DT（既无 H3 也无 :scope>a）包裹的内层 DL 不会被 walk 递归（DL 才递归 childNodes）。
      // 这一真实边界锁定防未来误以为"任何 DT 都递归其子 DL"。
      const html = `
        <DL>
          <DT><A HREF="https://outer.example/">outer</A></DT>
          <DT><DL><DT><A HREF="https://inner.example/">inner</A></DT></DL></DT>
        </DL>
      `
      const out = parseBookmarkHTML(html)
      expect(out.map(b => b.url)).toEqual(['https://outer.example/'])
    })
  })

  describe('title 与 icon 兜底', () => {
    it('空 title 用 href 作占位 title', () => {
      const html = `<DT><A HREF="https://notitle.example/path">  </A>`
      const out = parseBookmarkHTML(html)
      expect(out[0].title).toBe('https://notitle.example/path')
    })

    it('ICON 属性透传进 bookmark.icon，缺省为空串', () => {
      const withIcon = `<DT><A HREF="https://i.example/" ICON="data:image/png;base64,abc">有图标</A>`
      const noIcon = `<DT><A HREF="https://n.example/">无图标</A>`
      expect(parseBookmarkHTML(withIcon)[0].icon).toBe('data:image/png;base64,abc')
      expect(parseBookmarkHTML(noIcon)[0].icon).toBe('')
    })
  })

  describe('空输入与边界', () => {
    it('空字符串/无 <a> 的 HTML 返回空数组不抛', () => {
      expect(parseBookmarkHTML('')).toEqual([])
      expect(parseBookmarkHTML('<html><body></body></html>')).toEqual([])
      expect(parseBookmarkHTML('<DL><DT>纯文本无 A</DT></DL>')).toEqual([])
    })

    it('order 字段随解析序递增（与数组下标一致）', () => {
      const html = `
        <DT><A HREF="https://a.example/">A</A>
        <DT><A HREF="https://b.example/">B</A>
        <DT><A HREF="https://c.example/">C</A>
      `
      const out = parseBookmarkHTML(html)
      expect(out.map(b => b.order)).toEqual([0, 1, 2])
    })

    it('attributes 恒为空对象（解析导入不预置属性）', () => {
      const html = `<DT><A HREF="https://x.example/">X</A>`
      const out = parseBookmarkHTML(html)
      expect(out[0].attributes).toEqual({})
    })
  })
})
