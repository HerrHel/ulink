/**
 * useResize 补分支契约（补既有 useResize.test.ts(5 测锁 parseWidthPx 纯函数)+useResize.flush.test.ts(3 测锁
 * onUp rAF-flush 持久化防最后一次 delta 丢失) 未触达分支：
 *   ①onMove rAF 回调真跑路径（line 67-70）：mousemove 排入 rAF 后 flush 让回调解跑，经 line 68
 *     `if(!handle||!panel||dir==null) return` 二次守门（拖拽期未早退走 applyDelta）+ applyDelta clamp。
 *   ②applyDelta 左/右栏 clamp 边界（min=120/max=500 左 dir>0，min=200/max=600 右 dir<0）+ 右栏 .open class 联动写 width。
 *   ③onMove 早退守门（无 mousedown 直接 mousemove → line 64 `!handle||!panel||!dir` 早退不排 rAF）。
 *   ④onUnmounted 清理（line 120-125）：mount+mousedown+mousemove 排 raf → unmount 触发
 *     cancelAnimationFrame + 4 removeEventListener + handle/panel=null → 再 mousemove 无副作用证清理生效。
 * 锁住真实行为契约：节流 rAF 回调非空执行 / clamp 边界 / 卸载防泄漏监听。非刷行数。
 *
 * 桩沿用 flush.test.ts 同构：fake timers + requestAnimationFrame stub（cb 推迟进 rafQueue 不立即跑
 *  供测控制何时 flush）+ cancelAnimationFrame 删队列项 + getBoundingClientRect 桩返真实 width 让
 *  onDown 读 startW 可控。fixture 注释推导 delta/clamp 数值在 beforeEach 后明确。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { useResize } from '../../composables/interaction/useResize.js'

let rafId = 0
// 排队的 rAF 回调，需测显式 flushRaf 才跑（模拟浏览器下一帧渲染前才执行）
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

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/** 推进帧让所有排队 rAF 跑（模拟同帧内多 rAF 顺序执行） */
function flushRaf() {
  // 复制防 flush 期间又排入新 rAF 死循环（onMove→applyDelta 不排 rAF，安全）
  const snapshot = Array.from(rafQueue.values())
  rafQueue.clear()
  for (const run of snapshot) run()
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

/** 给 el 桩 getBoundingClientRect 返 width=w 的 rect（jsdom 默认恒 0 致 onDown startW=0 不可控） */
function stubRect(el: HTMLElement, w: number) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ width: w, left: 0, right: w, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true,
  })
}

describe('useResize 节流 rAF 回调与 clamp 边界', () => {
  it('onMove rAF 回调真跑：mousemove 排入 rAF 后 flush 让 applyDelta 执行写入 width（line 67-70 二次守门不早退）', async () => {
    buildDom()
    mount(mkComp())
    const leftHandle = document.getElementById('resizeLeft')!
    const rail = document.querySelector('.icon-rail') as HTMLElement
    stubRect(rail, 200)
    // mousedown 起点 clientX=100，startW=200（桩 rect）
    dispatch(leftHandle, 'mousedown', 100)
    // mousemove 到 clientX=300：delta=(300-100)*1=200, w=min(500, 200+200)=400
    // rAF 回调此时未跑（排队中），width 尚未写入
    dispatch(document, 'mousemove', 300)
    expect((rail as HTMLElement).style.width).toBe('200px') // rAF 未 flush 仍初始
    // flush 让 rAF 回调执行：line 68 `if(!handle||!panel||dir==null) return`
    // 拖拽期 handle/panel/dir 均已赋值不早退 → 走 applyDelta 写 width=400px
    flushRaf()
    expect((rail as HTMLElement).style.width).toBe('400px')
    // 清理：mouseup（走 flush 路径二次 applyDelta width 仍是 400 → 持久化）
    dispatch(document, 'mouseup', 300)
    flushRaf()
    expect(localStorage.getItem('lv_railWidth')).toBe('400')
  })

  it('左栏 dir>0 clamp max=500：delta 超出封顶存 500 不超 500', async () => {
    buildDom()
    mount(mkComp())
    const leftHandle = document.getElementById('resizeLeft')!
    const rail = document.querySelector('.icon-rail') as HTMLElement
    stubRect(rail, 200)
    // mousedown clientX=100，startW=200，mousemove clientX=600 → delta=500, w=min(500, 700)=500
    dispatch(leftHandle, 'mousedown', 100)
    dispatch(document, 'mousemove', 600)
    flushRaf()
    expect((rail as HTMLElement).style.width).toBe('500px')
    dispatch(document, 'mouseup', 600)
    flushRaf()
    expect(localStorage.getItem('lv_railWidth')).toBe('500')
  })

  it('左栏 dir>0 clamp min=120：反向拖到负 delta 封底 120 不低于 120', async () => {
    buildDom()
    mount(mkComp())
    const leftHandle = document.getElementById('resizeLeft')!
    const rail = document.querySelector('.icon-rail') as HTMLElement
    stubRect(rail, 200)
    // mousedown clientX=100，startW=200，mousemove clientX=0 → delta=-100, w=max(120, 100)=120
    dispatch(leftHandle, 'mousedown', 100)
    dispatch(document, 'mousemove', 0)
    flushRaf()
    expect((rail as HTMLElement).style.width).toBe('120px')
    dispatch(document, 'mouseup', 0)
    flushRaf()
    expect(localStorage.getItem('lv_railWidth')).toBe('120')
  })

  it('右栏 dir<0 clamp min=200：超出封底 200 不低于 200 + 不带 .open 只写 --detail-width', async () => {
    buildDom()
    mount(mkComp())
    const rightHandle = document.getElementById('resizeRight')!
    const detail = document.getElementById('detailPanel') as HTMLElement
    stubRect(detail, 320)
    // 右栏 dir=-1：delta=(lastClientX-startX)*-1，mousedown clientX=500 startW=320
    // mousemove clientX=900 → delta=(900-500)*-1=-400, w=max(200, 320-400)=200
    dispatch(rightHandle, 'mousedown', 500)
    dispatch(document, 'mousemove', 900)
    flushRaf()
    // 不带 .open class → 只写 --detail-width 不写 width
    expect(detail.style.getPropertyValue('--detail-width')).toBe('200px')
    expect(detail.style.width).toBe('')
    dispatch(document, 'mouseup', 900)
    flushRaf()
    expect(localStorage.getItem('lv_detailWidth')).toBe('200')
  })

  it('右栏 dir<0 clamp max=600：超出封顶 600 不超 600', async () => {
    buildDom()
    mount(mkComp())
    const rightHandle = document.getElementById('resizeRight')!
    const detail = document.getElementById('detailPanel') as HTMLElement
    stubRect(detail, 320)
    // mousedown clientX=500 startW=320，mousemove clientX=100 → delta=(100-500)*-1=400, w=min(600, 720)=600
    dispatch(rightHandle, 'mousedown', 500)
    dispatch(document, 'mousemove', 100)
    flushRaf()
    expect(detail.style.getPropertyValue('--detail-width')).toBe('600px')
    dispatch(document, 'mouseup', 100)
    flushRaf()
    expect(localStorage.getItem('lv_detailWidth')).toBe('600')
  })

  it('右栏 .open class 联动：带 open 时 applyDelta 同时写 --detail-width 与 width（line 59 分支）', async () => {
    buildDom()
    mount(mkComp())
    const rightHandle = document.getElementById('resizeRight')!
    const detail = document.getElementById('detailPanel') as HTMLElement
    stubRect(detail, 320)
    detail.classList.add('open')
    // mousedown clientX=500 startW=320，mousemove clientX=200 → delta=300, w=min(600, 620)=600
    dispatch(rightHandle, 'mousedown', 500)
    dispatch(document, 'mousemove', 200)
    flushRaf()
    // .open 命中 → 既写 --detail-width 又写 width
    expect(detail.style.getPropertyValue('--detail-width')).toBe('600px')
    expect(detail.style.width).toBe('600px')
    dispatch(document, 'mouseup', 200)
    flushRaf()
  })
})

