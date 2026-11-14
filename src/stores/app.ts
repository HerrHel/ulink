/**
 * app.ts — Facade Store
 * 组合 data / ui 两个子 Store，提供统一接口。
 * 新代码也可直接使用 useDataStore / useUIStore。
 */
import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useDataStore, _flushPendingHist } from './data.js'
import { useUIStore } from './ui.js'
import type { UIState } from './ui.js'
import { useUndoStore } from './undo.js'
import * as persist from './persist.js'
import { toast } from '../lib/toast.js'
import { t } from '../i18n/index.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute, AppData } from '../types.js'
import { AppDataSchema } from '../schemas.js'

/**
 * 轻量指纹：长度 + 实体数 + 关键时间戳；避免每次完整 JSON.stringify 两遍。
 * FIX(审计H1): 纯分类/属性改名只改自身 name+updatedAt，长度/order 不变、
 * 也不顶高 bookmarks/siblingGroups 的 maxUp，故必须把 cats/attrs 的 max updatedAt
 * 纳入指纹，否则 renameCategory/renameAttribute 命中 fp===_lastSavedFingerprint 早退不落盘。
 *
 * 纯函数（仅依赖入参 AppData），抽到模块顶层供护栏单测直测——setup 闭包内调用不变。
 */
export function _fingerprint(data: AppData): string {
  const bms = data.bookmarks || []
  const grps = data.siblingGroups || []
  const cats = data.categories || []
  const attrs = data.customAttributes || []
  let maxUp = 0
  let updSum = 0
  const bump = (ts: unknown) => {
    const v = typeof ts === 'number' && Number.isFinite(ts) ? ts : 0
    if (v > maxUp) maxUp = v
    // 累加校验和：只看 max 时，若存在「未来时间戳」条目（远端时钟超前 ≤120s），
    // 之后的普通编辑把 updatedAt 设为 now（仍小于 max），指纹不变会导致 save() 静默跳过落盘。
    updSum = (updSum + (v % 2147483647)) % 2147483647
  }
  // #25: _syncMaps() 会把孤儿 bookmark 的 categoryId/parentId、group 的 categoryId
  // 就地改写为兜底值，_normalizeCategoryOrders 改 order，软删/恢复改 deletedAt —— 这些
  // 改写都不触发 onWrite、也不 bump updatedAt，旧指纹（长度+实体数+updatedAt+useCount）
  // 完全捕捉不到，save() 命中 fp===_lastSavedFingerprint 早退 → 内存与 IDB 分叉、刷新回退。
  // 把这些结构字段按 (id + 字段值) 顺序敏感地折进校验和，任何改写都改变指纹、强制落盘。
  let structSum = 0
  const mix = (v: unknown) => {
    const s = v == null ? '' : String(v)
    for (let i = 0; i < s.length; i++) structSum = (structSum * 31 + s.charCodeAt(i)) | 0
    structSum = (structSum * 31 + 7) | 0 // 字段分隔符，防 ['ab','c'] 与 ['a','bc'] 碰撞
  }
  let useCounts = 0
  for (const b of bms) {
    bump(b.updatedAt)
    useCounts += b.useCount || 0
    mix(b.id); mix(b.order); mix(b.categoryId); mix(b.parentId); mix(b.deletedAt)
  }
  for (const g of grps) {
    bump(g.updatedAt)
    useCounts += g.useCount || 0
    mix(g.id); mix(g.order); mix(g.categoryId); mix(g.deletedAt)
  }
  for (const c of cats) {
    bump(c.updatedAt)
    mix(c.id); mix(c.order); mix(c.deletedAt)
  }
  for (const a of attrs) {
    bump(a.updatedAt)
    mix(a.id); mix(a.deletedAt)
  }
  const base = `${bms.length}|${grps.length}|${cats.length}|${attrs.length}|${maxUp}|${updSum}|${useCounts}|${structSum}|${(data as { _schemaVersion?: number })._schemaVersion ?? ''}`
  if (!data._masterCanary) return base
  const canaryPart = typeof data._masterCanary === 'object' && data._masterCanary !== null
    ? `${data._masterCanary.data || ''}:${data._masterCanary.iv || ''}`
    : String(data._masterCanary)
  return `${base}|${canaryPart}`
}

