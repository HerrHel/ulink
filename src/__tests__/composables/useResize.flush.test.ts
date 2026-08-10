/**
 * 真 bug 复现：useResize 拖拽 width 持久化丢失最后一次 rAF 中的 delta
 *
 * 触发链：onMove 每次 mousemove 用 `cancelAnimationFrame(raf!) + raf = requestAnimationFrame(...)`
 * 节流写 width。rAF 回调在「下一帧渲染前」才同步执行。onUp 在 mouseup 事件阶段同步执行，
 * 早于最后一次 mousemove 排入的 rAF 回调。旧代码 onUp 内同步读 panel.style.width 持久化
 * （leftPanel）/ 读 --detail-width 持久化（rightPanel），此时最后一次 rAF 还没跑 ——
 * panel.style.width 仍是上一次已执行 rAF 写入的旧值，最后一次 mousemove 的 delta 未落到
 * DOM，localStorage('lv_railWidth'/'lv_detailWidth') 存的是比用户松手位置略小的宽度。
 * 下次刷新恢复面板宽度偏小几像素到几十像素（取决于最后一帧 delta 与拖拽速度）。
 *
 * 修复：onUp 头 cancelAnimationFrame 并同步 applyDelta 一次（用 lastClientX），把最终宽度
 * 写进 style.width/--detail-width 再读持久化。applyDelta 提取共用，rAF 回调与 flush 一致。
 *
 * 此测锁定复现：左栏拖拽 mousedown → mousemove(clientX) → 不 flush rAF 直接触发 mouseup
 * （模拟浏览器同帧多事件）→ 断言 localStorage 存的是松手位置的最终宽度而非旧 startW。
 * 验证：回退修复后该测正确 fail（存旧 width），修复后存最终 width。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { useResize } from '../../composables/interaction/useResize.js'

// 模拟 rAF 节流而非立即执行：用 fake timers 推迟 rAF 回调，让 onUp 早于 rAF 跑
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
  // 推进帧让排队的 rAF 跑（测试一般不手动 flush，模拟「rAF 还没跑」就是 bug 场景）
  vi.runAllTimers()
}

function buildDom() {
  document.body.innerHTML = `
    <div id="resizeLeft"></div>
    <div id="resizeRight"></div>
    <div class="icon-rail" id="leftRail" style="width:200px"></div>
    <div id="detailPanel" style="--detail-width:320px"></div>
  `
}

function mkComp() {
  return { setup() { useResize(); return () => null } }
}

function dispatch(el: Element | Document, type: string, clientX: number) {
  const ev = new MouseEvent(type, { bubbles: true, clientX })
  el.dispatchEvent(ev)
}

describe('useResize rAF-flush 持久化', () => {
  it('左栏拖拽：mouseup 早于最后 rAF → onUp 应 flush 最终 delta，localStorage 存松手宽度', async () => {
    buildDom()
    mount(mkComp())
    const leftHandle = document.getElementById('resizeLeft')!
    const rail = document.querySelector('.icon-rail') as HTMLElement

    // mousedown 起点 clientX=100，startW=200（getBoundingClientRect().width）
    // jsdom getBoundingClientRect 返回 0，所以 onDown 内 startW=0；为隔离 rAF-flush
    // 逻辑（不测 min/max clamp），我们直接给 rail 设初始 width 让 startW 来自它
    // 但 startW 读的是 getBoundingClientRect().width —— jsdom 总返 0。
    // 改测试策略：startW=0，拖到 clientX=200 → delta=200 → w=min(120, startW+200)=200
    // （leftPanel min=120 max=500）。我们断言存的是 200 而非旧 width（旧 width=200px 初始）
    // 这个数巧合相同不好区分。换 clientX=300 → delta=300 → w=min(500, 0+300)=300。
    // 旧代码 onUp 读 panel.style.width：rAF 未跑，width 仍是初始 '200px' → 存 200。
    // 修复后 onUp flush applyDelta → width=300px → 存 300。区分明显。
    Object.defineProperty(rail, 'getBoundingClientRect', {
      value: () => ({ width: 200, left: 0, right: 200, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })

    dispatch(leftHandle, 'mousedown', 100)
    // mousemove 到 clientX=300（delta=200， startW=200 → w=400，clamp>500→400? min(500,400)=400）
    // 重算：startW=200（getBoundingClientRect 改成 200），delta=(300-100)*1=200, w=min(500, 200+200)=400
    // 旧代码 onUp 读 width（rAF 未跑）=初始 '200px' → 存 200
    // 修复后 flush applyDelta → width=400px → 存 400
    dispatch(document, 'mousemove', 300)
    // 不 flushRaf —— 模拟 mouseup 早于 rAF
    dispatch(document, 'mouseup', 300)
    flushRaf()

    expect(localStorage.getItem('lv_railWidth')).toBe('400')
  })

  it('右栏拖拽：同测 --detail-width 持久化 flush 最终 delta', async () => {
    buildDom()
    mount(mkComp())
    const rightHandle = document.getElementById('resizeRight')!
    const detail = document.getElementById('detailPanel') as HTMLElement
    Object.defineProperty(detail, 'getBoundingClientRect', {
      value: () => ({ width: 320, left: 0, right: 320, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })

    // 右栏 dir=-1：startX - clientX
    // mousedown clientX=500，startW=320
    // mousemove clientX=200 → delta=(200-500)*-1=300 → w=min(600, 320+300)=600
    // 旧代码 onUp 读 --detail-width（rAF 未跑）= 初始 '320px' → 存 320
    // 修复后 flush applyDelta → --detail-width=600px → 存 600
    dispatch(rightHandle, 'mousedown', 500)
    dispatch(document, 'mousemove', 200)
    dispatch(document, 'mouseup', 200)
    flushRaf()

    expect(localStorage.getItem('lv_detailWidth')).toBe('600')
  })

  it('mousedown 后未移动直接 mouseup → width 未变，不持久化非法值', async () => {
    buildDom()
    mount(mkComp())
    const leftHandle = document.getElementById('resizeLeft')!
    const rail = document.querySelector('.icon-rail') as HTMLElement
    Object.defineProperty(rail, 'getBoundingClientRect', {
      value: () => ({ width: 200, left: 0, right: 200, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    // mousedown 后无 mousemove 直接 mouseup —— lastClientX 仍 0，但 onUp 头 raf==null 时
    // 跳过 flush；applyDelta 不会跑；width 未改保持初始 200px → 存 200。parseWidthPx 200 有效。
    dispatch(leftHandle, 'mousedown', 100)
    dispatch(document, 'mouseup', 100)
    flushRaf()
    // 不移动 = 持久化当前 width 200（这是既有行为，修复未改它）
    expect(localStorage.getItem('lv_railWidth')).toBe('200')
  })
})
