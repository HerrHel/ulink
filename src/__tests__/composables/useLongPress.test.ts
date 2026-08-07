/**
 * useLongPress 护栏测（chunk #15 r9-longpress-pointer-handler-guard）
 *
 * 为什么这是真改善：useLongPress 是 H17（fired 由 let 改 ref，否则 watch 在 useApp 永不响应、
 * 合成 click 抑制失效）+ E3-004（pointerup/pointercancel 共用 200ms fired 复位，否则 cancel 后
 * fired 长期 true）双重修复点，但全无单测覆盖。长按 500ms 触发、移动超 SLOP=10 取消、200ms
 * fired 复位、各守卫分支全裸奔。本测锁住这些行为不变量——若有人误改 fired 语义或漏 reset、或改
 * 守卫顺序导致桌面端也触发长按，立即红灯。
 *
 * 触发方式：mount 一个用 useLongPress 的最小组件（onMounted 注册 document pointerdown/move/up/cancel
 * 监听），用真实 DOM 触发点（嵌在卡片内的 span）派发 PointerEvent 冒泡到 document，让 jsdom 自行
 * 设定 e.target=触发点，其 closest('.card,.group-card') 走真实 DOM 树命中卡片——比手动
 * defineProperty(ev,'target') 稳（jsdom dispatch 时会按 dispatch 路径重写 target）。
 * vi.useFakeTimers 跑 500ms/200ms 推进长按与复位定时器。
 *
 * mock 路径血泪教训：vi.mock 路径相对**测试文件**解析，必须与被测模块 import 解析到同一绝对路径才
 * match 生效。useLongPress.ts 在 src/composables/interaction/ import '../ui/useUI.js' → src/composables/ui/useUI.js，
 * 测试文件在 src/__tests__/composables/ 必须写 '../../composables/ui/useUI.js' 才解析到同一路径。
 * 早期写成 '../ui/useUI.js' 解析到不存在的 src/__tests__/ui/useUI.js，mock 静默失效→真 showActionSheet 跑
 * 而 mock 不记录（sheet=0）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, type Ref } from 'vue'

const isMobileHolder = { fn: (): boolean => true }
let showActionSheetMock = vi.fn()
const batchModeHolder = { v: false }

vi.mock('../../utils.js', () => ({ isMobile: () => isMobileHolder.fn() }))
vi.mock('../../composables/ui/useUI.js', () => ({
  showActionSheet: (...a: unknown[]) => showActionSheetMock(...a),
}))
vi.mock('../../stores/ui.js', () => ({
  // useLongPress 只读 useUIStore().batchMode。setup.ts beforeEach 用真 pinia 包初始化 Pinia，
  // mock 只作用于本模块对 useUIStore 的 import 路径。
  useUIStore: () => ({ get batchMode() { return batchModeHolder.v } }),
}))

/** pointermove/up/cancel 只读 clientX/Y 无需 target，派到 document 即可 */
function dispatchToDoc(type: 'pointermove' | 'pointerup' | 'pointercancel', init: PointerEventInit = {}) {
  document.dispatchEvent(new PointerEvent(type, { bubbles: true, ...init }))
}

/** 在 body 挂一张卡片（含内部触发 span），返回触发点与卡片引用 */
function makeCard(cls: string, x = 10, y = 10) {
  const card = document.createElement('div')
  card.className = cls
  document.body.appendChild(card)
  const trigger = document.createElement('span')
  card.appendChild(trigger)
  function press() {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }))
  }
  function downFrom(el: Element, px = 5, py = 5) {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: px, clientY: py }))
  }
  return { card, trigger, press, downFrom }
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

