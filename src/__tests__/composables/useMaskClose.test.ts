import { describe, it, expect, vi } from 'vitest'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'

// 改用真实 DOM 事件派发（addEventListener + dispatchEvent），不再用 Object.defineProperty
// 伪造只读的 currentTarget：浏览器在事件派发结束后会把 currentTarget 置 null，
// 只有真实派发才能覆盖「驱动必须在同步阶段缓存遮罩元素」这一真实生命周期
//（写法对齐 regression-20261109.test.ts 里已通过的用例）。
describe('useMaskClose', () => {
  // 把遮罩挂到 document.body：detached 元素的事件不会冒泡到 window，
  // 而 useMaskClose 的全局 mouseup 监听挂在 window 上，必须用真实冒泡链。
  function mountMask(onClose: () => void) {
    const { onMaskMouseDown, onMaskClick } = useMaskClose(onClose)
    const maskEl = document.createElement('div')
    document.body.appendChild(maskEl)
    maskEl.addEventListener('mousedown', onMaskMouseDown)
    maskEl.addEventListener('click', onMaskClick)
    return { maskEl, cleanup: () => maskEl.remove() }
  }

  it('正常在遮罩层点击（mousedown + mouseup + click 均在遮罩）应触发 onClose', () => {
    const onClose = vi.fn()
    const { maskEl, cleanup } = mountMask(onClose)
    try {
      // mousedown 在遮罩：target===currentTarget===maskEl → 进入待关闭态
      maskEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      // mouseup 也在遮罩：冒泡到 window 的全局监听看到 target===maskEl，不取消待关闭态
      maskEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      // click 派发到遮罩：派发结束后 currentTarget 已为 null，但驱动在 mousedown 阶段缓存了元素
      maskEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      cleanup()
    }
  })

  it('在内部元素（如 input 框选文本）按下并拖到遮罩层松开，不应触发 onClose', () => {
    const onClose = vi.fn()
    const { maskEl, cleanup } = mountMask(onClose)
    const inputEl = document.createElement('input')
    maskEl.appendChild(inputEl)
    try {
      // mousedown 发生在 input，冒泡到 maskEl：target(input)!==currentTarget(mask) → 不进入待关闭态
      inputEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      maskEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      // 浏览器把 click 派发给最近公共祖先 maskEl
      maskEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it('在遮罩层按下但拖入弹窗内部松开，不应触发 onClose', () => {
    const onClose = vi.fn()
    const { maskEl, cleanup } = mountMask(onClose)
    const modalEl = document.createElement('div')
    maskEl.appendChild(modalEl)
    try {
      maskEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      // mouseup 发生在内部弹窗：冒泡到 window 的全局监听看到 target(modal)!==maskEl → 取消待关闭态
      modalEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      maskEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })
})
