/**
 * stores/app.test.ts — app Store (Facade) 测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'

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
})
