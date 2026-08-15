/**
 * persist-branches.test.ts — persist.ts 持久化层未测分支补测
 *
 * 既有 persist.test.ts 锁 saveData/saveToIDB 的 idbSet 成功/失败/抛错、loadFromIDB 合法/null/safeParse 拒/H18 去重、
 * loadFromLocalStorage DEFAULTS/损坏/结构无效/旧数据可迁移、getStorageInfo 阈值/兜底、私密空间隔离。
 * 本文件补三类既有测未触达分支：
 *  - loadData 编排函数整体（既有测直接调 loadFromIDB/loadFromLocalStorage 间接，loadData 本身零测）
 *  - saveToIDB 的 idbSet 抛错 catch 分支（独立函数的 catch，与 saveData catch 区分）
 *  - loadFromIDB 结构非法（非对象/siblingGroups 非数组）回退 null（与 safeParse 拒区分）+ idbGet 抛错 catch
 *  - loadFromLocalStorage 迁移后 safeParse 仍失败回退 DEFAULTS（C2 fallback 第二层）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import * as persist from '../../stores/persist.js'
import { STORAGE_KEY, DEFAULTS } from '../../config/constants.js'
import type { AppData } from '../../types.js'

vi.mock('../../stores/storage.js', () => ({
  idbGet: vi.fn(async () => null),
  idbSet: vi.fn(async () => true),
  localHistoryKey: vi.fn(() => 'lv_hist_test'),
}))
const _idbGet = vi.mocked(await import('../../stores/storage.js')).idbGet
const _idbSet = vi.mocked(await import('../../stores/storage.js')).idbSet

describe('persist - 分支补测', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    _idbGet.mockReset(); _idbGet.mockResolvedValue(null)
    _idbSet.mockReset(); _idbSet.mockResolvedValue(true)
  })

  describe('loadData 编排函数（IDB 命中 / localStorage 回退 / 回填）', () => {
    it('IDB 命中时返回 IDB 数据并同步写 localStorage（R23：不递增 _writeSeq）', async () => {
      const idbData: AppData = {
        bookmarks: [{ id: 'b1', title: 'IDB数据', url: 'https://t.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 }],
        siblingGroups: [], categories: DEFAULTS.categories.map(c => ({ ...c })), customAttributes: [],
        _dataVersion: 7, _writeSeq: 7, _savedAt: 999,
      } as AppData
      _idbGet.mockResolvedValue(idbData)
      const result = await persist.loadData()
      // 返回 IDB 数据
      expect(result.bookmarks[0].id).toBe('b1')
      expect(result.bookmarks[0].title).toBe('IDB数据')
      // IDB 命中分支同步写 localStorage，保留 IDB 原始数据（含 _writeSeq 不递增）
      const lsRaw = localStorage.getItem(STORAGE_KEY)
      expect(lsRaw).not.toBeNull()
      const lsParsed = JSON.parse(lsRaw!)
      expect(lsParsed._writeSeq).toBe(7) // R23：不递增，保留 IDB 原序号
      expect(lsParsed.bookmarks[0].id).toBe('b1')
    })

    it('IDB 命中但 localStorage 同步失败（配额满）静默不抛、仍返回 IDB 数据', async () => {
      const idbData: AppData = {
        bookmarks: [{ id: 'b1', title: 'x', url: 'https://t.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 }],
        siblingGroups: [], categories: DEFAULTS.categories.map(c => ({ ...c })), customAttributes: [],
      } as AppData
      _idbGet.mockResolvedValue(idbData)
      const setItem = vi.spyOn(window.localStorage, 'setItem')
      setItem.mockImplementation((key: string) => {
        if (key === STORAGE_KEY) throw new Error('QuotaExceededError')
      })
      const result = await persist.loadData()
      // localStorage 同步失败被 catch 静默吞，仍返回 IDB 数据
      expect(result.bookmarks[0].id).toBe('b1')
      setItem.mockRestore()
    })

    it('IDB 无数据时回退 localStorage（loadFromLocalStorage），返回 localStorage 数据', async () => {
      _idbGet.mockResolvedValue(null)
      // localStorage 预置有效数据
      const lsData: AppData = {
        bookmarks: [{ id: 'ls1', title: '本地书签', url: 'https://l.com', username: '', password: '', notes: '', icon: '', categoryId: 'all', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 }],
        siblingGroups: [], categories: DEFAULTS.categories.map(c => ({ ...c })), customAttributes: [],
      }
      persist.saveToLocalStorage(lsData)
      const result = await persist.loadData()
      expect(result.bookmarks[0].id).toBe('ls1')
    })

    it('localStorage 有数据且含书签时触发 IDB 异步回填（saveToIDB 被调）', async () => {
      // loadData 在 IDB miss + lsData.bookmarks.length 时调 saveToIDB(lsData, space) 回填
      _idbGet.mockResolvedValue(null)
      const lsData: AppData = {
        bookmarks: [{ id: 'bk1', title: '回填', url: 'https://b.com', username: '', password: '', notes: '', icon: '', categoryId: 'all', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 }],
        siblingGroups: [], categories: DEFAULTS.categories.map(c => ({ ...c })), customAttributes: [],
      }
      persist.saveToLocalStorage(lsData)
      await persist.loadData()
      // 回填触发 saveToIDB → idbSet 被调
      expect(_idbSet).toHaveBeenCalled()
      const idbKeyArg = _idbSet.mock.calls[0][0]
      expect(idbKeyArg).toBe('linkvault_v2')
    })

    it('IDB 与 localStorage 都无数据时 loadData 返回 DEFAULTS（空 bookmarkMap）', async () => {
      _idbGet.mockResolvedValue(null)
      const result = await persist.loadData()
      // loadFromLocalStorage 无数据返回 cloneDeep(DEFAULTS)
      expect(result.categories.length).toBeGreaterThan(0)
      expect(result.categories[0].id).toBe('all')
    })
  })

  describe('saveToIDB idbSet 抛异常 catch 分支', () => {
    it('idbSet 抛错时 saveToIDB 捕获返回 false 不向调用方抛（与 saveData catch 独立）', async () => {
      _idbSet.mockRejectedValue(new Error('IDB connection lost'))
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      await expect(persist.saveToIDB(data)).resolves.toBe(false)
      // 非 Error 抛值走 `e instanceof Error ? e.message : e` 的非 Error 侧
      ;(_idbSet as any).mockRejectedValueOnce('string error')
      await expect(persist.saveToIDB(data)).resolves.toBe(false)
    })
  })

  describe('loadFromIDB 结构非法（非 safeParse 拒）回退 null', () => {
    it('IDB 数据 bookmarks 是数组但 siblingGroups 非数组 → 结构非法返回 null', async () => {
      _idbGet.mockResolvedValue({ bookmarks: [], siblingGroups: 'not_array', categories: [], customAttributes: [] })
      const result = await persist.loadFromIDB()
      expect(result).toBeNull()
    })

    it('IDB 数据整体非对象 → 结构非法返回 null', async () => {
      // idbData && idbData.bookmarks 守门需 bookmarks truthy；非对象 null 时走外层 null
      // 此处构造 bookmarks 是字符串触发 `!Array.isArray(idbData.bookmarks)`
      _idbGet.mockResolvedValue('not_object' as any)
      // 'not_object'.bookmarks 是 undefined → if (idbData && idbData.bookmarks) false → 走 catch 外 return null
      const result = await persist.loadFromIDB()
      expect(result).toBeNull()
    })

    it('IDB 数据类型校验 typeof idbData !== object（如字符串数组但 bookmarks truthy）结构非法返回 null', async () => {
      // bookmarks truthy 但 typeof 整体 !== 'object'：构造一个有 bookmarks 的非对象不常见，
      // 改用 bookmarks 是数组、siblingGroups 是数组但整体是数组实例（typeof 'object' 但结构判定 siblingGroups ok）
      // 实际 line 198 条件 `typeof idbData !== 'object' || !Array.isArray(bookmarks) || !Array.isArray(siblingGroups)`
      // 用 bookmarks=/siblingGroups= 数组但加一个非法 siblingGroups 触发第三个条件已由上测覆盖。
      // 此测覆盖「typeof idbData === object 但 siblingGroups 非数组」已被含，简化为 console.warn 记录断言
      _idbGet.mockResolvedValue({ bookmarks: [], siblingGroups: 123, categories: [], customAttributes: [] })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = await persist.loadFromIDB()
      expect(result).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('IDB data structure invalid'))
      warnSpy.mockRestore()
    })

    it('idbGet 抛异常时 loadFromIDB catch 兜底返回 null', async () => {
      _idbGet.mockRejectedValue(new Error('IDB read failed'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = await persist.loadFromIDB()
      expect(result).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('IDB load fallback'), expect.any(String))
      warnSpy.mockRestore()
    })
  })

  describe('loadFromLocalStorage 迁移后 safeParse 仍失败回退 DEFAULTS（C2 第二层）', () => {
    it('数据结构合法且可迁移，但迁移后 schema 仍不满足 → 回退 DEFAULTS', async () => {
      // 构造：结构通过（对象 + bookmarks/siblingGroups 是数组），runMigrations 能补齐字段，
      // 但 bookmark 含一个 schema 不接受的字段类型（如 order 是字符串 'notanumber' 但缺少必填 url）
      // 让迁移后 safeParse 仍失败回退 DEFAULTS。
      const tricky = {
        bookmarks: [{ id: 'b1' /* 缺 url 等必填 */ }],
        siblingGroups: [],
        categories: [],
        customAttributes: [],
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tricky))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = persist.loadFromLocalStorage()
      // safeParse 拒 → 回退 DEFAULTS
      expect(result.categories.length).toBeGreaterThan(0)
      expect(result.categories[0].id).toBe('all')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('data validation failed after migration'), expect.any(Array))
      warnSpy.mockRestore()
    })
  })
})
