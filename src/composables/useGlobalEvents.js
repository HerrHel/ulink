import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../stores/app.js'
import { useUIStore } from '../stores/ui.js'
import { isMobile } from '../utils.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../config/constants.js'
import { mentionAPI, attrDropdownAPI } from './bridge.js'
import { hideSettingsMenu, hideAddDropdown } from './ui/useUI.js'

/**
 * Global click/contextmenu event delegation.
 * Extracted from App.vue's inline handlers.
 */
export function useGlobalEvents(options = {}) {
  const store = useAppStore()
  const uiStore = useUIStore()
  const {
    onOpenDetail,
    onToggleGroupFocus,
    onRemoveGroupRef, onRemoveBmFromGroup,
    onVisit, onShowCtxMenu,
    longPressFired
  } = options

  function onResize() {
    uiStore.setMobile(isMobile())
  }

  function onGlobalClick(e) {
    // Suppress click after long-press
    if (longPressFired?.value) {
      longPressFired.value = false
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // Close dropdowns when clicking outside
    if (!e.target.closest('.attr-filter-wrap')) attrDropdownAPI?.close?.()
    if (!e.target.closest('.settings-wrap')) hideSettingsMenu()
    if (!e.target.closest('.add-wrap')) hideAddDropdown()
    if (!e.target.closest('#mentionDrop') && !e.target.closest('.group-body')) mentionAPI?.hide()

    // Inline card interactions
    const gic = e.target.closest('.gic-btn')
    const gicRm = e.target.closest('.gic-remove')
    const gicName = e.target.closest('.gic-name')
    if (gic || gicRm || gicName) {
      const card = e.target.closest('.group-inline-card')
      if (card) {
        const gb = card.closest('.group-body')
        if (gb) {
          const gid = gb.closest('.group-card')?.dataset?.groupId
          const bmId = card.getAttribute('data-bm-id')
          const isRef = bmId && bmId.startsWith('ref:')
          const refGid = isRef ? bmId.slice(4) : null
          if (gic) {
            e.stopPropagation()
            if (isRef) onOpenDetail?.('group:' + refGid)
            else if (bmId) onOpenDetail?.(bmId)
          } else if (gicRm) {
            e.stopPropagation()
            if (isRef && gid) onRemoveGroupRef?.(gid, refGid)
            else if (bmId && gid) onRemoveBmFromGroup?.(bmId, gid)
          } else if (gicName) {
            e.stopPropagation()
            if (isRef) onToggleGroupFocus?.(refGid)
            else if (bmId) onVisit?.(null, bmId)
          }
          return
        }
      }
    }
  }

  function onContextMenu(e) {
    if (isMobile()) { e.preventDefault(); return }
    if (store.batchMode && e.target.closest('.card, .group-card, .group-body, .sub-sites')) return
    if (!onShowCtxMenu) return

    const subSitesEl = e.target.closest('.sub-sites')
    if (subSitesEl) {
      const subItem = e.target.closest('.group-inline-card')
      if (!subItem) { e.preventDefault(); return }
      const subId = subItem.dataset.bmId || subItem.dataset.id
      if (subId) { store.ctxCard = null; onShowCtxMenu(e, 'sub', subId); return }
    }
    const inlineCard = e.target.closest('.group-inline-card')
    if (inlineCard) {
      const gCard = inlineCard.closest('.group-card')
      if (gCard) { store.ctxCard = inlineCard; store.ctxGid = gCard.dataset.groupId; onShowCtxMenu(e, 'group-card', inlineCard.getAttribute('data-bm-id')); return }
    }
    const gCard = e.target.closest('.group-card')
    if (gCard) { store.ctxCard = null; onShowCtxMenu(e, 'group', gCard.dataset.groupId); return }
    const bmCard = e.target.closest('.card')
    if (bmCard) { store.ctxCard = null; onShowCtxMenu(e, 'card', bmCard.dataset.id); return }
    const railItem = e.target.closest('.rail-item')
    if (railItem) { const catId = railItem.dataset.catId; if (catId && catId !== CAT_ALL && catId !== CAT_UNCATEGORIZED) { onShowCtxMenu(e, 'cat', catId); return } }
    if (e.target.closest('.icon-rail') && !e.target.closest('.rail-item') && !e.target.closest('.rail-logo') && !e.target.closest('.rail-bottom')) { onShowCtxMenu(e, 'rail-empty', ''); return }
    if (e.target.closest('#panelContent') && !e.target.closest('.card') && !e.target.closest('.empty')) { onShowCtxMenu(e, 'grid-empty', ''); return }
  }

  onMounted(() => {
    uiStore.setMobile(isMobile())
    window.addEventListener('resize', onResize)
    document.addEventListener('click', onGlobalClick)
    document.addEventListener('contextmenu', onContextMenu)
  })
  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
    document.removeEventListener('click', onGlobalClick)
    document.removeEventListener('contextmenu', onContextMenu)
  })
}