describe('useResize 早退守门与卸载清理', () => {
  it('onMove 早退守门（line 64）：无 mousedown 直接 mousemove → !handle 早退不排 rAF 不副作用 width', async () => {
    buildDom()
    mount(mkComp())
    const rail = document.querySelector('.icon-rail') as HTMLElement
    // 未触发任何 mousedown，handle=null → onMove line 64 `if(!handle||!panel||!dir) return`
    dispatch(document, 'mousemove', 999)
    flushRaf()
    expect(rafQueue.size).toBe(0) // 未排入任何 rAF
    expect(rail.style.width).toBe('200px') // width 未被改
  })

  it('onUnmounted 清理（line 120-125）：拖拽中卸载 → cancelAnimationFrame + 4 removeEventListener + handle/panel=null，再 mousemove 无副作用', async () => {
    buildDom()
    const w = mount(mkComp())
    const leftHandle = document.getElementById('resizeLeft')!
    const rail = document.querySelector('.icon-rail') as HTMLElement
    stubRect(rail, 200)
    dispatch(leftHandle, 'mousedown', 100)
    dispatch(document, 'mousemove', 300) // 排入 raf，未 flush
    expect(rafQueue.size).toBeGreaterThan(0)
    // 卸载 → onUnmounted：cancelAnimationFrame(raf!) + removeEventListener(mousedown 左/右 +
    // mousemove/move up) + handle=panel=null
    w.unmount()
    // rAF 已被 cancelAnimationFrame 清（rafQueue 为空）
    expect(rafQueue.size).toBe(0)
    // width 仍初始（rAF 未 flush 跑过）
    expect(rail.style.width).toBe('200px')
    // 卸载后 mousemove/mouseup 监听已移除 → 再 dispatch 无副作用（width 不变，不排 rAF）
    dispatch(document, 'mousemove', 999)
    flushRaf()
    expect(rail.style.width).toBe('200px')
    expect(rafQueue.size).toBe(0)
    // document.body.style 在 onDown 设了 cursor=col-resize/userSelect=none，onUp 复位；
    // 卸载发生在拖拽中（onDown 后 but onUp 前）→ 未复位遗留 cursor——这是实际行为非未清监听，
    // 不在本测 contract 范围（清理盯 removeEventListener + cancelAnimationFrame，不动 cursor）。
  })

  it('onMounted 缺元素早退（line 27）：缺 resizeLeft 等 4 元素任一 → return 不挂监听不影响 width', async () => {
    // 故意不建 resizeLeft（buildDom 不调，body 空）
    document.body.innerHTML = ''
    mount(mkComp())
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 999 }))
    flushRaf()
    expect(rafQueue.size).toBe(0) // 无宿主元素 onMounted 直接 return 未挂监听
  })

  it('onMounted 恢复保存宽度（line 30-33）：localStorage 有 savedLeft/savedRight → 恢复 panel.style', async () => {
    localStorage.setItem('lv_railWidth', '250')
    localStorage.setItem('lv_detailWidth', '350')
    buildDom()
    mount(mkComp())
    const rail = document.querySelector('.icon-rail') as HTMLElement
    const detail = document.getElementById('detailPanel') as HTMLElement
    expect(rail.style.width).toBe('250px')
    expect(detail.style.getPropertyValue('--detail-width')).toBe('350px')
  })
})
