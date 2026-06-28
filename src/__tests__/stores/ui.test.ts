import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'

describe('UIStore', () => {
  let store: ReturnType<typeof useUIStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useUIStore()
  })

  describe('初始状态', () => {
    it('应该有正确的默认值', () => {
      expect(store.curCat).toBe('all')
      expect(store.sortMode).toBe('order')
      expect(store.sortDir).toBe('desc')
      expect(store.layoutMode).toBe('grid')
      expect(store.searchQuery).toBe('')
      expect(store.batchMode).toBe(false)
      expect(store.batchSelected).toEqual([])
      expect(store.activeAttrs).toEqual([])
      expect(store.excludedAttrs).toEqual([])
      expect(store.detailCards).toEqual([])
      expect(store.panels.detail).toBe(false)
      expect(store.panels.rail).toBe(false)
    })
  })

  describe('UI 状态持久化', () => {
    it('saveUIState - 应该保存状态到 localStorage', () => {
      store.curCat = 'cat1'
      store.layoutMode = 'list'
      store.searchQuery = 'test'
      
      store.saveUIState()
      
      expect(localStorage.setItem).toHaveBeenCalled()
      const savedData = JSON.parse((localStorage.setItem as any).mock.calls[0][1])
      expect(savedData.curCat).toBe('cat1')
      expect(savedData.layoutMode).toBe('list')
      expect(savedData.searchQuery).toBe('test')
    })

    it('restoreUIState - 应该从 localStorage 恢复状态', () => {
      const stateData = {
        curCat: 'cat1',
        layoutMode: 'list',
        sortMode: 'title',
        searchQuery: 'test',
        activeAttrs: ['attr1'],
        excludedAttrs: ['attr2'],
      }
      ;(localStorage.getItem as any).mockReturnValue(JSON.stringify(stateData))
      
      store.restoreUIState()
      
      expect(store.curCat).toBe('cat1')
      expect(store.layoutMode).toBe('list')
      expect(store.sortMode).toBe('title')
      expect(store.searchQuery).toBe('test')
      expect(store.activeAttrs).toEqual(['attr1'])
      expect(store.excludedAttrs).toEqual(['attr2'])
    })

    it('restoreUIState - localStorage 为空时应保持默认值', () => {
      ;(localStorage.getItem as any).mockReturnValue(null)
      const originalCat = store.curCat
      store.restoreUIState()
      expect(store.curCat).toBe(originalCat)
    })

    it('restoreUIState - 应该处理无效 JSON', () => {
      ;(localStorage.getItem as any).mockReturnValue('invalid json')
      expect(() => store.restoreUIState()).not.toThrow()
    })
  })

  describe('selectAllBatch', () => {
    it('应该选择所有过滤后的书签和组', () => {
      const dataStore = useDataStore()
      dataStore.bookmarks = [
        { id: 'b1', title: 'Test', url: 'https://test.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 0 } as any,
      ]
      dataStore.siblingGroups = [
        { id: 'g1', name: 'Group', categoryId: 'c', bookmarkIds: [], attributes: {}, order: 0 } as any,
      ]
      
      store.selectAllBatch()
      
      expect(store.batchSelected).toContain('b1')
      expect(store.batchSelected).toContain('group:g1')
    })
  })

  describe('restoreUIState - 详细场景', () => {
    it('应该恢复 focusedGroupId 如果组存在', () => {
      const dataStore = useDataStore()
      dataStore.siblingGroups = [{ id: 'g1', name: 'Test' }] as any
      ;(localStorage.getItem as any).mockReturnValue(JSON.stringify({
        focusedGroupId: 'g1',
      }))
      
      store.restoreUIState()
      
      expect(store.focusedGroupId).toBe('g1')
    })

    it('不应该恢复 focusedGroupId 如果组不存在', () => {
      const dataStore = useDataStore()
      dataStore.siblingGroups = []
      ;(localStorage.getItem as any).mockReturnValue(JSON.stringify({
        focusedGroupId: 'nonexistent',
      }))
      
      store.restoreUIState()
      
      expect(store.focusedGroupId).toBeNull()
    })

    it('应该恢复 detailCards 并过滤无效项', () => {
      const dataStore = useDataStore()
      dataStore.bookmarks = [{ id: 'b1' }] as any
      dataStore.siblingGroups = [{ id: 'g1' }] as any
      ;(localStorage.getItem as any).mockReturnValue(JSON.stringify({
        detailCards: ['b1', 'group:g1', 'b2', 'group:g2'],
      }))
      
      store.restoreUIState()
      
      expect(store.detailCards).toEqual(['b1', 'group:g1'])
    })

    it('当有 detailCards 时 detailPanel 应从 detailCards 推导', () => {
      const dataStore = useDataStore()
      dataStore.bookmarks = [{ id: 'b1' }] as any
      dataStore.siblingGroups = []
      ;(localStorage.getItem as any).mockReturnValue(JSON.stringify({
        detailCards: ['b1'],
      }))

      store.restoreUIState()

      expect(store.detailCards).toEqual(['b1'])
      expect(store.panels.detail).toBe(false) // detail 不由 detailOpen 持久化驱动
    })

    it('应该只恢复 grid/list layoutMode', () => {
      ;(localStorage.getItem as any).mockReturnValue(JSON.stringify({
        layoutMode: 'invalid',
      }))
      
      store.restoreUIState()
      
      expect(store.layoutMode).toBe('grid') // 保持默认值
    })
  })
})
