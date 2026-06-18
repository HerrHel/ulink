/**
 * useKeyboardOps — 快捷键与导航恢复实现
 * 从 ui/keyboard-ops.js 迁移。
 */
import { useAppStore } from '../../stores/app.js'
import { saveGroupBody } from '../domain/useGroup.js'
import { performUndo, performRedo } from '../domain/useUndo.js'
import { EditorManager } from '../../lib/editor.js'
import { closeBmModal, openBmModal } from '../domain/useBookmark.js'
import { closeGroupEdit, exitGroupFocus, closeAddBmPopover } from '../domain/useGroup.js'
import { closeCatModal, closeAttrModal } from '../ui/useUI.js'
import { toggleBatchMode, selectAllBatch, batchDelete } from '../domain/useBatch.js'
import { hideSettingsMenu, hideAddDropdown } from '../ui/useUI.js'
import { ctxMenuAPI } from '../bridge.js'

interface NavState {
  curCat: string
  focusedGroupId: string | null
  detailPanelOpen: boolean
  bmModalOpen: boolean
  groupEditOpen: boolean
  catModalOpen: boolean
  attrModalOpen: boolean
}

export function captureNavState(): NavState {
  const store = useAppStore()
  return {
    curCat: store.curCat,
    focusedGroupId: store.focusedGroupId,
    detailPanelOpen: store.detailOpen || false,
    bmModalOpen: store.bmModalOpen || false,
    groupEditOpen: store.groupEditOpen || false,
    catModalOpen: store.catModalOpen || false,
    attrModalOpen: store.attrModalOpen || false
  }
}

export function pushNavState() {
  history.pushState(captureNavState(), '')
}

// --- 快捷键实现 ---

export function restoreNavState(prev: NavState) {
  const store = useAppStore()
  if (prev.bmModalOpen !== true && store.bmModalOpen) { closeBmModal(); return }
  if (prev.groupEditOpen !== true && store.groupEditOpen) { closeGroupEdit(); return }
  if (prev.catModalOpen !== true && store.catModalOpen) { closeCatModal(); return }
  if (prev.attrModalOpen !== true && store.attrModalOpen) { closeAttrModal(); return }
  if (prev.focusedGroupId === null && store.focusedGroupId !== null) { exitGroupFocus(); if (prev.curCat !== store.curCat) { store.curCat = prev.curCat } return }
  if (!prev.detailPanelOpen && store.detailOpen) { store.detailOpen = false; return }
  if (prev.detailPanelOpen && !store.detailOpen) { store.detailOpen = true; return }
  if (prev.curCat !== store.curCat) { store.curCat = prev.curCat; store.focusedGroupId = null; return }
}

export function _onGlobalKeydown(e: KeyboardEvent) {
  const store = useAppStore()
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
    if (!undoGid && store.focusedGroupId) undoGid = store.focusedGroupId
    if (undoGid) {
      const handled = e.key.toLowerCase() === 'z' && !e.shiftKey ? performUndo(undoGid) : performRedo(undoGid)
      if (handled) { e.preventDefault(); return }
    }
  }
  if (e.key === 'Escape') {
    if (store.batchMode) { toggleBatchMode(); return }
    closeBmModal(); closeCatModal(); closeAttrModal(); closeGroupEdit()
    ctxMenuAPI?.hide?.(); hideSettingsMenu(); closeAddBmPopover(); hideAddDropdown()
    store.confirmModalOpen = false
  }
  if (store.batchMode) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllBatch(); return }
    if ((e.key === 'Delete' || e.key === 'Backspace') && store.batchSelected.length) { e.preventDefault(); batchDelete(); return }
  }
}
