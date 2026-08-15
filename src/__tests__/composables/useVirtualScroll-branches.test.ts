/**
 * useVirtualScroll 分支补测 —— 锁既有 rAF 合并测未触达的逻辑分支契约
 *
 * 既有 useVirtualScroll.test.ts 只锁 onScroll rAF 合并 4 测（固定 itemHeight 数字 +
 * scrollRootSelector 查 #panelContent）。本文件补未覆盖分支：
 *  ① 响应式 itemHeight（MaybeRef）—— A1-005 传 Ref 时建 watch 同步行高分流
 *  ② bindScrollRoot 已有 scrollEl 时清旧监听 + 在途 rAF cancel（切换/重绑场景）
 *  ③ bindScrollRoot(null) 早退 —— scrollEl 置后 addEventListener 不挂、后续 scroll 无副作用
 *  ④ ResizeObserver 分支 —— 绑定后 RO observe、fire 后 measuredHeight 更新；
 *     typeof ResizeObserver !== 'undefined' 守门：无 RO 全局时跳过不崩
 *  ⑤ onUnmounted 卸载清理 —— bindScrollRoot(null) 移监听 + RO disconnect + 在途 rAF cancel
 *  ⑥ onMounted containerRef 优先 vs querySelector 兜底
 *  ⑦ totalHeight 变化时 scrollTop 超总高钳制（列表变短空白防护）/ 未超不钳制
 *
 * 桩：Mock ResizeObserver（仿 useCardOverflow.test.ts）+ rAF 推队列可控 + 假 scrollEl
 * defineProperty clientHeight/scrollTop（jsdom 默认 0 不能驱动）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, defineComponent, h, type Ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useVirtualScroll } from '../../composables/useVirtualScroll.js'

interface Item { type: 'bookmark' | 'group'; data: { id: string } }

let rafId = 0
const rafQueue = new Map<number, () => void>()
let roCtorCount = 0
const roInstances: { observed: Set<Element>; disconnect: () => void; fire: (el: Element) => void; observe: (el: Element) => void }[] = []

class MockRO {
  callback: ResizeObserverCallback
  observed = new Set<Element>()
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb
    roCtorCount++
    roInstances.push(this)
  }
  observe(el: Element) { this.observed.add(el) }
  disconnect() { this.observed.clear() }
  unobserve(el: Element) { this.observed.delete(el) }
  fire(el: Element) { this.callback([{ target: el } as unknown as ResizeObserverEntry], this) }
}

function flushRaf() {
  while (rafQueue.size > 0) {
    const firstKey = rafQueue.keys().next().value as number
    const cb = rafQueue.get(firstKey)!
    rafQueue.delete(firstKey)
    cb()
  }
}

function makeItems(n: number) {
  const arr: Item[] = []
  for (let i = 0; i < n; i++) arr.push({ type: 'bookmark', data: { id: 'b' + i } })
  return arr
}

/** 给 jsdom 默认 clientHeight=0 的元素桩真实 clientHeight */
function setClientHeight(el: HTMLElement, v: number) {
  Object.defineProperty(el, 'clientHeight', { value: v, configurable: true })
}

/**
 * mount 调用 useVirtualScroll 的占位组件，setup 内 onMounted 绑 scroll 监听。
 * opts.scrollRootSelector 控制真 scroll root；opts.itemHeight 传 Ref 启响应式；
 * opts.containerEl 传入时 setup 内显式赋 containerRef.value（mount 前生效）供测
 *   onMounted containerRef 优先分支（不走模板 ref 时序）。
 * 返回 captured 响应对象、scrollEl 句柄、items ref、unmount。
 */
