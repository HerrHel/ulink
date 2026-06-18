/**
 * useUI — 合并的 UI 辅助函数
 * 合并自: useActionSheet.js, useRail.js, useDetail.js, useCardExpand.js, useModal.js
 */
import { useAppStore } from '../../stores/app.js'
import { pushNavState } from '../interaction/useKeyboardOps.js'
import { actionSheetAPI } from '../bridge.js'
import { toast, showConfirm } from '../../lib/toast.js'

// ── Action Sheet ──
export function showActionSheet(items) { actionSheetAPI?.show(items) }

// ── Rail (Sidebar) ──
export function toggleRail() { useAppStore().railOpen = !useAppStore().railOpen }
export function closeRail() { useAppStore().railOpen = false }

// ── Detail Panel ──
export function toggleDetailPanel() {
  const store = useAppStore()
  if (!store.detailOpen) pushNavState()
  if (store.detailOpen || store.detailCards.length > 0) {
    store.detailOpen = false
    store.detailCards.splice(0)
  } else {
    store.detailOpen = true
  }
}

export function openDetail(bmId) {
  if (!bmId) return
  const store = useAppStore()
  if (store.detailCards.indexOf(bmId) === -1) store.detailCards.push(bmId)
  store.detailOpen = true
}

// ── Card Tags (scroll + overflow) ──
function _onCardTagsWheel(e) {
  const tags = e.target.closest('.card-tags')
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
export function openCatModal() { useAppStore().catModalOpen = true }
export function closeCatModal() { useAppStore().catModalOpen = false }

export function deleteCategory(id) {
  if (id === 'all' || id === 'uncategorized') { toast('无法删除默认分类', false); return }
  const store = useAppStore()
  showConfirm('确认删除此分类？', () => { store.deleteCategory(id); store.save() })
}

export function openAttrModal() { useAppStore().attrModalOpen = true }
export function closeAttrModal() { useAppStore().attrModalOpen = false }

export function deleteAttribute(id) { const s = useAppStore(); s.deleteAttribute(id); s.save() }

// ── Settings / Add Dropdown ──
export function hideSettingsMenu() { useAppStore().settingsOpen = false }
export function hideAddDropdown() { useAppStore().addDropdownOpen = false }
