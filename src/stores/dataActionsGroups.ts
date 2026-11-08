/**
 * dataActionsGroups.ts — data store 的组 CRUD 与置顶切换（自 data.ts 逐字迁移，逻辑零改动）
 * togglePin 跨书签/组两实体，归入本文件；组图片云清理在 permanentDeleteGroup。
 */
import { cleanupGroupImagesOnDelete } from '../lib/imageStorage.js'
import { _indexOfById } from '../lib/dataQuery.js'
import { _denyWrite } from './dataShared.js'
import { useUIStore } from './ui.js'
import { ATTR_IS_GROUP } from '../config/constants.js'
import type { DataStoreThis } from './dataShared.js'
import type { SiblingGroup } from '../types.js'

export const groupActions = {
  addGroup(this: DataStoreThis, g: SiblingGroup) {
    if (_denyWrite()) return
    const attributes = { ...g.attributes, [ATTR_IS_GROUP]: true }
    const group = { ...g, attributes }
    this.siblingGroups = [...this.siblingGroups, group]
    this._grpMap[group.id] = group
    this._markDirty(group.id)
    this._newIds.add(group.id)
    this._searchIndexDirty = true
  },
  updateGroup(this: DataStoreThis, id: string, changes: Partial<SiblingGroup>) {
    if (_denyWrite()) return
    const idx = _indexOfById(this.siblingGroups, this._grpMap, id)
    if (idx >= 0) {
      this._saveLocalHistory(id, { ...this.siblingGroups[idx] })
      const appliedChanges = { ...changes }
      if (appliedChanges.attributes) {
        appliedChanges.attributes = { ...appliedChanges.attributes, [ATTR_IS_GROUP]: true }
      }
      for (const key of Object.keys(appliedChanges)) {
        if ((appliedChanges as Record<string, unknown>)[key] !== (this.siblingGroups[idx] as Record<string, unknown>)[key]) {
          this._trackChange(id, key)
        }
      }
      const updated = { ...this.siblingGroups[idx], ...appliedChanges, updatedAt: Date.now() }
      if (!updated.attributes) {
        updated.attributes = { [ATTR_IS_GROUP]: true }
      } else {
        updated.attributes[ATTR_IS_GROUP] = true
      }
      this.siblingGroups[idx] = updated
      this._grpMap[id] = updated
      this._markDirty(id)
      this._searchIndexDirty = true
    }
  },
  /** 组 useCount 静默累加（R-RESURRECT）：聚焦/点击组时不 bump updatedAt、不标脏、不写历史，避免离线墓碑被复活 */
  bumpGroupUseCount(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    const g: SiblingGroup | undefined = this._grpMap[id]
    if (!g || g.deletedAt) return
    g.useCount = (g.useCount || 0) + 1
  },
  deleteGroup(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    const idx = _indexOfById(this.siblingGroups, this._grpMap, id)
    if (idx < 0) return
    const g = this.siblingGroups[idx]
    this.siblingGroups[idx] = { ...g, deletedAt: Date.now(), updatedAt: Date.now() }
    this._grpMap[id] = this.siblingGroups[idx]
    this._trackChange(id, 'deletedAt')
    this._markDirty(id)
    const ui = useUIStore()
    if (ui.focusedGroupId === id) ui.focusedGroupId = null
    const dIdx = ui.detailCards.indexOf('group:' + id)
    if (dIdx >= 0) ui.detailCards.splice(dIdx, 1)
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
    const ui = useUIStore()
    if (ui.focusedGroupId === id) ui.focusedGroupId = null
    const dIdx = ui.detailCards.indexOf('group:' + id)
    if (dIdx >= 0) ui.detailCards.splice(dIdx, 1)
    this._searchIndexDirty = true
  },
}
