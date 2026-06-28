/**
 * useUI — 合并的 UI 辅助函数
 * 合并自: useActionSheet.js, useRail.js, useDetail.js, useCardExpand.js, useModal.js
 */
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'
import { pushNavState } from '../interaction/useKeyboardOps.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { useActionSheetStore } from '../../stores/actionSheet.js'

// ── Action Sheet ──
export function showActionSheet(items: { label: string; action: () => void; danger?: boolean }[]) {
  useActionSheetStore().showActions(items)
}

// ── Rail (Sidebar) ──
export function toggleRail() { const ui = useUIStore(); ui.panels.rail = !ui.panels.rail }
export function closeRail() { useUIStore().railOpen = false }

// ── Detail Panel ──
export function toggleDetailPanel() {
  const ui = useUIStore()
  if (!ui.panels.detail) pushNavState()
  if (ui.panels.detail || ui.detailCards.length > 0) {
    ui.panels.detail = false
    ui.detailCards.splice(0)
  } else {
    ui.panels.detail = true
  }
}

export function openDetail(bmId: string) {
  if (!bmId) return
  const ui = useUIStore()
  if (ui.detailCards.indexOf(bmId) === -1) ui.detailCards.push(bmId)
  ui.panels.detail = true
}

// ── Card Tags (scroll + overflow) ──
function _onCardTagsWheel(e: WheelEvent) {
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
export function openCatModal() { useUIStore().modals.category = true }
export function closeCatModal() { useUIStore().modals.category = false }

export async function deleteCategory(id: string) {
  if (id === 'all' || id === 'uncategorized') { toast('无法删除默认分类', false); return }
  const ok = await showConfirm('确认删除此分类？')
  if (ok) { useDataStore().deleteCategory(id); saveAppData() }
}

export function openAttrModal() { useUIStore().modals.attribute = true }
export function closeAttrModal() { useUIStore().modals.attribute = false }

export function deleteAttribute(id: string) { useDataStore().deleteAttribute(id); saveAppData() }

// ── Settings / Add Dropdown ──
export function hideSettingsMenu() { useUIStore().panels.settings = false }
export function hideAddDropdown() { useUIStore().overlays.addDropdown = false }
