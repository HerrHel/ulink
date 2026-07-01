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
import type { Bookmark, SiblingGroup, Category, CustomAttribute, AppData, TableName } from '../types.js'
import type { SortMode, SortDir } from './ui.js'

interface DataState {
  bookmarks: Bookmark[]
  siblingGroups: SiblingGroup[]
  categories: Category[]
  customAttributes: CustomAttribute[]
  // 规范化索引：由 CRUD action 增量维护，getter 直接返回
  _bmMap: Record<string, Bookmark>
  _grpMap: Record<string, SiblingGroup>
  _catMap: Record<string, Category>
  _attrMap: Record<string, CustomAttribute>
  _childrenIdx: Record<string, string[]> // parentId → child bookmark IDs
  _masterCanary: string | import('../types.js').EncryptedPassword | null
  _customCardOrder: Array<{ t: 'g' | 'b'; id: string }> | null
  _cachedStorageInfo: { size: number; percent: number; label: string } | null
  _storageInfoDirty: boolean
  _saveCount: number
  _saveTimer: ReturnType<typeof setTimeout> | null
  _dirtyIds: Set<string>
  _deletedIds: Map<string, TableName>
  _newIds: Set<string>
  _changedFields: Map<string, Set<string>>
  _deletedGroupMemberships: Map<string, string[]> // bookmarkId → groupIds it belonged to before deletion
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

type SortableItem = { useCount: number; order: number; updatedAt: number }

function _sortItems<T extends SortableItem>(items: T[], { sortMode, sortDir }: { sortMode: SortMode; sortDir: SortDir }, nameKey: keyof T, dateKey: keyof T): void {
  const d = sortDir === 'asc' ? 1 : -1
  items.sort((a, b) => {
    if (sortMode === 'recommend') return (_recommendedScore(b) - _recommendedScore(a))
    if (sortMode === 'useCount') return (a.useCount - b.useCount) * d
    if (sortMode === 'title') return String(a[nameKey]).localeCompare(String(b[nameKey])) * d
    if (sortMode === 'dateDesc') return (((b[dateKey] as number) || 0) - ((a[dateKey] as number) || 0)) * d
    if (sortMode === 'dateAsc') return (((a[dateKey] as number) || 0) - ((b[dateKey] as number) || 0)) * d
    return (a.order - b.order) * d
  })
}

export const useDataStore = defineStore('data', {
  state: (): DataState => ({
    bookmarks: [],
    siblingGroups: [],
    categories: [],
    customAttributes: [],
    _masterCanary: null,
    _bmMap: {},
    _grpMap: {},
    _catMap: {},
    _attrMap: {},
    _childrenIdx: {},
    _customCardOrder: null,
    _cachedStorageInfo: null,
    _storageInfoDirty: true,
    _saveCount: 0,
    _saveTimer: null,
    _dirtyIds: new Set<string>(),
    _deletedIds: new Map(),
    _newIds: new Set<string>(),
    _changedFields: new Map(),
    _deletedGroupMemberships: new Map(),
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

    /** O(1) 书签查找 Map（含软删除——由 _syncMaps 维护，懒回退） */
    bookmarkMap(state): Record<string, Bookmark> {
      if (Object.keys(state._bmMap).length !== state.bookmarks.length) {
        const map: Record<string, Bookmark> = {}; state.bookmarks.forEach(b => { map[b.id] = b }); return map
      }
      return state._bmMap
    },
    groupMap(state): Record<string, SiblingGroup> {
      if (Object.keys(state._grpMap).length !== state.siblingGroups.length) {
        const map: Record<string, SiblingGroup> = {}; state.siblingGroups.forEach(g => { map[g.id] = g }); return map
      }
      return state._grpMap
    },
    /** 预计算父→子书签映射（由 _syncMaps 维护，排除软删除） */
    childrenMap(state): Record<string, Bookmark[]> {
      // 索引未构建或不同步时回退到手动计算
      if (Object.keys(state._childrenIdx).length === 0 && state.bookmarks.some(b => b.parentId)) {
        const map: Record<string, Bookmark[]> = {}
        state.bookmarks.forEach(b => {
          if (b.parentId && !b.deletedAt) {
            if (!map[b.parentId]) map[b.parentId] = []
            map[b.parentId].push(b)
          }
        })
        return map
      }
      // 按需将 ID 数组解析为 Bookmark 对象
      const bmMap = state._bmMap
      const result: Record<string, Bookmark[]> = {}
      for (const pid of Object.keys(state._childrenIdx)) {
        result[pid] = state._childrenIdx[pid]
          .map(id => bmMap[id] || state.bookmarks.find(b => b.id === id))
          .filter(b => b && !b.deletedAt)
      }
      return result
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
    // ── 索引维护：从数组重建所有索引 ──
    _syncMaps() {
      const bmMap: Record<string, Bookmark> = {}
      for (const b of this.bookmarks) bmMap[b.id] = b
      this._bmMap = bmMap

      const grpMap: Record<string, SiblingGroup> = {}
      for (const g of this.siblingGroups) grpMap[g.id] = g
      this._grpMap = grpMap

      const catMap: Record<string, Category> = {}
      for (const c of this.categories) catMap[c.id] = c
      this._catMap = catMap

      const attrMap: Record<string, CustomAttribute> = {}
      for (const a of this.customAttributes) attrMap[a.id] = a
      this._attrMap = attrMap

      const childIdx: Record<string, string[]> = {}
      for (const b of this.bookmarks) {
        if (b.parentId && !b.deletedAt) {
          if (!childIdx[b.parentId]) childIdx[b.parentId] = []
          childIdx[b.parentId].push(b.id)
        }
      }
      this._childrenIdx = childIdx
    },

    // ── CRUD：仅修改数据，调用方负责 save() ──
    _markDirty(...ids: string[]) { for (const id of ids) this._dirtyIds.add(id) },
    drainDirtyIds(): Set<string> {
      const ids = new Set(this._dirtyIds)
      this._dirtyIds.clear()
      return ids
    },
    drainDeletedIds(): Map<string, TableName> {
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
    addBookmark(bm: Bookmark) {
      this.bookmarks = [...this.bookmarks, bm]
      this._bmMap[bm.id] = bm
      if (bm.parentId) {
        const sib = this._childrenIdx[bm.parentId]
        if (sib) sib.push(bm.id)
        else this._childrenIdx[bm.parentId] = [bm.id]
      }
      this._markDirty(bm.id); this._newIds.add(bm.id)
    },
    /** 保存旧状态到本地历史（C2：覆盖前留底）。fire-and-forget。 */
    _saveLocalHistory(id: string, data: Record<string, unknown>) {
      const max = useUIStore().historyMax || 10
      try {
        const key = 'lv_hist:' + id
        const raw = localStorage.getItem(key)
        const arr = raw ? JSON.parse(raw) : []
        arr.unshift({ id: Date.now(), data, created_at: new Date().toISOString() })
        localStorage.setItem(key, JSON.stringify(arr.slice(0, max)))
      } catch (_) { /* fire-and-forget */ }
    },
    updateBookmark(id: string, changes: Partial<Bookmark>) {
      const idx = this.bookmarks.findIndex(b => b.id === id)
      if (idx >= 0) {
        this._saveLocalHistory(id, { ...this.bookmarks[idx] })
        for (const key of Object.keys(changes)) this._trackChange(id, key)
        this.bookmarks[idx] = { ...this.bookmarks[idx], ...changes, updatedAt: Date.now() }
        this._bmMap[id] = this.bookmarks[idx]
        this._markDirty(id)
      }
    },
    deleteBookmark(id: string) {
      const idx = this.bookmarks.findIndex(b => b.id === id)
      if (idx < 0) return
      const bm = this.bookmarks[idx]
      this.bookmarks[idx] = { ...bm, deletedAt: Date.now(), updatedAt: Date.now() }
      this._bmMap[id] = this.bookmarks[idx]
      this._markDirty(id)
      // 从 childrenIdx 中移除
      if (bm.parentId) {
        const sib = this._childrenIdx[bm.parentId]
        if (sib) {
          const ci = sib.indexOf(id)
          if (ci >= 0) sib.splice(ci, 1)
        }
      }
      // 记录被删除书签原本所属的组，以便恢复时还原
      const groupIds: string[] = []
      for (let gi = 0; gi < this.siblingGroups.length; gi++) {
        const g = this.siblingGroups[gi]
        const bi = g.bookmarkIds.indexOf(id)
        if (bi >= 0) {
          groupIds.push(g.id)
          this.siblingGroups[gi] = { ...g, bookmarkIds: g.bookmarkIds.filter((_, i) => i !== bi) }
          this._grpMap[g.id] = this.siblingGroups[gi]
          this._markDirty(g.id)
        }
      }
      if (groupIds.length) this._deletedGroupMemberships.set(id, groupIds)
    },
    addGroup(g: SiblingGroup) { this.siblingGroups = [...this.siblingGroups, g]; this._grpMap[g.id] = g; this._markDirty(g.id); this._newIds.add(g.id) },
    updateGroup(id: string, changes: Partial<SiblingGroup>) {
      const idx = this.siblingGroups.findIndex(g => g.id === id)
      if (idx >= 0) {
        this._saveLocalHistory(id, { ...this.siblingGroups[idx] })
        for (const key of Object.keys(changes)) this._trackChange(id, key)
        this.siblingGroups[idx] = { ...this.siblingGroups[idx], ...changes, updatedAt: Date.now() }
        this._grpMap[id] = this.siblingGroups[idx]
        this._markDirty(id)
      }
    },
    deleteGroup(id: string) {
      const idx = this.siblingGroups.findIndex(g => g.id === id)
      if (idx < 0) return
      const g = this.siblingGroups[idx]
      this.siblingGroups[idx] = { ...g, deletedAt: Date.now(), updatedAt: Date.now() }
      this._grpMap[id] = this.siblingGroups[idx]
      this._markDirty(id)
    },
    addCategory(cat: Category) {
      cat.updatedAt = Date.now()
      this.categories = [...this.categories, cat]
      this._catMap[cat.id] = cat
      this._markDirty(cat.id); this._newIds.add(cat.id)
    },
    renameCategory(id: string, name: string) {
      const idx = this.categories.findIndex(c => c.id === id)
      if (idx >= 0) {
        this._trackChange(id, 'name')
        this.categories[idx] = { ...this.categories[idx], name, updatedAt: Date.now() }
        this._catMap[id] = this.categories[idx]
        this._markDirty(id)
      }
    },
    deleteCategory(id: string) {
      const now = Date.now()
      this.bookmarks = this.bookmarks.map(b =>
        b.categoryId === id ? { ...b, categoryId: 'uncategorized', updatedAt: now } : b
      )
      this.siblingGroups = this.siblingGroups.map(g =>
        g.categoryId === id ? { ...g, categoryId: 'uncategorized', updatedAt: now } : g
      )
      // 同步索引
      for (const b of this.bookmarks) this._bmMap[b.id] = b
      for (const g of this.siblingGroups) this._grpMap[g.id] = g
      const cIdx = this.categories.findIndex(c => c.id === id)
      if (cIdx >= 0) {
        this._trackChange(id, 'deletedAt')
        this.categories[cIdx] = { ...this.categories[cIdx], deletedAt: Date.now(), updatedAt: Date.now() }
        this._catMap[id] = this.categories[cIdx]
        this._markDirty(id)
      }
    },
    addAttribute(attr: CustomAttribute) {
      attr.updatedAt = Date.now()
      this.customAttributes = [...this.customAttributes, attr]
      this._attrMap[attr.id] = attr
      this._markDirty(attr.id); this._newIds.add(attr.id)
    },
    renameAttribute(id: string, name: string) {
      const idx = this.customAttributes.findIndex(a => a.id === id)
      if (idx >= 0) {
        this._trackChange(id, 'name')
        this.customAttributes[idx] = { ...this.customAttributes[idx], name, updatedAt: Date.now() }
        this._attrMap[id] = this.customAttributes[idx]
        this._markDirty(id)
      }
    },
    deleteAttribute(id: string) {
      const aIdx = this.customAttributes.findIndex(a => a.id === id)
      if (aIdx >= 0) {
        this.customAttributes[aIdx] = { ...this.customAttributes[aIdx], deletedAt: Date.now(), updatedAt: Date.now() }
        this._attrMap[id] = this.customAttributes[aIdx]
        this._markDirty(id)
      }
      const now = Date.now()
      this.bookmarks = this.bookmarks.map(b => {
        if (b.attributes && id in b.attributes) {
          const next = { ...b, attributes: { ...b.attributes }, updatedAt: now }
          delete next.attributes[id]
          this._bmMap[b.id] = next
          return next
        }
        return b
      })
      this.siblingGroups = this.siblingGroups.map(g => {
        if (g.attributes && id in g.attributes) {
          const next = { ...g, attributes: { ...g.attributes }, updatedAt: now }
          delete next.attributes[id]
          this._grpMap[g.id] = next
          return next
        }
        return g
      })
      const ui = useUIStore()
      const ai = ui.activeAttrs.indexOf(id); if (ai >= 0) ui.activeAttrs.splice(ai, 1)
      const ei = ui.excludedAttrs.indexOf(id); if (ei >= 0) ui.excludedAttrs.splice(ei, 1)
    },

    // ── 回收站：恢复 ──
    restoreBookmark(id: string) {
      this._restoreItem('bookmarks', id)
      // 恢复被删除书签原本所属的组关系
      const groupIds = this._deletedGroupMemberships.get(id)
      if (groupIds) {
        for (const gid of groupIds) {
          const gIdx = this.siblingGroups.findIndex(g => g.id === gid)
          if (gIdx >= 0 && this.siblingGroups[gIdx].bookmarkIds.indexOf(id) === -1) {
            const g = this.siblingGroups[gIdx]
            this.siblingGroups[gIdx] = { ...g, bookmarkIds: [...g.bookmarkIds, id] }
            this._grpMap[gid] = this.siblingGroups[gIdx]
            this._markDirty(g.id)
          }
        }
        this._deletedGroupMemberships.delete(id)
      }
    },
    restoreGroup(id: string) { this._restoreItem('sibling_groups', id) },
    restoreCategory(id: string) { this._restoreItem('categories', id) },
    restoreAttribute(id: string) { this._restoreItem('custom_attributes', id) },

    /** 内部辅助：恢复已软删除项 */
    _restoreItem(table: TableName, id: string) {
      const stateKey = table === 'sibling_groups' ? 'siblingGroups' : table === 'custom_attributes' ? 'customAttributes' : table
      const arr = (this as any)[stateKey]
      const idx = (arr as any[]).findIndex((i: any) => i.id === id)
      if (idx >= 0) {
        const item = (arr as any[])[idx]
        const next = { ...item }
        delete next.deletedAt
        next.updatedAt = Date.now()
        ;(arr as any[])[idx] = next
        // 更新索引
        const mapKey = { bookmarks: '_bmMap', sibling_groups: '_grpMap', categories: '_catMap', custom_attributes: '_attrMap' }[table]!
        ;(this as any)[mapKey][id] = next
        this._markDirty(id)
      }
    },

    // ── 回收站：永久删除 ──
    permanentDeleteBookmark(id: string) {
      this._permanentDelete('bookmarks', id)
      delete this._bmMap[id]
      this._deletedGroupMemberships.delete(id)
    },
    permanentDeleteGroup(id: string) { this._permanentDelete('sibling_groups', id); delete this._grpMap[id] },
    permanentDeleteCategory(id: string) { this._permanentDelete('categories', id); delete this._catMap[id] },
    permanentDeleteAttribute(id: string) { this._permanentDelete('custom_attributes', id); delete this._attrMap[id] },

    /** 内部辅助：永久删除项 */
    _permanentDelete(key: TableName, id: string) {
      const stateKey = key === 'sibling_groups' ? 'siblingGroups' : key === 'custom_attributes' ? 'customAttributes' : key
      this[stateKey] = (this[stateKey] as any[]).filter((item: any) => item.id !== id)
      this._dirtyIds.delete(id)
      this._deletedIds.set(id, key)
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
      this._syncMaps()
    },

    // ── 数据加载/导入 ──
    loadFromStorage() {
      const d = persist.loadFromLocalStorage()
      this.bookmarks = d.bookmarks; this.siblingGroups = d.siblingGroups
      this.categories = d.categories; this.customAttributes = d.customAttributes
      this._syncMaps()
    },
    async tryLoadFromIDB(): Promise<boolean> {
      const idbData = await persist.loadFromIDB()
      if (idbData) {
        runMigrations(idbData, idbData)
        this.bookmarks = idbData.bookmarks; this.siblingGroups = idbData.siblingGroups
        this.categories = idbData.categories; this.customAttributes = idbData.customAttributes
        this._syncMaps()
        return true
      }
      return false
    },
    importFromData(data: Partial<AppData>) {
      const { categories = [], bookmarks = [], customAttributes = [], siblingGroups = [] } = data || {}
      // 防御性结构检查：确保输入是包含 id 的对象数组
      if (!Array.isArray(bookmarks) || !Array.isArray(categories) || !Array.isArray(customAttributes) || !Array.isArray(siblingGroups)) return
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
      this._syncMaps()
    },
    _dataSnapshot() {
      return { bookmarks: this.bookmarks, siblingGroups: this.siblingGroups, categories: this.categories, customAttributes: this.customAttributes }
    },
  },
})
