/**
 * usePasswordVisibility — 密码显示/隐藏状态管理（模块级单例）
 * 避免在 BookmarkCard.vue 和 DetailPanel.vue 中重复实现
 * E3-007：切页/失焦/pagehide 时 hideAll，避免明文挂在 DOM 被肩窥。
 * 审计 R29：原每个 BookmarkCard 调用该函数都会注册独立的 document/window 监听（3N 个全局监听）。
 * 改为模块级单例：首次调用时懒绑定全局监听，共享 visibleIds Set 与 auto-hide timer，
 * CardGrid 普通模式 >100 卡、过滤/虚拟滚动片段进出高频增删监听的抖动消除。
 *
 * E2E 锁定对称守门（R29 同向补全）：pagehide/blur 是「被动失焦」都触 _hideAll，
 * E2E lock 是更强的「主动要求所有明文从 DOM 消失」信号却无守门——
 * 旧实现 lock 后 isVisible(id) 不清（auto-hide 5s timer 未到），BookmarkCard 模板走
 * `isVisible(id) ? decodedPw : '••••••'`，decodedPw 被 watch(isUnlocked) 清成 ''，
 * 结果锁定后密码区显示空字符串而非占位 `••••••`（视觉错误呈现）；更糟若 <5s 内连续
 * 解锁，decodedPw 重算回明文 + isVisible 仍 true → 明文自动显形（无需再点眼）。
 * 修复：单例首绑时挂 E2E isUnlocked watch，false 时 _hideAll 清可见态——
 * 锁定即密码区回落占位、re-unlock 必再点眼才显形。绑在单例层防 R29 N 监听复活。
 */
import { ref, effectScope, watch, type EffectScope } from 'vue'
import { useE2EStore } from '../../stores/e2e.js'

const _visibleIds = ref(new Set<string>())
let _timer: ReturnType<typeof setTimeout> | null = null
let _listenersBound = false
let _autoHideMs = 5000
// E2E isUnlocked watch 的 scope 句柄——首绑时挂，stop 时停。模块级单例常驻。
let _e2eScope: EffectScope | null = null

function _bindListeners() {
  if (_listenersBound) return
  _listenersBound = true
  document.addEventListener('visibilitychange', _onVisChange)
  window.addEventListener('pagehide', _onVisChange)
  window.addEventListener('blur', _onBlur)
  // E2E lock 守门：isUnlocked→false 时清明文可见态（与 pagehide/blur 同向对称）
  // 用 effectScope 包裹抑制模块顶层 watch 的「no active render effect」警告
  if (_e2eScope) _e2eScope.stop()
  _e2eScope = effectScope(true)
  _e2eScope.run(() => {
    const e2eStore = useE2EStore()
    watch(() => e2eStore.isUnlocked, (v) => { if (!v) _hideAll() })
  })
}

function _onVisChange() {
  if (document.hidden) _hideAll()
}
function _onBlur() { _hideAll() }

export function _hideAll() {
  _visibleIds.value.clear()
  if (_timer) { clearTimeout(_timer); _timer = null }
}

/// 测试钩子：reset 模块级单例 state（visibleIds Set / auto-hide timer / 监听绑定标志 / autoHideMs 默认值）
/// 并解绑上轮测试懒绑定的全局监听，供每个用例干净起步。
/// 同 syncPending `__testPendingSync` / data `__testHistDebounce` 测试注入面口径：
/// 仅操作单例内存态与全局监听绑定，不触碰生产隐藏逻辑（_hideAll / _onVisChange / _onBlur 一字未动）。
export function __testReset() {
  if (_timer) { clearTimeout(_timer); _timer = null }
  _visibleIds.value.clear()
  // 解绑上轮测试懒绑定的监听，重置绑定标志（生产单例常驻无解绑，此处仅测试隔离用）
  document.removeEventListener('visibilitychange', _onVisChange)
  window.removeEventListener('pagehide', _onVisChange)
  window.removeEventListener('blur', _onBlur)
  _listenersBound = false
  _autoHideMs = 5000
  // 停 E2E isUnlocked watch scope，供下轮用例首绑时挂新 scope 拿新 Pinia 的 store
  if (_e2eScope) { _e2eScope.stop(); _e2eScope = null }
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
