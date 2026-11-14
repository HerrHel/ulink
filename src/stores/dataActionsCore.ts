/**
 * dataActionsCore.ts — data store 的索引维护 / 脏标记 / 搜索版本 / 本地历史 / 回收站通用底层
 * 自 data.ts 逐字迁移，逻辑零改动。实体 CRUD 见 dataActions{Bookmarks,Groups,Categories,Attributes}.ts，
 * 加载/导入/空间切换见 dataActionsIO.ts。
 */
import { useUIStore } from './ui.js'
import { safeGetItem, safeSetItem, safeJsonParse } from '../lib/storageSafe.js'
import { localHistoryKey, removeLocalHistory } from './storage.js'
import { _indexOfById } from '../lib/dataQuery.js'
import { cloneDeep } from '../lib/clone.js'
import { _denyWrite, _histDebounceTimers, _histDebounceData, _HISTORY_DEBOUNCE_MS } from './dataShared.js'
import { ATTR_IS_GROUP, CAT_ALL, CAT_UNCATEGORIZED } from '../config/constants.js'
import type { DataStoreThis } from './dataShared.js'
import type { TableName } from '../types.js'

export const coreActions = {
  // ── 索引维护：从数组重建所有索引 ──
  _syncMaps(this: DataStoreThis) {
    const bmMap: Record<string, import('../types.js').Bookmark> = {}
    for (const b of this.bookmarks) bmMap[b.id] = b
    this._bmMap = bmMap

    const grpMap: Record<string, import('../types.js').SiblingGroup> = {}
    for (const g of this.siblingGroups) grpMap[g.id] = g
    this._grpMap = grpMap

    const catMap: Record<string, import('../types.js').Category> = {}
    for (const c of this.categories) catMap[c.id] = c
    this._catMap = catMap

    const attrMap: Record<string, import('../types.js').CustomAttribute> = {}
    for (const a of this.customAttributes) attrMap[a.id] = a
    this._attrMap = attrMap

    const childIdx: Record<string, string[]> = {}
    const hasCats = this.categories.length > 0
    for (const b of this.bookmarks) {
      if (hasCats && b.categoryId && b.categoryId !== CAT_UNCATEGORIZED && b.categoryId !== CAT_ALL && (!catMap[b.categoryId] || catMap[b.categoryId].deletedAt)) {
        // 2026-11-14 审计 #25：这类「清洗孤儿引用」是真实改写，必须入脏并 bump
        // 时间戳，否则内存改了但 IDB/云端还是旧引用；指纹校验随后才不会早退。
        b.categoryId = CAT_UNCATEGORIZED
        b.updatedAt = Date.now()
        this._markDirty(b.id)
      }
      if (b.parentId) {
        const parent = bmMap[b.parentId]
        if (b.parentId === b.id || !parent) {
          b.parentId = null
          b.updatedAt = Date.now()
          this._markDirty(b.id)
        } else {
          // 深度防环：检测祖先链中是否回溯到自身或存在间接成环
          let ancestorId: string | null = b.parentId
          const visited = new Set<string>([b.id])
          let hasCycle = false
          while (ancestorId) {
            if (visited.has(ancestorId)) {
              hasCycle = true
              break
            }
            visited.add(ancestorId)
            ancestorId = bmMap[ancestorId]?.parentId || null
          }
          if (hasCycle) {
            b.parentId = null
            b.updatedAt = Date.now()
            this._markDirty(b.id)
          } else if (!parent.deletedAt && !b.deletedAt) {
            if (!childIdx[b.parentId]) childIdx[b.parentId] = []
            childIdx[b.parentId].push(b.id)
          }
        }
      }
    }
    for (const g of this.siblingGroups) {
      if (hasCats && g.categoryId && g.categoryId !== CAT_UNCATEGORIZED && g.categoryId !== CAT_ALL && (!catMap[g.categoryId] || catMap[g.categoryId].deletedAt)) {
        g.categoryId = CAT_UNCATEGORIZED
        g.updatedAt = Date.now()
        this._markDirty(g.id)
      }
    }
    this._childrenIdx = childIdx
  },

  // ── CRUD：仅修改数据，调用方负责 save() ──
  _markDirty(this: DataStoreThis, ...ids: string[]) { for (const id of ids) this._dirtyIds.add(id) },

  /** 增加搜索版本号（立即重建索引，用于批量操作） */
  _bumpSearchVersion(this: DataStoreThis) { this._searchVersion++ },
  /** 防抖版本：批量 CRUD 时仅最后一次递增 version，减少 Fuse 重建 */
  _debouncedBumpSearchVersion(this: DataStoreThis) {
    if (this._searchVersionTimer) clearTimeout(this._searchVersionTimer)
    this._searchVersionTimer = setTimeout(() => { this._searchVersion++ }, 0)
  },
  drainDirtyIds(this: DataStoreThis): Set<string> {
    const ids = new Set(this._dirtyIds)
    this._dirtyIds.clear()
    return ids
  },
  drainDeletedIds(this: DataStoreThis): Map<string, TableName> {
    const ids = new Map(this._deletedIds)
    this._deletedIds.clear()
    return ids
  },
  drainNewIds(this: DataStoreThis): Set<string> {
    const ids = new Set(this._newIds)
    this._newIds.clear()
    return ids
  },
  drainChangedFields(this: DataStoreThis): Map<string, Set<string>> {
    const fields = new Map(this._changedFields)
    this._changedFields.clear()
    return fields
  },
  _trackChange(this: DataStoreThis, id: string, field: string) {
    let fields = this._changedFields.get(id)
    if (!fields) { fields = new Set(); this._changedFields.set(id, fields) }
    fields.add(field)
    this._searchIndexDirty = true
  },
  /** 保存旧状态到本地历史（C2：覆盖前留底）。含 500ms 防抖，连续编辑保留初始基准快照。 */
  _saveLocalHistory(this: DataStoreThis, id: string, data: Record<string, unknown>) {
    if (!_histDebounceData.has(id)) {
      _histDebounceData.set(id, cloneDeep(data))
    }
    if (_histDebounceTimers.has(id)) return
    _histDebounceTimers.set(id, setTimeout(() => {
      _histDebounceTimers.delete(id)
      const initialData = _histDebounceData.get(id)
      _histDebounceData.delete(id)
      if (!initialData) return
      let max = 10
      try { max = useUIStore().historyMax || 10 } catch { /* ignore */ }
      const key = localHistoryKey(id)
      const arr = safeJsonParse<unknown[]>(safeGetItem(key), [])
      if (!Array.isArray(arr)) return
      try {
        arr.unshift({ id: Date.now(), data: initialData, created_at: new Date().toISOString() })
        safeSetItem(key, JSON.stringify(arr.slice(0, max)))
      } catch (e) {
        console.warn('[LinkVault] Failed to save local history for', id, e)
      }
    }, _HISTORY_DEBOUNCE_MS))
  },

  /** 内部辅助：通用型恢复已软删除项 */
  _restoreItem(this: DataStoreThis, table: TableName, id: string) {
    const handlers: Record<TableName, () => void> = {
      bookmarks: () => this._restoreFrom(this.bookmarks, this._bmMap, id),
      sibling_groups: () => this._restoreFrom(this.siblingGroups, this._grpMap, id),
      categories: () => this._restoreFrom(this.categories, this._catMap, id),
      custom_attributes: () => this._restoreFrom(this.customAttributes, this._attrMap, id),
    }
    handlers[table]?.()
  },
  _restoreFrom<T extends { id: string; deletedAt?: number; updatedAt?: number }>(
    this: DataStoreThis, arr: T[], map: Record<string, T>, id: string
  ) {
    const idx = _indexOfById(arr, map, id)
    if (idx < 0) return
    const next = { ...arr[idx], updatedAt: Date.now() }
    delete (next as { deletedAt?: unknown }).deletedAt
    arr[idx] = next
    map[id] = next
    this._trackChange(id, 'deletedAt')
    this._markDirty(id); this._searchIndexDirty = true
  },

  /** 内部辅助：永久删除项 */
  _permanentDelete(this: DataStoreThis, key: TableName, id: string) {
    if (key === 'custom_attributes' && id === ATTR_IS_GROUP) return
    if (key === 'categories' && (id === CAT_ALL || id === CAT_UNCATEGORIZED)) return
    const handlers: Record<TableName, () => void> = {
      bookmarks: () => { this.bookmarks = this.bookmarks.filter(b => b.id !== id) },
      sibling_groups: () => { this.siblingGroups = this.siblingGroups.filter(g => g.id !== id) },
      categories: () => { this.categories = this.categories.filter(c => c.id !== id) },
      custom_attributes: () => { this.customAttributes = this.customAttributes.filter(a => a.id !== id) },
    }
    handlers[key]?.()
    this._dirtyIds.delete(id)
    this._newIds.delete(id)
    this._deletedIds.set(id, key)
    try {
      removeLocalHistory(id)
    } catch { /* ignore */ }
    const pendingTimer = _histDebounceTimers.get(id)
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      _histDebounceTimers.delete(id)
    }
    _histDebounceData.delete(id)
  },

  /** 清空回收站（永久删除所有已软删除项） */
  emptyTrash(this: DataStoreThis) {
    if (_denyWrite()) return
    const bms = this.bookmarks.filter(b => b.deletedAt)
    const groups = this.siblingGroups.filter(g => g.deletedAt)
    const cats = this.categories.filter(c => c.deletedAt)
    const attrs = this.customAttributes.filter(a => a.deletedAt)
    for (const b of bms) this.permanentDeleteBookmark(b.id, { skipPersist: true })
    for (const g of groups) this.permanentDeleteGroup(g.id)
    for (const c of cats) this.permanentDeleteCategory(c.id)
    for (const a of attrs) this.permanentDeleteAttribute(a.id, { skipPersist: true })
    this._persistDeletedGroupMemberships()
    this._persistDeletedAttrMemberships()
    this._syncMaps()
  },
}
