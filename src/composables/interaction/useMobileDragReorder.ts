/**
 * useMobileDragReorder — 移动端拖拽排序（通用）
 * 纯 pointer events 实现，iOS 原生风格：
 * - 原元素直接跟手，无克隆体
 * - 仅 Y 轴移动
 * - 其他卡片平滑让位
 * - 边缘持续滚动（列表 + 页面）
 */
import { onMounted, onUnmounted, type Ref, computed } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { saveAppData } from '../../stores/app.js'
import { toast } from '../../lib/toast.js'
import { isMobile } from '../../utils.js'

const EDGE_ZONE = 60     // 触发滚动的边缘区域 px
const MAX_SCROLL_SPEED = 12 // 最大滚动速度 px/frame

/**
 * H12：区间 order 更新（splice 后的 allItems 上调用）。
 * fromIndex / toIdx 为 splice 前的 from 与 splice 后的目标索引（toIdx 已是「插入后」位置）。
 * 下移：[fromIndex, toIdx) 各 order--，moved 取区间末邻项的原 order；
 * 上移：(toIdx, fromIndex] 各 order++，moved 取区间首邻项的原 order。
 * 保证移动后区间内 order 唯一且相对序正确（连续或带间隙均可）。
 */
export function applyIntervalOrder(
  allItems: Array<{ data: { id: string; order: number } }>,
  fromIndex: number,
  toIdx: number,
  markDirty: (id: string) => void,
): void {
  const movedItem = allItems[toIdx]
  if (!movedItem || fromIndex === toIdx) return
  if (fromIndex < toIdx) {
    const targetOrder = allItems[toIdx - 1].data.order
    for (let k = fromIndex; k < toIdx; k++) {
      allItems[k].data.order--
      markDirty(allItems[k].data.id)
    }
    movedItem.data.order = targetOrder
    markDirty(movedItem.data.id)
  } else {
    const targetOrder = allItems[toIdx + 1].data.order
    for (let k = toIdx + 1; k <= fromIndex; k++) {
      allItems[k].data.order++
      markDirty(allItems[k].data.id)
    }
    movedItem.data.order = targetOrder
    markDirty(movedItem.data.id)
  }
}

interface DragState {
  el: HTMLElement
  placeholder: HTMLDivElement
  /** portal 到 body 时记录原父节点，pointerup 时移回占位符位置 */
  originalParent: HTMLElement | null
  startY: number
  initialTop: number
  lastY: number
  itemHeight: number
  itemIndex: number
  currentIndex: number
  pointerId: number
}

type ReorderFn = (from: number, to: number) => void

interface UseMobileDragReorderOptions {
  enabled?: Ref<boolean>
  handleSelector?: string | null
  itemSelector?: string
  /** 自定义落位回调。未提供时走默认卡片排序逻辑（CardItem / customCardOrder） */
  onReorder?: ReorderFn | null
  placeholderClass?: string
  draggingClass?: string
  /**
   * 拖拽期间把被拖元素移到 document.body 跟手。用于容器处于 transform / overflow:hidden
   * 祖先（如带进出场动画的 modal）内的列表：否则 fixed 定位会被 transform 祖先裁切，
   * 看不到跟手卡片。默认 false（CardGrid 列表无需 portal）。
   */
  portalToBody?: boolean
}

