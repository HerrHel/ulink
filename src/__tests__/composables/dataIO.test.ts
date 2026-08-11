/**
 * dataIO.test.ts — 数据导入链路回归测试
 *
 * 锁定两个已修复 bug：
 * 1. importFromDataInternal 写组时不过滤 bookmarkIds，被去重/Zod 跳过的书签 id
 *    悬空留在组里（bookmarkMap 查不到 → 组内空卡位，推云后远端也悬空）。
 * 2. parseRaindropJSON 对非 string 的 tags 元素调 .replace 抛 TypeError，被外层
 *    importData catch 吞掉致整批 Raindrop 导入失败、后续合法项全丢。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../../lib/toast.js', () => ({ toast: vi.fn(), toastWithUndo: vi.fn(), showConfirm: vi.fn(() => Promise.resolve(true)) }))

vi.mock('../../lib/search.js', () => ({ clearSearchCache: vi.fn() }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))

import { useDataStore } from '../../stores/data.js'
import { importFromDataInternal, parseRaindropJSON, exportHTML, resolveCsvColumns, detectFormat, _mergeCategories, _mergeAttributes, _mergeBookmarks, _mergeGroups, _attrsToTags } from '../../composables/domain/useDataIO.js'
import { saveFromExtension } from '../../composables/domain/useBookmark.js'
import { __testMarkDataReady } from '../../lib/dataReady.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

describe('exportHTML 使用 utils.esc（含单引号）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('标题中的单/双引号应被转义，避免 Netscape HTML 属性注入', () => {
    const ds = useDataStore()
    ds.addBookmark({
      id: 'bm-esc',
      title: `O'Brien "x"`,
      url: 'https://esc.example/a',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: CAT_UNCATEGORIZED,
      parentId: null,
      order: 0,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1,
      updatedAt: 1,
    } as any)

    const click = vi.fn()
    let captured: Blob | null = null
    const createObjectURL = vi.fn((blob: Blob) => {
      captured = blob
      return 'blob:mock'
    })
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'a') (el as HTMLAnchorElement).click = click
      return el
    })

    exportHTML()
    expect(createObjectURL).toHaveBeenCalled()
    expect(captured).toBeTruthy()
    return captured!.text().then((html) => {
      expect(html).toContain('&#39;')
      expect(html).toContain('&quot;')
      expect(html).not.toMatch(/>O'Brien "x"</)
    })
  })
})

describe('importFromDataInternal 组 bookmarkIds 悬空过滤', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('组 bookmarkIds 应过滤掉未存活的书签 id（被去重跳过 / Zod 失败）', () => {
    const ds = useDataStore()
    // 本地已有同 URL 书签，导入源的 dupBookmark 应被去重跳过不入库
    ds.addBookmark({ id: 'localExist', title: '本地', url: 'https://dup.example', username: '', password: '', notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)

    importFromDataInternal({
      categories: [],
      bookmarks: [
        // 正常入库
        { id: 'goodBm', title: '好书签', url: 'https://good.example', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0 } as any,
        // URL 与 localExist 重复 → 去重跳过（不入库），但其 id 仍出现在组的 bookmarkIds
        { id: 'dupBookmark', title: '重复', url: 'https://dup.example', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 1 } as any,
        // 缺 url → 245 行 continue 跳过，不入库，但仍被组引用
        { id: 'noUrlBm', title: '无URL书签' } as any,
      ],
      siblingGroups: [
        // 组 bookmarkIds 引用上述三种（goodBm 入库、其它两种悬空）
        { id: 'g1', name: '测试组', categoryId: CAT_UNCATEGORIZED, bookmarkIds: ['goodBm', 'dupBookmark', 'noUrlBm'], icon: '', order: 0, isExpanded: false, attributes: {}, notes: '', updatedAt: 1, useCount: 0 } as any,
      ],
      customAttributes: [],
    }, 'test')

    const g = ds.groupMap['g1']
    expect(g).toBeTruthy()
    // 关键：组只保留实际入库的 goodBm，悬空的 dupBookmark / noUrlBm 被过滤
    expect(g.bookmarkIds).toEqual(['goodBm'])
    // 每个留存 id 都能查到 bookmarkMap（不悬空）
    for (const id of g.bookmarkIds) {
      expect(ds.bookmarkMap[id]).toBeTruthy()
    }
  })
})

describe('parseRaindropJSON 坏 tags 防御', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('tags 含非 string 元素（number/对象）时不抛错，其它合法项正常导入', () => {
    const data = {
      items: [
        // 第一条 tags 含 number 和对象（坏数据）
        { title: '坏 tags 项', link: 'https://bad.example', tags: [123, { _id: 'x' }, 'normal-tag'] },
        // 第二条正常
        { title: '正常项', link: 'https://ok.example', tags: ['dev', 'tool'] },
      ],
    }
    // 旧实现：第一条 .map(t => t.replace) 遇 123 抛 TypeError → 整批失败
    expect(() => parseRaindropJSON(data)).not.toThrow()
    const result = parseRaindropJSON(data)
    expect(result).toHaveLength(2)
    // 第一条只保留 string tag 'normal-tag'（非 string 元素被过滤）
    expect(result[0].attributes['tag_normal-tag']).toBe(true)
    expect(Object.keys(result[0].attributes)).toHaveLength(1)
    // 第二条正常
    expect(result[1].attributes['tag_dev']).toBe(true)
    expect(result[1].attributes['tag_tool']).toBe(true)
  })

  it('tags 非数组时 attributes 为空对象，不抛错', () => {
    const data = { items: [{ title: 'T', link: 'https://x.example', tags: 'not-an-array' }] }
    expect(() => parseRaindropJSON(data)).not.toThrow()
    expect(parseRaindropJSON(data)[0].attributes).toEqual({})
  })
})

describe('resolveCsvColumns 表头列定位', () => {
  it('识别标准列名 title/url/tags/notes', () => {
    const r = resolveCsvColumns(['title', 'url', 'tags', 'notes'])
    expect(r).toEqual({ titleIdx: 0, urlIdx: 1, tagsIdx: 2, notesIdx: 3 })
  })

  it('识别各类第一个别名', () => {
    expect(resolveCsvColumns(['name', 'link', 'labels', 'excerpt'])).toEqual({ titleIdx: 0, urlIdx: 1, tagsIdx: 2, notesIdx: 3 })
    expect(resolveCsvColumns(['href', 'tag', 'description'])).toEqual({ titleIdx: -1, urlIdx: 0, tagsIdx: 1, notesIdx: 2 })
  })

  it('缺失的字段下标为 -1', () => {
    expect(resolveCsvColumns(['url'])).toEqual({ titleIdx: -1, urlIdx: 0, tagsIdx: -1, notesIdx: -1 })
  })

  it('未识别的列名被忽略，不会污染已定位下标', () => {
    const r = resolveCsvColumns(['foo', 'title', 'bar', 'url'])
    expect(r.titleIdx).toBe(1)
    expect(r.urlIdx).toBe(3)
    expect(r.tagsIdx).toBe(-1)
  })

  it('同类别重复列名只记录首次出现的下标', () => {
    // 第二个 url 别名 href 不覆盖已定位的 url 下标 1
    expect(resolveCsvColumns(['title', 'url', 'href'])).toEqual({ titleIdx: 0, urlIdx: 1, tagsIdx: -1, notesIdx: -1 })
  })
})

describe('saveFromExtension / importFromDataInternal 新建 order 唯一性', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    __testMarkDataReady()
  })

  it('saveFromExtension 用「现存最大 order+1」,永久删后不与现存项撞 order', () => {
    const ds = useDataStore()
    // 模拟「永久删最后一项」后的状态：现存 order=[5,7]，末尾那条 order=9 已被物理移除
    // 旧实现 order=ds.bookmarks.length=2 → 与现存 order=5 之外可能撞；max+1=8 唯一
    ds.addBookmark({ id: 'b1', title: 'A', url: 'https://a.example', username: '', password: '', notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 5, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    ds.addBookmark({ id: 'b2', title: 'B', url: 'https://b.example', username: '', password: '', notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 7, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    saveFromExtension('https://new-save-test.example', '新')
    const added = ds.bookmarks.find(b => b.url === 'https://new-save-test.example')
    expect(added).toBeTruthy()
    expect(added!.order).toBe(8) // max(5,7)+1=8，而非 length=3
    // 不与任何现存项撞
    const orders = ds.bookmarks.map(b => b.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('importFromDataInternal 用 orderBase=max+1 批量导入间不撞、与现存不撞', () => {
    const ds = useDataStore()
    ds.addBookmark({ id: 'exist1', title: '旧', url: 'https://exist1.example', username: '', password: '', notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 3, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    ds.addBookmark({ id: 'exist2', title: '旧2', url: 'https://exist2.example', username: '', password: '', notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 10, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    importFromDataInternal({
      categories: [],
      bookmarks: [
        { id: 'i1', title: '导入1', url: 'https://imp1.example', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0 } as any,
        { id: 'i2', title: '导入2', url: 'https://imp2.example', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0 } as any,
        { id: 'i3', title: '导入3', url: 'https://imp3.example', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0 } as any,
      ],
      siblingGroups: [], customAttributes: [],
    }, 'test')
    const orders = ds.bookmarks.map(b => b.order)
    // 全唯一
    expect(new Set(orders).size).toBe(orders.length)
    // 导入的三条 order 严格递增且 > 现存最大 10
    const imp = ds.bookmarks.filter(b => ['i1', 'i2', 'i3'].includes(b.id)).map(b => b.order)
    expect(imp).toEqual([11, 12, 13])
  })
})

/**
 * parseRaindropJSON 正路径护栏（D1-21，纯加测试零逻辑改动）。
 *
 * 既有「坏 tags 防御」用例仅锁非 string tags 不抛这条边界，正路径分支零直测——
 * 顶层结构多形态驱入、无 url 项被过滤、title/url/notes 兜底链、collection.$id 拼
 * categoryId、created/lastUpdate 时间字段映射、tags→attributes 规范化、字段默认等
 * 均靠实现口头维护。本组直锁全部正路径不变量，任一分支漂移即被抓。
 */
