/**
 * useUI — 合并的 UI 辅助函数
 * 合并自: useActionSheet.js, useRail.js, useDetail.js, useCardExpand.js, useModal.js
 */
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'
import { pushNavState } from '../interaction/useKeyboardOps.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { t } from '../../i18n/index.js'
import { useActionSheetStore } from '../../stores/actionSheet.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'

// ── Action Sheet ──
export function showActionSheet(items: { label: string; action: () => void; danger?: boolean }[]) {
  useActionSheetStore().showActions(items)
}

// ── Rail (Sidebar) ──
export function toggleRail() { const ui = useUIStore(); ui.panels.rail = !ui.panels.rail }
export function closeRail() { useUIStore().panels.rail = false }

// ── Detail Panel (AI 侧边栏与暂存搁架完全解耦) ──
export function toggleDetailPanel() {
  const ui = useUIStore()
  if (ui.activeView === 'ai') return
  if (!ui.panels.detail) pushNavState()
  ui.panels.detail = !ui.panels.detail
}

export function openDetail(bmId: string) {
  if (!bmId) return
  const ui = useUIStore()
  // 移动端无右侧暂存侧边栏：书签与笔记均呼起自底向上的速览详情抽屉
  if (ui.isMobile) {
    openQuickLook(bmId)
    return
  }
  if (ui.detailCards.indexOf(bmId) === -1) ui.detailCards.push(bmId)
}

// ── QuickLook 速览卡片浮层 ──
export function openQuickLook(bmId: string) {
  if (!bmId) return
  const ui = useUIStore()
  pushNavState()
  ui.openQuickLook(bmId)
}

export function goBackQuickLook(): boolean {
  return useUIStore().goBackQuickLook()
}

export function closeQuickLook() {
  useUIStore().closeQuickLook()
}

// ── Card Tags (scroll + overflow) ──
export function _onCardTagsWheel(e: WheelEvent) {
  const tags = (e.target as HTMLElement).closest('.card-tags')
  if (tags && tags.scrollWidth > tags.clientWidth) {
    e.preventDefault()
    tags.scrollLeft += e.deltaY
  }
}

export function initCardTags() { document.addEventListener('wheel', _onCardTagsWheel, { passive: false }) }
export function destroyCardTags() { document.removeEventListener('wheel', _onCardTagsWheel) }

export function updateCardTagsOverflow() {
  document.querySelectorAll('.card-tags').forEach(el => {
    el.classList.toggle('tags-overflow', el.scrollWidth > el.clientWidth)
  })
}

// ── Modal 开关 ──
export function openCatModal() {
  // A2-011：打开前 push 导航栈，浏览器后退可关
  const ui = useUIStore()
  if (!ui.modals.category) pushNavState()
  ui.modals.category = true
}
export function closeCatModal() { useUIStore().modals.category = false }

export async function deleteCategory(id: string) {
  if (id === CAT_ALL || id === CAT_UNCATEGORIZED) { toast(t('msg.cannotDeleteDefaultCategory'), false); return }
  const ok = await showConfirm(t('msg.confirmDeleteCategory'))
  if (ok) { useDataStore().deleteCategory(id); saveAppData() }
}

export function closeAttrModal() { useUIStore().modals.attribute = false }

export function deleteAttribute(id: string) { useDataStore().deleteAttribute(id); saveAppData() }

// ── Settings / Add Dropdown ──
export function hideSettingsMenu() { useUIStore().panels.settings = false }
export function hideAddDropdown() { useUIStore().overlays.addDropdown = false }
