/**
 * useScrollHeader 分支补测 —— 锁既有核心契约护栏测未触达的逻辑分支
 *
 * 既有 useScrollHeader.test.ts 6 例（精简版）已锁：首次加 search/header 阈值、迟滞已态收紧
 * 退出边界、onSearchToggle 350ms 焦点、卸载清监听+去双 class、watch(isMobile) 重 attach。
 * 精简版注释明确删去：E3-002 DOM 未就绪二次 rAF 重试链细节、attach 重复/缺失早退、
 * onScroll ticking 早退、detach 清在途 retryRaf、迟滞 middle 区反向等。
 *
 * 本文件补未覆盖分支（与既有测平铺于 __tests__/composables/）：
 *  ① onScroll ticking=true 早退守门（line 30）
 *  ② 迟滞 middle 区已态：y > THRESHOLD_SEARCH+hysteresis 但 <=THRESHOLD_HEADER 时 remove header 已态（line 44-45）
 *  ③ onSearchToggle 无 #searchInput 不崩（line 53 可选链）
 *  ④ attach() 已 attached 返 true 早退不重挂（line 58）
 *  ⑤ attach() 缺 content/wrapper 返 false 不挂监听（line 62）
 *  ⑥ attachWhenReady 二次 rAF 重试链（E3-002，line 84-89）
 *  ⑦ detach() 清在途 retryRaf（line 70）+ onUnmounted stopWatch（line 98）
 *
 * 桩：rAF 推 rafQueue 可控 flush（仿 useVirtualScroll rafQueue 模式）+ 假 panel scrollTop defineProperty +
 * 真 classList + getElementById 实查让 attach 真找到/找不到控缺失分支。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'

const uiHolder = reactive({ isMobile: true })

vi.mock('../../stores/ui.js', () => ({ useUIStore: () => uiHolder }))

let rafId = 0
const rafQueue = new Map<number, () => void>()

beforeEach(() => {
  vi.useFakeTimers()
  rafId = 0
  rafQueue.clear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafId
    rafQueue.set(id, () => cb(0))
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafQueue.delete(id) })
  uiHolder.isMobile = true
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function flushRaf() {
  while (rafQueue.size > 0) {
    const firstKey = rafQueue.keys().next().value as number
    const cb = rafQueue.get(firstKey)!
    rafQueue.delete(firstKey)
    cb()
  }
}

/** 单帧 flush：只跑队列首项，精确逐节点走 E3-002 二层重试链（与 flushRaf 全 flush 区分） */
function flushOneRaf() {
  if (rafQueue.size === 0) return
  const firstKey = rafQueue.keys().next().value as number
  const cb = rafQueue.get(firstKey)!
  rafQueue.delete(firstKey)
  cb()
}

function mountDom(opts: { withPanel?: boolean; withWrapper?: boolean; withSearchBtn?: boolean; withSearchInput?: boolean } = {}) {
  const { withPanel = true, withWrapper = true, withSearchBtn = true, withSearchInput = true } = opts
  let _scrollTop = 0
  let panel: HTMLElement | undefined
  if (withPanel) {
    panel = document.createElement('div')
    panel.id = 'panelContent'
    Object.defineProperty(panel, 'scrollTop', {
      get: () => _scrollTop,
      set: (v: number) => { _scrollTop = v },
      configurable: true,
    })
    document.body.appendChild(panel)
  }
  if (withWrapper) {
    const wrapper = document.createElement('div')
    wrapper.className = 'panel-main-inner'
    document.body.appendChild(wrapper)
  }
  if (withSearchBtn) {
    const searchBtn = document.createElement('button')
    searchBtn.id = 'searchToggleBtn'
    document.body.appendChild(searchBtn)
  }
  if (withSearchInput) {
    const searchInput = document.createElement('input')
    searchInput.id = 'searchInput'
    document.body.appendChild(searchInput)
  }
  return {
    panel: panel as HTMLElement,
    setScrollTop: (v: number) => { _scrollTop = v },
    getWrapper: () => document.querySelector('.panel-main-inner') as HTMLElement | null,
    getSearchBtn: () => document.getElementById('searchToggleBtn') as HTMLButtonElement | null,
  }
}

async function setup() {
  const { useScrollHeader } = await import('../../composables/interaction/useScrollHeader.js')
  const Comp = defineComponent({ name: 'ShWrapper', setup() { useScrollHeader(); return () => h('div') } })
  return mount(Comp)
}

/** 让 watch immediate（setup 时）跑完 attach + nextTick flush（attachWhenReady 二次重试链节点） */
async function advanceReady() {
  await vi.advanceTimersByTimeAsync(0)
}

