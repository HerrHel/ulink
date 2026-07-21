/**
 * ui.ts — UI 状态 Store
 * 职责：管理所有运行时 UI 状态（视图、面板、模态框、拖拽上下文等）
 * 从 app.js 拆分而来
 */
import { defineStore } from 'pinia'
import { CAT_ALL, UI_STATE_KEY } from '../config/constants.js'
import { useDataStore } from './data.js'
import { isMobile } from '../utils.js'
import { safeGetItem, safeSetItem } from '../lib/storageSafe.js'

// ── 严格字面量类型 ──
export type ThemeStyle = 'premium' | 'comfortable'

/** 排序模式（与 SettingsPanel 的 sortModes、_sortItems 一致） */
export type SortMode = 'order' | 'title' | 'dateDesc' | 'dateAsc' | 'useCount'

/** 排序方向 */
export type SortDir = 'asc' | 'desc'

/** 布局模式：grid 大宫格 / list 列表 / mini-grid 小宫格 */
export type LayoutMode = 'grid' | 'list' | 'mini-grid'

interface ModalState {
  bookmark: boolean
  category: boolean
  attribute: boolean
  groupEdit: boolean
  e2eSetup: boolean
  e2eUnlock: boolean
  setupGuide: boolean
}

interface PanelState {
  settings: boolean
  detail: boolean
  trash: boolean
  history: boolean
  rail: boolean
  shortcutHelp: boolean
}

interface OverlayState {
  addDropdown: boolean   // addDropdownOpen
  addPopover: boolean    // addBmPopoverOpen
  deadLinks: boolean     // deadLinksPopoverOpen
  /** A4-007：反馈弹窗纳入 overlays，支持 Esc / popstate */
  feedback: boolean
}

export interface UIState {
  curCat: string
  isMobile: boolean
  sortMode: SortMode
  sortDir: SortDir
  layoutMode: LayoutMode
  groupsOnTop: boolean
  searchQuery: string
  focusedGroupId: string | null
  batchMode: boolean
  batchSelected: string[]
  activeAttrs: string[]
  excludedAttrs: string[]
  detailCards: string[]
  editingId: string | null
  themeMode: 'auto' | 'manual'
  themeStyle: ThemeStyle
  historyItemId: string
  historyItemType: 'bookmark' | 'group'
  historyMax: number
  addToGid: string | null
  _addPopoverTrigger: { top: number; left: number; width: number } | null
  saveToGroup: string | null
  ctxGid: string | null
  ctxCard: HTMLElement | null
  editingGeId: string | null
  lastFocusedEl: HTMLElement | null
  lpFired: boolean
  _prevLayoutMode: LayoutMode | null
  _preferredLayoutMode: LayoutMode | null
  /** 移动端记住的布局（list/mini-grid），移动端不可用 grid */
  _mobileLayoutMode: 'list' | 'mini-grid'

  // 分组状态
  modals: ModalState
  panels: PanelState
  overlays: OverlayState
}

