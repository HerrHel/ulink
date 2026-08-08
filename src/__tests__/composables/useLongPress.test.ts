/**
 * useLongPress 护栏测（精简版）
 *
 * 原文件 20 例随 r9-longpress-pointer-handler-guard 补入。useLongPress 含两处真实修复:
 * H17(fired 由 let 改 ref,否则 watch 在 useApp 永不响应、合成 click 抑制失效)+
 * E3-004(pointerup/pointercancel 共用 200ms fired 复位,否则 cancel 后 fired 长期 true)。
 * 此精简版留 8 例守核心契约:非 mobile 守卫、500ms 触发、SLOP 容差、fired ref(响应式)、
 * fired 复位(E3-004 pointerup+pointercancel 两条)、卸载清理、focus 态组卡不弹。
 *
 * 删去:input/button/bare/同行多守卫镜像、Y 轴对称、getActions=null 边界、未长按到短路、
 * scheduleFiredReset 重复调度、卸载清两路定时器细节镜像。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, type Ref } from 'vue'

const isMobileHolder = { fn: (): boolean => true }
let showActionSheetMock = vi.fn()
const batchModeHolder = { v: false }

vi.mock('../../utils.js', () => ({ isMobile: () => isMobileHolder.fn() }))
vi.mock('../../composables/ui/useUI.js', () => ({ showActionSheet: (...a: unknown[]) => showActionSheetMock(...a) }))
vi.mock('../../stores/ui.js', () => ({ useUIStore: () => ({ get batchMode() { return batchModeHolder.v } }) }))

function dispatchToDoc(type: 'pointermove' | 'pointerup' | 'pointercancel', init: PointerEventInit = {}) {
  document.dispatchEvent(new PointerEvent(type, { bubbles: true, ...init }))
}

function makeCard(cls: string, x = 10, y = 10) {
  const card = document.createElement('div')
  card.className = cls
  document.body.appendChild(card)
  const trigger = document.createElement('span')
  card.appendChild(trigger)
  function press() {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }))
  }
  return { card, trigger, press }
}

async function setup(getActions?: (card: HTMLElement) => unknown[] | null) {
  const { useLongPress } = await import('../../composables/interaction/useLongPress.js')
  const firedRef: { f: Ref<boolean> | null } = { f: null }
  const Comp = defineComponent({
    setup() {
      const ga = getActions ?? (() => [{ label: 'x', action: () => {} }])
      const r = useLongPress(ga as never)
      firedRef.f = r.fired
      return () => h('div')
    },
  })
  const w = mount(Comp)
  return { w, fired: () => firedRef.f!.value }
}

describe('useLongPress pointer handler 核心契约护栏 (H17 fired-ref + E3-004 fired-reset)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    isMobileHolder.fn = () => true
    showActionSheetMock = vi.fn()
    batchModeHolder.v = false
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('非 mobile 守卫：直接 return，不设长按定时器不触发 showActionSheet', async () => {
    isMobileHolder.fn = () => false
    const { w, fired } = await setup()
    makeCard('card').press()
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('500ms 触发：fired=true(H17 ref 响应式)+ getActions 非空调 showActionSheet', async () => {
    const ga = vi.fn(() => [{ label: 'edit', action: () => {} }])
    const { w, fired } = await setup(ga)
    const c = makeCard('card')
    c.press()
    vi.advanceTimersByTime(499)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fired()).toBe(true) // H17: fired 是 ref,watch 可响应(非 let)
    expect(ga).toHaveBeenCalledWith(c.card)
    expect(showActionSheetMock).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('touchmove 超 SLOP=10 取消：600ms 后不触发长按', async () => {
    const { w, fired } = await setup()
    makeCard('card', 0, 0).press()
    dispatchToDoc('pointermove', { clientX: 11, clientY: 0 })
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('touchmove ≤10px 不取消：500ms 仍触发（SLOP 容差边界含等号）', async () => {
    const { w, fired } = await setup()
    makeCard('card', 0, 0).press()
    dispatchToDoc('pointermove', { clientX: 10, clientY: 0 })
    vi.advanceTimersByTime(500)
    expect(fired()).toBe(true)
    expect(showActionSheetMock).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('E3-004 pointerup 复位：500ms 触发后 fired=true，pointerup 启 200ms 复位归 false', async () => {
    const { w, fired } = await setup()
    makeCard('card').press()
    vi.advanceTimersByTime(500)
    expect(fired()).toBe(true)
    dispatchToDoc('pointerup')
    vi.advanceTimersByTime(199)
    expect(fired()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('E3-004 pointercancel 复位：与 pointerup 同样触发 200ms 复位（cancel 不留 fired 残留）', async () => {
    const { w, fired } = await setup()
    makeCard('card').press()
    vi.advanceTimersByTime(500)
    expect(fired()).toBe(true)
    dispatchToDoc('pointercancel')
    vi.advanceTimersByTime(200)
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('focus 态组卡不弹长按：.group-card-focus return（守卫区分 focus 态而非所有组卡）', async () => {
    const { w, fired } = await setup()
    makeCard('group-card group-card-focus').press()
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('group-card 非焦点态可触发长按（与 focus 态守卫对照）', async () => {
    const { w, fired } = await setup()
    makeCard('group-card').press()
    vi.advanceTimersByTime(500)
    expect(fired()).toBe(true)
    expect(showActionSheetMock).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('卸载清理：卸载后 document 不响应 pointerdown（监听已 removeEventListener）', async () => {
    const { w } = await setup()
    w.unmount()
    makeCard('card').press()
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
  })
})
