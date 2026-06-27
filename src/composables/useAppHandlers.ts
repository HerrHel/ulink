/**
 * useAppHandlers — App.vue 模板事件处理函数
 * 从 useApp.js 拆分，职责单一：提供模板绑定的事件处理器。
 */
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { saveAppData } from '../stores/app.js'
import { attrDropdownAPI } from './bridge.js'
import { createGroup, exitGroupFocus, editGroup, searchInFocusedGroup } from './domain/useGroup.js'
import { openBmModal } from './domain/useBookmark.js'
import { hideAddDropdown } from './ui/useUI.js'
import { showBatchMovePopover, batchDelete } from './domain/useBatch.js'
import { shareGroup } from './domain/useDataShare.js'
import { importData } from './domain/useDataIO.js'
import { performUndo, performRedo } from './domain/useUndo.js'

export function useAppHandlers() {
  const ds = useDataStore()
  const ui = useUIStore()

  const handlers = {
    onExitGroupFocus() { exitGroupFocus() },
    onFocusTitleChange(e: Event) {
      if (!ui.focusedGroupId) return
      const target = e.target as HTMLElement
      const raw = (target.textContent || '').trim()
      const name = raw || '未命名'
      target.textContent = name
      target.classList.toggle('focus-title-unnamed', !raw || raw === '未命名')
      ds.updateGroup(ui.focusedGroupId, { name }); saveAppData()
    },
    onSearch() { if (ui.focusedGroupId) searchInFocusedGroup() },
    onFocusAddBm(e?: Event) {
      if (!ui.focusedGroupId) return
      if (e && e.currentTarget) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        ui._addPopoverTrigger = { top: r.bottom, left: r.left, width: r.width }
      } else {
        ui._addPopoverTrigger = null
      }
      ui.addToGid = ui.focusedGroupId
      ui.addBmPopoverOpen = true
    },
    onFocusEditGroup() { if (ui.focusedGroupId) editGroup(ui.focusedGroupId) },
    onFocusShareGroup() { if (ui.focusedGroupId) shareGroup(ui.focusedGroupId) },
    onFocusUndo() { if (ui.focusedGroupId) performUndo(ui.focusedGroupId) },
    onFocusRedo() { if (ui.focusedGroupId) performRedo(ui.focusedGroupId) },
    onToggleAttrFilter() { attrDropdownAPI?.toggle?.() },
    onAddBookmark() { hideAddDropdown(); openBmModal() },
    onAddGroup() { hideAddDropdown(); createGroup() },
    onBatchMove() { showBatchMovePopover() },
    onBatchDelete() { batchDelete() },
    onImportFile(e: Event) { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; importData(file); (e.target as HTMLInputElement).value = '' },
  }

  return { handlers }
}
