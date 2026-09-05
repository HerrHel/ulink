/**
 * dataActionsAttributes.ts — data store 的自定义属性 CRUD（自 data.ts 逐字迁移，逻辑零改动）
 * 含 A2-002 / r10-attr-restore B1 的属性 membership 快照机制（_deletedAttrMemberships）：
 * 软删属性时快照持有者、恢复属性/实体时双向回填。
 */
import { useUIStore } from './ui.js'
import { _indexOfById } from '../lib/dataQuery.js'
import { _denyWrite } from './dataShared.js'
import type { DataStoreThis } from './dataShared.js'
import type { CustomAttribute } from '../types.js'

export const attributeActions = {
  /** M18：属性整对象补丁 */
  updateAttribute(this: DataStoreThis, id: string, changes: Partial<CustomAttribute>) {
    if (_denyWrite()) return
    const idx = _indexOfById(this.customAttributes, this._attrMap, id)
    if (idx < 0) return
    for (const key of Object.keys(changes)) this._trackChange(id, key)
    this.customAttributes[idx] = { ...this.customAttributes[idx], ...changes, updatedAt: Date.now() }
    this._attrMap[id] = this.customAttributes[idx]
    this._markDirty(id)
    this._debouncedBumpSearchVersion()
  },
  addAttribute(this: DataStoreThis, attr: CustomAttribute) {
    if (_denyWrite()) return
    attr.updatedAt = Date.now()
    this.customAttributes = [...this.customAttributes, attr]
    this._attrMap[attr.id] = attr
    this._markDirty(attr.id); this._newIds.add(attr.id)
    this._searchIndexDirty = true
  },
  renameAttribute(this: DataStoreThis, id: string, name: string) {
    if (_denyWrite()) return
    const idx = _indexOfById(this.customAttributes, this._attrMap, id)
    if (idx >= 0) {
      this._trackChange(id, 'name')
      this.customAttributes[idx] = { ...this.customAttributes[idx], name, updatedAt: Date.now() }
      this._attrMap[id] = this.customAttributes[idx]
      this._markDirty(id), this._searchIndexDirty = true
    }
  },
  deleteAttribute(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    const aIdx = _indexOfById(this.customAttributes, this._attrMap, id)
    if (aIdx >= 0) {
      this.customAttributes[aIdx] = { ...this.customAttributes[aIdx], deletedAt: Date.now(), updatedAt: Date.now() }
      this._attrMap[id] = this.customAttributes[aIdx]
      this._markDirty(id)
    }
    const now = Date.now()
    // A2-002：快照曾持有该属性的实体，restoreAttribute 可回写
    const members: Array<{ entityId: string; kind: 'bookmark' | 'group' }> = []
    // RE-4：去掉属性 key 的实体必须 dirty，否则云端 attributes 陈旧
    this.bookmarks = this.bookmarks.map(b => {
      if (b.attributes && id in b.attributes) {
        members.push({ entityId: b.id, kind: 'bookmark' })
        const next = { ...b, attributes: { ...b.attributes }, updatedAt: now }
        delete next.attributes[id]
        this._bmMap[b.id] = next
        this._trackChange(b.id, 'attributes')
        this._markDirty(b.id)
        return next
      }
      return b
    })
    this.siblingGroups = this.siblingGroups.map(g => {
      if (g.attributes && id in g.attributes) {
        members.push({ entityId: g.id, kind: 'group' })
        const next = { ...g, attributes: { ...g.attributes }, updatedAt: now }
        delete next.attributes[id]
        this._grpMap[g.id] = next
        this._trackChange(g.id, 'attributes')
        this._markDirty(g.id)
        return next
      }
      return g
    })
    if (members.length) this._deletedAttrMemberships.set(id, members)
    const ui = useUIStore()
    const ai = ui.activeAttrs.indexOf(id); if (ai >= 0) ui.activeAttrs.splice(ai, 1)
    const ei = ui.excludedAttrs.indexOf(id); if (ei >= 0) ui.excludedAttrs.splice(ei, 1)
    this._searchIndexDirty = true
  },
  restoreAttribute(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    this._restoreItem('custom_attributes', id)
    // A2-002：回写软删时抹掉的 attributes 键。
    // r10-attr-restore 修真 bug：旧实现末尾无条件 _deletedAttrMemberships.delete(id)，
    // 当某成员此刻仍软删（!b.deletedAt 守卫跳过它）时缓存被清空 → 该成员稍后
    // restoreBookmark/restoreGroup 永远拿不回 [id]:true（无回填路径，属性归属永久丢失
    // 且 _trackChange 已写「attributes」会把丢失同步到云端）。改为：只回写存活成员，
    // 仍软删的成员保留在缓存，等其自身 restore 时由 _restoreAttrMemberships 回填。
    const members = this._deletedAttrMemberships.get(id)
    if (members?.length) {
      const now = Date.now()
      const remaining: typeof members = []
      for (const m of members) {
        if (m.kind === 'bookmark') {
          const b = this._bmMap[m.entityId]
          if (b && !b.deletedAt) {
            const next = { ...b, attributes: { ...b.attributes, [id]: true }, updatedAt: now }
            const idx = _indexOfById(this.bookmarks, this._bmMap, m.entityId)
            if (idx >= 0) this.bookmarks[idx] = next
            this._bmMap[m.entityId] = next
            this._trackChange(m.entityId, 'attributes')
            this._markDirty(m.entityId)
          } else {
            remaining.push(m) // 成员仍软删或已永久删前的中间态：留缓存待其 restore 回填
          }
        } else {
          const g = this._grpMap[m.entityId]
          if (g && !g.deletedAt) {
            const next = { ...g, attributes: { ...g.attributes, [id]: true }, updatedAt: now }
            const idx = _indexOfById(this.siblingGroups, this._grpMap, m.entityId)
            if (idx >= 0) this.siblingGroups[idx] = next
            this._grpMap[m.entityId] = next
            this._trackChange(m.entityId, 'attributes')
            this._markDirty(m.entityId)
          } else {
            remaining.push(m)
          }
        }
      }
      if (remaining.length) {
        this._deletedAttrMemberships.set(id, remaining)
      } else {
        this._deletedAttrMemberships.delete(id)
      }
      this._searchIndexDirty = true
    }
  },

  /**
   * r10-attr-restore：恢复实体（bookmark/group）时回填其曾持有、属性本体已恢复的
   * attributes 键（从 _deletedAttrMemberships 消化对应 membership）。
   *
   * 真修复 B1：旧 restore* 路径只回写存活成员、不清缓存让软删成员的属性归属永久丢失。
   * 现让成员自身 restore 时扫缓存回填——与 _deletedGroupMemberships 在 restoreBookmark
   * 回填组关系（733-746）同构。仅当属性本体未软删（已恢复或从未删）才回填，避免给
   * 实体打上仍在回收站的属性键污染过滤。
   */
  _restoreAttrMemberships(this: DataStoreThis, entityId: string, kind: 'bookmark' | 'group') {
    for (const [attrId, members] of this._deletedAttrMemberships) {
      // 属性本体仍软删：成员此刻不该获得该键（属性不可见），保留 membership 待属性 restore 时回填
      if (this._attrMap[attrId]?.deletedAt) continue
      let touched = false
      let removed = 0
      for (let i = 0; i < members.length; i++) {
        const m = members[i]
        if (m.entityId !== entityId || m.kind !== kind) continue
        if (kind === 'bookmark') {
          const b = this._bmMap[entityId]
          if (!b) { removed++; continue }
          const next = { ...b, attributes: { ...b.attributes, [attrId]: true }, updatedAt: Date.now() }
          const idx = _indexOfById(this.bookmarks, this._bmMap, entityId)
          if (idx >= 0) this.bookmarks[idx] = next
          this._bmMap[entityId] = next
        } else {
          const g = this._grpMap[entityId]
          if (!g) { removed++; continue }
          const next = { ...g, attributes: { ...g.attributes, [attrId]: true }, updatedAt: Date.now() }
          const idx = _indexOfById(this.siblingGroups, this._grpMap, entityId)
          if (idx >= 0) this.siblingGroups[idx] = next
          this._grpMap[entityId] = next
        }
        this._trackChange(entityId, 'attributes')
        this._markDirty(entityId)
        touched = true
        removed++
      }
      if (touched) this._searchIndexDirty = true
      if (removed > 0) {
        if (members.length === removed) {
          this._deletedAttrMemberships.delete(attrId)
        } else {
          const surviving = members.filter(m => !(m.entityId === entityId && m.kind === kind))
          this._deletedAttrMemberships.set(attrId, surviving)
        }
      }
    }
  },

  /** r10-attr-restore B1：永久删实体时从 _deletedAttrMemberships 消去其残留 membership（防缓存泄漏） */
  _dropAttrMemberships(this: DataStoreThis, entityId: string) {
    for (const [attrId, members] of this._deletedAttrMemberships) {
      if (!members.some(m => m.entityId === entityId)) continue
      const surviving = members.filter(m => m.entityId !== entityId)
      if (surviving.length === 0) this._deletedAttrMemberships.delete(attrId)
      else this._deletedAttrMemberships.set(attrId, surviving)
    }
  },

  permanentDeleteAttribute(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    this._permanentDelete('custom_attributes', id)
    delete this._attrMap[id]
    this._deletedAttrMemberships.delete(id)
    this._searchIndexDirty = true
  },
}
