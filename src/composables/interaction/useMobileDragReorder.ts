/**
 * useMobileDragReorder — 移动端拖拽排序（通用）
 * 纯 pointer events 实现，iOS 原生风格：
 * - 原元素直接跟手，无克隆体
 * - 仅 Y 轴移动
 * - 其他卡片平滑让位
 * - 边缘持续滚动（列表 + 页面）
 */
import { onMounted, onUnmounted, type Ref, computed } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { toast } from '../../lib/toast.js'
import { isMobile } from '../../utils.js'

const EDGE_ZONE = 60     // 触发滚动的边缘区域 px
const MAX_SCROLL_SPEED = 12 // 最大滚动速度 px/frame

interface DragState {
  el: HTMLElement
  placeholder: HTMLDivElement
  startY: number
  initialTop: number
  lastY: number
  itemHeight: number
  itemIndex: number
  currentIndex: number
  pointerId: number
}

interface UseMobileDragReorderOptions {
  enabled?: Ref<boolean>
  handleSelector?: string | null
  itemSelector?: string
  onReorder?: ((list: unknown, from: number, to: number) => void) | null
  placeholderClass?: string
  draggingClass?: string
}

export function useMobileDragReorder(containerRef: Ref<HTMLElement | null>, listRef: Ref<any[]>, options: UseMobileDragReorderOptions = {}) {
  const store = useAppStore()
  const dataStore = useDataStore()

  const {
    enabled = computed(() => store.batchMode && isMobile()),
    handleSelector = '.batch-drag-handle',
    itemSelector = '.card, .group-card',
    onReorder = null,
    placeholderClass = 'card card-drag-placeholder',
    draggingClass = 'card-is-dragging'
  } = options

  let drag: DragState | null = null
  let scrollRaf: number | null = null
  let _prevY = 0

  function getItems(): Element[] {
    if (!containerRef.value) return []
    return Array.from(containerRef.value.children).filter(c => (c as HTMLElement).matches?.(itemSelector))
  }

  // 找到实际的滚动容器（.panel-content 或最近的可滚动祖先）
  function getScrollContainer(): HTMLElement | null {
    if (!containerRef.value) return null
    let el = containerRef.value.parentElement
    while (el) {
      const style = getComputedStyle(el)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') return el
      el = el.parentElement
    }
    return null
  }

  // ── rAF 循环：统一更新卡片位置 + 边缘滚动 ──
  function scrollLoop() {
    if (!drag) { scrollRaf = null; return }

    // 1. 设置卡片位置（只跟手指，不跟滚动）
    const cardTop = drag.initialTop + (drag.lastY - drag.startY)
    drag.el.style.top = cardTop + 'px'

    // 2. 更新占位符
    //    向上拖：用卡片顶部与目标 midpoint 比较（顶部先越过）
    //    向下拖：用卡片底部与目标 midpoint 比较（底部先越过）
    const draggingDown = drag.lastY > _prevY
    _prevY = drag.lastY
    const leadEdge = draggingDown ? cardTop + drag.itemHeight : cardTop
    const allCards = getItems().filter(c => c !== drag!.el)
    let newIndex = allCards.length
    for (let i = 0; i < allCards.length; i++) {
      if (allCards[i] === drag!.placeholder) continue
      const rect = allCards[i].getBoundingClientRect()
      if (leadEdge < rect.top + rect.height / 2) {
        newIndex = i
        break
      }
    }
    if (newIndex !== drag.currentIndex) {
      drag.currentIndex = newIndex
      const refEl = allCards[newIndex]
      if (refEl) containerRef.value!.insertBefore(drag.placeholder, refEl)
      else containerRef.value!.appendChild(drag.placeholder)
    }

    // 3. 边缘滚动（只滚列表，不动卡片）
    const scrollEl = getScrollContainer()
    if (scrollEl) {
      const y = drag.lastY
      const scrollRect = scrollEl.getBoundingClientRect()
      let delta = 0

      if (y - scrollRect.top < EDGE_ZONE && scrollEl.scrollTop > 0) {
        const ratio = 1 - Math.max(0, y - scrollRect.top) / EDGE_ZONE
        delta = -Math.round(MAX_SCROLL_SPEED * ratio)
      } else if (scrollRect.bottom - y < EDGE_ZONE) {
        const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop
        if (maxScroll > 0) {
          const ratio = 1 - Math.max(0, scrollRect.bottom - y) / EDGE_ZONE
          delta = Math.min(Math.round(MAX_SCROLL_SPEED * ratio), maxScroll)
        }
      }

      if (delta) {
        scrollEl.scrollTop += delta
      }
    }

    scrollRaf = requestAnimationFrame(scrollLoop)
  }

  function startScroll() {
    if (!scrollRaf) scrollRaf = requestAnimationFrame(scrollLoop)
  }

  function stopScroll() {
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = null }
  }

  // ── 拖拽事件 ──
  function onPointerDown(e: PointerEvent) {
    if (!enabled.value) return
    
    let item: HTMLElement | null = null
    if (handleSelector) {
      const handle = (e.target as HTMLElement).closest(handleSelector)
      if (!handle) return
      item = handle.closest(itemSelector) as HTMLElement
    } else {
      item = (e.target as HTMLElement).closest(itemSelector) as HTMLElement
    }
    if (!item || !containerRef.value) return

    e.preventDefault()
    item.setPointerCapture(e.pointerId)

    const rect = item.getBoundingClientRect()
    const allItems = getItems()
    const idx = allItems.indexOf(item)

    // 创建占位符
    const ph = document.createElement('div')
    ph.className = placeholderClass
    ph.style.height = rect.height + 'px'
    ph.style.margin = getComputedStyle(item).marginBottom
    item.parentNode!.insertBefore(ph, item)

    // 原元素改为 fixed 定位，保留完整 CSS 上下文
    item.classList.add(draggingClass)
    item.style.position = 'fixed'
    item.style.left = rect.left + 'px'
    item.style.top = rect.top + 'px'
    item.style.width = rect.width + 'px'
    item.style.margin = '0'
    item.style.zIndex = '9999'
    item.style.transition = 'none'

    drag = {
      el: item,
      placeholder: ph,
      startY: e.clientY,
      initialTop: rect.top,
      lastY: e.clientY,
      itemHeight: rect.height,
      itemIndex: idx,
      currentIndex: idx,
      pointerId: e.pointerId
    }
    _prevY = e.clientY
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return
    e.preventDefault()
    drag.lastY = e.clientY
    startScroll()
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return
    const d = drag
    drag = null
    stopScroll()

    // 基于最终位置重新计算目标索引
    const cardTop = d.initialTop + (d.lastY - d.startY)
    const draggingDown = d.lastY > d.startY
    const leadEdge = draggingDown ? cardTop + d.itemHeight : cardTop
    // allCards 排除被拖拽项和占位符
    const allCards = getItems().filter(c => c !== d.el && c !== d.placeholder)
    let filteredToIdx = allCards.length
    for (let i = 0; i < allCards.length; i++) {
      const rect = allCards[i].getBoundingClientRect()
      if (leadEdge < rect.top + rect.height / 2) { filteredToIdx = i; break }
    }

    // 映射：过滤列表索引 → 完整列表索引
    // 过滤列表排除了被拖拽项，所以目标在被拖拽项之后时需要 +1
    const fromIndex = d.itemIndex
    let toIndex = filteredToIdx
    if (filteredToIdx > fromIndex) toIndex = filteredToIdx + 1

    const arr = listRef.value

    // 移除占位符
    d.placeholder.remove()

    // 恢复原元素样式
    d.el.classList.remove(draggingClass)
    d.el.style.position = ''
    d.el.style.left = ''
    d.el.style.top = ''
    d.el.style.width = ''
    d.el.style.margin = ''
    d.el.style.zIndex = ''
    d.el.style.transition = ''

    if (fromIndex !== toIndex) {
      if (onReorder) {
        onReorder(null, fromIndex, toIndex)
      } else {
        const movedItem = arr[fromIndex]
        if (!movedItem) return

        // 在完整列表上操作：先删后插
        const allItems = arr.slice()
        allItems.splice(fromIndex, 1)
        allItems.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, movedItem)

        // 保存自定义顺序 + 更新 order 值
        allItems.forEach((it, i) => { it.data.order = i })
        const newOrder: Array<{ t: 'g' | 'b'; id: string }> = allItems.map(it => ({ t: it.type === 'group' ? 'g' : 'b', id: it.data.id }))

        dataStore._customCardOrder = newOrder
        const uiStore = useUIStore()
        if (uiStore.sortMode !== 'order') uiStore.sortMode = 'order'
        uiStore.saveUIState()
        store.save()
        toast('排序已更新')
      }
    }
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown, { passive: false })
    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)
  })

  onUnmounted(() => {
    stopScroll()
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)
  })
}
