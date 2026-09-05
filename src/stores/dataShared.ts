/**
 * dataShared.ts — data store 的模块级共享机械（无 store 实例依赖的辅助函数与防抖状态）
 * 从 data.ts 拆出：组合入口见 data.ts，getters 见 dataGetters.ts，actions 见 dataActions*.ts。
 * 模块级 Map（历史防抖）是单例，由 data.ts re-export 保持既有导入路径不变。
 */
import { useUIStore } from './ui.js'
import { safeGetItem } from '../lib/storageSafe.js'
import * as persist from './persist.js'
import { shadowData, shadowHasAny } from './shareShadow.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute, AppData, EncryptedPassword, TableName } from '../types.js'
import type { Space } from './ui.js'

export const DGM_KEY = 'lv_delGroupMems'

/**
 * 分享只读态的写保护判据（供所有 mutation action 前置调用）。
 *
 * 他人分享的内容只以影子 Map 形式存在（见 shareShadow.ts），不属于访问者的库。
 * 一旦允许 mutation，就会出现「改不动（影子数据不在数组里）却留下了脏标记 /
 * 历史快照 / 同步队列」的半写状态，甚至把他人数据推上访问者的云空间。
 * 故分享态下一律静默拒写——UI 层的写类入口已隐藏，这里是兜底第二道闸。
 */
export function _denyWrite(): boolean {
  try {
    return !!useUIStore().shareMode
  } catch {
    // Pinia 尚未激活（单测裸调 action）时不拦截，保持原行为
    return false
  }
}

/**
 * 把影子数据合并进 map 型 getter（分享态下）。
 *
 * 只合并 map、不碰数组：数组是 filtered* / 侧栏计数 / 搜索 / 落盘 / 云同步的
 * 共同数据源，影子数据一旦进数组就会污染访问者的库。合并 map 则让卡片组件、
 * 内联卡片、DetailPanel 能只读渲染，同时天然对一切遍历数组的路径隐身。
 */
export function _mergeShadow<T>(
  kind: 'bookmarks' | 'groups' | 'categories',
  base: Record<string, T>,
): Record<string, T> {
  let active = false
  try {
    active = !!useUIStore().shareMode
  } catch {
    return base
  }
  if (!active || !shadowHasAny()) return base
  const sh = shadowData()[kind] as unknown as Record<string, T>
  if (!Object.keys(sh).length) return base
  return { ...base, ...sh }
}

// ── 空间切换：仅当该空间 localStorage 键存在真数据时读取，绝不 fallback DEFAULTS ──
// （私密空间首进必须是真空库；loadFromLocalStorage 无数据时返回 DEFAULTS 含示例数据）
export function _maybeLoadLocalSpace(space: Space): AppData | null {
  const lsKey = space === 'vault' ? 'linkvault_vault_v1' : 'linkvault_v2'
  if (!safeGetItem(lsKey)) return null
  return persist.loadFromLocalStorage(space)
}

/** 保存旧状态到本地历史（C2：覆盖前留底）。含 500ms 防抖，同一 id 连续变更只保留最后一次快照。 */
export const _histDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
export const _histDebounceData = new Map<string, Record<string, unknown>>()
export const _HISTORY_DEBOUNCE_MS = 500

// R22：模块级历史防抖 Map，reset/import 时应一并清空，避免旧定时器按旧 id 写快照。
export function _cancelPendingHist() {
  for (const t of _histDebounceTimers.values()) clearTimeout(t)
  _histDebounceTimers.clear()
  _histDebounceData.clear()
}

/**
 * 测试专用：模拟已 drain 待推送历史防抖；beforeEach 需 clear。
 * 与 syncPending `__testPendingSync` 同口径——仅暴露填入/窥探/清两 Map 的最小面，
 * _cancelPendingHist 逻辑一字未动。peekSize 供单测断言 cancel 前后两 Map 清空契约。
 */
export const __testHistDebounce = {
  /** 手动填一个防抖 timer（fake timers 下返回真 timer id）+ 暂存 data，模拟 _saveLocalHistory 已布置防抖后态 */
  seed(id: string, timer: ReturnType<typeof setTimeout>, data: Record<string, unknown> = {}) {
    _histDebounceTimers.set(id, timer)
    _histDebounceData.set(id, data)
  },
  /** 窥探两 Map 当前 size，供单测断言 _cancelPendingHist 清空契约 */
  peekSize() {
    return { timers: _histDebounceTimers.size, data: _histDebounceData.size }
  },
  /** 窥探某 id 的 timer/data 是否仍在（便于断言"清后该 id 消失"） */
  has(id: string) {
    return _histDebounceTimers.has(id) || _histDebounceData.has(id)
  },
  /** 兜底清两 Map（与 _cancelPendingHist 等价但不调 clearTimeout，给 beforeEach 用） */
  clear() {
    _histDebounceTimers.clear()
    _histDebounceData.clear()
  },
}

export interface DataState {
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
  _masterCanary: string | EncryptedPassword | null
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
  /** A2-002：软删属性时快照「实体 id → 曾有该 attr 键」，restoreAttribute 回写 */
  _deletedAttrMemberships: Map<string, Array<{ entityId: string; kind: 'bookmark' | 'group' }>>
  _searchVersion: number
  /** 搜索索引重建脏标记：累积多次 CRUD 后仅重建一次 */
  _searchIndexDirty: boolean
  /** 防抖定时器：批量 CRUD 时延迟递增 version */
  _searchVersionTimer: ReturnType<typeof setTimeout> | null
}

/** state 工厂：由 data.ts 传入 defineStore（键与拆分前逐字一致） */
export function makeDataState(): DataState {
  return {
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
    _deletedAttrMemberships: new Map(),
    _searchVersion: 0,
    _searchIndexDirty: false,
    _searchVersionTimer: null as ReturnType<typeof setTimeout> | null,
  }
}