export const useUIStore = defineStore('ui', {
  state: (): UIState => ({
    curCat: CAT_ALL,
    isMobile: isMobile(),
    sortMode: 'order',
    sortDir: 'desc',
    groupsOnTop: true,
    layoutMode: 'grid',
    searchQuery: '',
    focusedGroupId: null,
    batchMode: false,
    batchSelected: [],
    activeAttrs: [],
    excludedAttrs: [],
    detailCards: [],
    editingId: null,
    // D1-004：默认 manual，与 theme.ts 缺省 lv_themeMode 一致
    themeMode: 'manual',
    themeStyle: 'premium',
    historyItemId: '',
    historyItemType: 'bookmark',
    historyMax: 10,
    modals: {
      bookmark: false,
      category: false,
      attribute: false,
      groupEdit: false,
      e2eSetup: false,
      e2eUnlock: false,
      setupGuide: false,
    },
    panels: {
      settings: false,
      detail: false,
      trash: false,
      history: false,
      rail: false,
      shortcutHelp: false,
    },
    overlays: {
      addDropdown: false,
      addPopover: false,
      deadLinks: false,
      feedback: false,
    },
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
    _mobileLayoutMode: 'list',
  }),

  actions: {
    /** 全选批量模式下的所有项 */
    selectAllBatch() {
      const ds = useDataStore()
      // A4-004：仅顶层可见卡 + 组；子书签由删除/移动路径 collectSubIds 显式展开
      this.batchSelected = [
        ...ds.filteredBookmarks.filter(b => !b.parentId).map(b => b.id),
        ...ds.filteredGroups.map(g => 'group:' + g.id)
      ]
    },

    setMobile(value: boolean) {
      if (this.isMobile === value) return
      this.isMobile = value
      // 同步 <html> class，供 CSS 区分真移动端 vs 窄窗口 PC
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('is-mobile', value)
      }
      if (value) {
        // 进移动端：grid 不可用，统一降级到移动端布局（list/mini-grid）
        if (!this._preferredLayoutMode) this._preferredLayoutMode = this.layoutMode
        if (this.layoutMode === 'list' || this.layoutMode === 'mini-grid') {
          this._mobileLayoutMode = this.layoutMode
        }
        this.layoutMode = this._mobileLayoutMode
      } else {
        // 切回 PC：grid 在移动端被降级，此处恢复用户 PC 偏好
        if (this._preferredLayoutMode) {
          this.layoutMode = this._preferredLayoutMode
          this._preferredLayoutMode = null
        } else if (this.layoutMode === 'mini-grid') {
          // 兜底：PC 端默认 grid
          this.layoutMode = 'grid'
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
          sortDir: this.sortDir || 'desc',
          groupsOnTop: this.groupsOnTop,
          layoutMode: this.layoutMode,
          historyMax: this.historyMax,
          docScrollTop: document.documentElement.scrollTop || 0,
          _preferredLayoutMode: this._preferredLayoutMode || null,
          _mobileLayoutMode: this._mobileLayoutMode,
          _customCardOrder: ds._customCardOrder || null,
        }
        if (!safeSetItem(UI_STATE_KEY, JSON.stringify(s))) {
          console.warn('[LinkVault] Failed to save UI state: storage full or unavailable')
        }
      } catch (e) { console.warn('[LinkVault] Failed to save UI state:', (e as Error).message) }
    },

    restoreUIState() {
      try {
        const raw = safeGetItem(UI_STATE_KEY)
        if (!raw) return
        const s = JSON.parse(raw)
        if (s.curCat) this.curCat = s.curCat
        if (s.sortMode) this.sortMode = s.sortMode
        if (s.sortDir === 'asc' || s.sortDir === 'desc') this.sortDir = s.sortDir
        if (typeof s.groupsOnTop === 'boolean') this.groupsOnTop = s.groupsOnTop
        if (s.layoutMode === 'list' || s.layoutMode === 'grid' || s.layoutMode === 'mini-grid') this.layoutMode = s.layoutMode
        if (typeof s.historyMax === 'number') this.historyMax = Math.min(30, Math.max(5, s.historyMax))
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
        if (s._preferredLayoutMode === 'grid' || s._preferredLayoutMode === 'list' || s._preferredLayoutMode === 'mini-grid') {
          this._preferredLayoutMode = s._preferredLayoutMode
        }
        if (s._mobileLayoutMode === 'mini-grid') this._mobileLayoutMode = 'mini-grid'
        // 移动端不可用 grid：还原若落在 grid 上则降级
        if (this.isMobile && this.layoutMode === 'grid') this.layoutMode = this._mobileLayoutMode
        if (Array.isArray(s._customCardOrder)) {
          const ds = useDataStore()
          ds._customCardOrder = s._customCardOrder
        }
        if (s.docScrollTop) document.documentElement.scrollTop = s.docScrollTop
        // themeStyle 不入 UI state 持久化对象（单一真相源是 theme.ts 的 lv_themeStyle key
        // —— themeSetStyle 写、theme.ts IIFE 启动读回设 DOM 属性）。但 uiStore.themeStyle 内存态
        // 刷新后会重置为默认 'premium'，导致重启后 SettingsPanel 的 :class 高亮与实际 DOM 主题
        // 不一致（实际是 comfortable 却高亮 premium）。此处从 lv_themeStyle 同步回 uiStore.themeStyle，
        // 与 theme.ts 已设的 DOM 态对齐，单一真相源不污染 saveUIState。
        const ts = safeGetItem('lv_themeStyle')
        if (ts === 'comfortable' || ts === 'premium') this.themeStyle = ts
        // D1-004：themeMode 同样以 lv_themeMode 为真相源，避免面板默认误显「跟随系统」
        const tm = safeGetItem('lv_themeMode')
        this.themeMode = tm === 'auto' ? 'auto' : 'manual'
      } catch (e) { console.warn('[LinkVault] Failed to restore UI state:', (e as Error).message) }
    },
  },
})
