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

    it('结构无效数据（Zod 校验失败）时返回 DEFAULTS', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ bookmarks: 'not_an_array' }))
      const result = persist.loadFromLocalStorage()
      expect(result.categories.length).toBeGreaterThan(0)
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
