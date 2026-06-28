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
import { toast } from '../lib/toast.js'
import { useCloudSync } from '../composables/domain/useCloudSync.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute, AppData } from '../types.js'

let _localStorageWarned = false

export const useAppStore = defineStore('app', () => {
  const ds = () => useDataStore()
  const ui = () => useUIStore()

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
    set: (v: UIState[K]) => { ui()[key] = v }
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
    detailOpen: uiProp('detailOpen'),
    editingId: uiProp('editingId'),
    themeMode: uiProp('themeMode'),
    themeStyle: uiProp('themeStyle'),
    addBmPopoverOpen: uiProp('addBmPopoverOpen'),
    deadLinksPopoverOpen: uiProp('deadLinksPopoverOpen'),
    addDropdownOpen: uiProp('addDropdownOpen'),

    // ── 分组状态（通过对象引用支持个体属性读写）──
    modals: computed({
      get: () => ui().modals,
      set: (v) => { ui().modals = v },
    }),
    panels: computed({
      get: () => ui().panels,
      set: (v) => { ui().panels = v },
    }),
    trashPanelOpen: uiProp('trashPanelOpen'),
    historyPanelOpen: uiProp('historyPanelOpen'),
    historyItemId: uiProp('historyItemId'),
    historyItemType: uiProp('historyItemType'),
    mentionGid: uiProp('mentionGid'),
    mentionQuery: uiProp('mentionQuery'),
    mentionIdx: uiProp('mentionIdx'),
    mentionActive: uiProp('mentionActive'),
    mentionType: uiProp('mentionType'),
    mentionSubMode: uiProp('mentionSubMode'),
    mentionSubIdx: uiProp('mentionSubIdx'),
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
      d._storageInfoDirty = true
      d._saveCount++
      const data = d._dataSnapshot()
      const ok = persist.saveToLocalStorage(data)
      if (!ok) {
        console.warn('[store] localStorage save failed')
        if (!_localStorageWarned) {
          _localStorageWarned = true
          toast('本地存储已满，数据已备份到 IndexedDB', false)
        }
      }
      persist.saveToIDB(data)
      if (d._saveCount % 10 === 0) useUndoStore().cleanStale()
      try { useCloudSync().debouncedSync() } catch (_) { /* 未登录时忽略 */ }
    },

    debouncedSave() {
      const d = ds()
      if (d._saveTimer) clearTimeout(d._saveTimer)
      d._saveTimer = setTimeout(() => {
        d._saveTimer = null
        this.save()
      }, 300)
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

export function flushSaveAppData() {
  useAppStore().flushDebouncedSave()
}