function setupComp(opts: {
  itemsLen?: number
  height?: number
  itemHeight?: number | Ref<number>
  scrollRootSelector?: string
  containerEl?: HTMLElement | null
} = {}) {
  const { scrollRootSelector = '#panelContent' } = opts
  const scrollEl = document.getElementById('panelContent') as HTMLElement
  setClientHeight(scrollEl, opts.height ?? 600)
  const items = ref(makeItems(opts.itemsLen ?? 500))
  let captured: ReturnType<typeof useVirtualScroll> | undefined
  const Comp = defineComponent({
    name: 'VsWrapper',
    setup() {
      captured = useVirtualScroll<Item>(items, {
        itemHeight: opts.itemHeight ?? 120,
        containerHeight: opts.height ?? 600,
        overscan: 5,
        scrollRootSelector,
      })
      // setup 内显式赋 containerRef（mount/onMounted 前生效）覆盖 ① containerRef 优先
      if (opts.containerEl !== undefined) {
        ;(captured as { containerRef: { value: HTMLElement | null } }).containerRef.value = opts.containerEl
      }
      return () => h('div')
    },
  })
  const w = mount(Comp)
  return { captured: captured!, scrollEl, items, unmount: () => w.unmount() }
}

beforeEach(() => {
  vi.useFakeTimers()
  rafId = 0
  rafQueue.clear()
  roCtorCount = 0
  roInstances.length = 0
  document.body.innerHTML = `<div id="panelContent"></div>`
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    const id = ++rafId
    rafQueue.set(id, () => cb(0))
    return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
    rafQueue.delete(id)
  })
  ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = MockRO
  ;(window as { ResizeObserver: unknown }).ResizeObserver = MockRO
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  delete (window as { ResizeObserver?: unknown }).ResizeObserver
})

describe('useVirtualScroll 响应式行高（A1-005 MaybeRef）', () => {
  it('传数字 itemHeight 不建 watch，行高固定', () => {
    const { captured } = setupComp({ itemsLen: 100 })
    expect(captured.totalHeight.value).toBe(100 * 120)
  })

  it('传 Ref itemHeight 建同步 watch：改 value 后 totalHeight 重算', async () => {
    const ih = ref(120)
    const { captured } = setupComp({ itemsLen: 100, itemHeight: ih })
    expect(captured.totalHeight.value).toBe(100 * 120)
    ih.value = 240
    await nextTick()
    expect(captured.totalHeight.value).toBe(100 * 240)
  })
})

describe('useVirtualScroll bindScrollRoot 清旧监听 + 在途 rAF 取消', () => {
  it('卸载时取消在途 rAF（cancelAnimationFrame 被调，rafQueue 清空）', () => {
    const { scrollEl, unmount } = setupComp({ itemsLen: 500 })
    scrollEl.scrollTop = 1200
    scrollEl.dispatchEvent(new Event('scroll'))
    expect(rafQueue.size).toBe(1) // 在途 rAF 未 flush
    unmount()
    // 卸载调 bindScrollRoot(null) → cancelAnimationFrame(scrollRafId) 清队列
    expect(rafQueue.size).toBe(0)
  })

  it('卸载后 scrollEl 不再响应 scroll 事件（监听已 remove）', () => {
    const { scrollEl, captured, unmount } = setupComp({ itemsLen: 500 })
    expect(captured.measuredHeight.value).toBe(600)
    // 大 scrollTop 使 startIndex 真变化（0→5）触发 watch(sync) rebuild
    scrollEl.scrollTop = 1200
    scrollEl.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(captured.visibleItems.value.length).toBe(15)
    expect(captured.visibleItems.value[0]._virtualIndex).toBe(5)
    unmount()
    // 卸载后 dispatch scroll 不应再排 rAF（监听已移除，line 102 if(!scrollEl) return）
    scrollEl.scrollTop = 5000
    scrollEl.dispatchEvent(new Event('scroll'))
    expect(rafQueue.size).toBe(0)
  })

  it('卸载触发 ResizeObserver disconnect（observed 清空）', () => {
    const { scrollEl, unmount } = setupComp({ itemsLen: 500 })
    expect(roCtorCount).toBeGreaterThanOrEqual(1)
    const ro = roInstances[0]
    expect(ro.observed.has(scrollEl)).toBe(true)
    unmount()
    expect(ro.observed.size).toBe(0)
  })
})

