/**
 * ui.js — UI 状态 Store
 * 职责：管理所有运行时 UI 状态（视图、面板、模态框、拖拽上下文等）
 * 从 app.js 拆分而来
 */
import { defineStore } from 'pinia'
import { CAT_ALL, UI_STATE_KEY } from '../config/constants.js'
import { useDataStore } from './data.js'
import { isMobile } from '../utils.js'

export const useUIStore = defineStore('ui', {
  state: () => ({
    curCat: CAT_ALL,
    isMobile: isMobile(),
    sortMode: 'order',
    sortDir: 'desc',
    layoutMode: 'grid',
    searchQuery: '',
    focusedGroupId: null,
    batchMode: false,
    batchSelected: [],
    activeAttrs: [],
    excludedAttrs: [],
    detailCards: [],
    detailOpen: false,
    editingId: null,

    themeMode: 'auto',
    themeStyle: 'premium',

    // 面板状态
    settingsOpen: false,
    addDropdownOpen: false,
    railOpen: false,
    bmModalOpen: false,
    addBmPopoverOpen: false,
    catModalOpen: false,
    attrModalOpen: false,
    groupEditOpen: false,
    confirmModalOpen: false,
    confirmModalMessage: '',
    confirmModalCallback: null,

    // Mention 状态
    mentionGid: null,
    mentionQuery: '',
    mentionIdx: 0,
    mentionActive: false,
    mentionType: 'bm',
    mentionSubMode: false,
    mentionSubIdx: 0,

    // 运行时上下文
    addToGid: null,
    _addPopoverTrigger: null, // { top, left, width } — 弹出框定位锚点
    saveToGroup: null,
    ctxGid: null,
    ctxCard: null,
    editingGeId: null,
    lastFocusedEl: null,
    lpFired: false,
    _prevLayoutMode: null,
    _preferredLayoutMode: null,
  }),

  actions: {
    /** 全选批量模式下的所有项 */
    selectAllBatch() {
      const ds = useDataStore()
      this.batchSelected = [
        ...ds.filteredBookmarks.map(b => b.id),
        ...ds.filteredGroups.map(g => 'group:' + g.id)
      ]
    },

    setMobile(value) {
      this.isMobile = value
      if (value) {
        if (!this._preferredLayoutMode) {
          this._preferredLayoutMode = this.layoutMode
        }
        this.layoutMode = 'list'
      } else {
        if (this._preferredLayoutMode) {
          this.layoutMode = this._preferredLayoutMode
          this._preferredLayoutMode = null
        }
      }
    },

    // ─── UI 状态持久化 ───
    saveUIState() {
      try {
        const s = {
          curCat: this.curCat,
          focusedGroupId: this.focusedGroupId || null,
          activeAttrs: this.activeAttrs.slice(),
          excludedAttrs: this.excludedAttrs.slice(),
          detailCards: this.detailCards.slice(),
          searchQuery: this.searchQuery || '',
          sortMode: this.sortMode || 'order',
          layoutMode: this.layoutMode,
          detailOpen: this.detailOpen || false,
          docScrollTop: document.documentElement.scrollTop || 0,
          _preferredLayoutMode: this._preferredLayoutMode || null,
        }
        localStorage.setItem(UI_STATE_KEY, JSON.stringify(s))
      } catch (e) { console.warn('[LinkVault] Failed to save UI state:', e.message) }
    },

    restoreUIState() {
      try {
        const raw = localStorage.getItem(UI_STATE_KEY)
        if (!raw) return
        const s = JSON.parse(raw)
        if (s.curCat) this.curCat = s.curCat
        if (s.sortMode) this.sortMode = s.sortMode
        if (s.layoutMode === 'list' || s.layoutMode === 'grid') this.layoutMode = s.layoutMode
        if (s.searchQuery) this.searchQuery = s.searchQuery
        if (Array.isArray(s.activeAttrs)) this.activeAttrs = s.activeAttrs.slice()
        if (Array.isArray(s.excludedAttrs)) this.excludedAttrs = s.excludedAttrs.slice()
        if (s.focusedGroupId) {
          const ds = useDataStore()
          const fg = ds.groupMap[s.focusedGroupId]
          if (fg) this.focusedGroupId = s.focusedGroupId
        }
        if (Array.isArray(s.detailCards)) {
          const ds = useDataStore()
          this.detailCards = s.detailCards.filter(entry => {
            if (typeof entry === 'string' && entry.startsWith('group:')) return ds.siblingGroups.some(g => g.id === entry.slice(6))
            return ds.bookmarks.some(b => b.id === entry)
          })
        }
        if (s._preferredLayoutMode === 'grid' || s._preferredLayoutMode === 'list') {
          this._preferredLayoutMode = s._preferredLayoutMode
        }
        if (s.detailOpen && this.detailCards.length) this.detailOpen = true
        if (s.docScrollTop) document.documentElement.scrollTop = s.docScrollTop
      } catch (e) { console.warn('[LinkVault] Failed to restore UI state:', e.message) }
    },
  },
})
