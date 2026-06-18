import { nextTick } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { batchMoveAPI } from '../bridge.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

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
    const bookmarkSnaps: Array<{ bookmarks: Bookmark[]; groups: Record<string, string[]> }> = []
    const groupSnaps: SiblingGroup[] = []
    store.batchSelected.forEach(id => {
      if (id.startsWith('group:')) {
        const gid = id.slice(6)
        const sg = store.groupMap[gid]
        if (sg) groupSnaps.push(JSON.parse(JSON.stringify(sg)))
        const idx = store.siblingGroups.findIndex(g => g.id === gid)
        if (idx >= 0) store.siblingGroups.splice(idx, 1)
      } else {
        const bm = store.bookmarkMap[id]
        if (bm) {
          const snap = { bookmarks: [JSON.parse(JSON.stringify(bm))], groups: {} as Record<string, string[]> }
          store.siblingGroups.forEach(g => {
            if (g.bookmarkIds.indexOf(id) > -1) {
              if (!snap.groups[id]) snap.groups[id] = []
              snap.groups[id].push(g.id)
            }
            g.bookmarkIds = g.bookmarkIds.filter(bid => bid !== id)
          })
          bookmarkSnaps.push(snap)
        }
        const idx = store.bookmarks.findIndex(b => b.id === id)
        if (idx >= 0) store.bookmarks.splice(idx, 1)
      }
    })
    store.save()
    store.batchSelected.splice(0)
    store.batchMode = false
    toastWithUndo('已删除 ' + count + ' 项', function () {
      groupSnaps.forEach(sg => store.siblingGroups.push(sg))
      if (groupSnaps.length) store.siblingGroups.sort((a, b) => (a.order || 0) - (b.order || 0))
      bookmarkSnaps.forEach(snap => {
        snap.bookmarks.forEach(b => store.bookmarks.push(b))
        Object.keys(snap.groups).forEach(bid => {
          snap.groups[bid].forEach(gid => {
            const sg = store.groupMap[gid]
            if (sg && sg.bookmarkIds.indexOf(bid) === -1) sg.bookmarkIds.push(bid)
          })
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