/**
 * DataStoreThis — 各拆分文件内 action/getter 的 `this` 形状（全 store：state + getters + actions）。
 *
 * 为什么手写：若 `this: DataStore = ReturnType<typeof useDataStore>`，则「fragment 类型 ← store 推断 ←
 * fragment 类型」成环，TS7022 把 fragment 整体降级 any。本接口不引用 data.ts，环即断。
 * 防漂移：data.ts 末尾有 `ReturnType<typeof useDataStore> extends DataStoreThis` 护栏断言，
 * 真实 store 缺成员/签名不符将编译报错，故本接口与真实 store 不可能静默漂移。
 */
export interface DataStoreThis {
  // ── state（与 DataState 逐字段一致，经 Pinia 解包后即此形状）──
  bookmarks: Bookmark[]
  siblingGroups: SiblingGroup[]
  categories: Category[]
  customAttributes: CustomAttribute[]
  _bmMap: Record<string, Bookmark>
  _grpMap: Record<string, SiblingGroup>
  _catMap: Record<string, Category>
  _attrMap: Record<string, CustomAttribute>
  _childrenIdx: Record<string, string[]>
  _masterCanary: string | EncryptedPassword | null
  _customCardOrder: Array<{ t: 'g' | 'b'; id: string }> | null
  _cachedStorageInfo: { size: number; percent: number; label: string } | null
  _storageInfoDirty: boolean
  _saveCount: number
  _saveTimer: ReturnType<typeof setTimeout> | null
  _dirtyIds: Set<string>
  _deletedIds: Map<string, TableName>
  _newIds: Set<string>
  _changedFields: Map<string, Set<string>>
  _deletedGroupMemberships: Map<string, string[]>
  _deletedAttrMemberships: Map<string, Array<{ entityId: string; kind: 'bookmark' | 'group' }>>
  _searchVersion: number
  _searchIndexDirty: boolean
  _searchVersionTimer: ReturnType<typeof setTimeout> | null

  // ── getters ──
  filteredBookmarks: Bookmark[]
  filteredGroups: SiblingGroup[]
  trashedBookmarks: Bookmark[]
  trashedGroups: SiblingGroup[]
  trashedCategories: Category[]
  trashedAttributes: CustomAttribute[]
  trashCount: number
  bookmarkMap: Record<string, Bookmark>
  groupMap: Record<string, SiblingGroup>
  categoryMap: Record<string, Category>
  attributeMap: Record<string, CustomAttribute>
  attributeByName: Record<string, CustomAttribute>
  childrenMap: Record<string, Bookmark[]>
  cardCounts: Record<string, number>
  selectableCategories: Category[]
  selectableAttributes: CustomAttribute[]

  // ── actions（签名与各 dataActions*.ts 一致）──
  // core
  _syncMaps(): void
  _markDirty(...ids: string[]): void
  _bumpSearchVersion(): void
  _debouncedBumpSearchVersion(): void
  drainDirtyIds(): Set<string>
  drainDeletedIds(): Map<string, TableName>
  drainNewIds(): Set<string>
  drainChangedFields(): Map<string, Set<string>>
  _trackChange(id: string, field: string): void
  _saveLocalHistory(id: string, data: Record<string, unknown>): void
  _restoreItem(table: TableName, id: string): void
  _restoreFrom<T extends { id: string; deletedAt?: number; updatedAt?: number }>(arr: T[], map: Record<string, T>, id: string): void
  _permanentDelete(key: TableName, id: string): void
  emptyTrash(): void
  // bookmarks
  nextBookmarkOrder(): number
  batchPatchBookmarkAttributes(patches: Record<string, Record<string, unknown>>): void
  _persistDeletedGroupMemberships(): void
  _restoreDeletedGroupMemberships(): void
  addBookmark(bm: Bookmark): void
  updateBookmark(id: string, changes: Partial<Bookmark>): void
  bumpBookmarkUseCount(id: string): void
  deleteBookmark(id: string): void
  restoreBookmark(id: string): void
  permanentDeleteBookmark(id: string): void
  // groups
  addGroup(g: SiblingGroup): void
  updateGroup(id: string, changes: Partial<SiblingGroup>): void
  deleteGroup(id: string): void
  togglePin(entityType: 'bookmark' | 'group', id: string): void
  restoreGroup(id: string): void
  permanentDeleteGroup(id: string): void
  // categories
  updateCategory(id: string, changes: Partial<Category>): void
  addCategory(cat: Category): void
  reorderCategories(ordered: Category[]): void
  renameCategory(id: string, name: string): void
  deleteCategory(id: string): void
  restoreCategory(id: string): void
  permanentDeleteCategory(id: string): void
  _normalizeCategoryOrders(): void
  // attributes
  updateAttribute(id: string, changes: Partial<CustomAttribute>): void
  addAttribute(attr: CustomAttribute): void
  renameAttribute(id: string, name: string): void
  deleteAttribute(id: string): void
  restoreAttribute(id: string): void
  _restoreAttrMemberships(entityId: string, kind: 'bookmark' | 'group'): void
  _dropAttrMemberships(entityId: string): void
  permanentDeleteAttribute(id: string): void
  // io
  loadFromStorage(): void
  tryLoadFromIDB(): Promise<boolean>
  importFromData(data: Partial<AppData>): void
  _dataSnapshot(): { bookmarks: Bookmark[]; siblingGroups: SiblingGroup[]; categories: Category[]; customAttributes: CustomAttribute[] }
  switchSpace(space: Space): Promise<void>
  getSpaceSnapshot(space: Space): Promise<AppData | null>
}