describe('parseRaindropJSON 正路径分支护栏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('顶层为数组时直驱 items（每条直接是书签对象）', () => {
    const arr = [
      { title: 'A', link: 'https://a.example', tags: [] },
      { title: 'B', link: 'https://b.example', tags: [] },
    ]
    const result = parseRaindropJSON(arr)
    expect(result).toHaveLength(2)
    expect(result[0].url).toBe('https://a.example')
    expect(result[1].url).toBe('https://b.example')
  })

  it('顶层为 { items: [...] } 对象形态时取 items 数组', () => {
    const data = { items: [{ title: 'T', link: 'https://obj.example', tags: [] }] }
    const result = parseRaindropJSON(data)
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://obj.example')
  })

  it('顶层为非数组且无 items 字段的对象 → bare 对象兜底 ?? d 但 d 非 array → 返空', () => {
    // 裸单书签对象（无 items 包裹）经 ?? 兜底成 d 自身，非 array → 空
    expect(parseRaindropJSON({ title: 'x', link: 'https://bare.example' })).toEqual([])
  })

  it('items 自身非数组（如 items:{}）→ 返空数组', () => {
    expect(parseRaindropJSON({ items: { not: 'array' } })).toEqual([])
  })

  it('过滤：无 link 也无 url 的项被跳过，不进结果', () => {
    const data = {
      items: [
        { title: '有 url', link: 'https://keep.example', tags: [] },
        { title: '无 url 只有 title', tags: [] }, // 缺 link/url → 过滤
        { title: '有 url', url: 'https://also-keep.example', tags: [] },
      ],
    }
    const result = parseRaindropJSON(data)
    expect(result).toHaveLength(2)
    expect(result.map((b) => b.url)).toEqual(['https://keep.example', 'https://also-keep.example'])
  })

  it('url 取 link 优先：同时有 link 和 url 时用 link', () => {
    const data = { items: [{ title: 'T', link: 'https://link.example', url: 'https://url.example', tags: [] }] }
    expect(parseRaindropJSON(data)[0].url).toBe('https://link.example')
  })

  it('title 兜底链：缺 title 时用 link 占位', () => {
    const data = { items: [{ link: 'https://notitle.example', tags: [] }] }
    const r = parseRaindropJSON(data)[0]
    expect(r.title).toBe('https://notitle.example')
    expect(r.url).toBe('https://notitle.example')
  })

  it('notes 取 excerpt||note 双键：excerpt 优先，缺 excerpt 用 note', () => {
    const data = {
      items: [
        { title: 'a', link: 'https://a.example', excerpt: '摘录', note: '备注', tags: [] },
        { title: 'b', link: 'https://b.example', note: '只有 note', tags: [] },
      ],
    }
    const r = parseRaindropJSON(data)
    expect(r[0].notes).toBe('摘录')
    expect(r[1].notes).toBe('只有 note')
  })

  it('categoryId 由 collection.$id 拼 rd_ 前缀', () => {
    const data = { items: [{ title: 'T', link: 'https://c.example', collection: { $id: '42' }, tags: [] }] }
    expect(parseRaindropJSON(data)[0].categoryId).toBe('rd_42')
  })

  it('无 collection（或 collection 无 $id）时 categoryId 取 CAT_UNCATEGORIZED', () => {
    const data = { items: [
      { title: 'T', link: 'https://u.example', tags: [] },
      { title: 'T2', link: 'https://u2.example', collection: {}, tags: [] },
    ] }
    const r = parseRaindropJSON(data)
    expect(r[0].categoryId).toBe(CAT_UNCATEGORIZED)
    expect(r[1].categoryId).toBe(CAT_UNCATEGORIZED)
  })

  it('tags 数组：filter 仅 string 元素 + tag_<空格折叠→_、小写> 建 attributes', () => {
    const data = {
      items: [{ title: 'T', link: 'https://t.example', tags: ['Web Dev', 'TOOL', 123, { x: 1 }] }],
    }
    const attrs = parseRaindropJSON(data)[0].attributes
    // 非 string 元素(123/对象)被过滤，仅 'Web Dev'→'tag_web_dev' 与 'TOOL'→'tag_tool'
    // 注意：parseRaindropJSON 用 `replace(/\s+/g, '_')` 空格→下划线，键是 `tag_web_dev`
    // 而非 useAttrFilter.addAttrQuick 的横线 `tag_web-dev`——两处口径不同，护栏直锁此差异
    expect(attrs['tag_web_dev']).toBe(true)
    expect(attrs['tag_tool']).toBe(true)
    expect(Object.keys(attrs)).toHaveLength(2)
    // 确认不是 addAttrQuick 口径的横线键（防未来误以为同口径统一成横线）
    expect(attrs['tag_web-dev']).toBeUndefined()
  })

  it('tags 缺失（undefined）时 attributes 为空对象不抛', () => {
    const data = { items: [{ title: 'T', link: 'https://x.example' }] }
    expect(parseRaindropJSON(data)[0].attributes).toEqual({})
  })

  it('created/lastUpdate 字段解析为毫秒时间戳', () => {
    const data = {
      items: [{ title: 'T', link: 'https://t.example', created: '2024-01-15T00:00:00Z', lastUpdate: '2024-06-20T12:00:00Z', tags: [] }],
    }
    const r = parseRaindropJSON(data)[0]
    expect(r.createdAt).toBe(new Date('2024-01-15T00:00:00Z').getTime())
    expect(r.updatedAt).toBe(new Date('2024-06-20T12:00:00Z').getTime())
  })

  it('created/lastUpdate 缺失时走 Date.now() 兜底（用 fake timers 锁确定性）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-03-01T08:30:00Z'))
    const FIXED_NOW = Date.now()
    try {
      const data = { items: [{ title: 'T', link: 'https://t.example', tags: [] }] }
      const r = parseRaindropJSON(data)[0]
      expect(r.createdAt).toBe(FIXED_NOW)
      expect(r.updatedAt).toBe(FIXED_NOW)
    } finally {
      vi.useRealTimers()
    }
  })

  it('字段默认：username/password 空、parentId null、order 按序递增、useCount 0、isExpanded false、icon 取 cover', () => {
    const data = {
      items: [
        { title: 'A', link: 'https://a.example', cover: 'https://cover.example/a.png', tags: [] },
        { title: 'B', link: 'https://b.example', tags: [] },
      ],
    }
    const r = parseRaindropJSON(data)
    expect(r[0]).toMatchObject({ username: '', password: '', parentId: null, order: 0, useCount: 0, isExpanded: false, icon: 'https://cover.example/a.png' })
    expect(r[1]).toMatchObject({ parentId: null, order: 1, useCount: 0, isExpanded: false, icon: '' })
    // order 按导入序递增（0, 1 而非均 0）
    expect(r.map((b) => b.order)).toEqual([0, 1])
  })

  it('空输入（null/undefined/空对象）不抛返空数组', () => {
    expect(parseRaindropJSON(null)).toEqual([])
    expect(parseRaindropJSON(undefined)).toEqual([])
    expect(parseRaindropJSON({})).toEqual([])
    expect(parseRaindropJSON([])).toEqual([])
  })
})

