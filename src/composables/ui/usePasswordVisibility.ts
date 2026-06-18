/**
 * usePasswordVisibility — 密码显示/隐藏状态管理
 * 避免在 BookmarkCard.vue 和 DetailPanel.vue 中重复实现
 */
import { ref, onUnmounted } from 'vue'

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
    if (timer) clearTimeout(timer)
  }

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return { visibleIds, toggle, isVisible, hideAll }
}