describe('useLongPress pointer handler 护栏 (H17 fired-ref + E3-004 fired-reset)', () => {
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

  it('onPtrDown：非 mobile 直接 return，不设定时器、不触发 showActionSheet', async () => {
    isMobileHolder.fn = () => false
    const { w, fired } = await setup()
    const c = makeCard('card')
    c.press()
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('onPtrDown：batchMode=true 直接 return（批量模式下不触发长按菜单）', async () => {
    batchModeHolder.v = true
    const { w, fired } = await setup()
    const c = makeCard('card')
    c.press()
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('onPtrDown：target 是 input（嵌在 card 内）时 return（输入控件守卫）', async () => {
    const { w, fired } = await setup()
    const c = makeCard('card')
    const input = document.createElement('input')
    c.trigger.replaceWith(input)
    c.downFrom(input)
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('onPtrDown：target 是 button 时 return（守卫覆盖 button）', async () => {
    const { w, fired } = await setup()
    const c = makeCard('card')
    const btn = document.createElement('button')
    c.trigger.replaceWith(btn)
    c.downFrom(btn)
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('onPtrDown：target 不在 .card/.group-card 内（裸 div）时 return', async () => {
    const { w } = await setup()
    const bare = document.createElement('div')
    document.body.appendChild(bare)
    const ev = new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 })
    bare.dispatchEvent(ev)
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('onPtrDown：命中 .group-card-focus 时 return（焦点态组卡不弹长按菜单）', async () => {
    const { w, fired } = await setup()
    const c = makeCard('group-card group-card-focus')
    c.press()
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('onPtrDown → 500ms 定时器：fired=true + getActions 返回非空时调 showActionSheet(actions)', async () => {
    const ga = vi.fn(() => [{ label: 'edit', action: () => {} }])
    const { w, fired } = await setup(ga)
    const c = makeCard('card')
    c.press()
    vi.advanceTimersByTime(499)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    expect(fired()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(fired()).toBe(true)
    expect(ga).toHaveBeenCalledWith(c.card)
    expect(showActionSheetMock).toHaveBeenCalledTimes(1)
    expect(showActionSheetMock).toHaveBeenCalledWith([{ label: 'edit', action: expect.any(Function) }])
    w.unmount()
  })

  it('onPtrDown → 500ms：getActions 返回 null 时不弹 sheet，但 fired 仍置 true（H17：fired 与 actions 解耦）', async () => {
    const ga = vi.fn(() => null)
    const { w, fired } = await setup(ga)
    const c = makeCard('card')
    c.press()
    vi.advanceTimersByTime(500)
    expect(fired()).toBe(true)
    expect(ga).toHaveBeenCalledWith(c.card)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('onPtrMove：移动 clientX 超 SLOP=10 时 cancel，600ms 后不触发长按', async () => {
    const { w, fired } = await setup()
    const c = makeCard('card', 0, 0)
    c.press()
    dispatchToDoc('pointermove', { clientX: 11, clientY: 0 }) // dx=11 > 10
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('onPtrMove：移动 clientY 超 SLOP=10 时 cancel（Y 轴对称）', async () => {
    const { w } = await setup()
    const c = makeCard('card', 5, 5)
    c.press()
    dispatchToDoc('pointermove', { clientX: 5, clientY: 16 }) // dy=11
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('onPtrMove：移动 ≤10px 时不 cancel，500ms 仍触发（SLOP 容差边界）', async () => {
    const { w, fired } = await setup()
    const c = makeCard('card', 0, 0)
    c.press()
    dispatchToDoc('pointermove', { clientX: 10, clientY: 0 }) // dx=10 不超
    vi.advanceTimersByTime(500)
    expect(fired()).toBe(true)
    expect(showActionSheetMock).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('onPtrMove：无 _target 时（未先 pointerdown）直接 return，不报错', async () => {
    const { w } = await setup()
    expect(() => dispatchToDoc('pointermove', { clientX: 999, clientY: 999 })).not.toThrow()
    w.unmount()
  })

  it('onPtrUp：未长按到（fired=false）时直接 cancel，300ms 后仍 false（scheduleFiredReset 短路）', async () => {
    const { w, fired } = await setup()
    const c = makeCard('card')
    c.press()
    vi.advanceTimersByTime(100) // 未到 500ms，fired 仍 false
    dispatchToDoc('pointerup')
    vi.advanceTimersByTime(300)
    expect(fired()).toBe(false)
    expect(showActionSheetMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('onPtrUp：已长按触发后 fired=true，pointerup 启动 200ms 复位定时器→ fired 归 false（E3-004）', async () => {
    const { w, fired } = await setup()
    const c = makeCard('card')
    c.press()
    vi.advanceTimersByTime(500)
    expect(fired()).toBe(true)
    dispatchToDoc('pointerup')
    vi.advanceTimersByTime(199)
    expect(fired()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('onPtrCancel：与 onPtrUp 同样触发 200ms 复位 + cancel（E3-004：cancel 不留 fired=true 残留）', async () => {
    const { w, fired } = await setup()
    const c = makeCard('card')
    c.press()
    vi.advanceTimersByTime(500)
    expect(fired()).toBe(true)
    dispatchToDoc('pointercancel')
    vi.advanceTimersByTime(200)
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('scheduleFiredReset 重复调度：pointerup 后 100ms 再次 pointerup 重排 200ms（不提前复位也不乱序）', async () => {
    const { w, fired } = await setup()
    const c = makeCard('card')
    c.press()
    vi.advanceTimersByTime(500)
    dispatchToDoc('pointerup')
    vi.advanceTimersByTime(100)
    dispatchToDoc('pointerup') // clearTimeout 旧 reset + 重新排 200ms
    vi.advanceTimersByTime(199)
    expect(fired()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(fired()).toBe(false)
    w.unmount()
  })

  it('onUnmounted：卸载后 document 不再响应 pointerdown（监听已 removeEventListener）', async () => {
    const { w } = await setup()
    w.unmount()
    const c = makeCard('card')
    c.press()
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
  })

  it('onUnmounted：卸载时清理 pending 长按定时器（pointerdown 后立即卸载，定时器不残留触发 sheet）', async () => {
    const { w } = await setup()
    const c = makeCard('card')
    c.press()
    w.unmount() // 不等 500ms
    vi.advanceTimersByTime(600)
    expect(showActionSheetMock).not.toHaveBeenCalled()
  })

  it('onUnmounted：卸载时清理 pending fired-reset 定时器（卸载时不残留定时器抛错）', async () => {
    const { w } = await setup()
    const c = makeCard('card')
    c.press()
    vi.advanceTimersByTime(500)
    dispatchToDoc('pointerup')
    w.unmount() // 复位定时器 pending 中卸载
    expect(() => vi.advanceTimersByTime(300)).not.toThrow()
  })

  it('group-card（非焦点态）也能触发长按（守卫区分 focus 态而非所有组卡）', async () => {
    const { w, fired } = await setup()
    const c = makeCard('group-card')
    c.press()
    vi.advanceTimersByTime(500)
    expect(fired()).toBe(true)
    expect(showActionSheetMock).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})