/**
 * detectFormat — 导入路由纯函数护栏
 *
 * importData(line 147) 用它按文件名扩展 + 内容头部探测决定走 json/html/csv 分支。
 * 本护栏锁住：扩展名优先级、大小写不敏感、内容兜底三态、扩展名覆盖内容、
 * 前导空白容忍、未知格式返 null 等全部分支，为后续若改内容探测正则铺地基。
 */
describe('detectFormat 扩展名+内容探测路由护栏', () => {
  it('扩展名 .json -> json', () => {
    expect(detectFormat('bookmarks.json', '')).toBe('json')
  })

  it('扩展名 .html / .htm -> html（两种写法都认）', () => {
    expect(detectFormat('export.html', '')).toBe('html')
    expect(detectFormat('export.htm', '')).toBe('html')
  })

  it('扩展名 .csv -> csv', () => {
    expect(detectFormat('data.csv', '')).toBe('csv')
  })

  it('扩展名大小写不敏感（toLowerCase 归一）', () => {
    expect(detectFormat('BOOKMARKS.JSON', '')).toBe('json')
    expect(detectFormat('Export.HTML', '')).toBe('html')
    expect(detectFormat('Data.CSV', '')).toBe('csv')
  })

  it('扩展名优先于内容探测——已知扩展名时内容不参与判定', () => {
    // 文件名是 .csv 但内容长得像 html/json，仍按扩展名走 csv（路由"文件名权威"语义）
    expect(detectFormat('a.csv', '<html>')).toBe('csv')
    expect(detectFormat('a.json', '<not json>')).toBe('json')
    expect(detectFormat('a.html', '[1,2,3]')).toBe('html')
  })

  it('无扩展名 / 不识别扩展名时走内容头部推断——{ 或 [ -> json', () => {
    expect(detectFormat('no_ext', '{"a":1}')).toBe('json')
    expect(detectFormat('no_ext', '[1,2,3]')).toBe('json')
  })

  it('无扩展名时 < 开头 -> html', () => {
    expect(detectFormat('no_ext', '<!DOCTYPE html>')).toBe('html')
    expect(detectFormat('no_ext', '<html>')).toBe('html')
  })

  it('无扩展名且内容不合 json/html -> null', () => {
    expect(detectFormat('no_ext', 'title,url\na,b')).toBeNull()
    expect(detectFormat('no_ext', 'plain text')).toBeNull()
    expect(detectFormat('no_ext', '')).toBeNull()
  })

  it('内容头部前导空白被 trimStart 容忍后才判型', () => {
    expect(detectFormat('no_ext', '   \n\t  {"a":1}')).toBe('json')
    expect(detectFormat('no_ext', '  \n <html>')).toBe('html')
  })

  it('扩展名取最后一段（点号分隔 split.pop）——文件名含多个点取末段', () => {
    expect(detectFormat('archive.2024.json', '')).toBe('json')
    expect(detectFormat('my.bookmarks.csv', '')).toBe('csv')
    // 末段非已知扩展名（如 .txt）-> 落内容推断
    expect(detectFormat('notes.txt', '{"a":1}')).toBe('json')
  })

  it('无扩展名且内容空 -> null（无信息可判）', () => {
    expect(detectFormat('README', '')).toBeNull()
  })
})

