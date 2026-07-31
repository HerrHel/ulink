/**
 * E3-003：Escape 须在 teardown 清空回调之前调用 onCancel
 *
 * 既有 2 用例锁主路径（Escape→onCancel、Enter→onSave），
 * 追加 describe 锁六条边界契约（见 d1-57 进度段逐条从读源真实结构）：
 * re-entry guard / blur 保存 / _save trim / multiline+Enter 不 save /
 * 单行 Shift+Enter 不 save / Escape 无 onCancel 不抛 + 仍 teardown 还原原值。
 */
import { describe, it, expect, vi } from 'vitest'
import { useInlineEdit } from '../../composables/ui/useInlineEdit.js'

describe('useInlineEdit', () => {
  it('Escape 触发 onCancel（先缓存回调再 teardown）', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const onCancel = vi.fn()
    const onSave = vi.fn()
    const { startEditing } = useInlineEdit()
    startEditing(el, '原始', { onSave, onCancel })

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
    expect(el.textContent).toBe('原始')
    expect(el.getAttribute('contenteditable')).toBeNull()
    document.body.removeChild(el)
  })

  it('Enter 保存当前内容', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const onSave = vi.fn()
    const { startEditing } = useInlineEdit()
    startEditing(el, '原始', { onSave })
    el.textContent = '新标题'
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onSave).toHaveBeenCalledWith('新标题')
    document.body.removeChild(el)
  })
})

/**
 * 边界护栏（d1-57）：re-entry guard / blur 保存 / _save trim /
 * multiline+Enter 不 save / 单行 Shift+Enter 不 save / Escape 无 onCancel 不抛 + teardown 还原
 */
describe('useInlineEdit 边界护栏（d1-57）', () => {
  /** 构造元素并入 DOM 的工厂，复用同文件既有 el+addEventListener 模式 */
  function makeEl() {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
  }

  it('re-entry guard：startEditing 对已 contenteditable 元素二次调用早返回不重复绑定', () => {
    const el = makeEl()
    const onSave = vi.fn()
    const { startEditing } = useInlineEdit()
    startEditing(el, '原', { onSave })
    // 已进入编辑态：el 带 contenteditable、_el 被赋值
    expect(el.hasAttribute('contenteditable')).toBe(true)
    const onSave2 = vi.fn()
    // 二次对同一元素 startEditing —— re-entry guard line 27 早返回
    startEditing(el, '原', { onSave: onSave2 })
    // _el/_onSave 不被第二次覆盖（onSave2 未替换 onSave）
    el.textContent = '改'
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    // onSave（首次）被调，onSave2（二次）未被绑：
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('改')
    expect(onSave2).not.toHaveBeenCalled()
    document.body.removeChild(el)
  })

  it('blur 触发 _save 调 onSave 传 trim 后内容', () => {
    const el = makeEl()
    const onSave = vi.fn()
    const { startEditing } = useInlineEdit()
    startEditing(el, '原', { onSave })
    el.textContent = '  模糊保存  '
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    // line 58 _save 走 _el.textContent?.trim() ?? '' —— 首尾空白被 trim
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('模糊保存')
    document.body.removeChild(el)
  })

  it('_save trim：全空白 contentText 被 trim 成空串经 onSave（不 trim 会传出空白）', () => {
    const el = makeEl()
    const onSave = vi.fn()
    const { startEditing } = useInlineEdit()
    startEditing(el, '原', { onSave })
    el.textContent = '   \n\t  '
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(onSave).toHaveBeenCalledWith('')
    document.body.removeChild(el)
  })

  it('multiline=true + Enter 不调 onSave（允许换行不保存）', () => {
    const el = makeEl()
    const onSave = vi.fn()
    const onCancel = vi.fn()
    const { startEditing } = useInlineEdit()
    startEditing(el, '原', { onSave, onCancel, multiline: true })
    el.textContent = '第一行'
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    // line 91 !_multiline 短路：multiline 时不进 Enter-save 分支
    expect(onSave).not.toHaveBeenCalled()
    // 仍处编辑态（未 teardown）
    expect(el.getAttribute('contenteditable')).toBe('true')
    // Escape 仍可正常取消
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    document.body.removeChild(el)
  })

  it('单行（默认 multiline=false）+ Shift+Enter 不调 onSave（换行不保存）', () => {
    const el = makeEl()
    const onSave = vi.fn()
    const { startEditing } = useInlineEdit()
    startEditing(el, '原', { onSave }) // multiline 默认 false
    el.textContent = '改'
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    // line 91 !ev.shiftKey 短路：Shift+Enter 不 save
    expect(onSave).not.toHaveBeenCalled()
    expect(el.getAttribute('contenteditable')).toBe('true')
    // 后续纯 Enter 仍正常保存（证明 guard 是 shiftKey 门控非整体禁用 Enter）
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onSave).toHaveBeenCalledTimes(1)
    document.body.removeChild(el)
  })

  it('Escape 无 onCancel 不抛、仍 teardown 还原原值', () => {
    const el = makeEl()
    const onSave = vi.fn() // 不传 onCancel
    const { startEditing } = useInlineEdit()
    startEditing(el, '原始值', { onSave })
    el.textContent = '改了一半'
    // line 88 cancel?.() —— cancel = _onCancel = null，?.() 短路不抛
    expect(() =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    ).not.toThrow()
    // _cancel 走 line 78 _el.textContent = _originalValue 还原
    expect(el.textContent).toBe('原始值')
    expect(onSave).not.toHaveBeenCalled()
    // teardown line 47 移除 contenteditable
    expect(el.getAttribute('contenteditable')).toBeNull()
    document.body.removeChild(el)
  })
})
