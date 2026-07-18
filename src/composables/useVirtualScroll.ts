import { ref, computed, onMounted, onUnmounted, watch, unref, type Ref, type MaybeRef } from 'vue'

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
 */
export function useVirtualScroll<T>(items: Ref<T[]>, options: VirtualScrollOptions = {}) {
  const {
    itemHeight: itemHeightOpt = 120,
    containerHeight: initialHeight = 600,
    overscan = 5,
    scrollRootSelector = '#panelContent',
  } = options

  // A1-005：支持响应式行高，避免 setup 时 isMobile 写死
  const itemHeight = computed(() => unref(itemHeightOpt))

  const scrollTop = ref(0)
  const measuredHeight = ref(initialHeight)
  const containerRef = ref<HTMLElement | null>(null)

  let scrollEl: HTMLElement | null = null
  let ro: ResizeObserver | null = null

  const visibleCount = computed(
    () => Math.ceil(measuredHeight.value / itemHeight.value) + overscan * 2
  )
  const startIndex = computed(() =>
    Math.max(0, Math.floor(scrollTop.value / itemHeight.value) - overscan)
  )
  const endIndex = computed(() =>
    Math.min(items.value.length, startIndex.value + visibleCount.value)
  )

  const visibleItems = computed(() => {
    const h = itemHeight.value
    return items.value.slice(startIndex.value, endIndex.value).map((item, index) => ({
      ...item,
      _virtualIndex: startIndex.value + index,
      _virtualStyle: {
        position: 'absolute' as const,
        top: `${(startIndex.value + index) * h}px`,
        height: `${h}px`,
        width: '100%',
        left: '0',
      },
    }))
  })

  const totalHeight = computed(() => items.value.length * itemHeight.value)

  function onScroll() {
    if (scrollEl) scrollTop.value = scrollEl.scrollTop
  }

  function bindScrollRoot(el: HTMLElement | null) {
    if (scrollEl) {
      scrollEl.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      ro = null
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

  return {
    containerRef,
    visibleItems,
    totalHeight,
    startIndex,
    endIndex,
    measuredHeight,
  }
}
