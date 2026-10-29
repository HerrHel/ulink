import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useRotatingPlaceholder } from '../../composables/ui/useRotatingPlaceholder.js'

describe('useRotatingPlaceholder', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('初始返回首条技巧文案', () => {
    const { currentPlaceholder, currentIndex } = useRotatingPlaceholder()
    expect(currentIndex.value).toBe(0)
    expect(currentPlaceholder.value).toContain('视频')
  })

  it('按时间间隔自动轮播下一条', () => {
    const { currentPlaceholder, currentIndex } = useRotatingPlaceholder({ intervalMs: 3000 })
    expect(currentIndex.value).toBe(0)

    vi.advanceTimersByTime(3000)
    expect(currentIndex.value).toBe(1)
    expect(currentPlaceholder.value).toContain('向与链提问')

    vi.advanceTimersByTime(3000)
    expect(currentIndex.value).toBe(2)

    vi.advanceTimersByTime(3000)
    expect(currentIndex.value).toBe(3)

    // 循环回到 0
    vi.advanceTimersByTime(3000)
    expect(currentIndex.value).toBe(0)
  })

  it('聚焦或已有输入时暂停轮播', () => {
    const isFocused = ref(false)
    const hasContent = ref(false)
    const { currentIndex } = useRotatingPlaceholder({ isFocused, hasContent, intervalMs: 3000 })

    expect(currentIndex.value).toBe(0)

    // 获得焦点时，定时器触发不递增
    isFocused.value = true
    vi.advanceTimersByTime(6000)
    expect(currentIndex.value).toBe(0)

    // 失去焦点，恢复递增
    isFocused.value = false
    vi.advanceTimersByTime(3000)
    expect(currentIndex.value).toBe(1)

    // 有输入时，再次暂停递增
    hasContent.value = true
    vi.advanceTimersByTime(6000)
    expect(currentIndex.value).toBe(1)
  })
})
