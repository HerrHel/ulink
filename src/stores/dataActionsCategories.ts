/**
 * dataActionsCategories.ts — data store 的分类 CRUD（自 data.ts 逐字迁移，逻辑零改动）
 * deleteCategory 级联把书签/组改挂「未分类」（RE-4：级联改写必须 dirty+track）。
 */
import { CAT_UNCATEGORIZED } from '../config/constants.js'
import { _indexOfById } from '../lib/dataQuery.js'
import { _denyWrite } from './dataShared.js'
import type { DataStoreThis } from './dataShared.js'
import type { Category } from '../types.js'

export const categoryActions = {
  /** M18：分类整对象补丁（冲突解决「用远端」），走 dirty/track/map */
  updateCategory(this: DataStoreThis, id: string, changes: Partial<Category>) {
    if (_denyWrite()) return
    const idx = _indexOfById(this.categories, this._catMap, id)
    if (idx < 0) return
    for (const key of Object.keys(changes)) this._trackChange(id, key)
    this.categories[idx] = { ...this.categories[idx], ...changes, updatedAt: Date.now() }
    this._catMap[id] = this.categories[idx]
    this._markDirty(id)
    this._debouncedBumpSearchVersion()
  },
  addCategory(this: DataStoreThis, cat: Category) {
    if (_denyWrite()) return
    cat.updatedAt = Date.now()
    this.categories = [...this.categories, cat]
    this._catMap[cat.id] = cat
    this._markDirty(cat.id); this._newIds.add(cat.id)
    this._searchIndexDirty = true
  },
  /**
   * B-11：按传入数组顺序重写 categories.order + updatedAt，并 track/markDirty。
   * 侧栏/模态拖拽共用；旧实现只改数组位置不刷 updatedAt → 远端 pull 丢弃顺序。
   * 未出现在 ordered 中的项（如软删分类）保留在末尾，避免被拖拽路径抹掉。
   */
  reorderCategories(this: DataStoreThis, ordered: Category[]) {
    if (_denyWrite()) return
    const now = Date.now()
    const orderedIds = new Set(ordered.map(c => c.id))
    const rest = this.categories.filter(c => !orderedIds.has(c.id))
    this.categories = [
      ...ordered.map((c, i) => {
        const next = { ...c, order: i, updatedAt: now }
        this._catMap[c.id] = next
        this._trackChange(c.id, 'order')
        this._markDirty(c.id)
        return next
      }),
      ...rest,
    ]
    this._searchIndexDirty = true
  },
  renameCategory(this: DataStoreThis, id: string, name: string) {
    if (_denyWrite()) return
    const idx = _indexOfById(this.categories, this._catMap, id)
    if (idx >= 0) {
      this._trackChange(id, 'name')
      this.categories[idx] = { ...this.categories[idx], name, updatedAt: Date.now() }
      this._catMap[id] = this.categories[idx]
      this._markDirty(id), this._searchIndexDirty = true
    }
  },
  deleteCategory(this: DataStoreThis, id: string) {
    if (_denyWrite()) return
    const now = Date.now()
    // RE-4：级联改写的 bookmark/group 必须 _markDirty + _trackChange，否则跨设备不同步
    this.bookmarks = this.bookmarks.map(b => {
      if (b.categoryId !== id) return b
      this._trackChange(b.id, 'categoryId')
      this._markDirty(b.id)
      const next = { ...b, categoryId: CAT_UNCATEGORIZED, updatedAt: now }
      this._bmMap[b.id] = next
      return next
    })
    this.siblingGroups = this.siblingGroups.map(g => {
      if (g.categoryId !== id) return g
      this._trackChange(g.id, 'categoryId')
      this._markDirty(g.id)
      const next = { ...g, categoryId: CAT_UNCATEGORIZED, updatedAt: now }
      this._grpMap[g.id] = next
      return next
    })
    const cIdx = _indexOfById(this.categories, this._catMap, id)
    if (cIdx >= 0) {
      this._trackChange(id, 'deletedAt')
      this.categories[cIdx] = { ...this.categories[cIdx], deletedAt: Date.now(), updatedAt: Date.now() }
      this._catMap[id] = this.categories[cIdx]
      this._markDirty(id)
    }
  },
  restoreCategory(this: DataStoreThis, id: string) { if (_denyWrite()) return; this._restoreItem('categories', id) },
  permanentDeleteCategory(this: DataStoreThis, id: string) { if (_denyWrite()) return; this._permanentDelete('categories', id); delete this._catMap[id]; this._searchIndexDirty = true },

  /**
   * B-12：归一化分类 order（序号语义）。
   * 历史 bug——createCategory 曾用 Date.now() 当 order（毫秒戳 13 位超出远端
   * categories.order INTEGER 上限 2147483647，同步必溢出失败）。加载时把超界
   * order 重写为当前数组序号的序号，仅当存在超界值才触发（幂等），正常数据零改动。
   * 重写时同步刷 updatedAt：否则跨设备 pull 时远端（旧 updatedAt 但超界 order）
   * 会被判定 remoteNewer 覆盖回来，归一化白做（pull assign 不走本方法）。
   */
  _normalizeCategoryOrders(this: DataStoreThis) {
    const MAX_INT = 2147483647
    const now = Date.now()
    let idx = 0
    for (const c of this.categories) {
      if (c.deletedAt) continue
      if ((c.order ?? 0) > MAX_INT) {
        c.order = idx
        c.updatedAt = now
        this._markDirty(c.id)
      }
      idx++
    }
  },
}
