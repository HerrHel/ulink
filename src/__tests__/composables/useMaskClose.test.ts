import { describe, it, expect, vi } from 'vitest'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'

describe('useMaskClose', () => {
  it('正常在遮罩层点击（mousedown + mouseup + click 均在遮罩）应触发 onClose', () => {
    const onClose = vi.fn()
    const { onMaskMouseDown, onMaskClick } = useMaskClose(onClose)

    const maskEl = document.createElement('div')
    const mousedownEv = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(mousedownEv, 'target', { value: maskEl })
    Object.defineProperty(mousedownEv, 'currentTarget', { value: maskEl })

    onMaskMouseDown(mousedownEv)

    const mouseupEv = new MouseEvent('mouseup', { bubbles: true })
    Object.defineProperty(mouseupEv, 'target', { value: maskEl })
    window.dispatchEvent(mouseupEv)

    const clickEv = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(clickEv, 'target', { value: maskEl })
    Object.defineProperty(clickEv, 'currentTarget', { value: maskEl })

    onMaskClick(clickEv)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('在内部元素（如 input 框选文本）按下并拖到遮罩层松开，不应触发 onClose', () => {
    const onClose = vi.fn()
    const { onMaskMouseDown, onMaskClick } = useMaskClose(onClose)

    const maskEl = document.createElement('div')
    const inputEl = document.createElement('input')
    maskEl.appendChild(inputEl)

    // mousedown 发生在 input 上，冒泡到 maskEl
    const mousedownEv = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(mousedownEv, 'target', { value: inputEl })
    Object.defineProperty(mousedownEv, 'currentTarget', { value: maskEl })

    onMaskMouseDown(mousedownEv)

    // mouseup 发生在遮罩层
    const mouseupEv = new MouseEvent('mouseup', { bubbles: true })
    Object.defineProperty(mouseupEv, 'target', { value: maskEl })
    window.dispatchEvent(mouseupEv)

    // 浏览器分发 click 给公共祖先 maskEl
    const clickEv = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(clickEv, 'target', { value: maskEl })
    Object.defineProperty(clickEv, 'currentTarget', { value: maskEl })

    onMaskClick(clickEv)

    // 重点：绝不能触发关闭！
    expect(onClose).not.toHaveBeenCalled()
  })

  it('在遮罩层按下但拖入弹窗内部松开，不应触发 onClose', () => {
    const onClose = vi.fn()
    const { onMaskMouseDown, onMaskClick } = useMaskClose(onClose)

    const maskEl = document.createElement('div')
    const modalEl = document.createElement('div')
    maskEl.appendChild(modalEl)

    // mousedown 发生在遮罩层
    const mousedownEv = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(mousedownEv, 'target', { value: maskEl })
    Object.defineProperty(mousedownEv, 'currentTarget', { value: maskEl })

    onMaskMouseDown(mousedownEv)

    // mouseup 发生在内部弹窗 modalEl
    const mouseupEv = new MouseEvent('mouseup', { bubbles: true })
    Object.defineProperty(mouseupEv, 'target', { value: modalEl })
    window.dispatchEvent(mouseupEv)

    // click 分发到 maskEl
    const clickEv = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(clickEv, 'target', { value: maskEl })
    Object.defineProperty(clickEv, 'currentTarget', { value: maskEl })

    onMaskClick(clickEv)

    // 不应触发关闭
    expect(onClose).not.toHaveBeenCalled()
  })
})
