/**
 * data.ts — 数据 Store
 * 职责：管理 bookmarks, siblingGroups, categories, customAttributes 及其 CRUD、过滤、排序
 * 从 app.js 拆分而来
 */
import { defineStore } from 'pinia'
import { CAT_ALL } from '../config/constants.js'
import * as persist from './persist.js'
import { runMigrations } from './migrations.js'
import { useUIStore } from './ui.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute, EncryptedPassword } from '../types.js'

interface DataState {
  bookmarks: Bookmark[]
  siblingGroups: SiblingGroup[]
  categories: Category[]
  customAttributes: CustomAttribute[]
  _masterCanary: EncryptedPassword | null
  _customCardOrder: Array<{ t: 'g' | 'b'; id: string }> | null
  _cachedStorageInfo: { size: number; percent: number; label: string } | null
  _storageInfoDirty: boolean
  _saveCount: number
  _saveTimer: ReturnType<typeof setTimeout> | null
}

// ── 内部辅助：getter 公共 filter+sort 逻辑 ──
function _filterAttrs<T extends { attributes: Record<string, boolean> }>(items: T[], { activeAttrs, excludedAttrs }: { activeAttrs: string[]; excludedAttrs: string[] }): T[] {
  for (const aid of activeAttrs) items = items.filter(i => i.attributes[aid])
  for (const aid of excludedAttrs) items = items.filter(i => !i.attributes[aid])
  return items
}

function _sortItems<T>(items: T[], { sortMode, sortDir }: { sortMode: string; sortDir: string }, nameKey: keyof T, dateKey: keyof T): void {
  const d = sortDir === 'asc' ? 1 : -1
  items.sort((a, b) => {
    if (sortMode === 'useCount') return ((a as any).useCount - (b as any).useCount) * d
    if (sortMode === 'title') return String(a[nameKey]).localeCompare(String(b[nameKey])) * d
    if (sortMode === 'dateDesc') return (((b[dateKey] as number) || 0) - ((a[dateKey] as number) || 0)) * d
    if (sortMode === 'dateAsc') return (((a[dateKey] as number) || 0) - ((b[dateKey] as number) || 0)) * d
    return ((a as any).order - (b as any).order) * d
  })
}

