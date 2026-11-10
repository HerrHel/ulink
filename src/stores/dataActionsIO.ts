/**
 * dataActionsIO.ts — data store 的数据加载 / 导入 / 空间切换（自 data.ts 逐字迁移，逻辑零改动）
 */
import { CAT_ALL, CAT_UNCATEGORIZED } from '../config/constants.js'
import { getLocale } from '../i18n/index.js'
import * as persist from './persist.js'
import { runMigrations } from './migrations.js'
import { useUIStore } from './ui.js'
import { useUndoStore } from './undo.js'
import { clearSearchCache } from '../lib/search.js'
import { _denyWrite, _maybeLoadLocalSpace, _cancelPendingHist } from './dataShared.js'
import type { DataStoreThis } from './dataShared.js'
import type { AppData } from '../types.js'
import type { Space } from './ui.js'

let _switchingSpaceTarget: Space | null = null

export const ioActions = {
  loadFromStorage(this: DataStoreThis) {
    const d = persist.loadFromLocalStorage()
    this.bookmarks = d.bookmarks; this.siblingGroups = d.siblingGroups
    this.categories = d.categories; this.customAttributes = d.customAttributes
    if (d._masterCanary !== undefined) this._masterCanary = d._masterCanary ?? null
    this._syncMaps()
    this._normalizeCategoryOrders()
    this._restoreDeletedGroupMemberships()
    this._restoreDeletedAttrMemberships()
    _cancelPendingHist()
    clearSearchCache()
    this._searchVersion = 1
  },
  async tryLoadFromIDB(this: DataStoreThis): Promise<boolean> {
    const idbData = await persist.loadFromIDB()
    if (idbData) {
      runMigrations(idbData, idbData)
      this.bookmarks = idbData.bookmarks; this.siblingGroups = idbData.siblingGroups
      this.categories = idbData.categories; this.customAttributes = idbData.customAttributes
      if (idbData._masterCanary !== undefined) this._masterCanary = idbData._masterCanary ?? null
      this._syncMaps()
      this._normalizeCategoryOrders()
      this._restoreDeletedGroupMemberships()
      this._restoreDeletedAttrMemberships()
      // R22：清空本地历史防抖 Map，避免旧定时器按旧 id 写快照到重置后数据不对应的 ID。
      _cancelPendingHist()
      clearSearchCache()
      this._searchVersion = 1
      return true
    }
    return false
  },
  importFromData(this: DataStoreThis, data: Partial<AppData>) {
    if (_denyWrite()) return
    const { categories = [], bookmarks = [], customAttributes = [], siblingGroups = [] } = data || {}
    // 防御性结构检查：确保输入是包含 id 的对象数组
    if (!Array.isArray(bookmarks) || !Array.isArray(categories) || !Array.isArray(customAttributes) || !Array.isArray(siblingGroups)) return
    const result = {
      categories: [...categories],
      bookmarks: [...bookmarks],
      customAttributes: [...customAttributes],
      siblingGroups: [...siblingGroups],
    }
    runMigrations(data, result)
    this.categories = result.categories
    this.bookmarks = result.bookmarks
    this.customAttributes = result.customAttributes
    this.siblingGroups = result.siblingGroups
    if (data._masterCanary !== undefined) {
      this._masterCanary = data._masterCanary ?? null
    }
    this._syncMaps()
    this._normalizeCategoryOrders()
    this._restoreDeletedGroupMemberships()
    this._restoreDeletedAttrMemberships()
    this._customCardOrder = null
    // R22：清空本地历史防抖模块级 Map，避免旧定时器按旧 id 写快照到重置后数据不对应的 ID。
    _cancelPendingHist()
    clearSearchCache()
    this._searchVersion = 1
  },
  _dataSnapshot(this: DataStoreThis) {
    const snap: AppData = {
      bookmarks: this.bookmarks,
      siblingGroups: this.siblingGroups,
      categories: this.categories,
      customAttributes: this.customAttributes,
    }
    if (this._masterCanary) snap._masterCanary = this._masterCanary
    return snap
  },

  /**
   * 切换数据空间（主页 ⇄ 私密空间）。两套数据集物理隔离、互不可见：
   * - 先把当前四数组落盘到当前空间 key（确保不丢）
   * - 切 curSpace，清 dirty 三集 + 同步队列 + pending sync 标记
   *   （私密空间不进云端：清队列防私密窗口产生的 op 切回主页后被误推云）
   * - 按目标 key 读目标数据集四数组入内存；目标无数据则空库（私密首进为空）。
   * 因取 uiStore 实例查 curSpace，本 action 必须在 Pinia 已 setActive 后调用。
   */
  async switchSpace(this: DataStoreThis, space: Space): Promise<void> {
    const ui = useUIStore()
    // 分享只读态禁止切换数据空间：写入被 _denyWrite 拦下会导致 curSpace 已切、
    // 数组仍是主页数据的半切换态，后续 save 可能把主页数据写进私密空间键。
    if (ui.shareMode) return
    const cur = ui.curSpace
    if (cur === space || _switchingSpaceTarget === space) return
    _switchingSpaceTarget = space
    try {
    // 取消防抖保存定时器与在途本地历史，防止主/私密空间交错落盘
    if (this._saveTimer) {
      clearTimeout(this._saveTimer)
      this._saveTimer = null
    }
    _cancelPendingHist()
    // 1) 当前空间落盘（防切换中途丢失未提交改动）
    await persist.saveData(this._dataSnapshot(), cur)
    // 1.1) 离开主页前把内存 dirty 落成持久化 sync op（离线也能写入 IDB 队列）。
    //      旧实现直接 clearAllSyncOps + 清 dirty，会把主页尚未推送的改动连同重试队列
    //      一起丢弃，且 queueBackedUp 守卫失效后全量对账可能把本地存活项误删。
    if (cur === 'main') {
      try {
        const { enqueueDirtyAsOps } = await import('../composables/domain/syncPush.js')
        await enqueueDirtyAsOps()
      } catch { /* 同步模块不可用时保持 dirty，至少本地已落盘 */ }
    }
    // 2) 切空间 + 清内存 dirty（私密 CRUD 不得进云端；持久化 op 队列属于主页，绝不清空）
    ui.curSpace = space
    this._dirtyIds.clear()
    this._deletedIds.clear()
    this._newIds.clear()
    this._changedFields.clear()
    this._deletedGroupMemberships.clear()
    this._deletedAttrMemberships.clear()
    try { useUndoStore().clearAllStacks() } catch { /* ignore */ }
    // 3) 载入目标数据集四数组：
    //    - 优先 IDB（权威）
    //    - 两者皆无 → 真空四数组（首进保底含有 CAT_ALL 与 CAT_UNCATEGORIZED）
    let target = await persist.loadFromIDB(space)
    if (!target) target = _maybeLoadLocalSpace(space)
    const isEn = getLocale() === 'en-US'
    const allName = isEn ? 'All' : '全部'
    const uncatName = isEn ? 'Uncategorized' : '未分类'
    const isFirstVault = !target && space === 'vault'
    if (!target) {
      target = {
        bookmarks: [],
        siblingGroups: [],
        categories: space === 'vault'
          ? [
              { id: CAT_ALL, name: allName, icon: 'grid', color: '#122E8A', order: 0 },
              { id: CAT_UNCATEGORIZED, name: uncatName, icon: 'bookmark', color: '#6E6860', order: 1 },
            ]
          : [],
        customAttributes: [],
      }
    }
    // 复用 importFromData 整集替换语义（runMigrations + _syncMaps + 清缓存）
    this.importFromData(target)
    // 私密空间首进：runMigrations 会从 DEFAULTS 注入全部示例分类（邮箱/工具/AI等），
    // 首次进入只保留 CAT_ALL 与 CAT_UNCATEGORIZED；非首进则确保基础两项存在且保留用户在私密下的自定义分类
    if (space === 'vault') {
      const hasAll = this.categories.some(c => c.id === CAT_ALL)
      const hasUncat = this.categories.some(c => c.id === CAT_UNCATEGORIZED)
      const baseCats = []
      if (!hasAll) baseCats.push({ id: CAT_ALL, name: allName, icon: 'grid', color: '#122E8A', order: 0 })
      if (!hasUncat) baseCats.push({ id: CAT_UNCATEGORIZED, name: uncatName, icon: 'bookmark', color: '#6E6860', order: 1 })
      
      if (isFirstVault) {
        this.categories = [
          { id: CAT_ALL, name: allName, icon: 'grid', color: '#122E8A', order: 0 },
          { id: CAT_UNCATEGORIZED, name: uncatName, icon: 'bookmark', color: '#6E6860', order: 1 },
        ]
      } else {
        this.categories = [...baseCats, ...this.categories]
      }
      this._syncMaps()
    }
    // 重置 curCat/focusedGroupId 及批量/详情/搜索上下文（杜绝跨空间状态污染）
    ui.curCat = 'all'
    ui.focusedGroupId = null
    ui.batchMode = false
    ui.batchSelected.splice(0)
    ui.detailCards.splice(0)
    ui.editingId = null
    ui.editingGeId = null
    ui.addToGid = null
    ui.saveToGroup = null
    ui.ctxGid = null
    ui.activeAttrs.splice(0)
    ui.excludedAttrs.splice(0)
    ui.searchQuery = ''
    ui.expandedIds.splice(0)
    if (ui.quickLookBmId) ui.closeQuickLook()
    if (Array.isArray(ui.quickLookHistory)) ui.quickLookHistory.splice(0)
    if (ui.shareModalTarget) ui.closeShareModal()
    if (ui.aiEnrichTargetBmId) { ui.aiEnrichTargetBmId = null; ui.modals.aiEnrich = false }
    if (Array.isArray(ui.aiAttachedCards)) ui.aiAttachedCards.splice(0)
    if (ui.shareMode) ui.shareMode = null
    } finally {
      _switchingSpaceTarget = null
    }
  },

  /**
   * 取指定空间的快照（不移入内存），用于移入私密时不打断当前空间视图
   * 直接读写目标空间数据集。优先 IDB（权威），无 IDB 或隐私模式回退 localStorage。
   */
  async getSpaceSnapshot(this: DataStoreThis, space: Space): Promise<AppData | null> {
    const snap = await persist.loadFromIDB(space)
    if (snap) return snap
    return _maybeLoadLocalSpace(space)
  },
}
