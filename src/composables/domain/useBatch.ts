import { nextTick } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { batchMoveAPI } from '../bridge.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'

/**
 * useBatch — Batch operations
 * Refactored: DOM operations removed, UI state managed via store + Vue reactivity.
 */

export function toggleBatchMode() {
  const store = useAppStore()
  store.batchMode = !store.batchMode
  store.batchSelected.splice(0)
  if (store.batchMode) {
    store.bookmarks.forEach(b => { if (b.isExpanded) b.isExpanded = false })
    store.siblingGroups.forEach(g => { if (g.isExpanded) g.isExpanded = false })
    store.save()
  }
  if (store.focusedGroupId) nextTick(() => { store.focusedGroupId = null })
}

export function selectAllBatch() {
  const store = useAppStore()
  store.selectAllBatch()
}

export function batchDelete() {
  const store = useAppStore()
  if (!store.batchSelected.length) return
  const count = store.batchSelected.length
  showConfirm('确认删除选中的 ' + count + ' 项？', () => {
    const removedGroupIds: string[] = []
    const removedBookmarkIds: string[] = []
    const removedFromGroups: Record<string, string[]> = {}
    store.batchSelected.forEach(id => {
      if (id.startsWith('group:')) {
        const gid = id.slice(6)
        store.deleteGroup(gid)
        removedGroupIds.push(gid)
      } else {
        store.siblingGroups.forEach(g => {
          const bi = g.bookmarkIds.indexOf(id)
          if (bi > -1) {
            if (!removedFromGroups[id]) removedFromGroups[id] = []
            removedFromGroups[id].push(g.id)
            g.bookmarkIds.splice(bi, 1)
          }
        })
        store.deleteBookmark(id)
        removedBookmarkIds.push(id)
      }
    })
    store.save()
    store.batchSelected.splice(0)
    store.batchMode = false
    toastWithUndo('已删除 ' + count + ' 项', function () {
      removedGroupIds.forEach(gid => store.restoreGroup(gid))
      removedBookmarkIds.forEach(bid => store.restoreBookmark(bid))
      Object.keys(removedFromGroups).forEach(bid => {
        removedFromGroups[bid].forEach(gid => {
          const sg = store.groupMap[gid]
          if (sg && sg.bookmarkIds.indexOf(bid) === -1) sg.bookmarkIds.push(bid)
        })
      })
      store.debouncedSave(); toast('已恢复')
    })
  })
}

export function showBatchMovePopover() { batchMoveAPI?.show?.() }

function hideBatchMovePopover() { batchMoveAPI?.hide?.() }

export function batchMoveToCat(catId: string) {
  const store = useAppStore()
  if (!store.batchSelected.length) return
  const count = store.batchSelected.length
  store.batchSelected.forEach(id => {
    if (id.startsWith('group:')) {
      const g = store.groupMap[id.slice(6)]
      if (g) { g.categoryId = catId; g.updatedAt = Date.now() }
    } else {
      const b = store.bookmarkMap[id]
      if (b) b.categoryId = catId
    }
  })
  store.save()
  store.batchMode = false
  store.batchSelected.splice(0)
  hideBatchMovePopover()
  toast('已移动 ' + count + ' 项')
}