export const useDataStore = defineStore('data', {
  state: (): DataState => ({
    bookmarks: [],
    siblingGroups: [],
    categories: [],
    customAttributes: [],
    _masterCanary: null,
    _customCardOrder: null,
    _cachedStorageInfo: null,
    _storageInfoDirty: true,
    _saveCount: 0,
    _saveTimer: null,
  }),

  getters: {
    /** 过滤后的书签列表（依赖 uiStore 的 curCat/searchQuery/activeAttrs/excludedAttrs/sortMode/sortDir） */
    filteredBookmarks(state): Bookmark[] {
      const ui = useUIStore()
      let bm = state.bookmarks.slice()
      if (ui.curCat !== CAT_ALL) bm = bm.filter(b => b.categoryId === ui.curCat)
      const q = ui.searchQuery.toLowerCase()
      if (q) {
        bm = bm.filter(b =>
          b.title.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q) ||
          (b.notes || '').toLowerCase().includes(q) ||
          (b.username || '').toLowerCase().includes(q) ||
          state.customAttributes.some(a => a.name.toLowerCase().includes(q) && b.attributes[a.id])
        )
      }
      bm = _filterAttrs(bm, ui)
      _sortItems(bm, ui, 'title', 'createdAt')
      return bm
    },

    /** 过滤后的组列表 */
    filteredGroups(state): SiblingGroup[] {
      const ui = useUIStore()
      let groups = state.siblingGroups.slice()
      if (ui.curCat !== CAT_ALL) groups = groups.filter(g => g.categoryId === ui.curCat)
      const q = ui.searchQuery.toLowerCase()
      if (q) {
        const bmMap = this.bookmarkMap
        groups = groups.filter(g => {
          if (g.name.toLowerCase().includes(q)) return true
          if (state.customAttributes.some(a => a.name.toLowerCase().includes(q) && g.attributes[a.id])) return true
          return g.bookmarkIds.some(bid => {
            const b = bmMap[bid]
            return b && (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
          })
        })
      }
      groups = _filterAttrs(groups, ui)
      _sortItems(groups, ui, 'name', 'updatedAt')
      return groups
    },

    /** O(1) 书签/组查找 Map */
    bookmarkMap(state): Record<string, Bookmark> {
      const map: Record<string, Bookmark> = {}; state.bookmarks.forEach(b => { map[b.id] = b }); return map
    },
    groupMap(state): Record<string, SiblingGroup> {
      const map: Record<string, SiblingGroup> = {}; state.siblingGroups.forEach(g => { map[g.id] = g }); return map
    },
    /** 预计算父→子书签映射 */
    childrenMap(state): Record<string, Bookmark[]> {
      const map: Record<string, Bookmark[]> = {}
      state.bookmarks.forEach(b => {
        if (b.parentId) {
          if (!map[b.parentId]) map[b.parentId] = []
          map[b.parentId].push(b)
        }
      })
      return map
    },
    /** 各分类的卡片计数 */
    cardCounts(state): Record<string, number> {
      const counts: Record<string, number> = {}; let total = 0
      state.bookmarks.forEach(b => { if (!b.parentId) { counts[b.categoryId] = (counts[b.categoryId] || 0) + 1; total++ } })
      state.siblingGroups.forEach(g => { counts[g.categoryId] = (counts[g.categoryId] || 0) + 1; total++ })
      counts[CAT_ALL] = total
      return counts
    },
    /** 可选择的分类列表（排除"全部"） */
    selectableCategories(state): Category[] {
      return state.categories.filter(c => c.id !== CAT_ALL)
    },
  },

  actions: {
    // ── CRUD：仅修改数据，调用方负责 save() ──
    addBookmark(bm: Bookmark) { this.bookmarks.push(bm) },
    updateBookmark(id: string, changes: Partial<Bookmark>) { const bm = this.bookmarkMap[id]; if (bm) Object.assign(bm, changes) },
    deleteBookmark(id: string) {
      const idx = this.bookmarks.findIndex(b => b.id === id)
      if (idx >= 0) this.bookmarks.splice(idx, 1)
      for (const g of this.siblingGroups) {
        const bi = g.bookmarkIds.indexOf(id)
        if (bi >= 0) g.bookmarkIds.splice(bi, 1)
      }
    },
    addGroup(g: SiblingGroup) { this.siblingGroups.push(g) },
    updateGroup(id: string, changes: Partial<SiblingGroup>) { const g = this.groupMap[id]; if (g) Object.assign(g, changes) },
    deleteGroup(id: string) {
      const idx = this.siblingGroups.findIndex(g => g.id === id)
      if (idx >= 0) this.siblingGroups.splice(idx, 1)
    },
    addCategory(cat: Category) { this.categories.push(cat) },
    renameCategory(id: string, name: string) { const c = this.categories.find(c => c.id === id); if (c) c.name = name },
    deleteCategory(id: string) {
      this.bookmarks.forEach(b => { if (b.categoryId === id) b.categoryId = 'uncategorized' })
      this.siblingGroups.forEach(g => { if (g.categoryId === id) g.categoryId = 'uncategorized' })
      const idx = this.categories.findIndex(c => c.id === id)
      if (idx >= 0) this.categories.splice(idx, 1)
    },
    addAttribute(attr: CustomAttribute) { this.customAttributes.push(attr) },
    renameAttribute(id: string, name: string) { const attr = this.customAttributes.find(a => a.id === id); if (attr) attr.name = name },
    deleteAttribute(id: string) {
      const idx = this.customAttributes.findIndex(a => a.id === id)
      if (idx >= 0) this.customAttributes.splice(idx, 1)
      this.bookmarks.forEach(b => { if (b.attributes) delete b.attributes[id] })
      this.siblingGroups.forEach(g => { if (g.attributes) delete g.attributes[id] })
      const ui = useUIStore()
      const ai = ui.activeAttrs.indexOf(id); if (ai >= 0) ui.activeAttrs.splice(ai, 1)
      const ei = ui.excludedAttrs.indexOf(id); if (ei >= 0) ui.excludedAttrs.splice(ei, 1)
    },

    // ── 数据加载/导入 ──
    loadFromStorage() {
      const d = persist.loadFromLocalStorage()
      this.bookmarks = d.bookmarks; this.siblingGroups = d.siblingGroups
      this.categories = d.categories; this.customAttributes = d.customAttributes
      if (d._masterCanary) this._masterCanary = d._masterCanary
    },
    async tryLoadFromIDB(): Promise<boolean> {
      const idbData = await persist.loadFromIDB()
      if (idbData) {
        this.bookmarks = idbData.bookmarks; this.siblingGroups = idbData.siblingGroups
        this.categories = idbData.categories; this.customAttributes = idbData.customAttributes
        if (idbData._masterCanary) this._masterCanary = idbData._masterCanary
        return true
      }
      return false
    },
    importFromData(data: any) {
      const result = {
        categories: [...data.categories],
        bookmarks: [...data.bookmarks],
        customAttributes: [...data.customAttributes],
        siblingGroups: [...data.siblingGroups],
      }
      runMigrations(data, result)
      this.categories = result.categories
      this.bookmarks = result.bookmarks
      this.customAttributes = result.customAttributes
      this.siblingGroups = result.siblingGroups
    },
    _dataSnapshot() {
      return { bookmarks: this.bookmarks, siblingGroups: this.siblingGroups, categories: this.categories, customAttributes: this.customAttributes, _masterCanary: this._masterCanary }
    },
  },
})
