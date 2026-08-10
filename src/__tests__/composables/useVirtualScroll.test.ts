/**
 * useVirtualScroll onScroll rAF 合并 —— 修 F2 CPU 热点真 bug 的回归测
 *
 * 触发链（修复前）：scroll 事件 → onScroll 同步 `scrollTop.value = scrollEl.scrollTop`
 * → 触发 `watch([startIndex,...], rebuildVisibleItems, { flush: 'sync' })` 同步重建
 * visibleItems（spread + push + 重写数组 + grid 重渲染）。fling 滚动每帧多次 scroll 事件
 * 每次都同步重建，1000+ 卡分类滚动掉帧。
 *
 * 修复：onScroll 加 rAF 合并 —— 多个 scroll 事件同帧只 sched 1 rAF，rAF 内读最新 scrollTop
 * 一次性更新。bindScrollRoot(null) cancel 在途 rAF 防泄漏。
 *
 * 此测锁定核心契约：连续 N 次 dispatch scroll 不 flush rAF 时，rAF 队列最多 1 个待跑回调
 * （修复前 rAF 不被用，scrollTop 每次 scroll 事件同步更新 N 次）；flush rAF 后 scrollTop
 * 反映最后一次 scroll 位置。
 *
 * 验证：回退 onScroll 改回 ``scrollTop.value = scrollEl.scrollTop`` 后，断言 rafQueue 大小
 * 为 0（无 rAF）+ scrollTop 同步直跳到最终值 —— 该测不再能锁住 rAF 合并契约（fail scenario
 * 体现为 rafQueue.length===0 而非修复后的 ≤1）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useVirtualScroll } from '../../composables/useVirtualScroll.js'

interface CardItem {
  type: 'bookmark' | 'group'
  data: { id: string }
}

let rafId = 0
const rafQueue = new Map<number, () => void>()
beforeEach(() => {
  vi.useFakeTimers()
  rafId = 0
  rafQueue.clear()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    const id = ++rafId
    rafQueue.set(id, () => cb(0))
    return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
    rafQueue.delete(id)
  })
})

function flushRaf() {
  // 真跑所有已 sched 的 rAF 回调（rAF 被 mock 成塞队列不立即跑；runAllTimers 推进的是
  // fake timer 队列不含 rAF，故必须手动 drain rafQueue 执行回调）。回调内若又触发 rAF
  // 也会入队，循环到队列空。
  while (rafQueue.size > 0) {
    const firstKey = rafQueue.keys().next().value as number
    const cb = rafQueue.get(firstKey)!
    rafQueue.delete(firstKey)
    cb()
  }
}

/** 构造 N 张假卡片 items ref */
function makeItems(n: number) {
  const arr: CardItem[] = []
  for (let i = 0; i < n; i++) arr.push({ type: 'bookmark', data: { id: 'b' + i } })
  return ref(arr)
}

/**
 * mount 一个调 useVirtualScroll 的占位组件，setup 内付 onMounted（绑 scroll 监听）。
 * 返回 visibleItems ref 与 scrollEl，供测试 dispatch scroll + flush rAF 观察行为。
 */
function setupComp(opts?: { itemsLen?: number; height?: number }) {
  document.body.innerHTML = `<div id="panelContent"></div>`
  const scrollEl = document.getElementById('panelContent') as HTMLElement
  Object.defineProperty(scrollEl, 'clientHeight', {
    value: opts?.height ?? 600,
    configurable: true,
  })
  const items = makeItems(opts?.itemsLen ?? 500)
  // captured 在 setup 内赋值；用 ReturnType 不带泛型（T 推断丢但 visibleItems/totalHeight
  // 字段类型推断为带 T 的并集仍兼容 TS），用 undefined union 表「未赋值」+ ! 断言已赋。
  let captured: ReturnType<typeof useVirtualScroll> | undefined
  const Comp = defineComponent({
    setup() {
      captured = useVirtualScroll<CardItem>(items, {
        itemHeight: 120,
        containerHeight: opts?.height ?? 600,
        overscan: 5,
        scrollRootSelector: '#panelContent',
      })
      // 让 useVirtualScroll onMounted 跑：占位渲染本身绑 containerRef 不必要，
      // 我们的 scroll El via #panelContent selector；onMounted 内会 querySelector 找到它。
      return () => h('div')
    },
  })
  mount(Comp)
  return { scrollEl, items, visibleItems: captured!.visibleItems, totalHeight: captured!.totalHeight }
}

describe('useVirtualScroll onScroll rAF 合并（F2 真热点修复回归）', () => {
  it('连续 dispatch N 次 scroll 事件，rAF 队列恰好 1 个待跑回调（合并契约）', () => {
    const { scrollEl } = setupComp()
    scrollEl.scrollTop = 100
    scrollEl.dispatchEvent(new Event('scroll'))
    scrollEl.scrollTop = 500
    scrollEl.dispatchEvent(new Event('scroll'))
    scrollEl.scrollTop = 1200
    scrollEl.dispatchEvent(new Event('scroll'))
    scrollEl.scrollTop = 2000
    scrollEl.dispatchEvent(new Event('scroll'))
    // 修复后：4 次 scroll 全合并到恰好 1 个 rAF；回退后（无 rAF）rafQueue.size=0 → 此断言正确 fail
    expect(rafQueue.size).toBe(1)
  })

  it('flush rAF 后 scrollTop 反映最后一次 scroll 位置（合并不丢最终值）', () => {
    const { scrollEl, visibleItems } = setupComp({ itemsLen: 2000 })
    scrollEl.scrollTop = 100
    scrollEl.dispatchEvent(new Event('scroll'))
    scrollEl.scrollTop = 1200
    scrollEl.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(visibleItems.value.length).toBeGreaterThan(0)
    // startIndex 应对应 scrollTop=1200 → floor(1200/120)-5=5
    expect(visibleItems.value[0]._virtualIndex).toBe(5)
  })

  it('未 flush rAF 时 scrollTop 未更新 → visibleItems 不反映新窗口（rAF 推迟生效）', () => {
    const { scrollEl, visibleItems } = setupComp({ itemsLen: 2000 })
    // mount 时 visibleItems=[]（watch 默认无 immediate，需依赖变才首次 rebuild）。
    // 先 scroll 到 1200 + flush 让 visibleItems 初始化到 startIndex=5 窗口。
    scrollEl.scrollTop = 1200
    scrollEl.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(visibleItems.value[0]._virtualIndex).toBe(5)

    // 再 scroll 到 2400 但不 flush rAF —— scrollTop.value 仍 1200 → watch 不触发 → visibleItems 不变
    scrollEl.scrollTop = 2400
    scrollEl.dispatchEvent(new Event('scroll'))
    expect(visibleItems.value[0]._virtualIndex).toBe(5)
    // flush 后才反映 scrollTop=2400 → startIndex=floor(2400/120)-5=15
    flushRaf()
    expect(visibleItems.value[0]._virtualIndex).toBe(15)
  })

  it('rAF 在途时再次 scroll 不新增 rAF 调度（合并的真正含义）', () => {
    const { scrollEl } = setupComp()
    scrollEl.scrollTop = 100
    scrollEl.dispatchEvent(new Event('scroll'))
    expect(rafQueue.size).toBe(1)
    scrollEl.scrollTop = 200
    scrollEl.dispatchEvent(new Event('scroll'))
    expect(rafQueue.size).toBe(1)
    scrollEl.scrollTop = 300
    scrollEl.dispatchEvent(new Event('scroll'))
    expect(rafQueue.size).toBe(1)
    flushRaf()
    expect(rafQueue.size).toBe(0)
  })
})