/**
 * _merge* 合并模式去重核心护栏（D1-23）
 *
 * 锁定 useDataIO 四个合并函数「同 id 跳过 / Zod 失败计入 skipped / URL 去重 / order 基线 /
 * bookmarkIds 悬空过滤 / 缺字段真值守卫跳过不计 skipped」契约。这些函数是合并模式导入
 * （mergeIntoLocalData）的去重核心，此前仅经 importFromDataInternal 两窄场景间接覆盖
 * （组 bookmarkIds 悬空过滤 / order 唯一性），分支计数与去重边界零直测。仅补测试零逻辑改动
 * （已增 export，唯一调用方 importFromDataInternal 内部引用不受影响）。
 */
describe('_mergeCategories 合并去重护栏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('正常分类合并入库，imported 计数正确', () => {
    const ds = useDataStore()
    const r = _mergeCategories(ds, [
      { id: 'c1', name: '工作', icon: 'briefcase', color: '#f00', order: 0 } as any,
      { id: 'c2', name: '生活', icon: 'home', color: '', order: 1 } as any,
    ])
    expect(r).toEqual({ imported: 2, skipped: 0 })
    expect(ds.categories.length).toBe(2)
    expect(ds.categories.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('缺 id 或缺 name 真值守卫 continue 跳过，不计入 skipped 且不入库', () => {
    const ds = useDataStore()
    const r = _mergeCategories(ds, [
      { name: '无id', order: 0 } as any,        // !c.id -> continue
      { id: 'noName' } as any,                   // !c.name -> continue
      { id: '', name: '空id', order: 0 } as any, // c.id='' 假值 -> continue
      { id: 'c1', name: '有值', order: 0 } as any,
    ])
    // 四项中仅最后一项入库；前三项走 continue 既不算 imported 也不算 skipped
    expect(r).toEqual({ imported: 1, skipped: 0 })
    expect(ds.categories.length).toBe(1)
    expect(ds.categories[0].id).toBe('c1')
  })

  it('同 ID 跳过去重——已存在分类不重复入库', () => {
    const ds = useDataStore()
    ds.addCategory({ id: 'dup', name: '旧同名', icon: 'star', color: '', order: 0, updatedAt: 1 } as any)
    const r = _mergeCategories(ds, [
      { id: 'dup', name: '新同名', icon: 'briefcase', color: '#0f0', order: 9 } as any,
      { id: 'new', name: '新增', icon: 'home', color: '', order: 1 } as any,
    ])
    expect(r).toEqual({ imported: 1, skipped: 0 })
    // 旧分类保留（同 id 跳过不覆盖 name/icon/color/order）
    expect(ds.categories.length).toBe(2)
    const dup = ds.categories.find((c) => c.id === 'dup')!
    expect(dup.name).toBe('旧同名')
    expect(dup.icon).toBe('star')
    expect(dup.color).toBe('')
  })

  it('icon/color 缺省兜底——AddCategory 前用 star / 空串填充', () => {
    const ds = useDataStore()
    _mergeCategories(ds, [{ id: 'c1', name: '只给名字', order: 0 } as any])
    const c = ds.categories.find((x) => x.id === 'c1')!
    expect(c.icon).toBe('star')
    expect(c.color).toBe('')
  })

  it('Zod 失败计入 skipped——非 string id 穿过真值守卫但被 CategorySchema z.string() 拒', () => {
    const ds = useDataStore()
    const r = _mergeCategories(ds, [{ id: 123, name: '数字id', order: 0 } as any])
    expect(r).toEqual({ imported: 0, skipped: 1 })
    expect(ds.categories.length).toBe(0)
  })
})

