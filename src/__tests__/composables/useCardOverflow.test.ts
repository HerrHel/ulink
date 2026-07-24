/**
 * useCardOverflow 单测：验证单例 ResizeObserver + WeakMap 注册表
 * 覆盖：多卡片共享一个 RO 实例、卸载清除注册、溢出/不溢出切换 class。
 *
 * 用 vi.resetModules + 动态 import 让每个测试拿到新的模块实例（新单例 RO），
 * 避免模块级 _sharedRO 跨测试污染。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref, h, type Component } from 'vue'

let _roInstances: MockRO[] = []
let _roCtorCount = 0
class MockRO {
  callback: ResizeObserverCallback
  observed = new Set<Element>()
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb
    _roCtorCount++
    _roInstances.push(this)
  }
  observe(el: Element) { this.observed.add(el) }
  unobserve(el: Element) { this.observed.delete(el) }
  disconnect() { this.observed.clear() }
  fire(el: Element) { this.callback([{ target: el } as unknown as ResizeObserverEntry], this) }
}

beforeEach(() => {
  _roInstances = []
  _roCtorCount = 0
  ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = MockRO
  ;(window as { ResizeObserver: unknown }).ResizeObserver = MockRO
  vi.resetModules()
})
afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  delete (window as { ResizeObserver?: unknown }).ResizeObserver
})

/** 动态 import useCardOverflow，返回使用它的最小卡片组件 */
async function makeCard(): Promise<Component> {
  const { useCardOverflow } = await import('../../composables/ui/useCardOverflow.js')
  return defineComponent({
    setup() {
      const cardEl = ref<HTMLElement | null>(null)
      useCardOverflow(cardEl)
      return () => h('div', { ref: cardEl, class: 'card' }, [h('div', { class: 'card-body' })])
    },
  })
}

describe('useCardOverflow 单例 ResizeObserver', () => {
  it('多张卡片共享一个 ResizeObserver 实例（构造次数 = 1）', async () => {
    const Card = await makeCard()
    const wrappers: VueWrapper[] = []
    for (let i = 0; i < 5; i++) wrappers.push(mount(Card))
    expect(_roCtorCount).toBe(1)
    expect(_roInstances.length).toBe(1)
    expect(_roInstances[0].observed.size).toBe(5)
    wrappers.forEach(w => w.unmount())
  })

  it('卡片卸载后从 RO 取消观察（其他卡片不受影响）', async () => {
    const Card = await makeCard()
    const w1 = mount(Card)
    const w2 = mount(Card)
    const ro = _roInstances[0]
    expect(ro.observed.size).toBe(2)
    w1.unmount()
    expect(ro.observed.size).toBe(1)
    w2.unmount()
  })

  it('body scrollHeight > clientHeight 时加 .card-overflow 类', async () => {
    const Card = await makeCard()
    const w = mount(Card)
    const body = w.element.querySelector('.card-body') as HTMLElement
    const card = w.element as HTMLElement
    Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => 100 })
    Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => 50 })
    _roInstances[0].fire(body)
    expect(card.classList.contains('card-overflow')).toBe(true)
    w.unmount()
  })

  it('不溢出时不加 .card-overflow；溢出消失后移除该类', async () => {
    const Card = await makeCard()
    const w = mount(Card)
    const body = w.element.querySelector('.card-body') as HTMLElement
    const card = w.element as HTMLElement
    Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => 50 })
    Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => 50 })
    _roInstances[0].fire(body)
    expect(card.classList.contains('card-overflow')).toBe(false)
    Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => 200 })
    _roInstances[0].fire(body)
    expect(card.classList.contains('card-overflow')).toBe(true)
    Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => 50 })
    _roInstances[0].fire(body)
    expect(card.classList.contains('card-overflow')).toBe(false)
    w.unmount()
  })
})
