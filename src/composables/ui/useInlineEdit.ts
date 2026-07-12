/**
 * useInlineEdit — 行内文本编辑
 *
 * 将任意元素临时变为 contenteditable 编辑区，
 * blur 或 Enter 时保存，Escape 取消。
 * 替代 BookmarkCard.vue 中的内联 DOM 操作。
 */

interface InlineEditOptions {
  onSave: (value: string) => void
  onCancel?: () => void
  multiline?: boolean
}

export function useInlineEdit() {
  let _el: HTMLElement | null = null
  let _onSave: ((value: string) => void) | null = null
  let _onCancel: (() => void) | null = null
  let _multiline = false
  // 取消编辑时恢复用的原值。旧实现 Escape 也走 _save 把当前 textContent 存回，
  // 用户改了一半按 Escape 期望「放弃改动」却被存为半成品/空值——保留原值，
  // Escape 时写回原值并触发 onCancel，Enter/blur 才真正保存。
  let _originalValue = ''

  function startEditing(el: HTMLElement, currentValue: string, options: InlineEditOptions) {
    // 防止重复编辑
    if (el.hasAttribute('contenteditable')) return

    _el = el
    _onSave = options.onSave
    _onCancel = options.onCancel ?? null
    _multiline = options.multiline ?? false
    _originalValue = currentValue

    el.setAttribute('contenteditable', 'true')
    el.style.cssText = 'outline:1px dashed var(--accent);padding:4px;border-radius:4px;cursor:text;white-space:pre-wrap;-webkit-line-clamp:unset;display:block'
    el.textContent = currentValue
    el.focus()
    window.getSelection()?.selectAllChildren(el)

    el.addEventListener('blur', _save)
    el.addEventListener('keydown', _onKey)
  }

  function _teardown() {
    if (!_el) return
    _el.removeAttribute('contenteditable')
    _el.style.cssText = ''
    _el.removeEventListener('blur', _save)
    _el.removeEventListener('keydown', _onKey)
    _el = null
    _onSave = null
    _onCancel = null
  }

  function _save() {
    if (!_el || !_onSave) return
    const newValue = _el.textContent?.trim() ?? ''
    _saveValue(newValue)
  }

  /** 退出可编辑态并把 newValue 存回 + 调用 onSave */
  function _saveValue(newValue: string) {
    if (!_el || !_onSave) { _teardown(); return }
    _el.removeAttribute('contenteditable')
    _el.style.cssText = ''
    _el.removeEventListener('blur', _save)
    _el.removeEventListener('keydown', _onKey)
    _onSave(newValue)
    _el = null
    _onSave = null
    _onCancel = null
  }

  /** 取消编辑：恢复原值，不调 onSave，可选调 onCancel */
  function _cancel() {
    if (!_el) return
    _el.textContent = _originalValue
    _teardown()
  }

  function _onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') { ev.preventDefault(); _cancel(); _onCancel?.(); return }
    if (!_multiline && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); _save() }
  }

  return { startEditing }
}