describe('useScrollHeader onScroll ticking 早退守门', () => {
  it('rAF 回调期间 ticking 未复位时新 scroll 不响应（line 30 早退守门）', async () => {
    const dom = mountDom()
    const w = await setup()
    await advanceReady()
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(rafQueue.size).toBe(1) // 第1次排入 rAF（ticking=true）
    // 未 flush 时第2次 scroll 应被「ticking ||」早退不排新 rAF
    dom.setScrollTop(200)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(rafQueue.size).toBe(1)
    // flush 后 ticking 复位，后续 scroll 重新响应
    flushRaf()
    dom.setScrollTop(200)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(rafQueue.size).toBe(1)
    flushRaf()
    w.unmount()
  })
})

describe('useScrollHeader 迟滞 middle 区已态', () => {
  it('已态双 true 滚回 middle 区（y>80 但<=140）remove header 保留 search', async () => {
    const dom = mountDom()
    const w = await setup()
    await advanceReady()
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    flushRaf()
    const wEl = dom.getWrapper()!
    expect(wEl.classList.contains('scrolled-search')).toBe(true)
    expect(wEl.classList.contains('scrolled-header')).toBe(true)
    // hasSearch=true 故 threshold=60+0=60；y=81>60 进 middle 区 if(hasHeader)remove header
    dom.setScrollTop(81)
    dom.panel.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(wEl.classList.contains('scrolled-header')).toBe(false)
    expect(wEl.classList.contains('scrolled-search')).toBe(true)
    w.unmount()
  })

  it('已态滚到 middle 区刚过 search 阈值（y=61）remove header', async () => {
    const dom = mountDom()
    const w = await setup()
    await advanceReady()
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    flushRaf()
    const wEl = dom.getWrapper()!
    // hasSearch=true 故 threshold=60；y=61>60 进 middle 区 remove header
    dom.setScrollTop(61)
    dom.panel.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(wEl.classList.contains('scrolled-header')).toBe(false)
    w.unmount()
  })

  it('已态滚回顶部（y<=THRESHOLD_SEARCH 迟滞后）走 else 区 remove search + header 全清除（line 44-45）', async () => {
    const dom = mountDom()
    const w = await setup()
    await advanceReady()
    // 先滚 141 加双 class（scrolled-search + scrolled-header）
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    flushRaf()
    const wEl = dom.getWrapper()!
    expect(wEl.classList.contains('scrolled-search')).toBe(true)
    expect(wEl.classList.contains('scrolled-header')).toBe(true)
    // 回滚到 y=30（<=60=THRESHOLD_SEARCH）：hasSearch=true 故阈值=60+0=60，y>60 false 走 else 分支
    // line 40 `else if (y > THRESHOLD_SEARCH + hysteresis)` 不满足 → 走 else line 44-45 remove search + header
    dom.setScrollTop(30)
    dom.panel.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(wEl.classList.contains('scrolled-search')).toBe(false)
    expect(wEl.classList.contains('scrolled-header')).toBe(false)
    w.unmount()
  })
})

describe('useScrollHeader onSearchToggle 无 searchInput 不崩', () => {
  it('无 #searchInput 时 onSearchToggle 经过可选链 `?.focus()` 不抛', async () => {
    const dom = mountDom({ withSearchInput: false })
    const w = await setup()
    await advanceReady()
    dom.setScrollTop(81)
    dom.panel.dispatchEvent(new Event('scroll'))
    flushRaf()
    const wEl = dom.getWrapper()!
    expect(wEl.classList.contains('scrolled-search')).toBe(true)
    // 点 searchBtn 触 onSearchToggle，内部可选链无 searchInput 不抛
    expect(() => dom.getSearchBtn()!.click()).not.toThrow()
    expect(wEl.classList.contains('scrolled-search')).toBe(false)
    expect(dom.panel.scrollTop).toBe(0)
    w.unmount()
  })
})

describe('useScrollHeader attach 早退守门', () => {
  it('缺 #panelContent 时 attach 返 false 不挂监听（line 62 content 缺）', async () => {
    const dom = mountDom({ withPanel: false })
    const w = await setup()
    await advanceReady()
    expect(document.getElementById('panelContent')).toBe(null)
    const wEl = dom.getWrapper()!
    // 无 panel → attach 失败不挂监听 → wrapper 无 scrolled-* class（无 scroll 可派发）
    expect(wEl.classList.contains('scrolled-search')).toBe(false)
    w.unmount()
  })

  it('缺 .panel-main-inner 时 attach 返 false 不挂监听（line 62 wrapper 缺）', async () => {
    mountDom({ withWrapper: false })
    const w = await setup()
    await advanceReady()
    expect(document.querySelector('.panel-main-inner')).toBe(null)
    expect(document.getElementById('searchToggleBtn')).toBeTruthy()
    w.unmount()
  })

  it('重 attach 不重复挂监听：滚响应正常只一套监听', async () => {
    const dom = mountDom()
    const w = await setup()
    await advanceReady()
    // 经 isMobile 切换走路 -> 转换状态 -> 修改回，触发二次挂接
    uiHolder.isMobile = false
    await advanceReady()
    uiHolder.isMobile = true
    await advanceReady()
    // 重 attach 后监听只 1 套：滚响应加 class
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(dom.getWrapper()!.classList.contains('scrolled-header')).toBe(true)
    w.unmount()
  })
})