describe('_mergeAttributes 合并去重护栏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('正常属性合并入库，imported 计数正确', () => {
    const ds = useDataStore()
    const r = _mergeAttributes(ds, [
      { id: 'a1', name: '常用', type: 'boolean' } as any,
      { id: 'a2', name: '收藏', type: 'boolean' } as any,
    ])
    expect(r).toEqual({ imported: 2, skipped: 0 })
    expect(ds.customAttributes.length).toBe(2)
    expect(ds.customAttributes.map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('缺 id 或缺 name 真值守卫 continue 跳过，不计 skipped 且不入库', () => {
    const ds = useDataStore()
    const r = _mergeAttributes(ds, [
      { name: '无id' } as any,              // !a.id -> continue
      { id: 'noName' } as any,              // !a.name -> continue
      { id: '', name: '空id' } as any,      // a.id='' 假值 -> continue
      { id: 'a1', name: '有值' } as any,
    ])
    expect(r).toEqual({ imported: 1, skipped: 0 })
    expect(ds.customAttributes.length).toBe(1)
  })

  it('同 ID 跳过去重——已存在属性不重复入库', () => {
    const ds = useDataStore()
    ds.addAttribute({ id: 'dup', name: '旧属性', type: 'boolean' } as any)
    const r = _mergeAttributes(ds, [
      { id: 'dup', name: '新属性', type: 'boolean' } as any,
      { id: 'new', name: '新增', type: 'boolean' } as any,
    ])
    expect(r).toEqual({ imported: 1, skipped: 0 })
    expect(ds.customAttributes.length).toBe(2)
    expect(ds.customAttributes.find((a) => a.id === 'dup')!.name).toBe('旧属性')
  })

  it('type 缺省兜底 boolean——AddAttribute 前用 "boolean" 填充', () => {
    const ds = useDataStore()
    _mergeAttributes(ds, [{ id: 'a1', name: '无type' } as any])
    expect(ds.customAttributes[0].type).toBe('boolean')
  })

  it('Zod 失败计入 skipped——非 string id 穿过真值守卫但被 CustomAttributeSchema z.string() 拒', () => {
    const ds = useDataStore()
    const r = _mergeAttributes(ds, [{ id: 99, name: '数字id' } as any])
    expect(r).toEqual({ imported: 0, skipped: 1 })
    expect(ds.customAttributes.length).toBe(0)
  })

  it('type 非 "boolean" 被 z.literal("boolean") 拒计入 skipped', () => {
    const ds = useDataStore()
    // type 是非空字符串 'text' 穿过守卫思路不适用（守卫只查 id/name），但 _mergeAttributes
    // 用 a.type || 'boolean' 兜底，非 boolean 的 truthy type 不会被兜底覆盖——直接送 Zod
    // CustomAttributeSchema.type = z.literal('boolean') 会拒 -> skipped++
    const r = _mergeAttributes(ds, [{ id: 'a1', name: '错的type', type: 'text' } as any])
    expect(r).toEqual({ imported: 0, skipped: 1 })
    expect(ds.customAttributes.length).toBe(0)
  })
})

