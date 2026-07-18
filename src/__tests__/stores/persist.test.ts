/**
 * stores/persist.test.ts — 持久化层测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import * as persist from '../../stores/persist.js'
import { STORAGE_KEY, DEFAULTS } from '../../config/constants.js'
import type { AppData } from '../../types.js'

// 隔离 IDB：persist 经 storage.js 的 idbGet/idbSet 读写 IndexedDB，jsdom 无 IDB。
// mock 出可控的 idbGet/idbSet：
//  - idbSet 默认返回 true（B-1 修复后是 Promise<boolean>，saveData/saveToIDB 检查返回值）。
//    旧 mock 返回 undefined 会误触发「IDB 写入失败」分支，破坏 B-1 修复的可测试性。
//  - idbGet 可控，用于「合法/损坏数据」分支验证。
vi.mock('../../stores/storage.js', () => ({
  idbGet: vi.fn(async () => null),
  idbSet: vi.fn(async () => true),
}))
const _idbGet = vi.mocked(await import('../../stores/storage.js')).idbGet
const _idbSet = vi.mocked(await import('../../stores/storage.js')).idbSet

describe('persist', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    // 每个测试重置 idbGet/idbSet 到 mock 工厂默认（null / true），防止上一测试
    // 临时改的 mockResolvedValueOnce 残留污染下一测试的断言。
    _idbGet.mockReset(); _idbGet.mockResolvedValue(null)
    _idbSet.mockReset(); _idbSet.mockResolvedValue(true)
  })

  describe('saveToLocalStorage', () => {
    it('应保存数据到 localStorage', () => {
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      const ok = persist.saveToLocalStorage(data)
      expect(ok).toBe(true)
      const raw = localStorage.getItem(STORAGE_KEY)
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw!)
      expect(parsed._savedAt).toBeGreaterThan(0)
    })

    it('应包含 _savedAt 时间戳', () => {
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      persist.saveToLocalStorage(data)
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(raw._savedAt).toBeGreaterThan(0)
    })

    it('QUAL-01：写入带 _writeSeq 与 _schemaVersion，_dataVersion 仅镜像 writeSeq', () => {
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
        _schemaVersion: 2,
      } as AppData
      persist.saveToLocalStorage(data)
      const a = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      persist.saveToLocalStorage(data)
      const b = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(a._schemaVersion).toBe(2)
      expect(b._schemaVersion).toBe(2)
      expect(typeof a._writeSeq).toBe('number')
      expect(b._writeSeq).toBeGreaterThan(a._writeSeq)
      expect(b._dataVersion).toBe(b._writeSeq)
    })

    it('localStorage 满时返回 false', () => {
      const setItem = vi.spyOn(window.localStorage, 'setItem')
      setItem.mockImplementation(() => { throw new Error('QuotaExceededError') })
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      const ok = persist.saveToLocalStorage(data)
      expect(ok).toBe(false)
      setItem.mockRestore()
    })
  })

  describe('saveData (B-1: IDB 写入失败如实上报)', () => {
    it('IDB 写入成功时返回 true', async () => {
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      _idbSet.mockResolvedValue(true)
      await expect(persist.saveData(data)).resolves.toBe(true)
    })

    it('idbSet 返回 false（隐私模式/配额满）时 saveData 返回 false，不落库 localStorage 误判成功', async () => {
      // B-1 根因：旧 idbSet 吞错返回 undefined，saveData 旧实现不检查返回值，
      // 恒返回 true → app.ts「存储不可用」toast 永不触发，数据丢失无提示。
      _idbSet.mockResolvedValue(false)
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      await expect(persist.saveData(data)).resolves.toBe(false)
    })

    it('idbSet 抛异常时 saveData 捕获并返回 false', async () => {
      _idbSet.mockRejectedValue(new Error('IDB unavailable'))
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      await expect(persist.saveData(data)).resolves.toBe(false)
    })
  })

  describe('loadFromLocalStorage', () => {
    it('无数据时返回 DEFAULTS', () => {
      const result = persist.loadFromLocalStorage()
      expect(result.categories.length).toBeGreaterThan(0)
      expect(result.categories[0].id).toBe('all')
    })

    it('损坏 JSON 时返回 DEFAULTS', () => {
      localStorage.setItem(STORAGE_KEY, '{corrupted}')
      const result = persist.loadFromLocalStorage()
      expect(result.categories.length).toBeGreaterThan(0)
    })

    it('结构无效数据（非对象/缺核心数组）时返回 DEFAULTS', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ bookmarks: 'not_an_array' }))
      const result = persist.loadFromLocalStorage()
      expect(result.categories.length).toBeGreaterThan(0)
    })

    it('C2：缺 isExpanded/updatedAt/createdAt 等可迁移字段的旧数据不被整体丢弃（先迁移补齐再校验）', () => {
      // C2 根因：旧实现 safeParse 在 runMigrations 之前执行，BookmarkSchema 要求
      // isExpanded/updatedAt/createdAt 必填无默认值，旧版数据缺这些字段会让整条 safeParse
      // 失败 → return DEFAULTS，用户全部书签被默认示例数据替换丢失。
      // 修复后：轻量结构检查通过 → runMigrations step6/7 补齐 updatedAt/createdAt 等
      // → 校验通过 → 旧数据保留不丢。
      const oldData = {
        // 缺 isExpanded / useCount / createdAt / updatedAt / icon / parentId / order 等
        bookmarks: [{ id: 'b1', title: '旧书签', url: 'https://old.com', username: '', password: '', notes: '', categoryId: 'all', attributes: {} }],
        siblingGroups: [
          // 缺 updatedAt / useCount / isExpanded / attributes 等
          { id: 'g1', name: '旧组', categoryId: 'all', icon: '', order: 0, bookmarkIds: [], notes: '' },
        ],
        categories: DEFAULTS.categories.map(c => ({ ...c })),
        customAttributes: [],
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(oldData))
      const result = persist.loadFromLocalStorage()
      // 关键断言：旧书签/旧组保留，未被 DEFAULTS 覆盖
      expect(result.bookmarks).toHaveLength(1)
      expect(result.bookmarks[0].title).toBe('旧书签')
      expect(result.bookmarks[0].url).toBe('https://old.com')
      expect(result.siblingGroups).toHaveLength(1)
      expect(result.siblingGroups[0].name).toBe('旧组')
      // 迁移补齐的字段已落入
      expect(typeof result.bookmarks[0].updatedAt).toBe('number')
      expect(typeof result.bookmarks[0].createdAt).toBe('number')
      expect(typeof result.bookmarks[0].isExpanded).toBe('boolean')
      // CAT_ALL 未经 migrations 不迁移（loadFromLocalStorage 路径里 migrations 给 bookmark 补齐字段，
      // step3 的 CAT_ALL→CAT_UNCATEGORIZED 是 BookmarkSchema z.string() 不校验分类合法性故保留 'all' 不影响断言）
      // 但 step6/7 的 updatedAt/createdAt 补齐必须生效
    })

    it('应加载有效数据', () => {
      const data: AppData = {
        bookmarks: [{ id: 'b1', title: '测试', url: 'https://test.com', username: '', password: '', notes: '', icon: '', categoryId: 'all', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 100, updatedAt: 100 }],
        siblingGroups: [],
        categories: DEFAULTS.categories.map(c => ({ ...c })),
        customAttributes: [],
      }
      persist.saveToLocalStorage(data)
      const result = persist.loadFromLocalStorage()
      expect(result.bookmarks[0].title).toBe('测试')
    })
  })

  describe('saveToIDB / loadFromIDB', () => {
    it('saveToIDB 成功返回 true', async () => {
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      await expect(persist.saveToIDB(data)).resolves.toBe(true)
    })

    it('saveToIDB 在 idbSet 失败时返回 false（B-1：备份路径也不得静默吞错）', async () => {
      _idbSet.mockResolvedValue(false)
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      await expect(persist.saveToIDB(data)).resolves.toBe(false)
    })

    it('loadFromIDB 应在无数据时返回 null', async () => {
      _idbGet.mockResolvedValue(null)
      const result = await persist.loadFromIDB()
      expect(result).toBeNull()
    })

    it('loadFromIDB 合法数据应经 safeParse 正常返回', async () => {
      const data: AppData = {
        bookmarks: [{ id: 'b1', title: '测', url: 'https://t.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 100, updatedAt: 100 }],
        siblingGroups: [], categories: DEFAULTS.categories.map(c => ({ ...c })), customAttributes: [],
      }
      _idbGet.mockResolvedValue({ ...data, _dataVersion: 5, _savedAt: 123 })
      const result = await persist.loadFromIDB()
      expect(result).not.toBeNull()
      expect(result!.bookmarks).toHaveLength(1)
      expect(result!.bookmarks[0].title).toBe('测')
    })

    it('loadFromIDB 损坏数据（bookmark 缺 url）应被 safeParse 拒，返回 null 走 localStorage 回退', async () => {
      // bookmark 缺 url → BookmarkSchema 校验失败。修复前直接 return idbData，坏字段入 store 致后续 NPE；
      // 修复后 safeParse 拒、返回 null，loadData 回退 localStorage（localStorage 自身也 safeParse 兜底 DEFAULTS）。
      const bad = {
        bookmarks: [{ id: 'b1', title: '坏' }], // 缺 url/必填字段
        siblingGroups: [], categories: [], customAttributes: [],
        _dataVersion: 5,
      }
      _idbGet.mockResolvedValue(bad)
      const result = await persist.loadFromIDB()
      expect(result).toBeNull()
    })

    it('H18：含重复属性名的旧 IDB 数据经 loadFromIDB 在同一对象上去重生效（bookmark 属性 id 重映射不悬空）', async () => {
      // H18 根因：旧实现 const data = parsed.data（Zod v4 返回新引用），runMigrations(idbData, data)
      // 让 step2 的属性 id 重映射写在 idbData.bookmarks[i].attributes 而非 data.bookmarks[i].attributes，
      // 结果 customAttributes 已去重但 bookmark 仍引用旧 attr id，boolean 标记永久失联，且 _schemaVersion
      // 被钉为 CURRENT 不再迁移。修复：runMigrations(idbData, idbData) 同对象迁移再 parse 得副本。
      const dupAttrA = { id: 'attr-a', name: '标签', type: 'boolean' }
      const dupAttrB = { id: 'attr-b', name: '标签', type: 'boolean' } // 同名重复
      const oldData = {
        bookmarks: [{
          id: 'b1', title: 't', url: 'https://t.com', username: '', password: '', notes: '',
          icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0,
          attributes: { 'attr-b': true }, // 引用将被丢弃的重复 id
          isExpanded: false, createdAt: 1, updatedAt: 1,
        }],
        siblingGroups: [],
        categories: DEFAULTS.categories.map(c => ({ ...c })),
        customAttributes: [dupAttrA, dupAttrB],
        _dataVersion: 1, // 旧版本触发迁移
        _savedAt: 1,
      }
      _idbGet.mockResolvedValue(JSON.parse(JSON.stringify(oldData)))
      const result = await persist.loadFromIDB()
      expect(result).not.toBeNull()
      // 去重后 customAttributes 只保留第一个同名 attr（attr-a）
      expect(result!.customAttributes).toHaveLength(1)
      // 关键：bookmark 的 attributes 已被重映射到 keep.id (attr-a)，不是悬空的 attr-b
      expect(result!.bookmarks[0].attributes).toEqual({ 'attr-a': true })
    })
  })

  describe('flushIDB', () => {
    it('应不抛出', () => {
      expect(() => persist.flushIDB()).not.toThrow()
    })
  })

  describe('getStorageInfo', () => {
    it('应返回存储信息', () => {
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      const info = persist.getStorageInfo(data)
      expect(info.size).toBeGreaterThanOrEqual(0)
      expect(info.percent).toBeGreaterThanOrEqual(0)
      expect(info.label).toBeTruthy()
    })

    it('非空数据应返回正数大小', () => {
      const data: AppData = {
        bookmarks: [{ id: 'b1', title: '测试', url: 'https://test.com', username: '', password: '', notes: '', icon: '', categoryId: 'all', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 100, updatedAt: 100 }],
        siblingGroups: [], categories: DEFAULTS.categories.map(c => ({ ...c })), customAttributes: [],
      }
      const info = persist.getStorageInfo(data)
      expect(info.size).toBeGreaterThan(0)
    })
  })
})
