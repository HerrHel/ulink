/**
 * stores/persist.test.ts — 持久化层测试
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import * as persist from '../../stores/persist.js'
import { STORAGE_KEY, DEFAULTS } from '../../config/constants.js'
import type { AppData } from '../../types.js'

describe('persist', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
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
    it('saveToIDB 不应抛出', async () => {
      const data: AppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      await expect(persist.saveToIDB(data)).resolves.toBeUndefined()
    })

    it('loadFromIDB 应在无数据时返回 null', async () => {
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