describe('_mergeBookmarks 合并去重护栏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('正常书签合并入库，imported 计数正确，order 基于 nextBookmarkOrder=max+1 递增', () => {
    const ds = useDataStore()
    // 本地已有一个 order=5 的书签，order 基线应为 6
    ds.addBookmark({ id: 'local', title: '本地', url: 'https://local.example', username: '', password: '', notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 5, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    const r = _mergeBookmarks(ds, [
      { id: 'b1', title: '书签1', url: 'https://b1.example', categoryId: CAT_UNCATEGORIZED } as any,
      { id: 'b2', title: '书签2', url: 'https://b2.example', categoryId: CAT_UNCATEGORIZED } as any,
    ])
    expect(r).toEqual({ imported: 2, skipped: 0 })
    expect(ds.bookmarks.length).toBe(3)
    // 新两项 order 应从 6 起（local max=5 + 1），批内递增 orderBase + imported
    const b1 = ds.bookmarks.find((b) => b.id === 'b1')!
    const b2 = ds.bookmarks.find((b) => b.id === 'b2')!
    expect(b1.order).toBe(6)
    expect(b2.order).toBe(7)
  })

  it('缺 title 或缺 url 真值守卫 continue 跳过，不计 skipped 且不入库', () => {
    const ds = useDataStore()
    const r = _mergeBookmarks(ds, [
      { id: 'noTitle', url: 'https://a.example' } as any,   // !b.title -> continue
      { id: 'noUrl', title: '无URL' } as any,               // !b.url -> continue
      { id: 'good', title: '好', url: 'https://good.example' } as any,
    ] as any)
    // 前两项 continue——既不算 imported 也不算 skipped；仅 good 入库
    expect(r).toEqual({ imported: 1, skipped: 0 })
    expect(ds.bookmarks.length).toBe(1)
    expect(ds.bookmarks[0].id).toBe('good')
  })

  it('同 ID 跳过去重——已存在书签不重复入库', () => {
    const ds = useDataStore()
    ds.addBookmark({ id: 'dup', title: '旧', url: 'https://dup.example', username: '', password: '', notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    const r = _mergeBookmarks(ds, [
      { id: 'dup', title: '新同名', url: 'https://dup.example/other', categoryId: CAT_UNCATEGORIZED } as any,
      { id: 'new', title: '新', url: 'https://new.example', categoryId: CAT_UNCATEGORIZED } as any,
    ])
    expect(r).toEqual({ imported: 1, skipped: 0 })
    expect(ds.bookmarks.length).toBe(2)
    // 旧 dup 不被覆盖（同 id 先于 URL 去重判定，跳过不覆盖字段）
    expect(ds.bookmarks.find((b) => b.id === 'dup')!.title).toBe('旧')
  })

  it('同 URL 跳过去重（大小写不敏感）——与本地现存 URL 重复跳过不入库', () => {
    const ds = useDataStore()
    ds.addBookmark({ id: 'local', title: '本地', url: 'https://CASE.example/path', username: '', password: '', notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    const r = _mergeBookmarks(ds, [
      // URL 大小写不同但 toLowerCase 同 -> 去重跳过
      { id: 'dupUrl', title: '重复URL', url: 'https://case.example/path', categoryId: CAT_UNCATEGORIZED } as any,
      { id: 'fresh', title: '不重复', url: 'https://other.example', categoryId: CAT_UNCATEGORIZED } as any,
    ])
    expect(r).toEqual({ imported: 1, skipped: 0 })
    expect(ds.bookmarks.find((b) => b.id === 'dupUrl')).toBeUndefined()
    expect(ds.bookmarks.find((b) => b.id === 'fresh')).toBeTruthy()
  })

  it('批内 URL 去重——同批两条相同 URL 仅首条入库，次条 URL 进 existingUrls 后被去重', () => {
    const ds = useDataStore()
    const r = _mergeBookmarks(ds, [
      { id: 'b1', title: '首条', url: 'https://same.example', categoryId: CAT_UNCATEGORIZED } as any,
      { id: 'b2', title: '同URL次条', url: 'https://same.example', categoryId: CAT_UNCATEGORIZED } as any,
    ])
    expect(r).toEqual({ imported: 1, skipped: 0 })
    expect(ds.bookmarks.length).toBe(1)
    expect(ds.bookmarks[0].id).toBe('b1')
  })

  it('字段缺省兜底——username/password/notes/icon 空、categoryId 走 CAT_UNCATEGORIZED、parentId null', () => {
    const ds = useDataStore()
    _mergeBookmarks(ds, [{ id: 'b1', title: '只给title和url', url: 'https://x.example' }] as any)
    const b = ds.bookmarks[0]
    expect(b.username).toBe('')
    expect(b.password).toBe('')
    expect(b.notes).toBe('')
    expect(b.icon).toBe('')
    expect(b.categoryId).toBe(CAT_UNCATEGORIZED)
    expect(b.parentId).toBeNull()
    expect(b.useCount).toBe(0)
    expect(b.isExpanded).toBe(false)
    expect(b.attributes).toEqual({})
  })
})

describe('_mergeGroups 合并去重护栏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('正常组合并入库，imported 计数正确', () => {
    const ds = useDataStore()
    const r = _mergeGroups(ds, [
      { id: 'g1', name: '组1', categoryId: CAT_UNCATEGORIZED, bookmarkIds: [], icon: '', order: 0, isExpanded: false, attributes: {}, notes: 'n', useCount: 0 } as any,
      { id: 'g2', name: '组2', categoryId: CAT_UNCATEGORIZED, bookmarkIds: [], icon: '', order: 1, isExpanded: false, attributes: {}, notes: '', useCount: 0 } as any,
    ])
    expect(r).toEqual({ imported: 2, skipped: 0 })
    expect(ds.siblingGroups.length).toBe(2)
  })

  it('缺 id 或缺 name 真值守卫 continue 跳过，不计 skipped 且不入库', () => {
    const ds = useDataStore()
    const r = _mergeGroups(ds, [
      { name: '无id', bookmarkIds: [] } as any,            // !g.id -> continue
      { id: 'noName', bookmarkIds: [] } as any,            // !g.name -> continue
      { id: '', name: '空id', bookmarkIds: [] } as any,    // g.id='' 假值 -> continue
      { id: 'g1', name: '有值', bookmarkIds: [], categoryId: CAT_UNCATEGORIZED } as any,
    ])
    expect(r).toEqual({ imported: 1, skipped: 0 })
    expect(ds.siblingGroups.length).toBe(1)
  })

  it('同 ID 跳过去重——已存在组不重复入库', () => {
    const ds = useDataStore()
    ds.addGroup({ id: 'dup', name: '旧组', categoryId: CAT_UNCATEGORIZED, icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 1, useCount: 0, isPublic: false } as any)
    const r = _mergeGroups(ds, [
      { id: 'dup', name: '新组', categoryId: CAT_UNCATEGORIZED, bookmarkIds: [] } as any,
      { id: 'new', name: '新增', categoryId: CAT_UNCATEGORIZED, bookmarkIds: [] } as any,
    ])
    expect(r).toEqual({ imported: 1, skipped: 0 })
    expect(ds.siblingGroups.length).toBe(2)
    expect(ds.siblingGroups.find((g) => g.id === 'dup')!.name).toBe('旧组')
  })

  it('bookmarkIds 悬空过滤——仅保留本地已存活书签 id，悬空 id 被剔除', () => {
    const ds = useDataStore()
    // 仅 goodBm 入库（dup 因同 URL 在更早合并被跳过——此处单独 _mergeGroups 测，先手动放存活项）
    ds.addBookmark({ id: 'goodBm', title: '存活', url: 'https://good.example', username: '', password: '', notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    const r = _mergeGroups(ds, [
      {
        id: 'g1', name: '测试组', categoryId: CAT_UNCATEGORIZED,
        bookmarkIds: ['goodBm', 'ghostId1', 'ghostId2'], // goodBm 存活、两 ghost 未存活
        icon: '', order: 0, isExpanded: false, attributes: {}, notes: '', useCount: 0,
      } as any,
    ])
    expect(r).toEqual({ imported: 1, skipped: 0 })
    const g = ds.groupMap['g1']
    expect(g.bookmarkIds).toEqual(['goodBm'])
    // 留存 id 全部可查 bookmarkMap（不悬空）
    for (const bid of g.bookmarkIds) {
      expect(ds.bookmarkMap[bid]).toBeTruthy()
    }
  })

  it('bookmarkIds 缺省 [] 兜底——无 bookmarkIds 字段不抛错', () => {
    const ds = useDataStore()
    const r = _mergeGroups(ds, [{ id: 'g1', name: '无bookmarkIds组', categoryId: CAT_UNCATEGORIZED }] as any)
    expect(r).toEqual({ imported: 1, skipped: 0 })
    expect(ds.groupMap['g1'].bookmarkIds).toEqual([])
  })

  it('Zod 失败计入 skipped——非 string id 穿过真值守卫但被 SiblingGroupSchema z.string() 拒', () => {
    const ds = useDataStore()
    const r = _mergeGroups(ds, [{ id: 777, name: '数字id', bookmarkIds: [] }] as any)
    expect(r).toEqual({ imported: 0, skipped: 1 })
    expect(ds.siblingGroups.length).toBe(0)
  })

  it('categoryId 指向不存在分类时兜底到 CAT_UNCATEGORIZED——避免组挂悬空分类 id 致分类筛选下消失', () => {
    // 真 bug 复现：源 backup 的组 categoryId='cat_ghost'，但本地（及同源 categories 列表）
    // 均无该分类（导出者填错/源被半删/同名分类合并未建 id）。旧 `g.categoryId || CAT_UNCATEGORIZED`
    // 仅兜底假值，非空但悬空的 'cat_ghost' 直接采用 → 组挂悬空分类 id。
    const ds = useDataStore()
    const r = _mergeGroups(ds, [
      { id: 'g1', name: '悬空分类组', categoryId: 'cat_ghost', bookmarkIds: [], icon: '', order: 0, isExpanded: false, attributes: {}, notes: '', useCount: 0 } as any,
    ] as any)
    expect(r).toEqual({ imported: 1, skipped: 0 })
    const g = ds.groupMap['g1']
    // 兜底到 CAT_UNCATEGORIZED 而非悬空的 'cat_ghost'
    expect(g.categoryId).toBe(CAT_UNCATEGORIZED)
    expect(g.categoryId).not.toBe('cat_ghost')
  })

  it('categoryId 指向已存在分类时正常采用（不误兜底）', () => {
    const ds = useDataStore()
    ds.addCategory({ id: 'realCat', name: '真分类', icon: 'star', color: '', order: 0, updatedAt: 1 } as any)
    const r = _mergeGroups(ds, [
      { id: 'g1', name: '挂真分类组', categoryId: 'realCat', bookmarkIds: [], icon: '', order: 0, isExpanded: false, attributes: {}, notes: '', useCount: 0 } as any,
    ] as any)
    expect(r).toEqual({ imported: 1, skipped: 0 })
    expect(ds.groupMap['g1'].categoryId).toBe('realCat')
  })

  it('空/缺省 categoryId 兜底到 CAT_UNCATEGORIZED（保留旧行为）', () => {
    const ds = useDataStore()
    const r = _mergeGroups(ds, [
      { id: 'g1', name: '空cat组', categoryId: '', bookmarkIds: [] } as any,
      { id: 'g2', name: '缺cat组', bookmarkIds: [] } as any,
    ] as any)
    expect(r).toEqual({ imported: 2, skipped: 0 })
    expect(ds.groupMap['g1'].categoryId).toBe(CAT_UNCATEGORIZED)
    expect(ds.groupMap['g2'].categoryId).toBe(CAT_UNCATEGORIZED)
  })
})

// ── _attrsToTags 护栏 ──
// useDataIO.ts:34 导出纯函数：把书签 attributes（attrId→on/off）还原成标签名数组，
// 供 exportHTML/exportCSV 导出书签时还原 tags 列。是导出链路"属性名正确还原"核心。
// 仅 export 关键字新增，零逻辑改动。用真实 Pinia store：addAttribute 建真实 attributeMap。
describe('_attrsToTags attributes→标签名还原', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('attrMap 命中——用属性的 name 作标签名', () => {
    const ds = useDataStore()
    ds.addAttribute({ id: 'attr-dev', name: '开发工具', type: 'boolean' } as any)
    const b = { attributes: { 'attr-dev': true } } as any
    expect(_attrsToTags(ds, b)).toEqual(['开发工具'])
  })

  it('attrMap 未命中且 id 带 tag_ 前缀——去掉 tag_ 前缀兜底返回', () => {
    const ds = useDataStore()
    // 未注册任何属性，attributeMap 命中不到 id
    const b = { attributes: { 'tag_my-tag': true } } as any
    expect(_attrsToTags(ds, b)).toEqual(['my-tag'])
  })

  it('attrMap 未命中且 id 无 tag_ 前缀——原样返回 id（replace 不匹配即不替换）', () => {
    const ds = useDataStore()
    const b = { attributes: { 'custom-id-123': true } } as any
    expect(_attrsToTags(ds, b)).toEqual(['custom-id-123'])
  })

  it('falsey 属性值被跳过（!on 守卫）——只有 on=truthy 的属性进标签', () => {
    const ds = useDataStore()
    ds.addAttribute({ id: 'attr-on', name: '启用', type: 'boolean' } as any)
    ds.addAttribute({ id: 'attr-off', name: '禁用', type: 'boolean' } as any)
    const b = { attributes: { 'attr-on': true, 'attr-off': false } } as any
    expect(_attrsToTags(ds, b)).toEqual(['启用'])
  })

  it('attributes 为 undefined——|| {} 兜底不抛 TypeError 返空数组', () => {
    const ds = useDataStore()
    expect(_attrsToTags(ds, { attributes: undefined } as any)).toEqual([])
  })

  it('attributes 为 null——|| {} 兜底不抛 TypeError 返空数组', () => {
    const ds = useDataStore()
    expect(_attrsToTags(ds, { attributes: null } as any)).toEqual([])
  })

  it('attributes 为空对象——返空数组', () => {
    const ds = useDataStore()
    expect(_attrsToTags(ds, { attributes: {} } as any)).toEqual([])
  })

  it('混合命中+未命中+falsey——均按各自分支正确处理互不干扰', () => {
    const ds = useDataStore()
    ds.addAttribute({ id: 'attr-named', name: '已命名', type: 'boolean' } as any)
    const b = {
      attributes: {
        'attr-named': true,          // 命中 → '已命名'
        'tag_orphan': true,          // 未命中去前缀 → 'orphan'
        'bare-id': true,             // 未命中无前缀 → 'bare-id'
        'attr-named-dup': false,     // falsey 跳过
      },
    } as any
    expect(_attrsToTags(ds, b)).toEqual(['已命名', 'orphan', 'bare-id'])
  })

  it('attrMap 命中但 name 为空串(falsy)——走 || 兜底去 tag_ 前缀', () => {
    // attr?.name 为空串时 || 触发，退回去前缀兜底路径
    const ds = useDataStore()
    ds.addAttribute({ id: 'tag_empty', name: '', type: 'boolean' } as any)
    const b = { attributes: { 'tag_empty': true } } as any
    expect(_attrsToTags(ds, b)).toEqual(['empty'])
  })

  it('软删属性仍命中 name——attributeMap getter 不过滤 deletedAt（真实特性锁定）', () => {
    // attributeMap getter（data.ts:237）直接遍历 customAttributes 不过滤，
    // 故软删 attr 仍 attributeMap[id] 命中 name 导出。锁定此特性防误判为过滤软删。
    const ds = useDataStore()
    ds.addAttribute({ id: 'attr-soft', name: '软删属性', type: 'boolean' } as any)
    ds.deleteAttribute('attr-soft')
    expect(ds.customAttributes.find(a => a.id === 'attr-soft')!.deletedAt).toBeTruthy()
    const b = { attributes: { 'attr-soft': true } } as any
    expect(_attrsToTags(ds, b)).toEqual(['软删属性'])
  })
})
