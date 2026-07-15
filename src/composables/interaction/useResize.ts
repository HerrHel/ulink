/**
 * useResize — 面板宽度拖拽调整
 * 管理左侧导航栏和右侧详情面板的 resize handle 拖拽逻辑。
 * 从 app-legacy.js IIFE 提取。
 */
import { onMounted, onUnmounted } from 'vue'

export function useResize() {
  onMounted(() => {
    const leftHandle = document.getElementById('resizeLeft')
    const rightHandle = document.getElementById('resizeRight')
    const leftPanel = document.querySelector('.icon-rail') as HTMLElement
    const rightPanel = document.getElementById('detailPanel')
    if (!leftHandle || !rightHandle || !leftPanel || !rightPanel) return

    // 恢复保存的宽度
    const savedLeft = localStorage.getItem('lv_railWidth')
    const savedRight = localStorage.getItem('lv_detailWidth')
    if (savedLeft) leftPanel.style.width = savedLeft + 'px'
    if (savedRight) rightPanel.style.setProperty('--detail-width', savedRight + 'px')

    let raf: number | null = null
    let handle: HTMLElement | null = null
    let panel: HTMLElement | null = null
    let dir: number | null = null
    let startX = 0
    let startW = 0

    function onMove(e: MouseEvent) {
      if (!handle || !panel || !dir) return
      cancelAnimationFrame(raf!)
      raf = requestAnimationFrame(() => {
        if (!handle || !panel || dir == null) return
        const delta = (e.clientX - startX) * dir!
        const min = dir! > 0 ? 120 : 200
        const max = dir! > 0 ? 500 : 600
        const w = Math.max(min, Math.min(startW + delta, max))
        if (panel === leftPanel) {
          panel.style.width = w + 'px'
        } else {
          panel.style.setProperty('--detail-width', w + 'px')
          if (panel.classList.contains('open')) panel.style.width = w + 'px'
        }
      })
    }

    function onUp() {
      if (!handle || !panel) return
      handle.classList.remove('active')
      panel.style.transition = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (panel === leftPanel) {
        localStorage.setItem('lv_railWidth', String(parseInt(panel.style.width)))
      } else {
        localStorage.setItem('lv_detailWidth', String(parseInt(panel.style.getPropertyValue('--detail-width'))))
      }
      handle = panel = null
    }

    function onDown(e: MouseEvent, h: HTMLElement, p: HTMLElement, d: number) {
      handle = h
      panel = p
      dir = d
      handle.classList.add('active')
      panel.style.transition = 'none'
      startX = e.clientX
      startW = panel.getBoundingClientRect().width
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    const onLeftDown = (e: MouseEvent) => onDown(e, leftHandle, leftPanel, 1)
    const onRightDown = (e: MouseEvent) => onDown(e, rightHandle, rightPanel, -1)

    leftHandle.addEventListener('mousedown', onLeftDown)
    rightHandle.addEventListener('mousedown', onRightDown)

    onUnmounted(() => {
      cancelAnimationFrame(raf!)
      handle = null; panel = null
      leftHandle.removeEventListener('mousedown', onLeftDown)
      rightHandle.removeEventListener('mousedown', onRightDown)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    })
  })
}
