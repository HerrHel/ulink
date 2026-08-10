/**
 * useResize — 面板宽度拖拽调整
 * 管理左侧导航栏和右侧详情面板的 resize handle 拖拽逻辑。
 * 从 app-legacy.js IIFE 提取。
 */
import { onMounted, onUnmounted } from 'vue'
import { safeGetItem, safeSetItem } from '../../lib/storageSafe.js'

/**
 * 解析面板宽度样式的数值（如 '320px' → 320）。
 * 空字符串 / 无效值 / NaN 时返回 null —— 调用方据此跳过持久化，
 * 避免 'NaNpx' 落入 localStorage 致宽度记忆永久损坏
 * （mousedown 后未移动直接 mouseup 时 style.width 可能为空）。
 */
export function parseWidthPx(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

export function useResize() {
  onMounted(() => {
    const leftHandle = document.getElementById('resizeLeft')
    const rightHandle = document.getElementById('resizeRight')
    const leftPanel = document.querySelector('.icon-rail') as HTMLElement
    const rightPanel = document.getElementById('detailPanel')
    if (!leftHandle || !rightHandle || !leftPanel || !rightPanel) return

    // 恢复保存的宽度
    const savedLeft = safeGetItem('lv_railWidth')
    const savedRight = safeGetItem('lv_detailWidth')
    if (savedLeft) leftPanel.style.width = savedLeft + 'px'
    if (savedRight) rightPanel.style.setProperty('--detail-width', savedRight + 'px')

    let raf: number | null = null
    let handle: HTMLElement | null = null
    let panel: HTMLElement | null = null
    let dir: number | null = null
    let startX = 0
    let startW = 0
    // 最后一次 mousemove 的 clientX，供 onUp 同步 flush 用：onUp 在 mouseup 事件阶段
    // 同步执行，早于最后一次 mousemove 排入的 rAF 回调（rAF 在下一帧渲染前才跑），
    // 若不 flush 直接读 panel.style.width 持久化，最后一次 delta 会丢失，存进
    // localStorage 的是比松手位置略小的宽度。
    let lastClientX = 0

    // 把拖拽 delta 同步应用到面板样式。提取出 rAF 回调与 onUp flush 共用，
    // 保证两条路径写 width 的逻辑完全一致。
    function applyDelta() {
      if (!panel || dir == null) return
      const delta = (lastClientX - startX) * dir
      const min = dir > 0 ? 120 : 200
      const max = dir > 0 ? 500 : 600
      const w = Math.max(min, Math.min(startW + delta, max))
      if (panel === leftPanel) {
        panel.style.width = w + 'px'
      } else {
        panel.style.setProperty('--detail-width', w + 'px')
        if (panel.classList.contains('open')) panel.style.width = w + 'px'
      }
    }

    function onMove(e: MouseEvent) {
      if (!handle || !panel || !dir) return
      lastClientX = e.clientX
      cancelAnimationFrame(raf!)
      raf = requestAnimationFrame(() => {
        if (!handle || !panel || dir == null) return
        applyDelta()
      })
    }

    function onUp() {
      if (!handle || !panel) return
      // flush 最后一次 pending rAF：mouseup 早于最后一次 mousemove 排入的 rAF 回调，
      // 不 cancel 同步 applyDelta 一次会让持久化读到旧 width（最后一次 delta 丢失）。
      // cancel 后 applyDelta 用 lastClientX 同步把最终宽度写进 style，再读持久化。
      if (raf != null) {
        cancelAnimationFrame(raf)
        raf = null
        applyDelta()
      }
      handle.classList.remove('active')
      panel.style.transition = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (panel === leftPanel) {
        const w = parseWidthPx(panel.style.width)
        if (w != null) safeSetItem('lv_railWidth', String(w))
      } else {
        const w = parseWidthPx(panel.style.getPropertyValue('--detail-width'))
        if (w != null) safeSetItem('lv_detailWidth', String(w))
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
