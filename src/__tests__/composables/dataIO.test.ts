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
import { importFromDataInternal, parseRaindropJSON } from '../../composables/domain/useDataIO.js'
import { saveFromExtension } from '../../composables/domain/useBookmark.js'
import { __testMarkDataReady } from '../../lib/dataReady.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

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
