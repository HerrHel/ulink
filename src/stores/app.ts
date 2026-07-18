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
  // 隐私模式 / IDB 配额满 toast 只弹一次（flag 保证不刷屏）。
  let _storageFailWarned = false
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
    bookmarkMap, groupMap, childrenMap,
    filteredBookmarks, filteredGroups, cardCounts,
    selectableCategories: computed(() => ds().selectableCategories),

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

    save() {
      const d = ds()
      const data = d._dataSnapshot()
      const fp = _fingerprint(data)
      if (fp && fp === _lastSavedFingerprint) return
      // 运行时验证数据完整性，阻止损坏数据写入存储
      const parsed = AppDataSchema.safeParse(data)
      if (!parsed.success) {
        console.error('[store] 数据验证失败，跳过存储:', parsed.error.issues)
        return
      }
      d._storageInfoDirty = true
      d._saveCount++
      // IDB 权威写入（含 localStorage 尽力缓存）
      // persist.saveData 失败时返回 false（隐私模式/IDB配额满等），fire-and-forget 但 toast 首次警告。
      // 旧实现不 await 不检查返回值 → 用户存的书签没落库却无任何提示，下次刷新发现丢了误以为 bug。
      // 只弹一次避免刷屏：debouncedSave 300ms 防抖触发 save 频率不低。
      persist.saveData(parsed.data).then(ok => {
        if (ok) {
          _lastSavedFingerprint = fp
          // H11 修复：IDB 配额满/隐私模式下 saveData 持续返回 false，但 _storageFailWarned
          // 一旦置 true 永不重置，后续持续失败静默，用户继续增删书签数据仅存活于内存，
          // 刷新即全部丢失却再无任何提示。写入恢复成功即清旗标，让"恢复→再失败"能重新提示，
          // 既保留"单次失败只弹一次避免刷屏"语义，又能在存储恢复后重新具备告警能力。
          _storageFailWarned = false
        }
        if (!ok && !_storageFailWarned) {
          _storageFailWarned = true
          toast('⚠️ 存储不可用（如隐私模式/配额满），刷新后数据可能丢失', false)
        }
      })
      if (d._saveCount % 10 === 0) useUndoStore().cleanStale()
    },

    debouncedSave(delayMs = 300) {
      const d = ds()
      if (d._saveTimer) clearTimeout(d._saveTimer)
      d._saveTimer = setTimeout(() => {
        d._saveTimer = null
        this.save()
      }, delayMs)
    },

    flushDebouncedSave() {
      const d = ds()
      if (d._saveTimer) {
        clearTimeout(d._saveTimer)
        d._saveTimer = null
        this.save()
      }
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
  useAppStore().save()
}

export function debouncedSaveAppData() {
  useAppStore().debouncedSave()
}

/** PERF-3：笔记/编辑器路径更长 debounce，与 CRUD 300ms 解耦，降低 TipTap 输入写放大 */
export function debouncedSaveAppDataNotes(delayMs = 1200) {
  useAppStore().debouncedSave(delayMs)
}

export function flushSaveAppData() {
  useAppStore().flushDebouncedSave()
}
