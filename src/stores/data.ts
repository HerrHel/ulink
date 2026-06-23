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
import { searchBookmarkIds, searchGroupIds } from '../lib/search.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../types.js'

interface DataState {
  bookmarks: Bookmark[]
  siblingGroups: SiblingGroup[]
  categories: Category[]
  customAttributes: CustomAttribute[]
  _customCardOrder: Array<{ t: 'g' | 'b'; id: string }> | null
  _cachedStorageInfo: { size: number; percent: number; label: string } | null
  _storageInfoDirty: boolean
  _saveCount: number
  _saveTimer: ReturnType<typeof setTimeout> | null
  _dirtyIds: Set<string>
  _deletedIds: Map<string, 'bookmarks' | 'sibling_groups' | 'categories' | 'custom_attributes'>
  _newIds: Set<string>
  _changedFields: Map<string, Set<string>>
}

// ── 内部辅助：getter 公共 filter+sort 逻辑 ──
function _filterAttrs<T extends { attributes: Record<string, boolean> }>(items: T[], { activeAttrs, excludedAttrs }: { activeAttrs: string[]; excludedAttrs: string[] }): T[] {
  for (const aid of activeAttrs) items = items.filter(i => i.attributes[aid])
  for (const aid of excludedAttrs) items = items.filter(i => !i.attributes[aid])
  return items
}

const _DECAY_LAMBDA = 0.05
const _MS_PER_DAY = 86400000

function _recommendedScore(item: { useCount: number; updatedAt: number }): number {
  const days = (Date.now() - (item.updatedAt || 0)) / _MS_PER_DAY
  return (item.useCount || 0) * Math.exp(-_DECAY_LAMBDA * days)
}

