/**
 * _confirmState.ts — Confirm 回调暂存
 *
 * 避免将函数值存入 Pinia state（不可序列化），
 * 改用模块级变量在 ConfirmModal 和 ToastContainer 之间传递。
 * 函数值仅存于用户交互的短暂窗口内，生命周期可控。
 */
let _confirmCallback: (() => void) | null = null

export function setConfirmCallback(cb: (() => void) | null) {
  _confirmCallback = cb
}

export function getAndClearConfirmCallback(): (() => void) | null {
  const cb = _confirmCallback
  _confirmCallback = null
  return cb
}
