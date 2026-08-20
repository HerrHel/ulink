import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { CAT_ALL } from '../../config/constants.js'

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
      expect(store.expandedIds).toEqual([])
    })
  })

  describe('列表展开态（expandedIds）', () => {
    it('toggleExpanded 翻转加入/移除 id', () => {
      store.toggleExpanded('b1')
      expect(store.expandedIds).toEqual(['b1'])
      store.toggleExpanded('b1')
      expect(store.expandedIds).toEqual([])
      // 书签与组 id 统一存放互不干扰
      store.toggleExpanded('b1')
      store.toggleExpanded('g1')
      expect(store.expandedIds).toEqual(['b1', 'g1'])
    })

    it('collapseAllExpanded 清空全部', () => {
      store.expandedIds = ['b1', 'g1']
      store.collapseAllExpanded()
      expect(store.expandedIds).toEqual([])
    })

    it('saveUIState 序列化 expandedIds；restoreUIState 恢复并过滤已删/软删项', () => {
      const dataStore = useDataStore()
      dataStore.bookmarks = [
        { id: 'live', title: 't', url: 'u', isExpanded: false, deletedAt: null } as any,
        { id: 'gone', title: 't2', url: 'u2', isExpanded: false, deletedAt: 123 } as any,
      ]
      dataStore.siblingGroups = [
        { id: 'glive', name: 'g', categoryId: 'c', isExpanded: false, deletedAt: null } as any,
      ]
      ;(dataStore as any)._syncMaps()

      store.expandedIds = ['live', 'gone', 'glive']
      store.saveUIState()
      const saved = JSON.parse((localStorage.setItem as any).mock.calls[0][1])
      expect(saved.expandedIds).toEqual(['live', 'gone', 'glive'])

      store.expandedIds = []
      ;(localStorage.getItem as any).mockReturnValue(JSON.stringify({ expandedIds: ['live', 'gone', 'glive'] }))
      store.restoreUIState()
      // gone 已软删被过滤
      expect(store.expandedIds).toEqual(['live', 'glive'])
    })

    it('restoreUIState 存量迁移：数据层 isExpanded=true 一次性读入 expandedIds，不写回', () => {
      const dataStore = useDataStore()
      dataStore.bookmarks = [
        { id: 'b1', title: 't', url: 'u', isExpanded: true, deletedAt: null } as any,
        { id: 'b2', title: 't2', url: 'u2', isExpanded: false, deletedAt: null } as any,
      ]
      dataStore.siblingGroups = [
        { id: 'g1', name: 'g', categoryId: 'c', isExpanded: true, deletedAt: null } as any,
      ]
      ;(dataStore as any)._syncMaps()

      store.restoreUIState()
      expect(store.expandedIds).toEqual(['b1', 'g1'])
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
      const dataStore = useDataStore()
      // restoreUIState 现在对 curCat/activeAttrs/excludedAttrs 做合法性校验
      // （审计 R37/R15：stale id 回退/过滤），需预建对应 category 与 attribute 方为有效。
      dataStore.categories = [{ id: 'cat1', name: '分类1', icon: '', color: '', order: 0, updatedAt: 0 } as any]
      dataStore.customAttributes = [
        { id: 'attr1', name: '属性1', type: 'boolean', order: 0, updatedAt: 0 } as any,
        { id: 'attr2', name: '属性2', type: 'boolean', order: 1, updatedAt: 0 } as any,
      ]
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

    it('restoreUIState - 审计R37/R15：curCat/activeAttrs/excludedAttrs 的 stale id 回退过滤', () => {
      const dataStore = useDataStore()
      // categories/customAttributes 无 staleC / staleA，则 curCat 回退 CAT_ALL、attr 被过滤掉
      dataStore.categories = [] as any
      dataStore.customAttributes = [] as any
      ;(localStorage.getItem as any).mockReturnValue(JSON.stringify({
        curCat: 'staleC',
        activeAttrs: ['staleA1', 'staleA2'],
        excludedAttrs: ['staleA3'],
      }))

      store.restoreUIState()

      expect(store.curCat).toBe(CAT_ALL)
      expect(store.activeAttrs).toEqual([])
      expect(store.excludedAttrs).toEqual([])
    })

    it('restoreUIState - 审计R15：activeAttrs/excludedAttrs 排除已软删属性', () => {
      const dataStore = useDataStore()
      dataStore.customAttributes = [
        { id: 'del', name: '已删', type: 'boolean', order: 0, deletedAt: 123, updatedAt: 0 } as any,
        { id: 'live', name: '存活', type: 'boolean', order: 1, updatedAt: 0 } as any,
      ]
      ;(localStorage.getItem as any).mockReturnValue(JSON.stringify({
        activeAttrs: ['del', 'live'],
        excludedAttrs: ['del'],
      }))

      store.restoreUIState()

      expect(store.activeAttrs).toEqual(['live'])
      expect(store.excludedAttrs).toEqual([])
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

    it('应该过滤 detailCards 中的软删项（deleteBookmark 不清理 detailCards，刷新后不应渲染已删卡）', () => {
      const dataStore = useDataStore()
      dataStore.bookmarks = [
        { id: 'b1', deletedAt: null } as any,            // 正常
        { id: 'b2', deletedAt: 1234 } as any,            // 软删
      ] as any
      dataStore.siblingGroups = [
        { id: 'g1', deletedAt: undefined } as any,       // 正常
        { id: 'g2', deletedAt: 5678 } as any,            // 软删
      ] as any
      ;(localStorage.getItem as any).mockReturnValue(JSON.stringify({
        detailCards: ['b1', 'b2', 'group:g1', 'group:g2'],
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