function _sortItems<T>(items: T[], { sortMode, sortDir }: { sortMode: string; sortDir: string }, nameKey: keyof T, dateKey: keyof T): void {
  const d = sortDir === 'asc' ? 1 : -1
  items.sort((a, b) => {
    if (sortMode === 'recommend') return (_recommendedScore(b as any) - _recommendedScore(a as any))
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
    _customCardOrder: null,
    _cachedStorageInfo: null,
    _storageInfoDirty: true,
    _saveCount: 0,
    _saveTimer: null,
    _dirtyIds: new Set<string>(),
    _deletedIds: new Map(),
    _newIds: new Set<string>(),
    _changedFields: new Map(),
  }),

  getters: {
    /** 过滤后的书签列表（排除软删除） */
    filteredBookmarks(state): Bookmark[] {
      const ui = useUIStore()
      let bm = state.bookmarks.filter(b => !b.deletedAt)
      if (ui.curCat !== CAT_ALL) bm = bm.filter(b => b.categoryId === ui.curCat)
      const q = ui.searchQuery
      if (q.trim()) {
        const matchIds = searchBookmarkIds(bm, q, state.customAttributes)
        if (matchIds) bm = bm.filter(b => matchIds.has(b.id))
      }
      bm = _filterAttrs(bm, ui)
      _sortItems(bm, ui, 'title', 'createdAt')
      return bm
    },

    /** 过滤后的组列表（排除软删除） */
    filteredGroups(state): SiblingGroup[] {
      const ui = useUIStore()
      let groups = state.siblingGroups.filter(g => !g.deletedAt)
      if (ui.curCat !== CAT_ALL) groups = groups.filter(g => g.categoryId === ui.curCat)
      const q = ui.searchQuery
      if (q.trim()) {
        const matchIds = searchGroupIds(groups, q, this.bookmarkMap, state.customAttributes)
        if (matchIds) groups = groups.filter(g => matchIds.has(g.id))
      }
      groups = _filterAttrs(groups, ui)
      _sortItems(groups, ui, 'name', 'updatedAt')
      return groups
    },

    /** 回收站：已软删除的书签 */
    trashedBookmarks(state): Bookmark[] {
      return state.bookmarks.filter(b => b.deletedAt).sort((a, b) => (b.deletedAt! - a.deletedAt!))
    },
    /** 回收站：已软删除的组 */
    trashedGroups(state): SiblingGroup[] {
      return state.siblingGroups.filter(g => g.deletedAt).sort((a, b) => (b.deletedAt! - a.deletedAt!))
    },
    /** 回收站：已软删除的分类 */
    trashedCategories(state): Category[] {
      return state.categories.filter(c => c.deletedAt)
    },
    /** 回收站：已软删除的自定义属性 */
    trashedAttributes(state): CustomAttribute[] {
      return state.customAttributes.filter(a => a.deletedAt)
    },
    /** 回收站总数 */
    trashCount(): number {
      return this.trashedBookmarks.length + this.trashedGroups.length + this.trashedCategories.length + this.trashedAttributes.length
    },

    /** O(1) 书签/组查找 Map（含软删除） */
    bookmarkMap(state): Record<string, Bookmark> {
      const map: Record<string, Bookmark> = {}; state.bookmarks.forEach(b => { map[b.id] = b }); return map
    },
    groupMap(state): Record<string, SiblingGroup> {
      const map: Record<string, SiblingGroup> = {}; state.siblingGroups.forEach(g => { map[g.id] = g }); return map
    },
    /** 预计算父→子书签映射（排除软删除） */
    childrenMap(state): Record<string, Bookmark[]> {
      const map: Record<string, Bookmark[]> = {}
      state.bookmarks.forEach(b => {
        if (b.parentId && !b.deletedAt) {
          if (!map[b.parentId]) map[b.parentId] = []
          map[b.parentId].push(b)
        }
      })
      return map
    },
    /** 各分类的卡片计数（排除软删除） */
    cardCounts(state): Record<string, number> {
      const counts: Record<string, number> = {}; let total = 0
      state.bookmarks.forEach(b => { if (!b.parentId && !b.deletedAt) { counts[b.categoryId] = (counts[b.categoryId] || 0) + 1; total++ } })
      state.siblingGroups.forEach(g => { if (!g.deletedAt) { counts[g.categoryId] = (counts[g.categoryId] || 0) + 1; total++ } })
      counts[CAT_ALL] = total
      return counts
    },
    /** 可选择的分类列表（排除"全部"和软删除） */
    selectableCategories(state): Category[] {
      return state.categories.filter(c => c.id !== CAT_ALL && !c.deletedAt)
    },
  },

  actions: {
    // ── CRUD：仅修改数据，调用方负责 save() ──
    _markDirty(...ids: string[]) { for (const id of ids) this._dirtyIds.add(id) },
    drainDirtyIds(): Set<string> {
      const ids = new Set(this._dirtyIds)
      this._dirtyIds.clear()
      return ids
    },
    drainDeletedIds(): Map<string, 'bookmarks' | 'sibling_groups' | 'categories' | 'custom_attributes'> {
      const ids = new Map(this._deletedIds)
      this._deletedIds.clear()
      return ids
    },
    drainNewIds(): Set<string> {
      const ids = new Set(this._newIds)
      this._newIds.clear()
      return ids
    },
    drainChangedFields(): Map<string, Set<string>> {
      const fields = new Map(this._changedFields)
      this._changedFields.clear()
      return fields
    },
    _trackChange(id: string, field: string) {
      let fields = this._changedFields.get(id)
      if (!fields) { fields = new Set(); this._changedFields.set(id, fields) }
      fields.add(field)
    },
    addBookmark(bm: Bookmark) { this.bookmarks.push(bm); this._markDirty(bm.id); this._newIds.add(bm.id) },
    updateBookmark(id: string, changes: Partial<Bookmark>) {
      const bm = this.bookmarkMap[id]
      if (bm) {
        for (const key of Object.keys(changes)) this._trackChange(id, key)
        Object.assign(bm, changes); bm.updatedAt = Date.now(); this._markDirty(id)
      }
    },
    deleteBookmark(id: string) {
      const bm = this.bookmarkMap[id]
      if (bm) {
        bm.deletedAt = Date.now()
        bm.updatedAt = bm.deletedAt
        this._markDirty(id)
      }
      for (const g of this.siblingGroups) {
        const bi = g.bookmarkIds.indexOf(id)
        if (bi >= 0) { g.bookmarkIds.splice(bi, 1); this._markDirty(g.id) }
      }
    },
    addGroup(g: SiblingGroup) { this.siblingGroups.push(g); this._markDirty(g.id); this._newIds.add(g.id) },
    updateGroup(id: string, changes: Partial<SiblingGroup>) {
      const g = this.groupMap[id]
      if (g) {
        for (const key of Object.keys(changes)) this._trackChange(id, key)
        Object.assign(g, changes); g.updatedAt = Date.now(); this._markDirty(id)
      }
    },
    deleteGroup(id: string) {
      const g = this.groupMap[id]
      if (g) {
        g.deletedAt = Date.now()
        g.updatedAt = g.deletedAt
        this._markDirty(id)
      }
    },
    addCategory(cat: Category) { cat.updatedAt = Date.now(); this.categories.push(cat); this._markDirty(cat.id); this._newIds.add(cat.id) },
    renameCategory(id: string, name: string) {
      const c = this.categories.find(c => c.id === id)
      if (c) { c.name = name; c.updatedAt = Date.now(); this._trackChange(id, 'name'); this._markDirty(id) }
    },
    deleteCategory(id: string) {
      this.bookmarks.forEach(b => { if (b.categoryId === id) { b.categoryId = 'uncategorized'; this._trackChange(b.id, 'categoryId'); this._markDirty(b.id) } })
      this.siblingGroups.forEach(g => { if (g.categoryId === id) { g.categoryId = 'uncategorized'; this._trackChange(g.id, 'categoryId'); this._markDirty(g.id) } })
      const c = this.categories.find(c => c.id === id)
      if (c) { c.deletedAt = Date.now(); c.updatedAt = c.deletedAt; this._markDirty(id) }
    },
    addAttribute(attr: CustomAttribute) { attr.updatedAt = Date.now(); this.customAttributes.push(attr); this._markDirty(attr.id); this._newIds.add(attr.id) },
    renameAttribute(id: string, name: string) {
      const attr = this.customAttributes.find(a => a.id === id)
      if (attr) { attr.name = name; attr.updatedAt = Date.now(); this._trackChange(id, 'name'); this._markDirty(id) }
    },
    deleteAttribute(id: string) {
      const attr = this.customAttributes.find(a => a.id === id)
      if (attr) { attr.deletedAt = Date.now(); attr.updatedAt = attr.deletedAt; this._markDirty(id) }
      this.bookmarks.forEach(b => { if (b.attributes) { delete b.attributes[id]; this._markDirty(b.id) } })
      this.siblingGroups.forEach(g => { if (g.attributes) { delete g.attributes[id]; this._markDirty(g.id) } })
      const ui = useUIStore()
      const ai = ui.activeAttrs.indexOf(id); if (ai >= 0) ui.activeAttrs.splice(ai, 1)
      const ei = ui.excludedAttrs.indexOf(id); if (ei >= 0) ui.excludedAttrs.splice(ei, 1)
    },

    // ── 回收站：恢复 ──
    restoreBookmark(id: string) { this._restoreItem(this.bookmarkMap[id], id) },
    restoreGroup(id: string) { this._restoreItem(this.groupMap[id], id) },
    restoreCategory(id: string) { this._restoreItem(this.categories.find(c => c.id === id), id) },
    restoreAttribute(id: string) { this._restoreItem(this.customAttributes.find(a => a.id === id), id) },

    /** 内部辅助：恢复已软删除项 */
    _restoreItem(item: { deletedAt?: number; updatedAt?: number } | undefined, id: string) {
      if (item) { delete item.deletedAt; item.updatedAt = Date.now(); this._markDirty(id) }
    },

    // ── 回收站：永久删除 ──
    permanentDeleteBookmark(id: string) { this._permanentDelete(this.bookmarks, id, 'bookmarks') },
    permanentDeleteGroup(id: string) { this._permanentDelete(this.siblingGroups, id, 'sibling_groups') },
    permanentDeleteCategory(id: string) { this._permanentDelete(this.categories, id, 'categories') },
    permanentDeleteAttribute(id: string) { this._permanentDelete(this.customAttributes, id, 'custom_attributes') },

    /** 内部辅助：永久删除项 */
    _permanentDelete(arr: { id: string }[], id: string, table: 'bookmarks' | 'sibling_groups' | 'categories' | 'custom_attributes') {
      const idx = arr.findIndex(item => item.id === id)
      if (idx >= 0) arr.splice(idx, 1)
      this._dirtyIds.delete(id)
      this._deletedIds.set(id, table)
    },

    /** 清空回收站（永久删除所有已软删除项） */
    emptyTrash() {
      const bms = this.bookmarks.filter(b => b.deletedAt)
      const groups = this.siblingGroups.filter(g => g.deletedAt)
      const cats = this.categories.filter(c => c.deletedAt)
      const attrs = this.customAttributes.filter(a => a.deletedAt)
      for (const b of bms) this.permanentDeleteBookmark(b.id)
      for (const g of groups) this.permanentDeleteGroup(g.id)
      for (const c of cats) this.permanentDeleteCategory(c.id)
      for (const a of attrs) this.permanentDeleteAttribute(a.id)
    },

    /** 自动清理：永久删除超过 30 天的已软删除项 */
    autoCleanupTrash() {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
      const old = (v: { deletedAt?: number }) => v.deletedAt && v.deletedAt < cutoff
      this.bookmarks.filter(old).forEach(b => this.permanentDeleteBookmark(b.id))
      this.siblingGroups.filter(old).forEach(g => this.permanentDeleteGroup(g.id))
      this.categories.filter(old).forEach(c => this.permanentDeleteCategory(c.id))
      this.customAttributes.filter(old).forEach(a => this.permanentDeleteAttribute(a.id))
    },

    // ── 数据加载/导入 ──
    loadFromStorage() {
      const d = persist.loadFromLocalStorage()
      this.bookmarks = d.bookmarks; this.siblingGroups = d.siblingGroups
      this.categories = d.categories; this.customAttributes = d.customAttributes
    },
    async tryLoadFromIDB(): Promise<boolean> {
      const idbData = await persist.loadFromIDB()
      if (idbData) {
        this.bookmarks = idbData.bookmarks; this.siblingGroups = idbData.siblingGroups
        this.categories = idbData.categories; this.customAttributes = idbData.customAttributes
        return true
      }
      return false
    },
    importFromData(data: any) {
      const { categories = [], bookmarks = [], customAttributes = [], siblingGroups = [] } = data || {}
      const result = {
        categories: [...categories],
        bookmarks: [...bookmarks],
        customAttributes: [...customAttributes],
        siblingGroups: [...siblingGroups],
      }
      runMigrations(data, result)
      this.categories = result.categories
      this.bookmarks = result.bookmarks
      this.customAttributes = result.customAttributes
      this.siblingGroups = result.siblingGroups
    },
    _dataSnapshot() {
      return { bookmarks: this.bookmarks, siblingGroups: this.siblingGroups, categories: this.categories, customAttributes: this.customAttributes }
    },
  },
})