describe('useScrollHeader E3-002 二次 rAF 重试链（attachWhenReady）', () => {
  it('attach 失败排 rAF1 → flushOne 跑 rAF1 再失败排 rAF2 → flushOne 跑 rAF2 仍失败不再排第三层（重试链终止）', async () => {
    mountDom({ withPanel: false }) // 无 panel：nextTick 时 attach 失败排首个 retryRaf（rAF1）
    const w = await setup()
    await advanceReady() // nextTick 跑：attach() 失败 → 排 rAF1（queue=1，retryRaf=rAF1.id）
    expect(rafQueue.size).toBe(1)
    flushOneRaf() // rAF1 callback：retryRaf=0 → attach() 仍失败（无 panel）→ 排 rAF2（queue=1）
    expect(rafQueue.size).toBe(1)
    flushOneRaf() // rAF2 callback：retryRaf=0 → attach() 仍失败 → **源码无第三层 rAF 嵌套**，不再排（queue=0）
    expect(rafQueue.size).toBe(0)
    // 重试链已终止：再 flush 无项，监听未挂（无 panel 无 scroll 可派发）
    expect(document.getElementById('panelContent')).toBe(null)
    w.unmount()
  })

  it('rAF2 前补 panel → flushOne rAF2 内 attach 成功挂监听（滚响应加 class）', async () => {
    // 无 panel：nextTick 时 attach 失败排 rAF1
    mountDom({ withPanel: false })
    const w = await setup()
    await advanceReady() // nextTick：attach 失败排 rAF1（queue=1）
    expect(rafQueue.size).toBe(1)
    flushOneRaf() // rAF1：attach 仍失败排 rAF2（queue=1）
    expect(rafQueue.size).toBe(1)
    // 现在补 panelContent + scrollTop getter/setter，下次 attach 实时读 DOM 会成功
    const panel = document.createElement('div')
    panel.id = 'panelContent'
    let _st = 0
    Object.defineProperty(panel, 'scrollTop', {
      get: () => _st, set: (v: number) => { _st = v }, configurable: true,
    })
    document.body.appendChild(panel)
    flushOneRaf() // rAF2 callback：attach() 实时读 panel 成功挂监听（queue=0）
    expect(rafQueue.size).toBe(0)
    _st = 141
    panel.dispatchEvent(new Event('scroll'))
    flushOneRaf()
    expect(document.querySelector('.panel-main-inner')!.classList.contains('scrolled-header')).toBe(true)
    w.unmount()
  })
})

describe('useScrollHeader detach 清在途 retryRaf + onUnmounted', () => {
  it('在非移动端切换触发 detach 时 retryRaf>0 → cancelAnimationFrame + 复位', async () => {
    // attach 仍在重试时（retryRaf rAF 在途），切 isMobile=false 触 detach 应 cancel 在途 rAF
    mountDom({ withPanel: false })
    const w = await setup()
    await advanceReady() // nextTick 后 attach 失败排首个 retryRaf rAF（queue 有项）
    const queuedBefore = rafQueue.size
    expect(queuedBefore).toBeGreaterThanOrEqual(1)
    // 切非 mobile 触 watch callback→detach()：line 70 if(retryRaf){cancelAnimationFrame;retryRaf=0}
    uiHolder.isMobile = false
    await advanceReady()
    expect(rafQueue.size).toBeLessThan(queuedBefore)
    w.unmount()
  })

  it('在途 retryRaf 时直接 unmount → detach cancelAnimationFrame 清在途 rAF + stopWatch（line 70 + 98）', async () => {
    // 无 panel：attach 失败排 retryRaf rAF 在途（queue=1，retryRaf=rAF1.id），unmount 触 detach 应 cancel 在途 rAF
    mountDom({ withPanel: false })
    const w = await setup()
    await advanceReady() // nextTick 后 attach 失败排首个 retryRaf rAF（queue=1）
    expect(rafQueue.size).toBe(1)
    w.unmount() // onUnmounted → detach() → line 70 `if(retryRaf){cancelAnimationFrame;retryRaf=0}` 清在途 rAF + stopWatch 停 watch
    expect(rafQueue.size).toBe(0) // 在途 rAF 被 cancel 删出 queue
    // 卸载后 watch 已停：再切 isMobile 不触 detach/attach（无副作用验证 queue 仍空）
    uiHolder.isMobile = false
    await advanceReady()
    uiHolder.isMobile = true
    await advanceReady()
    expect(rafQueue.size).toBe(0)
  })
})
