import { nextTick } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { useBatchMoveStore } from '../../stores/overlay.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'
import { t, tN } from '../../i18n/index.js'
import { collectDescendantIds } from '../../lib/collectSubIds.js'

/**
 * useBatch — Batch operations
 * Refactored: DOM operations removed, UI state managed via store + Vue reactivity.
 */

export function toggleBatchMode() {
  const ui = useUIStore()
  ui.batchMode = !ui.batchMode
  ui.batchSelected.splice(0)
  // A4-003：退出批量时一并关 batchMove 浮层，避免取消/Esc 后残留
  if (!ui.batchMode) useBatchMoveStore().hide()
  // 不再写持久化的 isExpanded=false：
  //  ① 批量模式下卡片内容 pointer-events:none（见 batch.css .batch-mode），展开按钮点不动、
  //     账户信息/子站无交互意义，收敛展开态无任何功能依赖——纯属副作用。
  //  ② 每条 updateBookmark/updateGroup({isExpanded:false}) 会 _markDirty + _trackChange，
  //     N 张卡片就 N 条同步队列脏 + 刷 N 个 updatedAt（污染「按日期排序」结果）+ 触发全量
  //     saveAppData 与冗余云推送。退出批量模式也不还原——用户展开状态被持久化抹除，数据丢失。
  //  批量模式期间的「视觉不展开」改由渲染层 computed `&& !batchMode` 临时压制（见
  //  BookmarkCard/GroupCard isExpanded），退出后数据态 isExpanded 自然恢复。
  if (ui.focusedGroupId) nextTick(() => { ui.focusedGroupId = null })
}

export function selectAllBatch() {
  useUIStore().selectAllBatch()
}

function collectSubIds(id: string): string[] {
  return collectDescendantIds(pid => useDataStore().childrenMap[pid], id)
}

export async function batchDelete() {
  const ui = useUIStore()
  if (!ui.batchSelected.length) return
  const count = ui.batchSelected.length
  const confirmed = await showConfirm(tN('msg.confirmDeleteSelectedItems', count))
  if (!confirmed) return
  const ds = useDataStore()
  const removedGroupIds: string[] = []
  const uniqueBmIds = new Set<string>()
  ui.batchSelected.forEach(id => {
    if (id.startsWith('group:')) {
      removedGroupIds.push(id.slice(6))
    } else {
      // 递归含子书签，使用 Set 去重，防止用户同时勾选父子项时重复操作与撤销栈重复
      const ids = collectSubIds(id)
      ids.forEach(bid => uniqueBmIds.add(bid))
    }
  })
  removedGroupIds.forEach(gid => ds.deleteGroup(gid))
  const removedBookmarkIds = Array.from(uniqueBmIds)
  removedBookmarkIds.forEach(bid => ds.deleteBookmark(bid))
  saveAppData()
  ui.batchSelected.splice(0)
  ui.batchMode = false
  toastWithUndo(tN('msg.deletedItems', count), function () {
    removedGroupIds.forEach(gid => ds.restoreGroup(gid))
    // restoreBookmark 已用 _deleteBookmark 记录的组关系恢复 bookmarkIds，
    // 不再手动回加 —— 与回收站恢复路径统一。
    removedBookmarkIds.forEach(bid => ds.restoreBookmark(bid))
    debouncedSaveAppData(); toast(t('deadlinks.restored'))
  })
}

export function showBatchMovePopover() { useBatchMoveStore().show() }

function hideBatchMovePopover() { useBatchMoveStore().hide() }

export function batchMoveToCat(catId: string) {
  const ui = useUIStore()
  if (!ui.batchSelected.length) return
  const ds = useDataStore()
  const count = ui.batchSelected.length
  const groupIds: string[] = []
  const uniqueBmIds = new Set<string>()
  ui.batchSelected.forEach(id => {
    if (id.startsWith('group:')) {
      groupIds.push(id.slice(6))
    } else {
      // 递归移动子书签：父子一并收集，并用 Set 去重
      const ids = collectSubIds(id)
      ids.forEach(bid => uniqueBmIds.add(bid))
    }
  })
  groupIds.forEach(gid => ds.updateGroup(gid, { categoryId: catId }))
  uniqueBmIds.forEach(bid => ds.updateBookmark(bid, { categoryId: catId }))
  saveAppData()
  ui.batchMode = false
  ui.batchSelected.splice(0)
  hideBatchMovePopover()
  toast(tN('msg.movedItems', count))
}
