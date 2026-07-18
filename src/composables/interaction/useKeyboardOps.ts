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
import { useAttrDropdownStore } from '../../stores/attrDropdown.js'
import { useBatchMoveStore, useMfbStore } from '../../stores/overlay.js'
import { useActionSheetStore } from '../../stores/actionSheet.js'
import { useAuthStore } from '../../stores/auth.js'
import { useE2EStore } from '../../stores/e2e.js'

interface NavState {
  curCat: string
  focusedGroupId: string | null
  detailPanelOpen: boolean
  bm: boolean
  groupEdit: boolean
  cat: boolean
  attr: boolean
  // 面板类叠加层：与 modal 一样支持「打开前 push、后退关」语义。
  // 原实现不含这些 → 打开 settings/trash/deadLinks/shortcutHelp/history 时未 push，
  // 用户后退无法关面板（只能点关闭按钮/Esc）。
  settings: boolean
  trash: boolean
  deadLinks: boolean
  shortcutHelp: boolean
  // E3-001：版本历史与 settings/trash 同语义
  history: boolean
  // A4-007：反馈弹窗
  feedback: boolean
}

export function captureNavState(): NavState {
  const ui = useUIStore()
  // 可选链防御：测试 mock 可能给 partial 的 panels/overlays，store 迁移期也可能缺字段。
  return {
    curCat: ui.curCat,
    focusedGroupId: ui.focusedGroupId,
    detailPanelOpen: ui.panels?.detail || false,
    bm: ui.modals?.bookmark || false,
    groupEdit: ui.modals?.groupEdit || false,
    cat: ui.modals?.category || false,
    attr: ui.modals?.attribute || false,
    settings: ui.panels?.settings || false,
    trash: ui.panels?.trash || false,
    deadLinks: ui.overlays?.deadLinks || false,
    shortcutHelp: ui.panels?.shortcutHelp || false,
    history: ui.panels?.history || false,
    feedback: ui.overlays?.feedback || false,
  }
}

export function pushNavState() {
  history.pushState(captureNavState(), '')
}

// --- 快捷键实现 ---

