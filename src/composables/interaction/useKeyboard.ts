/**
 * useKeyboard — 全局键盘快捷键 + 导航历史
 * 管理 Ctrl+K (搜索)、Ctrl+N (新建)、Escape (关闭)、
 * Ctrl+Z/Y (撤销/重做)、Tab (模态框焦点循环) 等快捷键，
 * 以及浏览器前进/后退按钮的导航状态恢复。
 */
import { onMounted, onUnmounted } from 'vue'
import { _onGlobalKeydown, restoreNavState } from './useKeyboardOps.js'

let _refCount = 0

export function useKeyboard() {
  function onPopState(e: PopStateEvent) { if (e.state) restoreNavState(e.state) }

  onMounted(() => {
    if (_refCount === 0) {
      document.addEventListener('keydown', _onGlobalKeydown)
    }
    _refCount++
    window.addEventListener('popstate', onPopState)
  })

  onUnmounted(() => {
    _refCount--
    if (_refCount === 0) {
      document.removeEventListener('keydown', _onGlobalKeydown)
    }
    window.removeEventListener('popstate', onPopState)
  })
}
