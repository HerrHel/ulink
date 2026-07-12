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
  const removedFromGroups: Record<string, string[]> = {}
  ui.batchSelected.forEach(id => {
    if (id.startsWith('group:')) {
      const gid = id.slice(6)
      ds.deleteGroup(gid)
      removedGroupIds.push(gid)
    } else {
      const ids = collectSubIds(id)
      ids.forEach(bid => {
        ds.siblingGroups.forEach(g => {
          const bi = g.bookmarkIds.indexOf(bid)
          if (bi > -1) {
            if (!removedFromGroups[bid]) removedFromGroups[bid] = []
            removedFromGroups[bid].push(g.id)
            ds.updateGroup(g.id, { bookmarkIds: g.bookmarkIds.filter((_, i) => i !== bi) })
          }
        })
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
    removedBookmarkIds.forEach(bid => ds.restoreBookmark(bid))
    Object.keys(removedFromGroups).forEach(bid => {
      removedFromGroups[bid].forEach(gid => {
        const sg = ds.groupMap[gid]
        if (sg && sg.bookmarkIds.indexOf(bid) === -1) {
          ds.updateGroup(gid, { bookmarkIds: [...sg.bookmarkIds, bid] })
        }
      })
    })
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
