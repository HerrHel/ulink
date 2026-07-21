/**
 * app.ts — Facade Store
 * 组合 data / ui 两个子 Store，提供统一接口。
 * 新代码也可直接使用 useDataStore / useUIStore。
 */
import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useDataStore } from './data.js'
import { useUIStore } from './ui.js'
import type { UIState } from './ui.js'
import { useUndoStore } from './undo.js'
import * as persist from './persist.js'
import { AppDataSchema } from '../schemas.js'
import { toast } from '../lib/toast.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute, AppData } from '../types.js'

export const useAppStore = defineStore('app', () => {
  const ds = () => useDataStore()
  const ui = () => useUIStore()
  // 隐私模式 / IDB 配额满：首次必 toast；持续失败时每 STORAGE_FAIL_REMIND_MS 再提醒（G1-004）
  let _storageFailWarned = false
  let _lastStorageFailToastAt = 0
  const STORAGE_FAIL_REMIND_MS = 5 * 60 * 1000
  // PERF-3：上次成功写入的快照指纹，相同则跳过 Zod/双写
  let _lastSavedFingerprint = ''

  function _fingerprint(data: AppData): string {
    // 轻量指纹：长度 + 实体数 + 关键时间戳；避免每次完整 JSON.stringify 两遍
    const bms = data.bookmarks || []
    const grps = data.siblingGroups || []
    let maxUp = 0
    for (const b of bms) if ((b.updatedAt || 0) > maxUp) maxUp = b.updatedAt || 0
    for (const g of grps) if ((g.updatedAt || 0) > maxUp) maxUp = g.updatedAt || 0
    return `${bms.length}|${grps.length}|${(data.categories || []).length}|${(data.customAttributes || []).length}|${maxUp}|${(data as { _schemaVersion?: number })._schemaVersion ?? ''}`
  }

  // ── 数据（只读，委托 dataStore）──
  const bookmarks = computed(() => ds().bookmarks)
  const siblingGroups = computed(() => ds().siblingGroups)
  const categories = computed(() => ds().categories)
  const customAttributes = computed(() => ds().customAttributes)
  const bookmarkMap = computed(() => ds().bookmarkMap)
  const groupMap = computed(() => ds().groupMap)
  const categoryMap = computed(() => ds().categoryMap)
  const attributeMap = computed(() => ds().attributeMap)
  const childrenMap = computed(() => ds().childrenMap)
  const filteredBookmarks = computed(() => ds().filteredBookmarks)
  const filteredGroups = computed(() => ds().filteredGroups)
  const cardCounts = computed(() => ds().cardCounts)

  // Helper: 可读写 computed，委托 uiStore
  const uiProp = <K extends keyof UIState>(key: K) => computed({
    get: () => ui()[key],
    set: (v: UIState[K]) => { (ui() as any)[key] = v }
  })

  return {
    bookmarks, siblingGroups, categories, customAttributes,
    bookmarkMap, groupMap, categoryMap, attributeMap, childrenMap,
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
    permanentDeleteBookmark(id: string) { ds().permanentDeleteBookmark(id) },
    permanentDeleteGroup(id: string) { ds().permanentDeleteGroup(id) },
    permanentDeleteCategory(id: string) { ds().permanentDeleteCategory(id) },
    permanentDeleteAttribute(id: string) { ds().permanentDeleteAttribute(id) },
    emptyTrash() { ds().emptyTrash() },
    importFromData(data: Partial<AppData>) {
      ds().importFromData(data)
      const u = ui()
      u.curCat = 'all'; u.focusedGroupId = null
      u.activeAttrs = []; u.excludedAttrs = []; u.detailCards = []
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
      const d = ds()
      const data = d._dataSnapshot()
      const fp = _fingerprint(data)
      if (fp && fp === _lastSavedFingerprint) return Promise.resolve(true)
      // 运行时验证数据完整性，阻止损坏数据写入存储
      const parsed = AppDataSchema.safeParse(data)
      if (!parsed.success) {
        console.error('[store] 数据验证失败，跳过存储:', parsed.error.issues)
        return Promise.resolve(false)
      }
      d._storageInfoDirty = true
      d._saveCount++
      // IDB 权威写入（含 localStorage 尽力缓存）
      // E1-003：返回 Promise 供 flush 可 await；toast 仍链式处理。
      const p = persist.saveData(parsed.data).then(ok => {
        if (ok) {
          _lastSavedFingerprint = fp
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
            toast('⚠️ 存储不可用（如隐私模式/配额满），刷新后数据可能丢失，请尽快导出备份', false)
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

    _backupBeforeImport() { persist.saveToLocalStorage(this._dataSnapshot()) },
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
