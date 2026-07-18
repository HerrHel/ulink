/**
 * usePasswordVisibility — 密码显示/隐藏状态管理
 * 避免在 BookmarkCard.vue 和 DetailPanel.vue 中重复实现
 *
 * E3-007：切页/失焦/pagehide 时 hideAll，避免明文挂在 DOM 被肩窥。
 */
import { ref, onMounted, onUnmounted } from 'vue'

export function usePasswordVisibility(autoHideMs = 5000) {
  const visibleIds = ref(new Set<string>())
  let timer: ReturnType<typeof setTimeout> | null = null

  function toggle(id: string) {
    if (visibleIds.value.has(id)) {
      visibleIds.value.delete(id)
    } else {
      visibleIds.value.add(id)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { visibleIds.value.clear() }, autoHideMs)
    }
  }

  function isVisible(id: string) {
    return visibleIds.value.has(id)
  }

  function hideAll() {
    visibleIds.value.clear()
    if (timer) { clearTimeout(timer); timer = null }
  }

  function onVisChange() {
    if (document.hidden) hideAll()
  }
  function onBlur() { hideAll() }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisChange)
    window.addEventListener('pagehide', onVisChange)
    window.addEventListener('blur', onBlur)
  })

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisChange)
    window.removeEventListener('pagehide', onVisChange)
    window.removeEventListener('blur', onBlur)
    hideAll()
  })

  return { visibleIds, toggle, isVisible, hideAll }
}
