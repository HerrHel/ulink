import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAppStore } from '../stores/app.js'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'

describe('App Store (兼容层)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('initial state', () => {
    it('should have default UI state', () => {
      const store = useAppStore()
      expect(store.curCat).toBe('all')
      expect(store.sortMode).toBe('order')
      expect(store.sortDir).toBe('desc')
      expect(store.layoutMode).toBe('grid')
      expect(store.batchMode).toBe(false)
      expect(store.batchSelected).toEqual([])
      expect(store.activeAttrs).toEqual([])
      expect(store.excludedAttrs).toEqual([])
      expect(store.detailCards).toEqual([])
    })
  })

  describe('filteredBookmarks', () => {
    it('should return empty array when no bookmarks', () => {
      const store = useAppStore()
      expect(store.filteredBookmarks).toEqual([])
    })

    it('should filter by category', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', title: 'Test', url: 'https://test.com', categoryId: 'cat1', notes: '', username: '', attributes: {}, order: 0 } as any,
        { id: '2', title: 'Test2', url: 'https://test2.com', categoryId: 'cat2', notes: '', username: '', attributes: {}, order: 1 } as any
      ]
      uiStore.curCat = 'cat1'
      expect(store.filteredBookmarks).toHaveLength(1)
      expect(store.filteredBookmarks[0].id).toBe('1')
    })

    it('should filter by search query', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', title: 'GitHub', url: 'https://github.com', categoryId: 'cat1', notes: '', username: '', attributes: {}, order: 0 } as any,
        { id: '2', title: 'Google', url: 'https://google.com', categoryId: 'cat1', notes: '', username: '', attributes: {}, order: 1 } as any
      ]
      uiStore.searchQuery = 'git'
      const filtered = store.filteredBookmarks
      expect(filtered).toHaveLength(1)
      expect(filtered[0].title).toBe('GitHub')
    })

    it('should sort by title', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', title: 'Banana', url: 'https://b.com', categoryId: 'cat1', notes: '', username: '', attributes: {}, order: 0 } as any,
        { id: '2', title: 'Apple', url: 'https://a.com', categoryId: 'cat1', notes: '', username: '', attributes: {}, order: 1 } as any
      ]
      uiStore.sortMode = 'title'
      uiStore.sortDir = 'asc'
      const sorted = store.filteredBookmarks
      expect(sorted[0].title).toBe('Apple')
      expect(sorted[1].title).toBe('Banana')
    })
  })

  describe('actions', () => {
    it('should add bookmark', () => {
      const dataStore = useDataStore()
      const store = useAppStore()
      const bm = { id: '1', title: 'Test', url: 'https://test.com', categoryId: 'cat1' } as any
      store.save = () => {}
      store.addBookmark(bm)
      expect(dataStore.bookmarks).toHaveLength(1)
      expect(dataStore.bookmarks[0].id).toBe('1')
    })

    it('should delete bookmark', () => {
      const dataStore = useDataStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', title: 'Test', url: 'https://test.com', categoryId: 'cat1' } as any
      ]
      dataStore.siblingGroups = []
      store.save = () => {}
      store.deleteBookmark('1')
      expect(dataStore.bookmarks).toHaveLength(1)
      expect(dataStore.bookmarks[0].deletedAt).toBeDefined()
    })

    it('should select all batch', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', title: 'Test', url: 'https://test.com', categoryId: 'cat1', notes: '', username: '', attributes: {}, order: 0 } as any
      ]
      dataStore.siblingGroups = []
      store.selectAllBatch()
      expect(uiStore.batchSelected).toContain('1')
    })
  })
})
