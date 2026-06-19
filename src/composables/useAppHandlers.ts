/**
 * useAppHandlers — App.vue 模板事件处理函数
 * 从 useApp.js 拆分，职责单一：提供模板绑定的事件处理器。
 */
import { useAppStore } from '../stores/app.js'
import { attrDropdownAPI } from './bridge.js'
import { createGroup, exitGroupFocus, editGroup, searchInFocusedGroup } from './domain/useGroup.js'
import { openBmModal } from './domain/useBookmark.js'
import { hideAddDropdown } from './ui/useUI.js'
import { showBatchMovePopover, batchDelete } from './domain/useBatch.js'
import { shareGroup, importData } from './domain/useDataIO.js'
import { performUndo, performRedo } from './domain/useUndo.js'

export function useAppHandlers() {
  const store = useAppStore()

  const handlers = {
    onExitGroupFocus() { exitGroupFocus() },
    onFocusTitleChange(e: Event) {
      if (!store.focusedGroupId) return
      const target = e.target as HTMLElement
      const raw = (target.textContent || '').trim()
      const name = raw || '未命名'
      target.textContent = name
      target.classList.toggle('focus-title-unnamed', !raw || raw === '未命名')
      store.updateGroup(store.focusedGroupId, { name }); store.save()
    },
    onSearch() { if (store.focusedGroupId) searchInFocusedGroup() },
    onFocusAddBm(e?: Event) {
      if (!store.focusedGroupId) return
      if (e && e.currentTarget) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        store._addPopoverTrigger = { top: r.bottom, left: r.left, width: r.width }
      } else {
        store._addPopoverTrigger = null
      }
      store.addToGid = store.focusedGroupId
      store.addBmPopoverOpen = true
    },
    onFocusEditGroup() { if (store.focusedGroupId) editGroup(store.focusedGroupId) },
    onFocusShareGroup() { if (store.focusedGroupId) shareGroup(store.focusedGroupId) },
    onFocusUndo() { if (store.focusedGroupId) performUndo(store.focusedGroupId) },
    onFocusRedo() { if (store.focusedGroupId) performRedo(store.focusedGroupId) },
    onToggleAttrFilter() { attrDropdownAPI?.toggle?.() },
    onAddBookmark() { hideAddDropdown(); openBmModal() },
    onAddGroup() { hideAddDropdown(); createGroup() },
    onBatchMove() { showBatchMovePopover() },
    onBatchDelete() { batchDelete() },
    onImportFile(e: Event) { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; importData(file); (e.target as HTMLInputElement).value = '' },
  }

  return { handlers }
}
