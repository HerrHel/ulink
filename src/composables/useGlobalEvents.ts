import { onMounted, onUnmounted } from 'vue'
import { useUIStore } from '../stores/ui.js'
import { isMobile } from '../utils.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../config/constants.js'
import { useAttrDropdownStore } from '../stores/attrDropdown.js'
import { useMentionStore } from '../stores/overlay.js'
import { hideSettingsMenu, hideAddDropdown } from './ui/useUI.js'

interface GlobalEventsOptions {
  onOpenDetail?: (id: string) => void
  onToggleGroupFocus?: (id: string) => void
  onRemoveGroupRef?: (gid: string, refGid: string) => void
  onRemoveBmFromGroup?: (bmId: string, gid: string) => void
  onVisit?: (e: Event | null, id?: string) => void
  onShowCtxMenu?: (e: MouseEvent, type: string, id: string) => void
}

/**
 * Global click/contextmenu event delegation.
 * Extracted from App.vue's inline handlers.
 */
export function useGlobalEvents(options: GlobalEventsOptions = {}) {
  const ui = useUIStore()
  const {
    onOpenDetail,
    onToggleGroupFocus,
    onRemoveGroupRef, onRemoveBmFromGroup,
    onVisit, onShowCtxMenu,
  } = options

  function onResize() {
    // 直接读 matchMedia 而非 isMobile()，避免 resize 与 matchMedia change 事件
    // 触发顺序不确定时读到过时的 _isMobile 缓存值，导致切回桌面端后 isMobile 仍为 true、
    // 布局不恢复宫格、设置面板按钮禁用。
    const mobile = window.matchMedia('(max-width: 768px)').matches
    ui.setMobile(mobile)
  }

  function onGlobalClick(e: MouseEvent) {
    // Suppress click after long-press：长按抬起后的系统 click 与长按手势同点触发，
    // 不抑制会误触发卡片内 click 委派（如误展开/误访问）。原实现传一次性快照对象
    // { value: longPress.fired } 进来——快照创建瞬间取值 false，之后 longPress.fired
    // 翻 true 也反映不到快照，抑制分支永不生效。改读 store.lpFired（useApp 的 watch
    // 已把 longPress.fired 同步过去），读完清零，单次抑制语义保持。
    if (ui.lpFired) {
      ui.lpFired = false
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // Close dropdowns when clicking outside
    if (!(e.target as HTMLElement).closest('.attr-filter-wrap')) useAttrDropdownStore().close()
    if (!(e.target as HTMLElement).closest('.settings-wrap')) hideSettingsMenu()
    if (!(e.target as HTMLElement).closest('.add-wrap')) hideAddDropdown()
    if (!(e.target as HTMLElement).closest('#mentionDrop') && !(e.target as HTMLElement).closest('.group-body')) useMentionStore().hide()

    // Inline card interactions
    const gic = (e.target as HTMLElement).closest('.gic-btn')
    const gicRm = (e.target as HTMLElement).closest('.gic-remove')
    const gicName = (e.target as HTMLElement).closest('.gic-name')
    if (gic || gicRm || gicName) {
      const card = (e.target as HTMLElement).closest('.group-inline-card')
      if (card) {
        const gb = card.closest('.group-body')
        if (gb) {
          const gid = gb.closest('.group-card')?.getAttribute('data-group-id')
          const bmId = card.getAttribute('data-bm-id')
          const isRef = bmId && bmId.startsWith('ref:')
          const refGid = isRef ? bmId.slice(4) : null
          if (gic) {
            e.stopPropagation()
            if (isRef) onOpenDetail?.('group:' + refGid)
            else if (bmId) onOpenDetail?.(bmId)
          } else if (gicRm) {
            e.stopPropagation()
            if (isRef && gid) onRemoveGroupRef?.(gid, refGid!)
            else if (bmId && gid) onRemoveBmFromGroup?.(bmId, gid)
          } else if (gicName) {
            e.stopPropagation()
            if (isRef) onToggleGroupFocus?.(refGid!)
            else if (bmId) onVisit?.(null, bmId)
          }
          return
        }
      }
    }
  }

  function onContextMenu(e: MouseEvent) {
    if (isMobile()) { e.preventDefault(); return }
    if (ui.batchMode && (e.target as HTMLElement).closest('.card, .group-card, .group-body, .sub-sites')) return
    if (!onShowCtxMenu) return

    // 匹配到自定义菜单项时始终阻止浏览器默认菜单
    function showCtx(type: string, id: string) {
      e.preventDefault()
      onShowCtxMenu!(e, type, id)
    }

    const subSitesEl = (e.target as HTMLElement).closest('.sub-sites')
    if (subSitesEl) {
      const subItem = (e.target as HTMLElement).closest('.group-inline-card')
      if (!subItem) return  // 无 inline card 时不阻止原生菜单
      const subId = (subItem as HTMLElement).dataset.bmId || (subItem as HTMLElement).dataset.id
      if (subId) { ui.ctxCard = null; showCtx('sub', subId); return }
    }
    const inlineCard = (e.target as HTMLElement).closest('.group-inline-card')
    // 组编辑区域内（非 inline card）：显示浏览器原生右键菜单
    const groupBody = (e.target as HTMLElement).closest('.group-body')
    if (groupBody && !inlineCard) { return }
    if (inlineCard) {
      const gCard = inlineCard.closest('.group-card')
      if (gCard) { ui.ctxCard = inlineCard as HTMLElement; ui.ctxGid = (gCard as HTMLElement).dataset.groupId!; showCtx('group-card', inlineCard.getAttribute('data-bm-id')!); return }
    }
    const gCard = (e.target as HTMLElement).closest('.group-card')
    if (gCard) { ui.ctxCard = null; showCtx('group', (gCard as HTMLElement).dataset.groupId!); return }
    const bmCard = (e.target as HTMLElement).closest('.card')
    if (bmCard) { ui.ctxCard = null; showCtx('card', (bmCard as HTMLElement).dataset.id!); return }
    const railItem = (e.target as HTMLElement).closest('.rail-item')
    if (railItem) { const catId = (railItem as HTMLElement).dataset.catId; if (catId && catId !== CAT_ALL && catId !== CAT_UNCATEGORIZED) { showCtx('cat', catId); return } }
    if ((e.target as HTMLElement).closest('.icon-rail') && !(e.target as HTMLElement).closest('.rail-item') && !(e.target as HTMLElement).closest('.rail-logo') && !(e.target as HTMLElement).closest('.rail-bottom')) { showCtx('rail-empty', ''); return }
    if ((e.target as HTMLElement).closest('#panelContent') && !(e.target as HTMLElement).closest('.card') && !(e.target as HTMLElement).closest('.empty')) { showCtx('grid-empty', ''); return }
  }

  onMounted(() => {
    ui.setMobile(isMobile())
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
