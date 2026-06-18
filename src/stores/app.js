/**
 * app.js — 兼容层（组合 Store）
 * 组合 data / ui / security 三个子 Store，保持向后兼容。
 * 新代码建议直接使用 useDataStore / useUIStore / useSecurityStore。
 */
import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useDataStore } from './data.js'
import { useUIStore } from './ui.js'
import { useSecurityStore } from './security.js'
import { useUndoStore } from './undo.js'
import * as persist from './persist.js'

export const useAppStore = defineStore('app', () => {
  const ds = () => useDataStore()
  const ui = () => useUIStore()
  const sec = () => useSecurityStore()

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

  // ── 安全（只读，委托 securityStore）──
  const masterPassword = computed(() => sec().masterPassword)
  const masterPasswordOpen = computed(() => sec().masterPasswordOpen)

  // Helper: 可读写 computed，委托 uiStore
  const uiProp = (key) => computed({
    get: () => ui()[key],
    set: (v) => { ui()[key] = v }
  })

  const _uiKeys = [
    'curCat', 'sortMode', 'sortDir', 'layoutMode', 'searchQuery',
    'focusedGroupId', 'batchMode', 'batchSelected', 'activeAttrs', 'excludedAttrs',
    'detailCards', 'detailOpen', 'editingId', 'themeMode', 'themeStyle',
    'settingsOpen', 'addDropdownOpen', 'railOpen', 'bmModalOpen', 'addBmPopoverOpen',
    'catModalOpen', 'attrModalOpen', 'groupEditOpen',
    'confirmModalOpen', 'confirmModalMessage', 'confirmModalCallback',
    'mentionGid', 'mentionQuery', 'mentionIdx', 'mentionActive', 'mentionType',
    'mentionSubMode', 'mentionSubIdx',
    'addToGid', '_addPopoverTrigger', 'saveToGroup',
    'ctxGid', 'ctxCard', 'editingGeId', 'lastFocusedEl', 'lpFired',
    '_prevLayoutMode',
  ]

  return {
    bookmarks, siblingGroups, categories, customAttributes,
    bookmarkMap, groupMap, childrenMap,
    filteredBookmarks, filteredGroups, cardCounts,
    selectableCategories: computed(() => ds().selectableCategories),
    masterPassword, masterPasswordOpen,

    // ── UI 状态（可读写，批量委托 uiStore）──
    ...Object.fromEntries(_uiKeys.map(k => [k, uiProp(k)])),

    // ── CRUD（委托 dataStore）──
    addBookmark(bm) { ds().addBookmark(bm) },
    updateBookmark(id, changes) { ds().updateBookmark(id, changes) },
    deleteBookmark(id) { ds().deleteBookmark(id) },
    addGroup(g) { ds().addGroup(g) },
    updateGroup(id, changes) { ds().updateGroup(id, changes) },
    deleteGroup(id) { ds().deleteGroup(id) },
    addCategory(cat) { ds().addCategory(cat) },
    renameCategory(id, name) { ds().renameCategory(id, name) },
    deleteCategory(id) { ds().deleteCategory(id) },
    addAttribute(attr) { ds().addAttribute(attr) },
    renameAttribute(id, name) { ds().renameAttribute(id, name) },
    deleteAttribute(id) { ds().deleteAttribute(id) },
    importFromData(data) {
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

    // ── 安全（委托 securityStore）──
    async setMasterPassword(pw) { await sec().setMasterPassword(pw) },
    encryptFormPassword(plaintext) { return sec().encryptFormPassword(plaintext) },
    decryptStoredPassword(stored) { return sec().decryptStoredPassword(stored) },
    verifyMasterPassword(pw) { return sec().verifyMasterPassword(pw) },
    clearMasterPassword() { sec().clearMasterPassword() },

    // ── 持久化（协调多个 Store）──
    loadFromStorage() { ds().loadFromStorage() },
    tryLoadFromIDB() { return ds().tryLoadFromIDB() },

    save() {
      const d = ds()
      d._storageInfoDirty = true
      d._saveCount++
      const data = d._dataSnapshot()
      const ok = persist.saveToLocalStorage(data)
      if (!ok) { console.warn('[store] localStorage save failed') }
      persist.saveToIDB(data)
      if (d._saveCount % 10 === 0) useUndoStore().cleanStale()
    },

    debouncedSave() {
      const d = ds()
      if (d._saveTimer) clearTimeout(d._saveTimer)
      d._saveTimer = setTimeout(() => {
        d._saveTimer = null
        this.save()
      }, 300)
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
