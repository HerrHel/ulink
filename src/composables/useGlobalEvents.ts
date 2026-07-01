import { onMounted, onUnmounted } from 'vue'
import { useUIStore } from '../stores/ui.js'
import { isMobile } from '../utils.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../config/constants.js'
import { useAttrDropdownStore } from '../stores/attrDropdown.js'
import { useMentionStore } from '../stores/overlay.js'
import { hideSettingsMenu, hideAddDropdown } from './ui/useUI.js'
import type { UIState } from '../stores/ui.js'

interface GlobalEventsOptions {
  onOpenDetail?: (id: string) => void
  onToggleGroupFocus?: (id: string) => void
  onRemoveGroupRef?: (gid: string, refGid: string) => void
  onRemoveBmFromGroup?: (bmId: string, gid: string) => void
  onVisit?: (e: Event | null, id?: string) => void
  onShowCtxMenu?: (e: MouseEvent, type: string, id: string) => void
  longPressFired?: { value: boolean }
}

// ── 右键菜单匹配器注册表 ──
// 每个实体类型独立匹配器，顺序决定优先级（先匹配胜出）
// 返回 null → 尝试下一个匹配器
// 返回 _ABSTAIN → 交给浏览器原生菜单
// 返回 CtxMatch → 显示自定义菜单

const _ABSTAIN = Symbol('lv-ctx-abstain')

interface CtxMatch {
  type: string
  id: string
  setup?: () => void
}

type CtxResult = CtxMatch | typeof _ABSTAIN | null

interface CtxMatcher {
  name: string
  match: (target: HTMLElement) => CtxResult
}

function createMatchers(ui: UIState): CtxMatcher[] {
  return [
    // 1. 子网站 inline card
    {
      name: 'sub',
      match(target) {
        if (!target.closest('.sub-sites')) return null
        const card = target.closest('.group-inline-card') as HTMLElement | null
        if (!card) return _ABSTAIN
        const id = card.dataset.bmId || card.dataset.id
        return id ? { type: 'sub', id, setup: () => { ui.ctxCard = null } } : null
      },
    },
    // 2. 组内 inline card
    {
      name: 'inline-card',
      match(target) {
        const card = target.closest('.group-inline-card') as HTMLElement | null
        if (!card) return null
        const gCard = card.closest('.group-card') as HTMLElement | null
        if (!gCard) return null
        const bmId = card.getAttribute('data-bm-id')
        return bmId
          ? { type: 'group-card', id: bmId, setup: () => { ui.ctxCard = card; ui.ctxGid = gCard.dataset.groupId! } }
          : null
      },
    },
    // 3. 组编辑区域（非 inline card）：交给浏览器
    {
      name: 'group-body',
      match(target) {
        return target.closest('.group-body') ? _ABSTAIN : null
      },
    },
    // 4. 组卡片
    {
      name: 'group',
      match(target) {
        const gCard = target.closest('.group-card') as HTMLElement | null
        if (!gCard) return null
        const gid = gCard.dataset.groupId
        return gid ? { type: 'group', id: gid, setup: () => { ui.ctxCard = null } } : null
      },
    },
    // 5. 书签卡片
    {
      name: 'card',
      match(target) {
        const bmCard = target.closest('.card') as HTMLElement | null
        if (!bmCard) return null
        const id = bmCard.dataset.id
        return id ? { type: 'card', id, setup: () => { ui.ctxCard = null } } : null
      },
    },
    // 6. 导航栏分类
    {
      name: 'category',
      match(target) {
        const railItem = target.closest('.rail-item') as HTMLElement | null
        if (!railItem) return null
        const catId = railItem.dataset.catId
        if (!catId || catId === CAT_ALL || catId === CAT_UNCATEGORIZED) return null
        return { type: 'cat', id: catId }
      },
    },
    // 7. 导航栏空白区域
    {
      name: 'rail-empty',
      match(target) {
        if (!target.closest('.icon-rail')) return null
        if (target.closest('.rail-item') || target.closest('.rail-logo') || target.closest('.rail-bottom')) return null
        return { type: 'rail-empty', id: '' }
      },
    },
    // 8. 主面板空白区域
    {
      name: 'grid-empty',
      match(target) {
        if (!target.closest('#panelContent')) return null
        if (target.closest('.card') || target.closest('.empty')) return null
        return { type: 'grid-empty', id: '' }
      },
    },
  ]
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
    longPressFired
  } = options

  function onResize() {
    ui.setMobile(isMobile())
  }

  function onGlobalClick(e: MouseEvent) {
    // Suppress click after long-press
    if (longPressFired?.value) {
      longPressFired.value = false
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
    if (!onShowCtxMenu) return
    if (isMobile()) { e.preventDefault(); return }
    // 批量模式下不显示自定义菜单
    if (ui.batchMode && (e.target as HTMLElement).closest('.card, .group-card, .group-body, .sub-sites')) return

    const target = e.target as HTMLElement
    const matchers = createMatchers(ui)
    for (const m of matchers) {
      const result = m.match(target)
      if (result === _ABSTAIN) return // 交给浏览器原生菜单
      if (result !== null) {
        result.setup?.()
        e.preventDefault()
        onShowCtxMenu(e, result.type, result.id)
        return
      }
    }
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
