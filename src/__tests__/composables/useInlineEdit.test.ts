/**
 * E3-003：Escape 须在 teardown 清空回调之前调用 onCancel
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
