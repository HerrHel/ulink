/**
 * useLongPress — 移动端长按触发操作菜单
 * 从 event-delegation.js 提取的 pointer event 长按逻辑。
 * 检测 touch 设备上的长按手势，触发 showActionSheet 回调。
 */
import { ref, onMounted, onUnmounted, type Ref } from 'vue'
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

export function useLongPress(getActions: (card: HTMLElement) => ActionItem[] | null): { fired: Ref<boolean> } {
  let _target: HTMLElement | null = null
  let _timer: ReturnType<typeof setTimeout> | null = null
  // H17：旧实现用普通 let + getter，useApp 的 watch(() => longPress.fired) 只在初始化触发一次，
  // 长按后 _fired=true 永不驱动 lpFired，合成 click 抑制失效。改为 ref 后 watch 能正确响应。
  const fired = ref(false)
  let _startX = 0
  let _startY = 0
  let _resetTimer: ReturnType<typeof setTimeout> | null = null

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
      fired.value = true
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

  /** E3-004：pointerup/pointercancel 共用 fired 复位，避免 cancel 后 fired 长期 true */
  function scheduleFiredReset() {
    if (!fired.value) return
    if (_resetTimer) clearTimeout(_resetTimer)
    _resetTimer = setTimeout(() => { fired.value = false; _resetTimer = null }, 200)
  }

  function onPtrUp() {
    scheduleFiredReset()
    cancel()
  }

  function onPtrCancel() {
    scheduleFiredReset()
    cancel()
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onPtrDown, { passive: true })
    document.addEventListener('pointermove', onPtrMove, { passive: true })
    document.addEventListener('pointerup', onPtrUp, { passive: true })
    document.addEventListener('pointercancel', onPtrCancel, { passive: true })
  })

  onUnmounted(() => {
    cancel()
    if (_resetTimer) { clearTimeout(_resetTimer); _resetTimer = null }
    document.removeEventListener('pointerdown', onPtrDown)
    document.removeEventListener('pointermove', onPtrMove)
    document.removeEventListener('pointerup', onPtrUp)
    document.removeEventListener('pointercancel', onPtrCancel)
  })

  return { fired }
}
