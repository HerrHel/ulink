/**
 * useAppHandlers — App.vue 模板事件处理函数
 * 从 useApp.js 拆分，职责单一：提供模板绑定的事件处理器。
 */
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { saveAppData } from '../stores/app.js'
import { useAttrDropdownStore } from '../stores/attrDropdown.js'
import { exitGroupFocus, editGroup, searchInFocusedGroup, isUnnamedGroupName } from './domain/useGroup.js'
import { openBmModal } from './domain/useBookmark.js'
import { showBatchMovePopover, batchDelete } from './domain/useBatch.js'
import { importData } from './domain/useDataIO.js'
import { performUndo, performRedo } from './domain/useUndo.js'
import { t } from '../i18n/index.js'

export function useAppHandlers() {
  const ds = useDataStore()
  const ui = useUIStore()

  const handlers = {
    onExitGroupFocus() { exitGroupFocus() },
    onFocusTitleChange(e: Event) {
      if (!ui.focusedGroupId) return
      const target = e.target as HTMLElement
      const raw = (target.textContent || '').trim()
      const isPlaceholder = isUnnamedGroupName(raw)
      const persistedName = isPlaceholder ? '' : raw
      target.textContent = isPlaceholder ? t('common.unnamed') : raw
      target.classList.toggle('focus-title-unnamed', isPlaceholder)
      const curName = (ds.groupMap[ui.focusedGroupId]?.name || '').trim()
      // 占位名统一存空串，避免「未命名笔记」阻断空笔记自动清理、摘要标题与语言切换；无变更则不写脏
      if (persistedName !== curName) {
        ds.updateGroup(ui.focusedGroupId, { name: persistedName })
        saveAppData()
      }
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
      ui.overlays.addPopover = true
    },
    onFocusEditGroup() { if (ui.focusedGroupId) editGroup(ui.focusedGroupId) },
    onFocusShareGroup() { if (ui.focusedGroupId) ui.openShareModal('group', ui.focusedGroupId) },
    onFocusUndo() { if (ui.focusedGroupId) performUndo(ui.focusedGroupId) },
    onFocusRedo() { if (ui.focusedGroupId) performRedo(ui.focusedGroupId) },
    onToggleAttrFilter() { useAttrDropdownStore().toggle() },
    onAddBookmark() { openBmModal() },
    onBatchMove() { showBatchMovePopover() },
    onBatchDelete() { batchDelete() },
    onImportFile(e: Event) { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; importData(file); (e.target as HTMLInputElement).value = '' },
  }

  return { handlers }
}
