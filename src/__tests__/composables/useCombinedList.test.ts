/**
 * A1-001 / A1-002：组合列表排序与 custom 过滤
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useCombinedList } from '../../composables/useCombinedList.js'
import { CAT_ALL } from '../../config/constants.js'

describe('useCombinedList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const ds = useDataStore()
    const ui = useUIStore()
    ui.curCat = CAT_ALL
    ui.groupsOnTop = false
    ui.searchQuery = ''
    ui.activeAttrs = []
    ui.excludedAttrs = []
    ui.focusedGroupId = null
    ds.bookmarks = [
      { id: 'b1', title: 'Old', url: 'https://old.test', icon: '', username: '', password: '', notes: '', categoryId: 'c1', parentId: null, order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 100, deletedAt: null },
      { id: 'b2', title: 'New', url: 'https://new.test', icon: '', username: '', password: '', notes: '', categoryId: 'c1', parentId: null, order: 2, useCount: 0, attributes: {}, isExpanded: false, createdAt: 2, updatedAt: 900, deletedAt: null },
      { id: 'b3', title: 'OtherCat', url: 'https://other.test', icon: '', username: '', password: '', notes: '', categoryId: 'c2', parentId: null, order: 3, useCount: 0, attributes: {}, isExpanded: false, createdAt: 3, updatedAt: 500, deletedAt: null },
    ] as any
    ds.siblingGroups = []
    ds.categories = [
      { id: 'c1', name: 'A', icon: '', color: '' },
      { id: 'c2', name: 'B', icon: '', color: '' },
    ] as any
    ds.customAttributes = []
    ds._syncMaps()
  })

  it('A1-001: dateDesc with default sortDir=desc puts newer first', () => {
    const ui = useUIStore()
    ui.sortMode = 'dateDesc'
    ui.sortDir = 'desc'
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.filter(c => c.type === 'bm').map(c => c.data.id)
    expect(ids[0]).toBe('b2')
    expect(ids[ids.length - 1]).toBe('b1')
  })

  it('A1-001: dateAsc puts older first', () => {
    const ui = useUIStore()
    ui.sortMode = 'dateAsc'
    ui.sortDir = 'desc'
    const { combinedList } = useCombinedList()
    const ids = combinedList.value.filter(c => c.type === 'bm').map(c => c.data.id)
    expect(ids[0]).toBe('b1')
  })

  it('A1-002: custom mode respects category filter on ordered and appended items', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.sortMode = 'order'
    ui.curCat = 'c1'
    ds._customCardOrder = [
      { t: 'b', id: 'b1' },
      { t: 'b', id: 'b3' }, // other category — must be skipped
    ]
    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('custom')
    const ids = combinedList.value.map(c => c.data.id)
    expect(ids).toContain('b1')
    expect(ids).toContain('b2') // appended new in cat c1
    expect(ids).not.toContain('b3')
  })
})
