/**
 * stores/app.test.ts — app Store (Facade) 测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import * as persist from '../../stores/persist.js'

describe('AppStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('数据代理', () => {
    it('bookmarks 应委托给 dataStore', () => {
      const store = useAppStore()
      expect(store.bookmarks).toEqual([])
    })

    it('categories 应委托给 dataStore', () => {
      const store = useAppStore()
      expect(store.categories).toEqual([])
    })

    it('selectableCategories 应排除"全部"', () => {
      const store = useAppStore()
      const ids = store.selectableCategories.map(c => c.id)
      expect(ids).not.toContain('all')
    })
  })

  describe('UI 状态代理', () => {
    it('curCat 可读写', () => {
      const store = useAppStore()
      store.curCat = 'test-cat'
      expect(store.curCat).toBe('test-cat')
    })

    it('sortMode 可读写', () => {
      const store = useAppStore()
      store.sortMode = 'title'
      expect(store.sortMode).toBe('title')
    })

    it('batchSelected 可读写', () => {
      const store = useAppStore()
      store.batchSelected = ['b1', 'b2']
      expect(store.batchSelected).toEqual(['b1', 'b2'])
    })

    it('modals 对象可读写', () => {
      const store = useAppStore()
      store.modals.bookmark = true
      expect(store.modals.bookmark).toBe(true)
    })

    it('panels 对象可读写', () => {
      const store = useAppStore()
      store.panels.settings = true
      expect(store.panels.settings).toBe(true)
    })

    it('overlays 对象可读写', () => {
      const store = useAppStore()
      store.overlays.addDropdown = true
      expect(store.overlays.addDropdown).toBe(true)
    })
  })

  describe('CRUD 操作', () => {
    it('addBookmark 应委托给 dataStore', () => {
      const store = useAppStore()
      const ds = useDataStore()
      const spy = vi.spyOn(ds, 'addBookmark')
      store.addBookmark({ id: 'b1' } as any)
      expect(spy).toHaveBeenCalledWith({ id: 'b1' })
    })

    it('updateBookmark 应委托给 dataStore', () => {
      const store = useAppStore()
      const ds = useDataStore()
      const spy = vi.spyOn(ds, 'updateBookmark')
      store.updateBookmark('b1', { title: '新标题' })
      expect(spy).toHaveBeenCalledWith('b1', { title: '新标题' })
    })

    it('deleteBookmark 应委托给 dataStore', () => {
      const store = useAppStore()
      const ds = useDataStore()
      const spy = vi.spyOn(ds, 'deleteBookmark')
      store.deleteBookmark('b1')
      expect(spy).toHaveBeenCalledWith('b1')
    })
  })

  describe('save() 落盘指纹 (审计 H1 修复)', () => {
    // H1 根因：_fingerprint 只统计 bookmarks/siblingGroups 的 maxUp 与四个数组长度，
    // 纯分类/属性 renameCategory/renameAttribute 只改自身 name+updatedAt，长度不变、
    // 也不顶高 bookmarks/siblingGroups 的 maxUp → 命中 fp===_lastSavedFingerprint 早退不落盘。
    // 修复后把 categories/customAttributes 的 max updatedAt 纳入指纹。
    // 全程 mock saveData 返回 true，使 _lastSavedFingerprint 正常更新，还原真实落盘后的指纹状态。
    let saveSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      saveSpy = vi.spyOn(persist, 'saveData').mockResolvedValue(true)
    })
    afterEach(() => { saveSpy.mockRestore() })
    // rename 改 updatedAt 依赖 Date.now()，同毫秒内连续 rename 指纹不变；
    // 用假定时器手动推进时间还原真实操作间隔。
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('renameCategory 连续两次都落盘（不被指纹早退吞掉）', async () => {
      const store = useAppStore()
      const ds = useDataStore()
      ds.addCategory({ id: 'cat1', name: '分类A', icon: '', color: '', order: 0 })
      await store.save()

      vi.clearAllMocks()
      vi.setSystemTime(1000)
      store.renameCategory('cat1', '分类B')
      await store.save()
      expect(saveSpy).toHaveBeenCalledTimes(1)

      // 推进 1ms 后再 rename：修复前指纹不变会早退，saveData 不被调用
      vi.setSystemTime(1001)
      store.renameCategory('cat1', '分类C')
      await store.save()
      expect(store.categories[0].name).toBe('分类C')
      expect(saveSpy).toHaveBeenCalledTimes(2)
    })

    it('renameAttribute 连续两次都落盘', async () => {
      const store = useAppStore()
      const ds = useDataStore()
      ds.customAttributes = [{ id: 'attr1', name: '属性A', type: 'boolean' }]
      await store.save()

      vi.clearAllMocks()
      vi.setSystemTime(2000)
      store.renameAttribute('attr1', '属性B')
      await store.save()
      expect(saveSpy).toHaveBeenCalledTimes(1)

      vi.setSystemTime(2001)
      store.renameAttribute('attr1', '属性C')
      await store.save()
      expect(store.customAttributes[0].name).toBe('属性C')
      expect(saveSpy).toHaveBeenCalledTimes(2)
    })

    it('未变更时 save() 被指纹早退（PERF-3 性能优化仍生效，未被修复破坏）', async () => {
      const store = useAppStore()
      const ds = useDataStore()
      ds.addBookmark({ id: 'b1', title: 't', url: 'u', categoryId: 'all', order: 0 } as any)
      await store.save()

      vi.clearAllMocks()
      // 什么也不改，直接 save：fp 与上次相等 → 早退不落盘
      const r1 = await store.save()
      expect(r1).toBe(true)
      expect(saveSpy).toHaveBeenCalledTimes(0)
    })
  })
})
