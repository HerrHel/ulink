/**
 * dataGetters.ts — data store getters（自 data.ts 逐字迁移，逻辑零改动）
 * `this: DataStoreThis` 显式标注供跨 getter 互引（如 trashCount → trashedBookmarks）。
 */
import { CAT_ALL } from '../config/constants.js'
import { useUIStore } from './ui.js'
import { searchBookmarkIds, searchGroupIds } from '../lib/search.js'
import { _filterAttrs, _sortItems } from '../lib/dataQuery.js'
import { _mergeShadow } from './dataShared.js'
import type { DataState } from './dataShared.js'
import { shadowVersion } from './shareShadow.js'
import type { DataStoreThis } from './dataShared.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../types.js'

export const dataGetters = {
  /** 过滤后的书签列表（排除软删除） */
  filteredBookmarks(state: DataState): Bookmark[] {
    const ui = useUIStore()
    let bm = state.bookmarks.filter(b => !b.deletedAt)
    if (ui.curCat !== CAT_ALL) bm = bm.filter(b => b.categoryId === ui.curCat)
    const q = ui.searchQuery
    if (q.trim()) {
      // 如果搜索索引脏了，直接递增 version 触发重建
      if (state._searchIndexDirty) { state._searchVersion++; state._searchIndexDirty = false }
      // AUDIT-R11 权衡记录：此处 getter 内写 state（state._searchVersion++）是 Vue 反模式（getter 副作用），
      // 但是「立即性」的刻意设计，非可随意消除。
      // · CRUD action（addBookmark/updateBookmark/...）末尾仅设 `_searchIndexDirty=true` 不递增 version——
      //   version 递增唯一时机即此处 getter 求值时。若改为「写 action 末尾 debounced bump(setTimeout 0)」：
      //   Vue 调度 flush effect（微任务）早于 setTimeout 0（宏任务）触发，getter 首次求值时 version 仍旧 →
      //   `version === _bmVersion` → needsRebuild=false → 走 Fuse 缓存返回旧结果（搜索框闪旧值一 tick），
      //   setTimeout 触发后才重建——「首条脏搜索拿到陈旧结果」是真实可见退化。
      // · 批量导入路径（loadFromStorage/tryLoadFromIDB/importFromData）已直接 `clearSearchCache() + _searchVersion=1`，
      //   不走本副作用，故「删 getter 副作用优化批量」论证不成立（批量本不经此）。
      // · 现状 `_searchIndexDirty` 守护确保不无限递归；首次脏搜索立即拿新 version 重建，立即性正确；
      //   副作用代价（下游 computed 同 tick 多算一次）ms 级无用户感知。
      // 结论：用可见退化换不可见净化不划算，维持现状。理由入 [[lv-optimization-candidates-board]] R11 段。
      // 在全量 bookmarks 上建/复用 Fuse 基准（引用稳定，CRUD 才变，配 version 双保险），
      // 再用 bm.filter(matchIds) 限定到当前分类——结果与「在 bm 子集上搜」一致，
      // 但 Fuse 缓存不再因每次 filter 产生的新数组引用而重建。旧实现传 bm（每次新建）
      // → ref 永远 !== _bmBaseRef → 每个键击重建 Fuse + 与 SearchSuggest 互踩缓存基准。
      // 审计 R8：删去显式 forceRebuild=true，仅依赖 version 不匹配触发重建（CRUD 时 _searchIndexDirty=true 递增 version）。
      const matchIds = searchBookmarkIds(state.bookmarks, q, state.customAttributes, state._searchVersion)
      if (matchIds) bm = bm.filter(b => matchIds.has(b.id))
    }
    bm = _filterAttrs(bm, ui)
    _sortItems(bm, ui, 'title', 'createdAt')
    return bm
  },

  /** 过滤后的组列表（排除软删除） */
  filteredGroups(this: DataStoreThis, state: DataState): SiblingGroup[] {
    const ui = useUIStore()
    let groups = state.siblingGroups.filter(g => !g.deletedAt)
    if (ui.curCat !== CAT_ALL) groups = groups.filter(g => g.categoryId === ui.curCat)
    const q = ui.searchQuery
    if (q.trim()) {
      // 如果搜索索引脏了，直接递增 version 触发重建
      if (state._searchIndexDirty) { state._searchVersion++; state._searchIndexDirty = false }
      // AUDIT-R11：同 filteredBookmarks，此处 getter 副作用是「立即性」刻意设计，见上方完整权衡记录。
      // 同 filteredBookmarks：在全量 siblingGroups 上搜复用 Fuse 缓存（见上注释），
      // 再用 groups.filter 限定当前分类。旧实现传每次新建的 groups 子集 → ref 永变 → 重建。
      // 审计 R8：删 forceRebuild=true，仅依赖 version 不匹配触发重建（CRUD 时 _searchIndexDirty=true 递增 version）。
      const matchIds = searchGroupIds(state.siblingGroups, q, this.bookmarkMap, state.customAttributes, state._searchVersion)
      if (matchIds) groups = groups.filter(g => matchIds.has(g.id))
    }
    groups = _filterAttrs(groups, ui)
    _sortItems(groups, ui, 'name', 'updatedAt')
    return groups
  },

  /** 回收站：已软删除的书签 */
  trashedBookmarks(state: DataState): Bookmark[] {
    return state.bookmarks.filter(b => b.deletedAt).sort((a, b) => (b.deletedAt! - a.deletedAt!))
  },
  /** 回收站：已软删除的组 */
  trashedGroups(state: DataState): SiblingGroup[] {
    return state.siblingGroups.filter(g => g.deletedAt).sort((a, b) => (b.deletedAt! - a.deletedAt!))
  },
  /** 回收站：已软删除的分类 */
  trashedCategories(state: DataState): Category[] {
    return state.categories.filter(c => c.deletedAt).sort((a, b) => (b.deletedAt! - a.deletedAt!))
  },
  /** 回收站：已软删除的自定义属性 */
  trashedAttributes(state: DataState): CustomAttribute[] {
    return state.customAttributes.filter(a => a.deletedAt)
  },
  /** 回收站总数 */
  trashCount(this: DataStoreThis): number {
    return this.trashedBookmarks.length + this.trashedGroups.length + this.trashedCategories.length + this.trashedAttributes.length
  },

  /** O(1) 书签查找 Map（含软删除——由 _syncMaps 维护，懒回退；分享态叠加影子书签） */
  bookmarkMap(state: DataState): Record<string, Bookmark> {
    // 读取 shadowVersion 作响应式依赖：shadow 变化时本 getter 必须重算
    void shadowVersion.value
    if (Object.keys(state._bmMap).length !== state.bookmarks.length) {
      const map: Record<string, Bookmark> = {}; state.bookmarks.forEach(b => { map[b.id] = b }); return _mergeShadow('bookmarks', map)
    }
    return _mergeShadow('bookmarks', state._bmMap)
  },
  groupMap(state: DataState): Record<string, SiblingGroup> {
    // 读取 shadowVersion 作响应式依赖
    void shadowVersion.value
    if (Object.keys(state._grpMap).length !== state.siblingGroups.length) {
      const map: Record<string, SiblingGroup> = {}; state.siblingGroups.forEach(g => { map[g.id] = g }); return _mergeShadow('groups', map)
    }
    return _mergeShadow('groups', state._grpMap)
  },
  /** O(1) 分类查找（含软删除——由 _syncMaps 维护，懒回退；分享态叠加影子分类） */
  categoryMap(state: DataState): Record<string, Category> {
    // 读取 shadowVersion 作响应式依赖
    void shadowVersion.value
    if (Object.keys(state._catMap).length !== state.categories.length) {
      const map: Record<string, Category> = {}; state.categories.forEach(c => { map[c.id] = c }); return _mergeShadow('categories', map)
    }
    return _mergeShadow('categories', state._catMap)
  },
  /** O(1) 属性查找（含软删除——由 _syncMaps 维护，懒回退） */
  attributeMap(state: DataState): Record<string, CustomAttribute> {
    if (Object.keys(state._attrMap).length !== state.customAttributes.length) {
      const map: Record<string, CustomAttribute> = {}; state.customAttributes.forEach(a => { map[a.id] = a }); return map
    }
    return state._attrMap
  },
  /**
   * 按显示名查属性（仅未软删）。属性数量通常很小；依赖 customAttributes 缓存。
   * 用于卡片点 tag、快速新建查重等，避免每次 .find(a => a.name === …)。
   */
  attributeByName(state: DataState): Record<string, CustomAttribute> {
    const map: Record<string, CustomAttribute> = {}
    for (const a of state.customAttributes) {
      if (!a.deletedAt) map[a.name] = a
    }
    return map
  },
  /** 预计算父→子书签映射（由 _syncMaps 维护，排除软删除） */
  childrenMap(state: DataState): Record<string, Bookmark[]> {
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
    // 按需将 ID 数组解析为 Bookmark 对象（_bmMap 权威，不再扫 bookmarks.find）
    const bmMap = state._bmMap
    const result: Record<string, Bookmark[]> = {}
    for (const pid of Object.keys(state._childrenIdx)) {
      result[pid] = state._childrenIdx[pid]
        .map(id => bmMap[id])
        .filter((b): b is Bookmark => !!b && !b.deletedAt)
    }
    return result
  },
  /** 各分类的卡片计数（排除软删除） */
  cardCounts(state: DataState): Record<string, number> {
    const counts: Record<string, number> = {}; let total = 0
    state.bookmarks.forEach(b => { if (!b.parentId && !b.deletedAt) { counts[b.categoryId] = (counts[b.categoryId] || 0) + 1; total++ } })
    state.siblingGroups.forEach(g => { if (!g.deletedAt) { counts[g.categoryId] = (counts[g.categoryId] || 0) + 1; total++ } })
    counts[CAT_ALL] = total
    return counts
  },
  /** 可选择的分类列表（排除"全部"和软删除），按 order 升序（B-11 跨设备顺序） */
  selectableCategories(state: DataState): Category[] {
    return state.categories
      .filter(c => c.id !== CAT_ALL && !c.deletedAt)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  },
  /** A2-007：可勾选/管理的属性（排除软删）；查重同名重建时亦用此列表 */
  selectableAttributes(state: DataState): CustomAttribute[] {
    return state.customAttributes.filter(a => !a.deletedAt)
  },
}
