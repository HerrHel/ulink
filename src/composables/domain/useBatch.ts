import { nextTick } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { useBatchMoveStore } from '../../stores/overlay.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'

/**
 * useBatch — Batch operations
 * Refactored: DOM operations removed, UI state managed via store + Vue reactivity.
 */

export function toggleBatchMode() {
  const ui = useUIStore()
  ui.batchMode = !ui.batchMode
  ui.batchSelected.splice(0)
  if (ui.batchMode) {
    const ds = useDataStore()
    ds.bookmarks.forEach(b => { if (b.isExpanded) ds.updateBookmark(b.id, { isExpanded: false }) })
    ds.siblingGroups.forEach(g => { if (g.isExpanded) ds.updateGroup(g.id, { isExpanded: false }) })
    saveAppData()
  }
  if (ui.focusedGroupId) nextTick(() => { ui.focusedGroupId = null })
}

export function selectAllBatch() {
  useUIStore().selectAllBatch()
}

function collectSubIds(id: string): string[] {
  const ds = useDataStore()
  const cm = ds.childrenMap
  const ids: string[] = [id]
  const stack = [id]
  while (stack.length) {
    const pid = stack.pop()!
    const children = cm[pid]
    if (children) {
      for (const c of children) { ids.push(c.id); stack.push(c.id) }
    }
  }
  return ids
}

export async function batchDelete() {
  const ui = useUIStore()
  if (!ui.batchSelected.length) return
  const count = ui.batchSelected.length
  const confirmed = await showConfirm('确认删除选中的 ' + count + ' 项？')
  if (!confirmed) return
  const ds = useDataStore()
  const removedGroupIds: string[] = []
  const removedBookmarkIds: string[] = []
  ui.batchSelected.forEach(id => {
    if (id.startsWith('group:')) {
      const gid = id.slice(6)
      ds.deleteGroup(gid)
      removedGroupIds.push(gid)
    } else {
      // 递归含子书签。删除仅调 deleteBookmark——它会自动从所属组的 bookmarkIds
      // 中剔除该 bid，并把「原本所属的组」记录到 store._deletedGroupMemberships，
      // 供回收站 restoreBookmark 恢复组关系。旧代码在此又手动剔组一遍并自维护
      // removedFromGroups，导致 deleteBookmark 内部 indexOf 找不到（已提前被剔）
      // → _deletedGroupMemberships 记空 → 用户不撤销而进回收站恢复时组关系丢失。
      // 统一走 deleteBookmark 的组关系记录，undo 与回收站共用同一恢复路径。
      const ids = collectSubIds(id)
      ids.forEach(bid => {
        ds.deleteBookmark(bid)
        removedBookmarkIds.push(bid)
      })
    }
  })
  saveAppData()
  ui.batchSelected.splice(0)
  ui.batchMode = false
  toastWithUndo('已删除 ' + count + ' 项', function () {
    removedGroupIds.forEach(gid => ds.restoreGroup(gid))
    // restoreBookmark 已用 _deleteBookmark 记录的组关系恢复 bookmarkIds，
    // 不再手动回加 —— 与回收站恢复路径统一。
    removedBookmarkIds.forEach(bid => ds.restoreBookmark(bid))
    debouncedSaveAppData(); toast('已恢复')
  })
}

export function showBatchMovePopover() { useBatchMoveStore().show() }

function hideBatchMovePopover() { useBatchMoveStore().hide() }

export function batchMoveToCat(catId: string) {
  const ui = useUIStore()
  if (!ui.batchSelected.length) return
  const ds = useDataStore()
  const count = ui.batchSelected.length
  ui.batchSelected.forEach(id => {
    if (id.startsWith('group:')) {
      ds.updateGroup(id.slice(6), { categoryId: catId })
    } else {
      // 递归移动子书签：与 batchDelete 保持一致的父子语义——
      // 否则父移到新分类、子留在原分类，子书签将无法在原分类顶层显示
      //（!b.parentId 过滤），又因父不在原分类而无从展开访问，分类归属与
      // 可见性分裂。collectSubIds 返回 [id, ...所有子孙]，一并改 categoryId。
      const ids = collectSubIds(id)
      ids.forEach(bid => ds.updateBookmark(bid, { categoryId: catId }))
    }
  })
  saveAppData()
  ui.batchMode = false
  ui.batchSelected.splice(0)
  hideBatchMovePopover()
  toast('已移动 ' + count + ' 项')
}
