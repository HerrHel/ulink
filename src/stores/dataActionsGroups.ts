/**
 * dataActionsGroups.ts — data store 的组 CRUD 与置顶切换（自 data.ts 逐字迁移，逻辑零改动）
 * togglePin 跨书签/组两实体，归入本文件；组图片云清理在 permanentDeleteGroup。
 */
import { cleanupGroupImagesOnDelete } from '../lib/imageStorage.js'
import { _indexOfById } from '../lib/dataQuery.js'
import { _denyWrite } from './dataShared.js'
import type { DataStoreThis } from './dataShared.js'
import type { SiblingGroup } from '../types.js'

export const groupActions = {
  addGroup(this: DataStoreThis, g: SiblingGroup) { if (_denyWrite()) return; this.siblingGroups = [...this.siblingGroups, g]; this._grpMap[g.id] = g; this._markDirty(g.id); this._newIds.add(g.id); this._searchIndexDirty = true },
  updateGroup(this: DataStoreThis, id: string, changes: Partial<SiblingGroup>) {
    if (_denyWrite()) return
    const idx = _indexOfById(this.siblingGroups, this._grpMap, id)
    if (idx >= 0) {
      this._saveLocalHistory(id, { ...this.siblingGroups[idx] })
      for (const key of Object.keys(changes)) this._trackChange(id, key)
      this.siblingGroups[idx] = { ...this.siblingGroups[idx], ...changes, updatedAt: Date.now() }
      this._grpMap[id] = this.siblingGroups[idx]
      this._markDirty(id)
      this._searchIndexDirty = true
    }
  },
  deleteGroup(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    const idx = _indexOfById(this.siblingGroups, this._grpMap, id)
    if (idx < 0) return
    const g = this.siblingGroups[idx]
    this.siblingGroups[idx] = { ...g, deletedAt: Date.now(), updatedAt: Date.now() }
    this._grpMap[id] = this.siblingGroups[idx]
    this._markDirty(id)
    this._searchIndexDirty = true
  },
  /** 切换置顶状态：已置顶则取消，未置顶则设为当前时间 */
  togglePin(this: DataStoreThis, entityType: 'bookmark' | 'group', id: string) {
    if (_denyWrite()) return
    if (entityType === 'bookmark') {
      const idx = _indexOfById(this.bookmarks, this._bmMap, id)
      if (idx < 0) return
      const bm = this.bookmarks[idx]
      const nextPinnedAt = bm.pinnedAt ? undefined : Date.now()
      this._saveLocalHistory(id, { ...bm })
      this._trackChange(id, 'pinnedAt')
      this.bookmarks[idx] = { ...bm, pinnedAt: nextPinnedAt, updatedAt: Date.now() }
      this._bmMap[id] = this.bookmarks[idx]
      this._markDirty(id)
    } else {
      const idx = _indexOfById(this.siblingGroups, this._grpMap, id)
      if (idx < 0) return
      const g = this.siblingGroups[idx]
      const nextPinnedAt = g.pinnedAt ? undefined : Date.now()
      this._saveLocalHistory(id, { ...g })
      this._trackChange(id, 'pinnedAt')
      this.siblingGroups[idx] = { ...g, pinnedAt: nextPinnedAt, updatedAt: Date.now() }
      this._grpMap[id] = this.siblingGroups[idx]
      this._markDirty(id)
    }
    this._searchIndexDirty = true
  },
  restoreGroup(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    this._restoreItem('sibling_groups', id)
    // r10-attr-restore B1：回填此组被删属性时抹掉的 attributes 键
    this._restoreAttrMemberships(id, 'group')
  },
  permanentDeleteGroup(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    const g = this._grpMap[id]
    if (g) {
      // 组彻底删除 → 清理云端图片（fire-and-forget）。免费计划容量有限，避免孤儿文件占满额度。
      void cleanupGroupImagesOnDelete(id, g.notes || '')
    }
    this._permanentDelete('sibling_groups', id)
    delete this._grpMap[id]
    // r10-attr-restore B1：永久删组时清其在 _deletedAttrMemberships 的预订 membership
    this._dropAttrMemberships(id)
    this._searchIndexDirty = true
  },
}
