/**
 * usePasswordVisibility — 密码显示/隐藏状态管理（模块级单例）
 * 避免在 BookmarkCard.vue 和 DetailPanel.vue 中重复实现
 * E3-007：切页/失焦/pagehide 时 hideAll，避免明文挂在 DOM 被肩窥。
 * 审计 R29：原每个 BookmarkCard 调用该函数都会注册独立的 document/window 监听（3N 个全局监听）。
 * 改为模块级单例：首次调用时懒绑定全局监听，共享 visibleIds Set 与 auto-hide timer，
 * CardGrid 普通模式 >100 卡、过滤/虚拟滚动片段进出高频增删监听的抖动消除。
 */
import { ref } from 'vue'

const _visibleIds = ref(new Set<string>())
let _timer: ReturnType<typeof setTimeout> | null = null
let _listenersBound = false
let _autoHideMs = 5000

function _bindListeners() {
  if (_listenersBound) return
  _listenersBound = true
  document.addEventListener('visibilitychange', _onVisChange)
  window.addEventListener('pagehide', _onVisChange)
  window.addEventListener('blur', _onBlur)
}

function _onVisChange() {
  if (document.hidden) _hideAll()
}
function _onBlur() { _hideAll() }

function _hideAll() {
  _visibleIds.value.clear()
  if (_timer) { clearTimeout(_timer); _timer = null }
}

export function usePasswordVisibility(autoHideMs = 5000) {
  if (!_listenersBound) {
    _autoHideMs = autoHideMs
    _bindListeners()
  }
  // 单例：后续调用传入的 autoHideMs 忽略，用首次绑定时的值（合理：全局一致）
  function toggle(id: string) {
    if (_visibleIds.value.has(id)) {
      _visibleIds.value.delete(id)
    } else {
      _visibleIds.value.add(id)
      if (_timer) clearTimeout(_timer)
      _timer = setTimeout(() => { _visibleIds.value.clear() }, _autoHideMs)
    }
  }

  function isVisible(id: string) {
    return _visibleIds.value.has(id)
  }

  function hideAll() { _hideAll() }

  // 注意：单例无 onUnmounted 解绑（应用常驻），回调极轻（Set.clear + clearTimeout），常驻无害。
  return { visibleIds: _visibleIds, toggle, isVisible, hideAll }
}
