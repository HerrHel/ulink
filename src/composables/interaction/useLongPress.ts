/**
 * useLongPress — 移动端长按触发操作菜单
 * 从 event-delegation.js 提取的 pointer event 长按逻辑。
 * 检测 touch 设备上的长按手势，触发 showActionSheet 回调。
 */
import { onMounted, onUnmounted } from 'vue'
import { isMobile } from '../../utils.js'
import { showActionSheet } from '../ui/useUI.js'
import { useUIStore } from '../../stores/ui.js'

const LP_DELAY = 500
const LP_SLOP = 10

interface ActionItem {
  label: string
  action: () => void
  danger?: boolean
}

export function useLongPress(getActions: (card: HTMLElement) => ActionItem[] | null) {
  let _target: HTMLElement | null = null
  let _timer: ReturnType<typeof setTimeout> | null = null
  let _fired = false
  let _startX = 0
  let _startY = 0

  function cancel() {
    if (_timer) { clearTimeout(_timer); _timer = null }
    _target = null
  }

  function onPtrDown(e: PointerEvent) {
    if (!isMobile()) return
    if (useUIStore().batchMode) return
    if ((e.target as HTMLElement).closest('input, button, textarea, select, [contenteditable="true"]')) return
    const card = (e.target as HTMLElement).closest('.card,.group-card') as HTMLElement
    if (!card || card.classList.contains('group-card-focus')) return
    _target = card
    _startX = e.clientX
    _startY = e.clientY
    _timer = setTimeout(() => {
      _timer = null
      _fired = true
      const actions = getActions(card)
      if (actions) {
        showActionSheet(actions)
      }
    }, LP_DELAY)
  }

  function onPtrMove(e: PointerEvent) {
    if (!_target) return
    if (Math.abs(e.clientX - _startX) > LP_SLOP || Math.abs(e.clientY - _startY) > LP_SLOP) cancel()
  }

  function onPtrUp() {
    if (_fired) { setTimeout(() => { _fired = false }, 200) }
    cancel()
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onPtrDown, { passive: true })
    document.addEventListener('pointermove', onPtrMove, { passive: true })
    document.addEventListener('pointerup', onPtrUp, { passive: true })
    document.addEventListener('pointercancel', cancel, { passive: true })
  })

  onUnmounted(() => {
    document.removeEventListener('pointerdown', onPtrDown)
    document.removeEventListener('pointermove', onPtrMove)
    document.removeEventListener('pointerup', onPtrUp)
    document.removeEventListener('pointercancel', cancel)
  })

  // Expose _fired so global click handler can suppress click after long-press
  return { get fired() { return _fired }, set fired(v) { _fired = v } }
}
