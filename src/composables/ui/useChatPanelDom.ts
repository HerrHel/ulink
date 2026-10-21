/**
 * useChatPanelDom — DetailPanel 面板级 DOM 行为（自 DetailPanel.vue 抽出，行为零变化）
 *
 * 职责：拖拽卡片悬停高亮、聊天区滚动到底、输入框自适应高度、移动端下滑关闭手势
 * （translateY 跟手 + panelStyle）、触摸监听的挂载/卸载。
 * 键盘交互、会话菜单等与调度状态耦合的行为留在 DetailPanel。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { isMobile } from '../../utils.js'
import { processFileForAi } from '../../lib/ai/attachmentHelper.js'
import { toast } from '../../lib/toast.js'
import { t } from '../../i18n/index.js'

export interface ChatPanelDomDeps {
  panelRef: Ref<HTMLElement | null>
  textareaRef: Ref<HTMLTextAreaElement | null>
  scrollRef: Ref<HTMLElement | null>
  /** 惰性读取输入框文本（aiQuery 由 useAiChat 创建，须延迟到其初始化后读取） */
  getQuery: () => string
}

export function useChatPanelDom(deps: ChatPanelDomDeps) {
  const { panelRef, textareaRef, scrollRef, getQuery } = deps
  const ui = useUIStore()

  // ── 拖拽卡片悬停高亮 ──
  const isDragOverPanel = ref(false)

  function onPanelDragOver(e?: DragEvent) {
    if (ui.isDraggingCard || e?.dataTransfer?.types?.includes('Files')) {
      isDragOverPanel.value = true
    }
  }

  function onPanelDragLeave(e: DragEvent) {
    const rect = panelRef.value?.getBoundingClientRect()
    if (rect) {
      if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
        isDragOverPanel.value = false
      }
    }
  }

  async function onPanelDrop(e?: DragEvent) {
    isDragOverPanel.value = false
    if (e && e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      const files = e.dataTransfer.files
      let added = 0
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        if (f.size > 50 * 1024 * 1024) continue
        const processed = await processFileForAi(f)
        ui.attachFileToAi(processed)
        added++
      }
      if (added > 0) {
        toast(t('ai.fileAttachedToast', { name: files[0].name }))
      }
    }
  }

  watch(
    () => ui.isDraggingCard,
    (dragging) => {
      if (!dragging) {
        isDragOverPanel.value = false
      }
    },
  )

  // ── 聊天区滚动到底 ──
  function scrollToBottom(smooth = false) {
    nextTick(() => {
      if (!scrollRef.value) return
      const el = scrollRef.value
      if (typeof el.scrollTo === 'function' && smooth) {
        try {
          el.scrollTo({
            top: el.scrollHeight,
            behavior: 'smooth',
          })
        } catch {
          // fallback to direct assignment
        }
      }
      el.scrollTop = el.scrollHeight
    })
  }

  // ── 输入框自适应高度 ──
  function adjustTextareaHeight() {
    const el = textareaRef.value
    if (!el) return
    if (!getQuery()) {
      el.style.height = '24px'
      el.style.lineHeight = '24px'
      el.style.overflowY = 'hidden'
      return
    }
    el.style.height = 'auto'
    const scrollH = el.scrollHeight
    if (scrollH <= 26) {
      el.style.height = '24px'
      el.style.lineHeight = '24px'
      el.style.overflowY = 'hidden'
    } else {
      const nextH = Math.min(scrollH, 160)
      el.style.height = nextH + 'px'
      el.style.lineHeight = '1.45'
      el.style.overflowY = scrollH > 160 ? 'auto' : 'hidden'
    }
  }

  /* 移动端下滑关闭手势 */
  const isSwiping = ref(false)
  const translateY = ref(0)
  let _swipeStartY = 0
  function onSwipeStart(e: TouchEvent) {
    if (!isMobile() || !ui.panels.detail) return
    if (!(e.target as HTMLElement).closest('.detail-drag-handle')) return
    _swipeStartY = e.touches[0].clientY
  }
  function onSwipeMove(e: TouchEvent) {
    if (!_swipeStartY) return
    const dy = e.touches[0].clientY - _swipeStartY
    if (dy > 0) {
      e.preventDefault()
      isSwiping.value = true
      translateY.value = dy
    }
  }
  function onSwipeEnd() {
    if (!isSwiping.value) { _swipeStartY = 0; return }
    const panel = panelRef.value
    const panelHeight = panel ? panel.offsetHeight : 300
    if (translateY.value > panelHeight * 0.3) { ui.panels.detail = false }
    _resetSwipe()
  }
  function onSwipeCancel() {
    if (isSwiping.value || _swipeStartY) _resetSwipe()
  }
  function _resetSwipe() {
    translateY.value = 0
    isSwiping.value = false
    _swipeStartY = 0
  }

  const panelStyle = computed(() => {
    const styles: Record<string, string> = {}
    if (translateY.value) {
      styles.transform = `translateY(${translateY.value}px)`
    }
    return Object.keys(styles).length ? styles : undefined
  })

  onMounted(() => {
    nextTick(() => adjustTextareaHeight())
    const el = panelRef.value
    if (el) {
      el.addEventListener('touchstart', onSwipeStart, { passive: true })
      el.addEventListener('touchmove', onSwipeMove, { passive: false })
      el.addEventListener('touchend', onSwipeEnd)
      el.addEventListener('touchcancel', onSwipeCancel)
    }
  })
  onUnmounted(() => {
    const el = panelRef.value
    if (el) {
      el.removeEventListener('touchstart', onSwipeStart)
      el.removeEventListener('touchmove', onSwipeMove)
      el.removeEventListener('touchend', onSwipeEnd)
      el.removeEventListener('touchcancel', onSwipeCancel)
    }
  })

  return {
    isDragOverPanel,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
    scrollToBottom,
    adjustTextareaHeight,
    isSwiping,
    translateY,
    panelStyle,
  }
}
