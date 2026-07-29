/**
 * parseCSV.test.ts — CSV 书签导入解析器护栏单测（D1-18）
 *
 * 锁定 useDataIO.ts:451 的 parseCSV 全部分支行为契约（同 D1-17 parseBookmarkHTML 口径，
 * 仅 export 私有函数加测试零逻辑改动）：
 * - RFC 引号状态机：字段内逗号不分裂、""转义一个"、跨引号换行字段、引号紧贴内容
 * - 行终止三态：\r\n / \r / \n 各自正确切行；空行跳过
 * - 表头规范化：toLowerCase + 剔非字母数字、别名表 title/name、url/link/href、tags/tag/labels、notes/description/excerpt
 * - 首列判定：urlIdx<0 返空、lines<2 返空
 * - 行过滤：url 空或不含 . 跳过、title 缺省用 url、title 空跳过
 * - tags 分隔：; | , 三分隔 split + tag_<规范>（空格→_、小写）attribute 键
 * - 字段默认：order=r-1、createdAt/updatedAt=now、categoryId=CAT_UNCATEGORIZED、username/password/icon 空
 *
 * id 走 newBookmarkId(r) 含 Date.now+Math.random，只断言唯一+非空形态。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../lib/toast.js', () => ({ toast: vi.fn(), toastWithUndo: vi.fn(), showConfirm: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../../lib/search.js', () => ({ clearSearchCache: vi.fn() }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))

import { parseCSV } from '../../composables/domain/useDataIO.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { Bookmark } from '../../types.js'

const FIXED_NOW = 1_700_000_000_000 // 固定 now，锁定 createdAt/updatedAt 兜底

describe('parseCSV（CSV 书签解析护栏）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('RFC 引号状态机', () => {
    it('字段内逗号被引号包住不分裂', () => {
      const csv = 'title,url\n"Hello, World","https://example.com"'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].title).toBe('Hello, World')
      expect(out[0].url).toBe('https://example.com')
    })

    it('"" 转义为一个字面双引号', () => {
      const csv = 'title,url\n"He said ""hi""","https://example.com"'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].title).toBe('He said "hi"')
    })

    it('跨行带换行的引号字段保留内部换行', () => {
      const csv = 'title,url\n"line1\nline2","https://example.com"'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].title).toBe('line1\nline2')
    })

    it('引号紧贴内容（quoted 前后混入普通字段）', () => {
      const csv = 'title,url\n"quoted",plain.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].title).toBe('quoted')
      expect(out[0].url).toBe('plain.com')
    })
  })

  describe('行终止三态 / 空行', () => {
    it('\\r\\n 换行正确切两行书签', () => {
      const csv = 'title,url\r\na,a.com\r\nb,b.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(2)
      expect(out[0].title).toBe('a')
      expect(out[1].title).toBe('b')
    })

    it('单个 \\r 也作为换行', () => {
      const csv = 'title,url\ra,a.com\rb,b.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(2)
    })

    it('空行（全字段 trim 后皆空）被跳过不进 lines', () => {
      // 第一数据行逗号两边全空白 → trim 后空，row.some(f=>f.length>0) 为 false → 跳过
      const csv = 'title,url\n ,\nvalid,v.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].url).toBe('v.com')
    })
  })

  describe('表头规范化与别名', () => {
    it('表头大小写无关 + 剔非字母数字（Title→title 命中别名）', () => {
      const csv = 'Title,URL\nt,example.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].title).toBe('t')
    })

    it('表头含空格/标点被剔除非字母数字成合并串——双别名 "Title Name" → "titlename" 不命中任一别名（护栏锁定真实行为）', () => {
      // "Title Name" 经 toLowerCase + replace(/[^a-z0-9]/g,'') → "titlename"，
      // 不等于 "title" 或 "name"，故 titleIdx=-1，title 走 url 兜底
      const csv = 'Title Name,URL\nt,example.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].title).toBe('example.com')
    })

    it('url 列别名 link 命中', () => {
      const csv = 'title,link\nt,example.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].url).toBe('example.com')
    })

    it('url 列别名 href 命中', () => {
      const csv = 'title,href\nt,example.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].url).toBe('example.com')
    })

    it('title 列别名 name 命中', () => {
      const csv = 'name,url\nnt,example.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].title).toBe('nt')
    })

    it('tags 列别名 labels 命中并解析为 attributes', () => {
      const csv = 'title,url,labels\nt,example.com,work|reading'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].attributes['tag_work']).toBe(true)
      expect(out[0].attributes['tag_reading']).toBe(true)
    })

    it('notes 列别名 description 命中', () => {
      const csv = 'title,url,description\nt,example.com,some notes'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].notes).toBe('some notes')
    })

    it('首列重复别名取首个出现 idx（idx[kind]<0 守卫）', () => {
      // url 与 link 两列，第一个 url 列 idx 为 0 胜出
      const csv = 'url,link\ngood.com,bad.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].url).toBe('good.com')
    })
  })

  describe('空集守卫', () => {
    it('无 url 列（urlIdx<0）返空数组', () => {
      const csv = 'title,name\nt,nt'
      expect(parseCSV(csv)).toEqual([])
    })

    it('只有表头行（lines<2）返空数组', () => {
      const csv = 'title,url'
      expect(parseCSV(csv)).toEqual([])
    })
  })

  describe('行过滤与字段兜底', () => {
    it('url 不含 . 的行被跳过', () => {
      const csv = 'title,url\nt,localhost\nv,good.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].url).toBe('good.com')
    })

    it('url 空行被跳过', () => {
      const csv = 'title,url\n,'
      expect(parseCSV(csv)).toEqual([])
    })

    it('无 title 列时用 url 作 title 兜底', () => {
      const csv = 'url\nexample.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].title).toBe('example.com')
      expect(out[0].url).toBe('example.com')
    })

    it('有 title 列但该行 title 为空时跳过该行（title 空守卫）', () => {
      const csv = 'title,url\n,example.com\nv,good.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].title).toBe('v')
    })

    it('五行数据过滤后 order 仍按数据 r-1（保留 idx 语义，跳过行不重排）', () => {
      // r=1 url 不含 . 被跳过，r=2 合法书签 order=1（r-1）
      const csv = 'title,url\nt,localhost\nv,good.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(1)
      expect(out[0].order).toBe(2 - 1)
    })
  })

  describe('tags 分隔与规范化', () => {
    it('多种分隔符 ; | , 各自正确 split', () => {
      const csv = 'title,url,tags\nt,example.com,a;b|c,a'
      const out = parseCSV(csv)
      expect(out[0].attributes['tag_a']).toBe(true)
      expect(out[0].attributes['tag_b']).toBe(true)
      expect(out[0].attributes['tag_c']).toBe(true)
    })

    it('tag 内多空格折叠为单 _ 并小写', () => {
      const csv = 'title,url,tags\nt,example.com,My   Tag'
      const out = parseCSV(csv)
      expect(out[0].attributes['tag_my_tag']).toBe(true)
    })

    it('tags 含空段（连续分隔/首尾分隔）被 trim 剔除不产空 attribute', () => {
      const csv = 'title,url,tags\nt,example.com,|a||b|'
      const out = parseCSV(csv)
      expect(out[0].attributes['tag_a']).toBe(true)
      expect(out[0].attributes['tag_b']).toBe(true)
      expect(Object.keys(out[0].attributes).length).toBe(2)
    })

    it('无 tags 列时 attributes 为空对象', () => {
      const csv = 'title,url\nt,example.com'
      const out = parseCSV(csv)
      expect(out[0].attributes).toEqual({})
    })
  })

  describe('字段默认与时序', () => {
    it('合成 Bookmark 字段默认正确（categoryId/parentId/username/password/icon/useCount/isExpanded）', () => {
      const csv = 'title,url\nt,example.com'
      const out = parseCSV(csv)
      const b = out[0] as Bookmark
      expect(b.categoryId).toBe(CAT_UNCATEGORIZED)
      expect(b.parentId).toBeNull()
      expect(b.username).toBe('')
      expect(b.password).toBe('')
      expect(b.icon).toBe('')
      expect(b.useCount).toBe(0)
      expect(b.isExpanded).toBe(false)
      // createdAt/updatedAt 均走 now 兜底
      expect(b.createdAt).toBe(FIXED_NOW)
      expect(b.updatedAt).toBe(FIXED_NOW)
    })

    it('id 由 newBookmarkId 生成——唯一且非空字符串', () => {
      const csv = 'title,url\nt1,a.com\nt2,b.com\nt3,c.com'
      const out = parseCSV(csv)
      expect(out).toHaveLength(3)
      const ids = out.map(b => b.id)
      expect(new Set(ids).size).toBe(3)
      for (const id of ids) {
        expect(typeof id).toBe('string')
        expect(id.length).toBeGreaterThan(0)
      }
    })

    it('空输入文本返空数组', () => {
      expect(parseCSV('')).toEqual([])
    })
  })
})
