import { ref, computed, onMounted, onUnmounted, type Ref } from 'vue'

interface VirtualScrollOptions {
  itemHeight?: number
  containerHeight?: number
  overscan?: number
}

interface VirtualItem<T> {
  _virtualIndex: number
  _virtualStyle: {
    position: 'absolute'
    top: string
    height: string
    width: string
  }
  [key: string]: any
}

/**
 * useVirtualScroll — 虚拟滚动 composable
 * 仅在数据量超过阈值时激活，避免大数据量场景下的渲染性能问题
 */
export function useVirtualScroll<T>(items: Ref<T[]>, options: VirtualScrollOptions = {}) {
  const {
    itemHeight = 120,
    containerHeight = 600,
    overscan = 5,
  } = options

  const scrollTop = ref(0)
  const containerRef = ref<HTMLElement | null>(null)

  const visibleCount = Math.ceil(containerHeight / itemHeight) + overscan * 2
  const startIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / itemHeight) - overscan))
  const endIndex = computed(() => Math.min(items.value.length, startIndex.value + visibleCount))

  const visibleItems = computed(() =>
    items.value.slice(startIndex.value, endIndex.value).map((item, index) => ({
      ...item,
      _virtualIndex: startIndex.value + index,
      _virtualStyle: {
        position: 'absolute' as const,
        top: `${(startIndex.value + index) * itemHeight}px`,
        height: `${itemHeight}px`,
        width: '100%',
      },
    }))
  )

  const totalHeight = computed(() => items.value.length * itemHeight)

  function onScroll(e: Event) {
    scrollTop.value = (e.target as HTMLElement).scrollTop
  }

  onMounted(() => {
    if (containerRef.value) {
      containerRef.value.addEventListener('scroll', onScroll, { passive: true })
    }
  })

  onUnmounted(() => {
    if (containerRef.value) {
      containerRef.value.removeEventListener('scroll', onScroll)
    }
  })

  return {
    containerRef,
    visibleItems,
    totalHeight,
    startIndex,
    endIndex,
  }
}
