/**
 * dataActionsBookmarks.ts — data store 的书签 CRUD（自 data.ts 逐字迁移，逻辑零改动）
 * deleteBookmark / restoreBookmark / permanentDeleteBookmark 含跨实体级联（组关系、子索引、
 * 属性 membership），经 `this` 直达全 store——这是保持单 store 组合而非拆多 store 的原因之一。
 */
import { safeGetItem, safeSetItem, safeJsonParse } from '../lib/storageSafe.js'
import { _indexOfById } from '../lib/dataQuery.js'
import { _denyWrite, DGM_KEY } from './dataShared.js'
import type { DataStoreThis } from './dataShared.js'
import type { Bookmark } from '../types.js'

export const bookmarkActions = {
  /** L10：现存书签最大 order + 1，新建书签统一入口 */
  nextBookmarkOrder(this: DataStoreThis): number {
    return this.bookmarks.reduce((m, b) => b.order > m ? b.order : m, -1) + 1
  },

  /**
   * PERF-4：批量写 bookmark.attributes，合并 dirty，末尾一次 _bumpSearchVersion。
   * 用于死链全量检查等「多 id 同字段」场景，避免 N 次 updateBookmark 风暴。
   */
  batchPatchBookmarkAttributes(this: DataStoreThis, patches: Record<string, Record<string, unknown>>) {
    if (_denyWrite()) return
    const ids = Object.keys(patches)
    if (!ids.length) return
    let bumped = false
    for (const id of ids) {
      const idx = _indexOfById(this.bookmarks, this._bmMap, id)
      if (idx < 0) continue
      const prev = this.bookmarks[idx]
      this._saveLocalHistory(id, { ...prev })
      this._trackChange(id, 'attributes')
      this.bookmarks[idx] = {
        ...prev,
        attributes: patches[id] as Bookmark['attributes'],
        updatedAt: Date.now(),
      }
      this._bmMap[id] = this.bookmarks[idx]
      this._markDirty(id)
      bumped = true
    }
    if (bumped) this._searchIndexDirty = true
  },

  /** 持久化 _deletedGroupMemberships 到 localStorage，用于恢复时跨会话保持组关联 */
  _persistDeletedGroupMemberships(this: DataStoreThis) {
    const obj: Record<string, string[]> = {}
    for (const [id, groupIds] of this._deletedGroupMemberships) obj[id] = groupIds
    safeSetItem(DGM_KEY, JSON.stringify(obj))
  },
  /** 从 localStorage 恢复 _deletedGroupMemberships */
  _restoreDeletedGroupMemberships(this: DataStoreThis) {
    const obj = safeJsonParse<Record<string, string[]> | null>(safeGetItem(DGM_KEY), null)
    if (obj) this._deletedGroupMemberships = new Map(Object.entries(obj))
  },
  addBookmark(this: DataStoreThis, bm: Bookmark) {
    if (_denyWrite()) return
    const entry = { ...bm }
    this.bookmarks = [...this.bookmarks, entry]
    this._bmMap[entry.id] = entry
    if (entry.parentId) {
      const sib = this._childrenIdx[entry.parentId]
      if (sib) sib.push(entry.id)
      else this._childrenIdx[entry.parentId] = [entry.id]
    }
    this._markDirty(entry.id); this._newIds.add(entry.id)
    this._searchIndexDirty = true
  },
  updateBookmark(this: DataStoreThis, id: string, changes: Partial<Bookmark>) {
    if (_denyWrite()) return
    const idx = _indexOfById(this.bookmarks, this._bmMap, id)
    if (idx >= 0) {
      const prev = this.bookmarks[idx]
      this._saveLocalHistory(id, { ...prev })
      for (const key of Object.keys(changes)) {
        // LOCK-FIX：仅 track 真实变化的字段。全量 patch 调用方（saveBm 编辑/移动书签等）
        // 会把未改动的 username 等字段一并放进 changes，无条件 track 会使锁定态下
        // 仅改分类/标题的书签被 _opNeedsUnlock 误判为「触及敏感字段」，同步徽章误显
        // 「N 项等待解锁后同步」。值未变的字段不 track：partial push 也不推送，云端
        // 值本相同，无副作用。对象/数组字段每次 spread 恒为新引用（attributes 等），
        // 行为与修复前一致。
        if ((changes as Record<string, unknown>)[key] !== (prev as Record<string, unknown>)[key]) {
          this._trackChange(id, key)
        }
      }
      // DATA-4：parentId 变更时维护 _childrenIdx，否则 childrenMap 残留/缺失
      if ('parentId' in changes && changes.parentId !== prev.parentId) {
        if (prev.parentId) {
          const sib = this._childrenIdx[prev.parentId]
          if (sib) {
            const ci = sib.indexOf(id)
            if (ci >= 0) sib.splice(ci, 1)
          }
        }
        const nextParent = changes.parentId
        if (nextParent) {
          const sib = this._childrenIdx[nextParent]
          if (sib) {
            if (sib.indexOf(id) === -1) sib.push(id)
          } else {
            this._childrenIdx[nextParent] = [id]
          }
        }
      }
      this.bookmarks[idx] = { ...prev, ...changes, updatedAt: Date.now() }
      this._bmMap[id] = this.bookmarks[idx]
      this._markDirty(id)
      this._searchIndexDirty = true
    }
  },
  /** useCount 静默累加（R-RESURRECT）：统计计数不 bump updatedAt、不标脏/track。
   *  旧实现 openBookmark 走 updateBookmark——「点开书签」这种无实质编辑的行为也会
   *  生成同步 op，离线积压的存活快照上线后会把远端更新的软删墓碑盖掉（删除复活）。
   *  计数仍随调用方的 debouncedSaveAppData 落盘，并在该项下次因真实编辑入队时搭车
   *  同步到云端。 */
  bumpBookmarkUseCount(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    const bm = this._bmMap[id]
    if (!bm || bm.deletedAt) return
    bm.useCount = (bm.useCount || 0) + 1
  },
  deleteBookmark(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    const idx = _indexOfById(this.bookmarks, this._bmMap, id)
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
    this._persistDeletedGroupMemberships()
    this._searchIndexDirty = true
  },
  restoreBookmark(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    this._restoreItem('bookmarks', id)
    // RE-8：恢复后重建 _childrenIdx，否则父下子书签不可见直至下次 _syncMaps
    const bm = this._bmMap[id]
    if (bm?.parentId) {
      const parent = this._bmMap[bm.parentId]
      if (parent && !parent.deletedAt) {
        const sib = this._childrenIdx[bm.parentId]
        if (sib) {
          if (sib.indexOf(id) === -1) sib.push(id)
        } else {
          this._childrenIdx[bm.parentId] = [id]
        }
      } else {
        // 父已删：降为顶层，避免挂在幽灵父下
        bm.parentId = null
        this._trackChange(id, 'parentId')
      }
    }
    // 恢复被删除书签原本所属的组关系
    const groupIds = this._deletedGroupMemberships.get(id)
    if (groupIds) {
      for (const gid of groupIds) {
        const gIdx = _indexOfById(this.siblingGroups, this._grpMap, gid)
        if (gIdx >= 0 && this.siblingGroups[gIdx].bookmarkIds.indexOf(id) === -1) {
          const g = this.siblingGroups[gIdx]
          this.siblingGroups[gIdx] = { ...g, bookmarkIds: [...g.bookmarkIds, id] }
          this._grpMap[gid] = this.siblingGroups[gIdx]
          this._markDirty(g.id)
        }
      }
      this._deletedGroupMemberships.delete(id)
      this._persistDeletedGroupMemberships()
    }
    // r10-attr-restore B1：回填此书签被删属性时抹掉的 attributes 键
    this._restoreAttrMemberships(id, 'bookmark')
  },

  // ── 回收站：永久删除 ──
  permanentDeleteBookmark(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    // 先记录 children 关系，移除前清理索引
    const bm = this._bmMap[id]
    if (bm?.parentId && this._childrenIdx[bm.parentId]) {
      const ci = this._childrenIdx[bm.parentId].indexOf(id)
      if (ci >= 0) this._childrenIdx[bm.parentId].splice(ci, 1)
    }
    // RC-1：遍历所有子孙（非仅直接子项）清除 parentId，避免孤儿不可见。
    // 旧实现只清一级 children parentId——若存在多层嵌套（虽 UI 层 addSub 仅顶层
    // 可见、禁 >1 层，但 API 层 addBookmark 可编程挂多层），孙辈 parentId 仍指向
    // 已删中间层 → filteredBookmarks 的 !parentId 过滤排除 → 孙书签永久不可见。
    // 用队列 BFS 遍历所有后代。
    const queue: string[] = this._childrenIdx[id] ? [...this._childrenIdx[id]] : []
    while (queue.length) {
      const cid = queue.shift()!
      const cbm = this._bmMap[cid]
      if (cbm) { cbm.parentId = null; this._markDirty(cid) }
      // r10-attr-restore B1：子孙永久删，清其在 _deletedAttrMemberships 的预订 membership
      this._dropAttrMemberships(cid)
      if (this._childrenIdx[cid]) {
        queue.push(...this._childrenIdx[cid])
        delete this._childrenIdx[cid]
      }
    }
    delete this._childrenIdx[id]
    this._permanentDelete('bookmarks', id)
    delete this._bmMap[id]
    this._deletedGroupMemberships.delete(id)
    this._persistDeletedGroupMemberships()
    // r10-attr-restore B1：本实体永久删，清其 _deletedAttrMemberships 预订 membership
    this._dropAttrMemberships(id)
    this._searchIndexDirty = true
  },
}