describe('useVirtualScroll bindScrollRoot(null) 早退守门', () => {
  it('scrollRootSelector 找不到元素时绑 null、measuredHeight 保持初始', () => {
    const { captured } = setupComp({ itemsLen: 100, scrollRootSelector: '#notExist' })
    expect(captured.measuredHeight.value).toBe(600)
    expect(rafQueue.size).toBe(0)
  })
})

describe('useVirtualScroll ResizeObserver 分支', () => {
  it('绑定后 ResizeObserver 实例化 + observe scrollEl', () => {
    const { scrollEl } = setupComp({ itemsLen: 100 })
    expect(roCtorCount).toBeGreaterThanOrEqual(1)
    const ro = roInstances[0]
    expect(ro.observed.has(scrollEl)).toBe(true)
  })

  it('RO fire 后 measuredHeight 更新为新 clientHeight', () => {
    const { scrollEl, captured } = setupComp({ itemsLen: 100, height: 600 })
    setClientHeight(scrollEl, 900)
    const ro = roInstances[0]
    ro.fire(scrollEl)
    expect(captured.measuredHeight.value).toBe(900)
  })

  it('无 ResizeObserver 全局时跳过不崩（typeof !== undefined 守门 line 125）', () => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    delete (window as { ResizeObserver?: unknown }).ResizeObserver
    const { captured } = setupComp({ itemsLen: 100, height: 500 })
    // 无 RO 时 measuredHeight 用 scrollEl.clientHeight 一次性取（line 124 || initialHeight）
    expect(captured.measuredHeight.value).toBe(500)
  })
})

describe('useVirtualScroll onMounted containerRef 优先 vs querySelector 兜底', () => {
  it('containerRef 有值时优先用它（不依赖 querySelector 命中）', () => {
    // 造独立 container 元素 clientHeight=800（≠ #panelContent 的 700）
    const containerEl = document.createElement('div')
    setClientHeight(containerEl, 800)
    const { captured } = setupComp({ itemsLen: 100, height: 700, containerEl })
    // containerRef 优先 → measuredHeight=containerEl.clientHeight=800（非 selector 700）
    expect(captured.measuredHeight.value).toBe(800)
  })

  it('containerRef 为 null 时 onMounted 回退 querySelector(scrollRootSelector)', () => {
    const { scrollEl, captured } = setupComp({ itemsLen: 100, height: 700, containerEl: null })
    expect(scrollEl.id).toBe('panelContent')
    expect(captured.measuredHeight.value).toBe(700) // selector 命中 #panelContent clientHeight=700
  })
})

describe('useVirtualScroll totalHeight watch scrollTop 钳制（列表变短空白防护）', () => {
  it('列表变短后 scrollTop 超总高时钳制回弹并同步 scrollTop.value', async () => {
    const { scrollEl, items, captured } = setupComp({ itemsLen: 500, height: 600 })
    // 500 卡 * 120 = totalHeight 60000；滚到 50000（仍在总高内）
    scrollEl.scrollTop = 50000
    scrollEl.dispatchEvent(new Event('scroll'))
    flushRaf()
    // 缩到 10 卡 → totalHeight=1200；scrollTop=50000 >> max(0,1200-600)=600 → 钳制
    items.value = makeItems(10)
    await nextTick()
    expect(scrollEl.scrollTop).toBe(600) // watch(totalHeight) 钳制回弹
    expect(captured.startIndex.value).toBe(0) // 600/120=5 -overscan5 =0
  })

  it('列表变短但 scrollTop 未超总高时不钳制（保留滚动位置）', async () => {
    const { scrollEl, items } = setupComp({ itemsLen: 500, height: 600 })
    scrollEl.scrollTop = 500
    scrollEl.dispatchEvent(new Event('scroll'))
    flushRaf()
    // 缩到 100 卡 → totalHeight=12000；scrollTop=500 << 12000-600=11400 不超 → 不钳制
    items.value = makeItems(100)
    await nextTick()
    expect(scrollEl.scrollTop).toBe(500)
  })
})
