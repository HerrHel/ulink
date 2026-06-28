/**
 * useInlineEdit — 行内文本编辑
 *
 * 将任意元素临时变为 contenteditable 编辑区，
 * blur 或 Enter 时保存，Escape 取消。
 * 替代 BookmarkCard.vue 中的内联 DOM 操作。
 */
import { type Ref } from 'vue'

interface InlineEditOptions {
  onSave: (value: string) => void
  multiline?: boolean
}

export function useInlineEdit() {
  let _el: HTMLElement | null = null
  let _onSave: ((value: string) => void) | null = null
  let _multiline = false

  function startEditing(el: HTMLElement, currentValue: string, options: InlineEditOptions) {
    // 防止重复编辑
    if (el.hasAttribute('contenteditable')) return

    _el = el
    _onSave = options.onSave
    _multiline = options.multiline ?? false

    el.setAttribute('contenteditable', 'true')
    el.style.cssText = 'outline:1px dashed var(--accent);padding:4px;border-radius:4px;cursor:text;white-space:pre-wrap;-webkit-line-clamp:unset;display:block'
    el.textContent = currentValue
    el.focus()
    window.getSelection()?.selectAllChildren(el)

    el.addEventListener('blur', _save)
    el.addEventListener('keydown', _onKey)
  }

  function _save() {
    if (!_el || !_onSave) return
    _el.removeAttribute('contenteditable')
    _el.style.cssText = ''
    const newValue = _el.textContent?.trim() ?? ''
    _onSave(newValue)
    _el.removeEventListener('blur', _save)
    _el.removeEventListener('keydown', _onKey)
    _el = null
    _onSave = null
  }

  function _onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') { ev.preventDefault(); _save(); return }
    if (!_multiline && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); _save() }
  }

  return { startEditing }
}