export function useMobileDragReorder(containerRef: Ref<HTMLElement | null>, listRef: Ref<any[]>, options: UseMobileDragReorderOptions = {}) {
  const uiStore = useUIStore()
  const dataStore = useDataStore()

  const {
    enabled = computed(() => uiStore.batchMode && isMobile()),
    handleSelector = '.batch-drag-handle',
    itemSelector = '.card, .group-card',
    onReorder = null,
    placeholderClass = 'card card-drag-placeholder',
    draggingClass = 'card-is-dragging',
    portalToBody = false
  } = options

  let drag: DragState | null = null
  let scrollRaf: number | null = null
  let _prevY = 0
  // PERF-6：缓存卡片 midY / 滚动容器 rect，避免每帧全量 getBoundingClientRect
  let _cachedMids: { el: Element; mid: number }[] = []
  let _midsDirty = true
  let _scrollRect: DOMRect | null = null
  let _scrollRectAt = 0

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

  function invalidateMids() { _midsDirty = true }

  function ensureMids(allCards: Element[]) {
    if (!_midsDirty && _cachedMids.length === allCards.length) {
      // 元素集合变化时仍重建
      let same = true
      for (let i = 0; i < allCards.length; i++) {
        if (_cachedMids[i]?.el !== allCards[i]) { same = false; break }
      }
      if (same) return
    }
    _cachedMids = allCards.map(el => {
      const r = el.getBoundingClientRect()
      return { el, mid: r.top + r.height / 2 }
    })
    _midsDirty = false
  }

  function getScrollRect(scrollEl: HTMLElement): DOMRect {
    const now = performance.now()
    // 边缘滚动改 scrollTop 后 top/bottom 不变，可复用；仅周期刷新
    if (!_scrollRect || now - _scrollRectAt > 100) {
      _scrollRect = scrollEl.getBoundingClientRect()
      _scrollRectAt = now
    }
    return _scrollRect
  }

  // ── rAF 循环：统一更新卡片位置 + 边缘滚动 ──
  function scrollLoop() {
    if (!drag) { scrollRaf = null; return }

    // 1. 设置卡片位置（只跟手指，不跟滚动）
    const cardTop = drag.initialTop + (drag.lastY - drag.startY)
    drag.el.style.top = cardTop + 'px'

    // 2. 更新占位符（用缓存 midY）
    const draggingDown = drag.lastY > _prevY
    _prevY = drag.lastY
    const leadEdge = draggingDown ? cardTop + drag.itemHeight : cardTop
    const allCards = getItems().filter(c => c !== drag!.el)
    ensureMids(allCards)
    let newIndex = allCards.length
    for (let i = 0; i < _cachedMids.length; i++) {
      if (_cachedMids[i].el === drag!.placeholder) continue
      if (leadEdge < _cachedMids[i].mid) {
        newIndex = i
        break
      }
    }
    if (newIndex !== drag.currentIndex) {
      drag.currentIndex = newIndex
      const refEl = allCards[newIndex]
      if (refEl) containerRef.value!.insertBefore(drag.placeholder, refEl)
      else containerRef.value!.appendChild(drag.placeholder)
      // 占位符移动后 mid 失效
      invalidateMids()
    }

    // 3. 边缘滚动（只滚列表，不动卡片）
    const scrollEl = getScrollContainer()
    if (scrollEl) {
      const y = drag.lastY
      const scrollRect = getScrollRect(scrollEl)
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
        // 滚动后卡片 mid 相对视口变化
        invalidateMids()
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

  /**
   * H14：统一清理拖拽视觉/状态（恢复 el 样式、移除 placeholder、stopScroll、drag=null）。
   * 不应用 reorder。供 onUnmounted / lostpointercapture / pointercancel 复用。
   */
  function cleanupDragState() {
    if (!drag) return
    const d = drag
    drag = null
    stopScroll()
    try { d.el.releasePointerCapture(d.pointerId) } catch { /* 已释放则忽略 */ }
    d.el.classList.remove(draggingClass)
    d.el.style.position = ''
    d.el.style.left = ''
    d.el.style.top = ''
    d.el.style.width = ''
    d.el.style.margin = ''
    d.el.style.zIndex = ''
    d.el.style.transition = ''
    // portal 到 body 的需先移回原容器，避免 body 残留游离节点
    if (d.originalParent) {
      // 占位符可能已不在 DOM；有则插到占位符前，无则 append
      if (d.placeholder.parentNode) d.originalParent.insertBefore(d.el, d.placeholder)
      else d.originalParent.appendChild(d.el)
    }
    d.placeholder.remove()
    _cachedMids = []
    _midsDirty = true
    _scrollRect = null
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

    // 创建占位符（插入到被拖项原位置之前，保持其他项索引不变）
    const ph = document.createElement('div')
    ph.className = placeholderClass
    ph.style.height = rect.height + 'px'
    ph.style.margin = getComputedStyle(item).marginBottom
    containerRef.value!.insertBefore(ph, item)

    // 原元素改为 fixed 定位，保留完整 CSS 上下文
    item.classList.add(draggingClass)
    item.style.position = 'fixed'
    item.style.left = rect.left + 'px'
    item.style.top = rect.top + 'px'
    item.style.width = rect.width + 'px'
    item.style.margin = '0'
    item.style.zIndex = '9999'
    item.style.transition = 'none'

    // 容器若处于 transform / overflow:hidden 祖先下（modal 动画），
    // fixed 会被该祖先裁切且坐标基准偏移——移到 body 才能正常跟手。
    const originalParent = portalToBody ? item.parentElement : null
    if (portalToBody) document.body.appendChild(item)

    drag = {
      el: item,
      placeholder: ph,
      originalParent,
      startY: e.clientY,
      initialTop: rect.top,
      lastY: e.clientY,
      itemHeight: rect.height,
      itemIndex: idx,
      currentIndex: idx,
      pointerId: e.pointerId
    }
    _prevY = e.clientY
    invalidateMids()
    _scrollRect = null
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return
    e.preventDefault()
    drag.lastY = e.clientY
    startScroll()
  }

  /**
   * 正常松手：按最终位置应用 reorder，再清理视觉状态。
   * 规范保证 pointerup 先于 lostpointercapture，故先消费 drag 再 cleanup 不会丢落点。
   */
  function onPointerUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return
    const d = drag
    // 先置 null 阻断 rAF / 后续 lostpointercapture 二次处理
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

    // 恢复被拖元素到列表：portal 到 body 的需移回原容器（用占位符定位）
    if (d.originalParent) {
      d.originalParent.insertBefore(d.el, d.placeholder)
    }

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
    _cachedMids = []
    _midsDirty = true
    _scrollRect = null

    if (fromIndex !== toIndex) {
      // 置顶项不能与非置顶项交叉拖拽
      const arr = listRef.value
      const movedItem = arr[fromIndex]
      const targetItem = arr[toIndex > fromIndex ? toIndex - 1 : toIndex]
      if (movedItem && targetItem) {
        const movedPinned = !!(movedItem.data?.pinnedAt)
        const targetPinned = !!(targetItem.data?.pinnedAt)
        if (movedPinned !== targetPinned) {
          // 置顶状态不同，取消排序
          return
        }
      }

      if (onReorder) {
        onReorder(fromIndex, toIndex)
      } else {
        const movedItem = arr[fromIndex]
        if (!movedItem) return

        // 在完整列表上操作：先删后插
        const allItems = arr.slice()
        allItems.splice(fromIndex, 1)
        allItems.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, movedItem)

        // 保存自定义顺序 + 更新 order 值 + 标记 dirty
        // B-6：只更新受影响区间的 order，不全员重排。
        // H12：见 applyIntervalOrder（下移取邻项 order、区间循环不误改 moved 自身）
        const toIdx = toIndex > fromIndex ? toIndex - 1 : toIndex
        applyIntervalOrder(allItems, fromIndex, toIdx, (id) => dataStore._markDirty(id))
        const newOrder: Array<{ t: 'g' | 'b'; id: string }> = allItems.map(it => ({ t: it.type === 'group' ? 'g' : 'b', id: it.data.id }))

        dataStore._customCardOrder = newOrder
        const uiStore = useUIStore()
        if (uiStore.sortMode !== 'order') uiStore.sortMode = 'order'
        uiStore.saveUIState()
        saveAppData()
        toast('排序已更新')
      }
    }
  }

  /**
   * H14：capture 被系统回收且未走 pointerup 时（切 tab / 系统手势抢占 / 部分 WebView），
   * 仅会派发 lostpointercapture。若不清理，drag 非 null → scrollLoop 持续 rAF + 边缘滚动泄漏。
   * 规范：pointerup 先于 lostpointercapture；正常松手时 drag 已被 onPointerUp 置 null，此处 no-op。
   * pointercancel 语义是中断而非确认落点，同样只清理不应用 reorder。
   */
  function onPointerCancelOrLost(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return
    cleanupDragState()
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown, { passive: false })
    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancelOrLost)
    // lostpointercapture 冒泡，document 级可捕获任意 el 上 setPointerCapture 后的丢失
    document.addEventListener('lostpointercapture', onPointerCancelOrLost)
  })

  onUnmounted(() => {
    // 清理拖拽中途被卸载的残留：固定定位的卡片 + 占位符 + pointer capture + rAF。
    // 否则若组件在拖拽中销毁（如切视图/退出批量模式），drag.el 仍 fixed 漂在
    // viewport 上、drag.placeholder 仍占位，形成幽灵节点直到容器被整体移除。
    cleanupDragState()
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerCancelOrLost)
    document.removeEventListener('lostpointercapture', onPointerCancelOrLost)
  })
}
