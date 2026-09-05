/**
 * dataActionsIO.ts — data store 的数据加载 / 导入 / 空间切换（自 data.ts 逐字迁移，逻辑零改动）
 */
import { CAT_ALL, CAT_UNCATEGORIZED } from '../config/constants.js'
import * as persist from './persist.js'
import { runMigrations } from './migrations.js'
import { useUIStore } from './ui.js'
import { clearSearchCache } from '../lib/search.js'
import { clearAllSyncOps } from './storage.js'
import { _clearAllPendingSync } from '../composables/domain/syncPending.js'
import { _denyWrite, _maybeLoadLocalSpace, _cancelPendingHist } from './dataShared.js'
import type { DataStoreThis } from './dataShared.js'
import type { AppData } from '../types.js'
import type { Space } from './ui.js'

export const ioActions = {
  loadFromStorage(this: DataStoreThis) {
    const d = persist.loadFromLocalStorage()
    this.bookmarks = d.bookmarks; this.siblingGroups = d.siblingGroups
    this.categories = d.categories; this.customAttributes = d.customAttributes
    this._syncMaps()
    this._normalizeCategoryOrders()
    this._restoreDeletedGroupMemberships()
    clearSearchCache()
    this._searchVersion = 1
  },
  async tryLoadFromIDB(this: DataStoreThis): Promise<boolean> {
    const idbData = await persist.loadFromIDB()
    if (idbData) {
      runMigrations(idbData, idbData)
      this.bookmarks = idbData.bookmarks; this.siblingGroups = idbData.siblingGroups
      this.categories = idbData.categories; this.customAttributes = idbData.customAttributes
      this._syncMaps()
      this._normalizeCategoryOrders()
      this._restoreDeletedGroupMemberships()
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
    this._syncMaps()
    this._normalizeCategoryOrders()
    // R22：清空本地历史防抖模块级 Map，避免旧定时器按旧 id 写快照到重置后数据不对应的 ID。
    _cancelPendingHist()
    clearSearchCache()
    this._searchVersion = 1
  },
  _dataSnapshot(this: DataStoreThis) {
    return { bookmarks: this.bookmarks, siblingGroups: this.siblingGroups, categories: this.categories, customAttributes: this.customAttributes }
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
    const cur = ui.curSpace
    if (cur === space) return
    // 1) 当前空间落盘（防切换中途丢失未提交改动）
    await persist.saveData(this._dataSnapshot(), cur)
    // 2) 切空间 + 清 dirty/同步队列（私密 CRUD 不得进云端）
    ui.curSpace = space
    this._dirtyIds.clear()
    this._deletedIds.clear()
    this._newIds.clear()
    this._changedFields.clear()
    try { await clearAllSyncOps() } catch { /* ignore */ }
    _clearAllPendingSync()
    // 3) 载入目标数据集四数组：
    //    - 优先 IDB（权威）
    //    - 两者皆无 → 真空四数组（categories=[] 即可，CAT_ALL/CAT_UNCATEGORIZED 由 categoryMap 兜底）
    let target = await persist.loadFromIDB(space)
    if (!target) target = _maybeLoadLocalSpace(space)
    if (!target) target = { bookmarks: [], siblingGroups: [], categories: [], customAttributes: [] }
    // 复用 importFromData 整集替换语义（runMigrations + _syncMaps + 清缓存）
    this.importFromData(target)
    // 私密空间首进：runMigrations 会从 DEFAULTS 注入全部示例分类（邮箱/工具/AI等），
    // 私密空间只需 CAT_ALL + CAT_UNCATEGORIZED 两个基础项，多余分类在此过滤
    if (space === 'vault') {
      this.categories = this.categories.filter(c => c.id === CAT_ALL || c.id === CAT_UNCATEGORIZED)
      this._syncMaps()
    }
    // 重置 curCat/focusedGroupId（新空间分类视图从全部分类开始）
    ui.curCat = 'all'
    ui.focusedGroupId = null
  },

  /**
   * 取指定空间的 IDB 快照（不移入内存），用于移入私密时不打断当前空间视图
   * 直接读写私密数据集。返回 null 表示该空间暂无落库数据。
   */
  async getSpaceSnapshot(this: DataStoreThis, space: Space): Promise<AppData | null> {
    return persist.loadFromIDB(space)
  },
}