export function restoreNavState(prev: NavState) {
  const ui = useUIStore()
  // pushNavState 在「打开前」调用并 snapshot「未开」态，popstate 时比对
  // 「prev.X=false 且当前已开」→ 关闭。modal 与面板叠加层用同一模式。
  if (prev.bm !== true && ui.modals.bookmark) { closeBmModal(); return }
  if (prev.groupEdit !== true && ui.modals.groupEdit) { closeGroupEdit(); return }
  if (prev.cat !== true && ui.modals.category) { closeCatModal(); return }
  if (prev.attr !== true && ui.modals.attribute) { closeAttrModal(); return }
  if (prev.focusedGroupId === null && ui.focusedGroupId !== null) { exitGroupFocus(); if (prev.curCat !== ui.curCat) { ui.curCat = prev.curCat } return }
  if (!prev.detailPanelOpen && ui.panels.detail) { ui.panels.detail = false; return }
  // 旧实现还有「prev.detailPanelOpen && !ui.panels.detail → 重新打开」反向分支——
  // popstate 语义统一为「关闭 snapshot 未开而当前已开的层」（其余 modal/panel 都只关不重开），
  // 唯独 detail 有该反向分支致不一致：场景「detail 开 → 其他操作 pushNavState 快照 detail=true
  //   → 用户手动关 detail → 后退」会被强制重开 detail，与用户后退意图相悖。删之，与 settings/
  // trash/shortcutHelp 等一致——prev 开、当前关时保持关（用户已主动关，不强制重开）。
  if (prev.settings !== true && ui.panels.settings) { ui.panels.settings = false; return }
  if (prev.trash !== true && ui.panels.trash) { ui.panels.trash = false; return }
  if (prev.deadLinks !== true && ui.overlays.deadLinks) { ui.overlays.deadLinks = false; return }
  if (prev.shortcutHelp !== true && ui.panels.shortcutHelp) { ui.panels.shortcutHelp = false; return }
  // E3-001：HistoryPanel 后退关闭
  if (prev.history !== true && ui.panels.history) { ui.panels.history = false; return }
  // A4-007：反馈弹窗后退关闭
  if (prev.feedback !== true && ui.overlays.feedback) { ui.overlays.feedback = false; return }
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
    // Ctrl+N 新建书签——表单输入框/TipTap 编辑器聚焦时不拦截，否则会弹起新建书签弹窗
    // 打断当前编辑并丢失未保存内容（搜索框/BookmarkModal 表单/组 notes 编辑器均受影响）。
    // 对照同文件 Ctrl+Z/Y 的守卫（line 84-86），并补 isContentEditable 覆盖 TipTap。
    if (e.key.toLowerCase() === 'n') {
      const ae = document.activeElement
      const inField = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || (ae as HTMLElement).isContentEditable)
      if (!inField) { e.preventDefault(); openBmModal() }
    }
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
    const ae = document.activeElement as HTMLElement | null
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return
    // E3-005：contentEditable 但不在 .group-body 内（如组名行内编辑）交给浏览器原生撤销；
    // TipTap 组 notes 在 .group-body 内，继续走 performUndo 自定义栈。
    if (ae?.isContentEditable && !ae.closest?.('.group-body')) return
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
    // A3-004：ActionSheet 优先关
    const as = useActionSheetStore()
    if (as.visible) { as.hide(); return }
    // A2-006：Auth / E2E / SetupGuide
    const auth = useAuthStore()
    if (auth.authModalOpen) { auth.authModalOpen = false; return }
    if (ui.modals.e2eUnlock) {
      ui.modals.e2eUnlock = false
      // A2-006：与 App.onE2EClose 一致 drain pending，避免 await 永挂
      try {
        const pending = useE2EStore().pendingUnlock.splice(0)
        for (const resolve of pending) { try { resolve(false) } catch { /* ignore */ } }
      } catch { /* store 未就绪 */ }
      return
    }
    if (ui.modals.e2eSetup) { ui.modals.e2eSetup = false; return }
    if (ui.modals.setupGuide) { ui.modals.setupGuide = false; return }
    // A4-007：反馈弹窗
    if (ui.overlays.feedback) { ui.overlays.feedback = false; return }
    if (ui.batchMode) { toggleBatchMode(); return }
    closeBmModal(); closeCatModal(); closeAttrModal(); closeGroupEdit()
    useContextMenuStore().hide(); hideSettingsMenu(); closeAddBmPopover(); hideAddDropdown()
    // 回收站 / 死链面板：与 settings 一致支持 Esc 关闭（settings 已由 hideSettingsMenu 处理）。
    // 此前 Esc 仅关 bm/cat/attr/groupEdit 四 modal + ctxMenu/addPopover/dropdown，trash/deadLinks 缺失，
    // 用户只能点面板右上角关闭按钮，UX 不一致。ShortcutHelpPanel 自带 Esc 监听无需重复。
    if (ui.panels.trash) ui.panels.trash = false
    if (ui.overlays.deadLinks) ui.overlays.deadLinks = false
    // L7：版本历史面板 Esc 关闭
    if (ui.panels.history) ui.panels.history = false
    // M13：补齐 Rail / AttrDropdown / MFB / BatchMove
    if (ui.panels.rail) ui.panels.rail = false
    if (useAttrDropdownStore().open) useAttrDropdownStore().close()
    if (useBatchMoveStore().open) useBatchMoveStore().hide()
    if (useMfbStore().open) useMfbStore().hide()
    useToastStore().resolveConfirm(false)
  }
  if (ui.batchMode) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllBatch(); return }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.batchSelected.length) { e.preventDefault(); batchDelete(); return }
  }
}
