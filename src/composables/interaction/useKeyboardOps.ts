/**
 * useKeyboardOps — 快捷键与导航恢复实现
 * 从 ui/keyboard-ops.js 迁移。
 */
import { useUIStore } from '../../stores/ui.js'
import { saveGroupBody } from '../domain/useGroup.js'
import { performUndo, performRedo } from '../domain/useUndo.js'
import { EditorManager } from '../../lib/editor.js'
import { closeBmModal, openBmModal } from '../domain/useBookmark.js'
import { closeGroupEdit, exitGroupFocus, closeAddBmPopover } from '../domain/useGroup.js'
import { closeCatModal, closeAttrModal } from '../ui/useUI.js'
import { toggleBatchMode, selectAllBatch, batchDelete } from '../domain/useBatch.js'
import { hideSettingsMenu, hideAddDropdown } from '../ui/useUI.js'
import { useToastStore } from '../../stores/toast.js'
import { useContextMenuStore } from '../../stores/contextMenu.js'

interface NavState {
  curCat: string
  focusedGroupId: string | null
  detailPanelOpen: boolean
  bm: boolean
  groupEdit: boolean
  cat: boolean
  attr: boolean
}

export function captureNavState(): NavState {
  const ui = useUIStore()
  return {
    curCat: ui.curCat,
    focusedGroupId: ui.focusedGroupId,
    detailPanelOpen: ui.detailOpen || false,
    bm: ui.modals.bookmark || false,
    groupEdit: ui.modals.groupEdit || false,
    cat: ui.modals.category || false,
    attr: ui.modals.attribute || false,
  }
}

export function pushNavState() {
  history.pushState(captureNavState(), '')
}

// --- 快捷键实现 ---

export function restoreNavState(prev: NavState) {
  const ui = useUIStore()
  if (prev.bm !== true && ui.modals.bookmark) { closeBmModal(); return }
  if (prev.groupEdit !== true && ui.modals.groupEdit) { closeGroupEdit(); return }
  if (prev.cat !== true && ui.modals.category) { closeCatModal(); return }
  if (prev.attr !== true && ui.modals.attribute) { closeAttrModal(); return }
  if (prev.focusedGroupId === null && ui.focusedGroupId !== null) { exitGroupFocus(); if (prev.curCat !== ui.curCat) { ui.curCat = prev.curCat } return }
  if (!prev.detailPanelOpen && ui.detailOpen) { ui.detailOpen = false; return }
  if (prev.detailPanelOpen && !ui.detailOpen) { ui.detailOpen = true; return }
  if (prev.curCat !== ui.curCat) { ui.curCat = prev.curCat; ui.focusedGroupId = null; return }
}

export function _onGlobalKeydown(e: KeyboardEvent) {
  const ui = useUIStore()
  const _ae = document.activeElement
  const _gb = _ae && _ae.closest ? _ae.closest('.group-body') : null
  if (_gb && (e.ctrlKey || e.metaKey)) {
    const _kgid = _gb.getAttribute('data-gid')
    if (_kgid && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
      e.preventDefault(); EditorManager.toggleBold(_kgid); saveGroupBody(_kgid); return
    }
    if (_kgid && e.shiftKey && !e.altKey && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3')) {
      e.preventDefault(); EditorManager.setHeading(_kgid, parseInt(e.code[5])); saveGroupBody(_kgid); return
    }
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
    if (e.key.toLowerCase() === 'k') { e.preventDefault(); document.querySelector<HTMLInputElement>('.search-input')?.focus() }
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); openBmModal() }
  }
  if (e.key === 'Tab') {
    const modal = document.querySelector('.modal-mask.open .modal')
    if (!modal) return
    const focusable = modal.querySelectorAll('input:not([type="hidden"]),textarea,select,button,[tabindex]:not([tabindex="-1"])')
    if (!focusable.length) return
    const first = focusable[0] as HTMLElement, last = focusable[focusable.length - 1] as HTMLElement
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
    const ae = document.activeElement
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return
    let undoGid: string | undefined
    const gb = ae && ae.closest ? ae.closest('.group-body') : null
    if (gb) undoGid = gb.closest('.group-card')?.getAttribute('data-group-id') || undefined
    if (!undoGid && ui.focusedGroupId) undoGid = ui.focusedGroupId
    if (undoGid) {
      const handled = e.key.toLowerCase() === 'z' && !e.shiftKey ? performUndo(undoGid) : performRedo(undoGid)
      if (handled) { e.preventDefault(); return }
    }
  }
  if (e.key === 'Escape') {
    if (ui.batchMode) { toggleBatchMode(); return }
    closeBmModal(); closeCatModal(); closeAttrModal(); closeGroupEdit()
    useContextMenuStore().hide(); hideSettingsMenu(); closeAddBmPopover(); hideAddDropdown()
    useToastStore().resolveConfirm(false)
  }
  if (ui.batchMode) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllBatch(); return }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.batchSelected.length) { e.preventDefault(); batchDelete(); return }
  }
}
