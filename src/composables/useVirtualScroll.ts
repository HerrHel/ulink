import { ref, computed, onMounted, onUnmounted, watch, unref, type Ref, type MaybeRef, shallowRef, isRef, type CSSProperties } from 'vue'
import { createBoundedCache } from '../lib/boundedCache.js'

interface VirtualScrollOptions {
  /** 固定行高；可传 Ref 以响应布局/断点变化（A1-005） */
  itemHeight?: MaybeRef<number>
  /** 初始估算高度；实际以 scroll 容器 clientHeight + ResizeObserver 为准 */
  containerHeight?: number
  overscan?: number
  /** 真实滚动根（CardGrid 外层 #panelContent 才有 overflow-y:auto） */
  scrollRootSelector?: string
}

/**
 * useVirtualScroll — 虚拟滚动 composable
 * 仅在数据量超过阈值时由调用方激活。
 * PERF-2：默认绑定 #panelContent（真正的 overflow 容器），而非 grid 自身。
 * 优化：itemHeight 使用 shallowRef 避免深层响应式开销；visibleItems 仅在必要时重算。
 */
export function useVirtualScroll<T>(items: Ref<T[]>, options: VirtualScrollOptions = {}) {
  const {
    itemHeight: itemHeightOpt = 120,
    containerHeight: initialHeight = 600,
    overscan = 5,
    scrollRootSelector = '#panelContent',
  } = options

  // A1-005：支持响应式行高，避免 setup 时 isMobile 写死
  // 使用 shallowRef 避免深层响应式开销（itemHeight 仅为数字）
  const itemHeight = shallowRef(unref(itemHeightOpt))
  if (isRef(itemHeightOpt)) {
    // 若传入为 ref/computed，建立同步而非嵌套 computed
    watch(itemHeightOpt, (v) => { itemHeight.value = v })
  }

  const scrollTop = ref(0)
  const measuredHeight = ref(initialHeight)
  const containerRef = ref<HTMLElement | null>(null)

  let scrollEl: HTMLElement | null = null
  let ro: ResizeObserver | null = null
  // onScroll rAF 合并：scroll 高频事件（fling 每帧多次）合并为每帧最多 1 次更新，
  // 避免每 scroll 事件都同步触发 watch(flush:'sync') 重建 visibleItems（spread+push+
  // 重写数组+grid 重渲染），在 1000+ 卡分类滚动时掉帧。rAF 在 scroll El 失联或卸载时取消。
  let scrollRafId = 0

  const visibleCount = computed(
    () => Math.ceil(measuredHeight.value / itemHeight.value) + overscan * 2
  )
  const startIndex = computed(() =>
    Math.max(0, Math.floor(scrollTop.value / itemHeight.value) - overscan)
  )
  const endIndex = computed(() =>
    Math.min(items.value.length, startIndex.value + visibleCount.value)
  )

  // 使用 shallowRef 缓存 visibleItems，仅当 startIndex/endIndex/itemHeight 变化时重算
  const visibleItems = ref<Array<T & { _virtualIndex: number; _virtualStyle: CSSProperties }>>([])
  const totalHeight = computed(() => items.value.length * itemHeight.value)

  // 缓存 style 对象：key = `i:${i}|h:${h}`，避免每次重建创建新对象。
  // 必须加上界：原裸 Map 只写不逐出，长会话滚动到大分类时随每触达 index 线性单调
  // 增长（PC↔移动端 itemHeight 切换则新建整族键旧族永不释放）—— 真内存泄漏。
  // CACHE_MAX=200 覆盖滚动窗口外 overscan 余量仍有充足复用，LRU 淘汰最旧封死无界增长。
  const CACHE_MAX = 200
  const _styleCache = createBoundedCache<string, CSSProperties>(CACHE_MAX)

  function rebuildVisibleItems() {
    const h = itemHeight.value
    const start = startIndex.value
    const end = endIndex.value
    const arr: Array<T & { _virtualIndex: number; _virtualStyle: CSSProperties }> = []
    for (let i = start; i < end; i++) {
      const styleKey = `i:${i}|h:${h}`
      let style = _styleCache.get(styleKey)
      if (!style) {
        style = {
          position: 'absolute' as const,
          top: `${i * h}px`,
          height: `${h}px`,
          width: '100%',
          left: '0',
        }
        _styleCache.set(styleKey, style)
      }
      arr.push({
        ...items.value[i],
        _virtualIndex: i,
        _virtualStyle: style,
      })
    }
    visibleItems.value = arr
  }

  // 仅在依赖变化时重建。
  // 必须把 items 本身纳入依赖：endIndex 仅依赖 items.value.length，当过滤等长切换导致
  // items 引用变而长度不变时，endIndex 不变 → 不重建 → 列表显示陈旧（滚一下才自愈）。
  watch([startIndex, endIndex, itemHeight, items], rebuildVisibleItems, { flush: 'sync' })

  function onScroll() {
    // 已有 rAF 在途 → 本帧已 sched 合并，跳过新调度；下一个 rAF 会读最新 scrollTop
    if (scrollRafId || !scrollEl) return
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = 0
      if (scrollEl) scrollTop.value = scrollEl.scrollTop
    })
  }

  function bindScrollRoot(el: HTMLElement | null) {
    if (scrollEl) {
      scrollEl.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      ro = null
    }
    // 取消在途 rAF：unbind/卸载后 scrollEl 置空，rAF 回调内 `if (scrollEl)` 虽已兜底，
    // 但留着悬挂 rafId 会让 onScroll 误判「已在途」而吞掉清空后的合理重调度（生命周期尾收口）。
    if (scrollRafId) {
      cancelAnimationFrame(scrollRafId)
      scrollRafId = 0
    }
    scrollEl = el
    if (!scrollEl) return
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    measuredHeight.value = scrollEl.clientHeight || initialHeight
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (scrollEl) measuredHeight.value = scrollEl.clientHeight || initialHeight
      })
      ro.observe(scrollEl)
    }
  }

  onMounted(() => {
    const el =
      (containerRef.value as HTMLElement | null) ||
      (document.querySelector(scrollRootSelector) as HTMLElement | null)
    bindScrollRoot(el)
  })

  onUnmounted(() => {
    bindScrollRoot(null)
  })

  // 列表变短时若 scrollTop 超出总高，钳制以免空白
  watch(totalHeight, (h) => {
    if (scrollEl && scrollEl.scrollTop > Math.max(0, h - measuredHeight.value)) {
      scrollEl.scrollTop = Math.max(0, h - measuredHeight.value)
      scrollTop.value = scrollEl.scrollTop
    }
  })

  /** 滚动到指定数据索引（键盘跨屏导航用；未挂载时静默） */
  function scrollToIndex(index: number) {
    if (!scrollEl) return
    const h = itemHeight.value
    const target = Math.max(0, Math.min(index, Math.max(0, items.value.length - 1))) * h
    scrollEl.scrollTop = target
    scrollTop.value = target
  }

  return {
    containerRef,
    visibleItems,
    totalHeight,
    startIndex,
    endIndex,
    measuredHeight,
    scrollToIndex,
  }
}
