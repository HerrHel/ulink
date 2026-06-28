/**
 * ui.ts — UI 状态 Store
 * 职责：管理所有运行时 UI 状态（视图、面板、模态框、拖拽上下文等）
 * 从 app.js 拆分而来
 */
import { defineStore } from 'pinia'
import { CAT_ALL, UI_STATE_KEY } from '../config/constants.js'
import { useDataStore } from './data.js'
import { isMobile } from '../utils.js'

export interface UIState {
  curCat: string
  isMobile: boolean
  sortMode: string
  sortDir: string
  layoutMode: 'grid' | 'list'
  searchQuery: string
  focusedGroupId: string | null
  batchMode: boolean
  batchSelected: string[]
  activeAttrs: string[]
  excludedAttrs: string[]
  detailCards: string[]
  detailOpen: boolean
  editingId: string | null
  themeMode: 'auto' | 'manual'
  themeStyle: string
  settingsOpen: boolean
  addDropdownOpen: boolean
  railOpen: boolean
  bmModalOpen: boolean
  addBmPopoverOpen: boolean
  deadLinksPopoverOpen: boolean
  catModalOpen: boolean
  attrModalOpen: boolean
  groupEditOpen: boolean
  confirmModalOpen: boolean
  confirmModalMessage: string
  trashPanelOpen: boolean
  historyPanelOpen: boolean
  historyItemId: string
  historyItemType: 'bookmark' | 'group'
  e2eSetupOpen: boolean
  e2eUnlockOpen: boolean
  mentionGid: string | null
  mentionQuery: string
  mentionIdx: number
  mentionActive: boolean
  mentionType: 'bm' | 'group'
  mentionSubMode: boolean
  mentionSubIdx: number
  addToGid: string | null
  _addPopoverTrigger: { top: number; left: number; width: number } | null
  saveToGroup: string | null
  ctxGid: string | null
  ctxCard: HTMLElement | null
  editingGeId: string | null
  lastFocusedEl: HTMLElement | null
  lpFired: boolean
  _prevLayoutMode: 'grid' | 'list' | null
  _preferredLayoutMode: 'grid' | 'list' | null
}

export const useUIStore = defineStore('ui', {
  state: (): UIState => ({
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
    settingsOpen: false,
    addDropdownOpen: false,
    railOpen: false,
    bmModalOpen: false,
    addBmPopoverOpen: false,
    deadLinksPopoverOpen: false,
    catModalOpen: false,
    attrModalOpen: false,
    groupEditOpen: false,
    confirmModalOpen: false,
    confirmModalMessage: '',
    trashPanelOpen: false,
    historyPanelOpen: false,
    historyItemId: '',
    historyItemType: 'bookmark',
    e2eSetupOpen: false,
    e2eUnlockOpen: false,
    mentionGid: null,
    mentionQuery: '',
    mentionIdx: 0,
    mentionActive: false,
    mentionType: 'bm',
    mentionSubMode: false,
    mentionSubIdx: 0,
    addToGid: null,
    _addPopoverTrigger: null,
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

    setMobile(value: boolean) {
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
        const ds = useDataStore()
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
          _customCardOrder: ds._customCardOrder || null,
        }
        localStorage.setItem(UI_STATE_KEY, JSON.stringify(s))
      } catch (e) { console.warn('[LinkVault] Failed to save UI state:', (e as Error).message) }
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
          this.detailCards = s.detailCards.filter((entry: string) => {
            if (typeof entry === 'string' && entry.startsWith('group:')) return ds.siblingGroups.some(g => g.id === entry.slice(6))
            return ds.bookmarks.some(b => b.id === entry)
          })
        }
        if (s._preferredLayoutMode === 'grid' || s._preferredLayoutMode === 'list') {
          this._preferredLayoutMode = s._preferredLayoutMode
        }
        if (Array.isArray(s._customCardOrder)) {
          const ds = useDataStore()
          ds._customCardOrder = s._customCardOrder
        }
        if (s.detailOpen && this.detailCards.length) this.detailOpen = true
        if (s.docScrollTop) document.documentElement.scrollTop = s.docScrollTop
      } catch (e) { console.warn('[LinkVault] Failed to restore UI state:', (e as Error).message) }
    },
  },
})
