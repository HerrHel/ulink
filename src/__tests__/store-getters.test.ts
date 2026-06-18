import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAppStore } from '../stores/app.js'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'

describe('Store Getters', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  describe('filteredBookmarks', () => {
    it('should filter by category', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', title: 'A', url: 'https://a.com', categoryId: 'cat1', notes: '', username: '', attributes: {}, order: 0 } as any,
        { id: '2', title: 'B', url: 'https://b.com', categoryId: 'cat2', notes: '', username: '', attributes: {}, order: 1 } as any,
        { id: '3', title: 'C', url: 'https://c.com', categoryId: 'cat1', notes: '', username: '', attributes: {}, order: 2 } as any,
      ]
      uiStore.curCat = 'cat1'
      uiStore.sortDir = 'asc'
      expect(store.filteredBookmarks).toHaveLength(2)
      expect(store.filteredBookmarks.map(b => b.id)).toEqual(['1', '3'])
    })

    it('should filter by search query across title, url, notes, username', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', title: 'GitHub', url: 'https://github.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 0 } as any,
        { id: '2', title: 'Google', url: 'https://google.com', categoryId: 'c', notes: 'search engine', username: 'user@g.com', attributes: {}, order: 1 } as any,
        { id: '3', title: 'DeepSeek', url: 'https://deepseek.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 2 } as any,
      ]
      uiStore.searchQuery = 'git'
      expect(store.filteredBookmarks).toHaveLength(1)
      uiStore.searchQuery = 'engine'
      expect(store.filteredBookmarks).toHaveLength(1)
      expect(store.filteredBookmarks[0].id).toBe('2')
      uiStore.searchQuery = 'user@g'
      expect(store.filteredBookmarks).toHaveLength(1)
      expect(store.filteredBookmarks[0].id).toBe('2')
    })

    it('should filter by active attributes', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', title: 'A', url: 'https://a.com', categoryId: 'c', notes: '', username: '', attributes: { login: true }, order: 0 } as any,
        { id: '2', title: 'B', url: 'https://b.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 1 } as any,
      ]
      uiStore.activeAttrs = ['login']
      expect(store.filteredBookmarks).toHaveLength(1)
      expect(store.filteredBookmarks[0].id).toBe('1')
    })

    it('should filter by excluded attributes', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', title: 'A', url: 'https://a.com', categoryId: 'c', notes: '', username: '', attributes: { login: true }, order: 0 } as any,
        { id: '2', title: 'B', url: 'https://b.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 1 } as any,
      ]
      uiStore.excludedAttrs = ['login']
      expect(store.filteredBookmarks).toHaveLength(1)
      expect(store.filteredBookmarks[0].id).toBe('2')
    })

    it('should sort by title ascending', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', title: 'Banana', url: 'https://b.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 0 } as any,
        { id: '2', title: 'Apple', url: 'https://a.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 1 } as any,
      ]
      uiStore.sortMode = 'title'; uiStore.sortDir = 'asc'
      expect(store.filteredBookmarks.map(b => b.title)).toEqual(['Apple', 'Banana'])
    })

    it('should sort by useCount descending', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', title: 'A', url: 'https://a.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 0, useCount: 5 } as any,
        { id: '2', title: 'B', url: 'https://b.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 1, useCount: 20 } as any,
      ]
      uiStore.sortMode = 'useCount'; uiStore.sortDir = 'desc'
      expect(store.filteredBookmarks.map(b => b.id)).toEqual(['2', '1'])
    })
  })

  describe('filteredGroups', () => {
    it('should filter groups by name', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.siblingGroups = [
        { id: 'g1', name: 'AI Tools', categoryId: 'c', bookmarkIds: [], attributes: {}, order: 0 } as any,
        { id: 'g2', name: 'Social', categoryId: 'c', bookmarkIds: [], attributes: {}, order: 1 } as any,
      ]
      uiStore.searchQuery = 'ai'
      expect(store.filteredGroups).toHaveLength(1)
      expect(store.filteredGroups[0].id).toBe('g1')
    })

    it('should filter groups by contained bookmark title', () => {
      const dataStore = useDataStore()
      const uiStore = useUIStore()
      const store = useAppStore()
      dataStore.bookmarks = [{ id: 'b1', title: 'ChatGPT', url: 'https://chat.openai.com', categoryId: 'c', attributes: {} } as any]
      dataStore.siblingGroups = [{ id: 'g1', name: 'Group', categoryId: 'c', bookmarkIds: ['b1'], attributes: {}, order: 0 } as any]
      uiStore.searchQuery = 'chatgpt'
      expect(store.filteredGroups).toHaveLength(1)
    })
  })

  describe('cardCounts', () => {
    it('should count top-level bookmarks per category', () => {
      const dataStore = useDataStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: '1', categoryId: 'tools', parentId: null } as any,
        { id: '2', categoryId: 'tools', parentId: null } as any,
        { id: '3', categoryId: 'email', parentId: null } as any,
        { id: '4', categoryId: 'tools', parentId: '1' } as any,
      ]
      dataStore.siblingGroups = [{ id: 'g1', categoryId: 'ai' } as any]
      const counts = store.cardCounts
      expect(counts['tools']).toBe(2)
      expect(counts['email']).toBe(1)
      expect(counts['ai']).toBe(1)
      expect(counts['all']).toBe(4)
    })
  })

  describe('childrenMap', () => {
    it('should map parent IDs to children', () => {
      const dataStore = useDataStore()
      const store = useAppStore()
      dataStore.bookmarks = [
        { id: 'p1', parentId: null } as any,
        { id: 'c1', parentId: 'p1' } as any,
        { id: 'c2', parentId: 'p1' } as any,
        { id: 'c3', parentId: 'p2' } as any,
        { id: 'p2', parentId: null } as any,
      ]
      const map = store.childrenMap
      expect(map['p1']).toHaveLength(2)
      expect(map['p1'].map(b => b.id)).toEqual(['c1', 'c2'])
      expect(map['p2']).toHaveLength(1)
    })

    it('should return empty when no children', () => {
      const dataStore = useDataStore()
      const store = useAppStore()
      dataStore.bookmarks = [{ id: '1', parentId: null } as any]
      expect(Object.keys(store.childrenMap)).toHaveLength(0)
    })
  })
})