export const useAppStore = defineStore('app', () => {
  const ds = () => useDataStore()
  const ui = () => useUIStore()
  // 隐私模式 / IDB 配额满：首次必 toast；持续失败时每 STORAGE_FAIL_REMIND_MS 再提醒（G1-004）
  let _storageFailWarned = false
  let _lastStorageFailToastAt = 0
  const STORAGE_FAIL_REMIND_MS = 5 * 60 * 1000
  // #56 写入侧 schema 守卫：快照不合法时同样的节流口径（首次必提示，之后每 5min 一次）
  let _invalidSnapshotWarned = false
  let _lastInvalidSnapshotToastAt = 0
  // PERF-3：上次成功写入的快照指纹（per space），相同则跳过 Zod/双写。
  // 切换数据空间后，按当前空间取该空间的指纹——私密空间与主页指纹独立，避免互相早退跳过落盘。
  const _lastSavedFp: Record<'main' | 'vault', string> = { main: '', vault: '' }

  // ── 数据（只读，委托 dataStore）──
  const bookmarks = computed(() => ds().bookmarks)
  const siblingGroups = computed(() => ds().siblingGroups)
  const categories = computed(() => ds().categories)
  const customAttributes = computed(() => ds().customAttributes)
  const bookmarkMap = computed(() => ds().bookmarkMap)
  const groupMap = computed(() => ds().groupMap)
  const categoryMap = computed(() => ds().categoryMap)
  const attributeMap = computed(() => ds().attributeMap)
  const attributeByName = computed(() => ds().attributeByName)
  const childrenMap = computed(() => ds().childrenMap)
  const filteredBookmarks = computed(() => ds().filteredBookmarks)
  const filteredGroups = computed(() => ds().filteredGroups)
  const cardCounts = computed(() => ds().cardCounts)

  // Helper: 可读写 computed，委托 uiStore
  const uiProp = <K extends keyof UIState>(key: K) => computed({
    get: () => ui()[key],
    set: (v: UIState[K]) => { (ui() as UIState)[key] = v }
  })

  return {
    bookmarks, siblingGroups, categories, customAttributes,
    bookmarkMap, groupMap, categoryMap, attributeMap, attributeByName, childrenMap,
    filteredBookmarks, filteredGroups, cardCounts,
    selectableCategories: computed(() => ds().selectableCategories),
    selectableAttributes: computed(() => ds().selectableAttributes),

    // ── UI 状态（可读写，委托 uiStore）──
    curCat: uiProp('curCat'),
    sortMode: uiProp('sortMode'),
    sortDir: uiProp('sortDir'),
    layoutMode: uiProp('layoutMode'),
    searchQuery: uiProp('searchQuery'),
    focusedGroupId: uiProp('focusedGroupId'),
    shareMode: uiProp('shareMode'),
    batchMode: uiProp('batchMode'),
    batchSelected: uiProp('batchSelected'),
    activeAttrs: uiProp('activeAttrs'),
    excludedAttrs: uiProp('excludedAttrs'),
    detailCards: uiProp('detailCards'),
    editingId: uiProp('editingId'),
    themeMode: uiProp('themeMode'),
    themeStyle: uiProp('themeStyle'),

    // ── 分组状态（通过对象引用支持个体属性读写）──
    modals: computed({
      get: () => ui().modals,
      set: (v) => { ui().modals = v },
    }),
    panels: computed({
      get: () => ui().panels,
      set: (v) => { ui().panels = v },
    }),
    overlays: computed({
      get: () => ui().overlays,
      set: (v) => { ui().overlays = v },
    }),
    historyItemId: uiProp('historyItemId'),
    historyItemType: uiProp('historyItemType'),
    addToGid: uiProp('addToGid'),
    _addPopoverTrigger: uiProp('_addPopoverTrigger'),
    saveToGroup: uiProp('saveToGroup'),
    ctxGid: uiProp('ctxGid'),
    ctxCard: uiProp('ctxCard'),
    editingGeId: uiProp('editingGeId'),
    lastFocusedEl: uiProp('lastFocusedEl'),
    lpFired: uiProp('lpFired'),
    _prevLayoutMode: uiProp('_prevLayoutMode'),
    shareModalTarget: uiProp('shareModalTarget'),
    e2eUnlockInitialMode: uiProp('e2eUnlockInitialMode'),
    openShareModal(type: 'group' | 'category', id: string) { ui().openShareModal(type, id) },
    closeShareModal() { ui().closeShareModal() },
    openAiAssistant(query = '') { ui().openAiAssistant(query) },

    // ── CRUD（委托 dataStore）──
    addBookmark(bm: Bookmark) { ds().addBookmark(bm) },
    updateBookmark(id: string, changes: Partial<Bookmark>) { ds().updateBookmark(id, changes) },
    deleteBookmark(id: string) { ds().deleteBookmark(id) },
    addGroup(g: SiblingGroup) { ds().addGroup(g) },
    updateGroup(id: string, changes: Partial<SiblingGroup>) { ds().updateGroup(id, changes) },
    deleteGroup(id: string) { ds().deleteGroup(id) },
    addCategory(cat: Category) { ds().addCategory(cat) },
    renameCategory(id: string, name: string) { ds().renameCategory(id, name) },
    deleteCategory(id: string) { ds().deleteCategory(id) },
    addAttribute(attr: CustomAttribute) { ds().addAttribute(attr) },
    renameAttribute(id: string, name: string) { ds().renameAttribute(id, name) },
    deleteAttribute(id: string) { ds().deleteAttribute(id) },
    restoreBookmark(id: string) { ds().restoreBookmark(id) },
    restoreGroup(id: string) { ds().restoreGroup(id) },
    restoreCategory(id: string) { ds().restoreCategory(id) },
    restoreAttribute(id: string) { ds().restoreAttribute(id) },
    permanentDeleteBookmark(id: string, opts?: { skipPersist?: boolean }) {
      if (opts !== undefined) ds().permanentDeleteBookmark(id, opts)
      else ds().permanentDeleteBookmark(id)
    },
    permanentDeleteGroup(id: string) { ds().permanentDeleteGroup(id) },
    permanentDeleteCategory(id: string) { ds().permanentDeleteCategory(id) },
    permanentDeleteAttribute(id: string, opts?: { skipPersist?: boolean }) {
      if (opts !== undefined) ds().permanentDeleteAttribute(id, opts)
      else ds().permanentDeleteAttribute(id)
    },
    ensureGroupAttribute() { return ds().ensureGroupAttribute() },
    emptyTrash() { ds().emptyTrash() },
    importFromData(data: Partial<AppData>) {
      ds().importFromData(data)
      const u = ui()
      u.curCat = 'all'
      u.focusedGroupId = null
      u.activeAttrs.splice(0)
      u.excludedAttrs.splice(0)
      u.detailCards.splice(0)
      u.batchMode = false
      u.batchSelected.splice(0)
      u.expandedIds.splice(0)
      u.searchQuery = ''
      u.editingId = null
      u.editingGeId = null
      u.addToGid = null
      u.saveToGroup = null
      u.ctxGid = null
      if (u.quickLookBmId) u.closeQuickLook()
      if (Array.isArray(u.quickLookHistory)) u.quickLookHistory.splice(0)
      this.save()
    },

    // ── UI（委托 uiStore）──
    selectAllBatch() { ui().selectAllBatch() },
    saveUIState() { ui().saveUIState() },
    restoreUIState() { ui().restoreUIState() },

    // ── 持久化（协调多个 Store）──
    loadFromStorage() { ds().loadFromStorage() },
    tryLoadFromIDB() { return ds().tryLoadFromIDB() },

    save(): Promise<boolean> {
      // 分享只读态：一律拒写。影子数据虽只在 map 层（进不了落盘快照），
      // 但分享态下仍可能有本地路径触发保存，且落盘会连带把 _writeSeq /
      // localStorage 缓存推高。返回 true 表示「无需保存」，避免误报存储失败。
      if (ui().shareMode) return Promise.resolve(true)
      const d = ds()
      if (d._saveTimer) {
        clearTimeout(d._saveTimer)
        d._saveTimer = null
      }
      const data = d._dataSnapshot()
      const fp = _fingerprint(data)
      const space = ui().curSpace
      if (fp && fp === _lastSavedFp[space]) return Promise.resolve(true)
      // #56 写入侧 schema 守卫：绝不落盘「读取侧会拒绝」的快照。
      // 读取侧 AppDataSchema 校验失败会回退 DEFAULTS（用户看到整库消失），
      // 所以只要内存态已经不合法，就必须拦在写入前 —— 否则一次坏写会覆盖掉
      // 上一份好快照，把「可恢复」变成「真丢数据」。
      // 用同一份 AppDataSchema（不是另写一套规则），保证「写进去的必能读回来」。
      const shape = AppDataSchema.safeParse(data)
      if (!shape.success) {
        const detail = shape.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ')
        console.error('[app.save] 快照未通过 schema 校验，已拒绝落盘（保留上一份好快照）：', detail)
        const now = Date.now()
        const due = !_invalidSnapshotWarned || (now - _lastInvalidSnapshotToastAt >= STORAGE_FAIL_REMIND_MS)
        if (due) {
          _invalidSnapshotWarned = true
          _lastInvalidSnapshotToastAt = now
          toast(t('msg.storageInvalidSnapshot'), false)
        }
        return Promise.resolve(false)
      }
      d._storageInfoDirty = true
      d._saveCount++
      // IDB 权威写入（含 localStorage 尽力缓存）；按当前数据空间选存储键——
      // 主页 linkvault_v2 / 私密空间 linkvault_vault_v1，物理隔离。
      // E1-003：返回 Promise 供 flush 可 await；toast 仍链式处理。
      const p = persist.saveData(data, space).then(ok => {
        if (ok) {
          _lastSavedFp[space] = fp
          // H11：写入恢复成功即清旗标，让「恢复→再失败」能重新提示
          _storageFailWarned = false
          _lastStorageFailToastAt = 0
        } else {
          // G1-004：持续失败时按间隔重复显著提示，禁止只 toast 一次后静默丢写
          const now = Date.now()
          const due = !_storageFailWarned || (now - _lastStorageFailToastAt >= STORAGE_FAIL_REMIND_MS)
          if (due) {
            _storageFailWarned = true
            _lastStorageFailToastAt = now
            toast(t('msg.storageUnavailable'), false)
          }
        }
        return ok
      })
      if (d._saveCount % 10 === 0) useUndoStore().cleanStale()
      return p
    },

    debouncedSave(delayMs = 300) {
      const d = ds()
      if (d._saveTimer) clearTimeout(d._saveTimer)
      d._saveTimer = setTimeout(() => {
        d._saveTimer = null
        this.save()
      }, delayMs)
    },

    /** E1-003：取消防抖并 await 落盘 */
    flushDebouncedSave(): Promise<boolean> {
      _flushPendingHist()
      const d = ds()
      if (d._saveTimer) {
        clearTimeout(d._saveTimer)
        d._saveTimer = null
      }
      return this.save()
    },

    _dataSnapshot() { return ds()._dataSnapshot() },

    getStorageInfo() {
      const d = ds()
      if (!d._storageInfoDirty && d._cachedStorageInfo) return d._cachedStorageInfo
      d._cachedStorageInfo = persist.getStorageInfo(this._dataSnapshot())
      d._storageInfoDirty = false
      return d._cachedStorageInfo
    },

    _backupBeforeImport() { persist.saveToLocalStorage(this._dataSnapshot(), ui().curSpace) },
  }
})

// ── 独立保存函数（无需 useAppStore 即可调用）──
// 委托至 appStore action，避免保存逻辑重复

export function saveAppData() {
  return useAppStore().save()
}

export function debouncedSaveAppData() {
  useAppStore().debouncedSave()
}

/** PERF-3：笔记/编辑器路径更长 debounce，与 CRUD 300ms 解耦，降低 TipTap 输入写放大 */
export function debouncedSaveAppDataNotes(delayMs = 1200) {
  useAppStore().debouncedSave(delayMs)
}

/** E1-003：可 await 的 flush */
export function flushSaveAppData(): Promise<boolean> {
  return useAppStore().flushDebouncedSave()
}
