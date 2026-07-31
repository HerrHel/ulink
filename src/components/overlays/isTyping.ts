/**
 * 判定事件目标是否处于「输入态」（输入框/文本域/下拉/可编辑区域）。
 *
 * 被 ShortcutHelpPanel 的全局 keydown 监听用于决定 `?` (Shift+/) 快捷键
 * 是否在用户正在输入时被吞——在输入态按 `?` 应插入问号而非调出帮助面板。
 *
 * 纯函数：仅读入参 `t` 的 `tagName` / `isContentEditable`，无副作用、无 DOM 全局依赖。
 * 直接用于断言 `?` 全局快捷键的输入态吞否行为契约。
 *
 * 约束（来源于 ShortcutHelpPanel.vue 行 93 调用 `isTyping(e.target)`）：
 * - tagName 比较用大写常量 'INPUT'/'TEXTAREA'/'SELECT'（HTMLElement.tagName 返回大写）。
 * - null / falsy 入参返回 false（非输入态不该吞快捷键）。
 */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}
