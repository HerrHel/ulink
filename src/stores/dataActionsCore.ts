/**
 * dataActionsCore.ts — data store 的索引维护 / 脏标记 / 搜索版本 / 本地历史 / 回收站通用底层
 * 自 data.ts 逐字迁移，逻辑零改动。实体 CRUD 见 dataActions{Bookmarks,Groups,Categories,Attributes}.ts，
 * 加载/导入/空间切换见 dataActionsIO.ts。
 */
import { useUIStore } from './ui.js'
import { safeGetItem, safeSetItem, safeJsonParse } from '../lib/storageSafe.js'
import { localHistoryKey } from './storage.js'
import { _indexOfById } from '../lib/dataQuery.js'
import { _denyWrite, _histDebounceTimers, _histDebounceData, _HISTORY_DEBOUNCE_MS } from './dataShared.js'
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
    for (const b of this.bookmarks) {
      if (b.parentId && !b.deletedAt) {
        if (!childIdx[b.parentId]) childIdx[b.parentId] = []
        childIdx[b.parentId].push(b.id)
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
  /** 保存旧状态到本地历史（C2：覆盖前留底）。含 500ms 防抖，同一 id 连续变更只保留最后一次快照。 */
  _saveLocalHistory(this: DataStoreThis, id: string, data: Record<string, unknown>) {
    _histDebounceData.set(id, data)
    if (_histDebounceTimers.has(id)) return  // 已有计时器运行中，仅更新最新 data
    _histDebounceTimers.set(id, setTimeout(() => {
      _histDebounceTimers.delete(id)
      const latestData = _histDebounceData.get(id)
      _histDebounceData.delete(id)
      if (!latestData) return
      const max = useUIStore().historyMax || 10
      const key = localHistoryKey(id)
      const arr = safeJsonParse<unknown[]>(safeGetItem(key), [])
      if (!Array.isArray(arr)) return
      arr.unshift({ id: Date.now(), data: latestData, created_at: new Date().toISOString() })
      safeSetItem(key, JSON.stringify(arr.slice(0, max)))
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
    this._markDirty(id); this._searchIndexDirty = true
  },

  /** 内部辅助：永久删除项 */
  _permanentDelete(this: DataStoreThis, key: TableName, id: string) {
    const handlers: Record<TableName, () => void> = {
      bookmarks: () => { this.bookmarks = this.bookmarks.filter(b => b.id !== id) },
      sibling_groups: () => { this.siblingGroups = this.siblingGroups.filter(g => g.id !== id) },
      categories: () => { this.categories = this.categories.filter(c => c.id !== id) },
      custom_attributes: () => { this.customAttributes = this.customAttributes.filter(a => a.id !== id) },
    }
    handlers[key]?.()
    this._dirtyIds.delete(id)
    this._deletedIds.set(id, key)
  },

  /** 清空回收站（永久删除所有已软删除项） */
  emptyTrash(this: DataStoreThis) {
    if (_denyWrite()) return
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
}
