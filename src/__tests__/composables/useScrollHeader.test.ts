/**
 * useScrollHeader 护栏测（精简版）
 *
 * 原文件 23 例随 r9-scrollheader-onscroll-guard 补入,逐阈值边界各立一例——但迟滞阈值
 * 常量(60/120/20)是纯 UI 交互细节,无数据/安全后果,回归表现为 header 折叠时机略偏,
 * 用户几乎无感。此精简版只留 7 例守核心契约:首次加 search 阈值、首次加 header 阈值、
 * 迟滞(N→已态收紧)、onSearchToggle 350ms 焦点、生命周期卸载清理、isMobile 重 attach。
 *
 * 删去:y=0/60/61/120/121/130/80 等逐点阈值镜像、中分支镜像、touchmove、E3-002
 * DOM 未就绪重试链细节、watch 往返、卸载后 click 监听移除等实现细节断言。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'

const uiHolder = reactive({ isMobile: true })

vi.mock('../../stores/ui.js', () => ({ useUIStore: () => uiHolder }))

/** rAF 同步立即执行回调（jsdom 真 rAF 异步与 useFakeTimers 不配） */
function stubRafSync() {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

function mountDom() {
  const panel = document.createElement('div')
  panel.id = 'panelContent'
  let _scrollTop = 0
  Object.defineProperty(panel, 'scrollTop', {
    get: () => _scrollTop,
    set: (v: number) => { _scrollTop = v },
    configurable: true,
  })
  document.body.appendChild(panel)
  const wrapper = document.createElement('div')
  wrapper.className = 'panel-main-inner'
  document.body.appendChild(wrapper)
  const searchBtn = document.createElement('button')
  searchBtn.id = 'searchToggleBtn'
  document.body.appendChild(searchBtn)
  const searchInput = document.createElement('input')
  searchInput.id = 'searchInput'
  document.body.appendChild(searchInput)
  return { panel, wrapper, searchBtn, searchInput, setScrollTop: (v: number) => { _scrollTop = v } }
}

async function setup() {
  const { useScrollHeader } = await import('../../composables/interaction/useScrollHeader.js')
  const Comp = defineComponent({ setup() { useScrollHeader(); return () => h('div') } })
  return mount(Comp)
}

describe('useScrollHeader 核心契约护栏', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubRafSync()
    uiHolder.isMobile = true
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('首次加 search 阈值：y=81 (>60+HYSTERESIS=80) 添加 scrolled-search', async () => {
    const dom = mountDom()
    const w = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(81)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    w.unmount()
  })

  it('首次加 header 阈值：y=141 (>120+HYSTERESIS=140) 同时加 search + header', async () => {
    const dom = mountDom()
    const w = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    w.unmount()
  })

  it('迟滞：已 header 态回落 y=110 (<=120) 才移除 header(已态收紧退出边界)', async () => {
    const dom = mountDom()
    const w = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    // 已态收紧：回落需 <=120 才去 header，110 去、130 不去
    dom.setScrollTop(110)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    w.unmount()
  })

  it('onSearchToggle：click #searchToggleBtn 去双 class + 回顶 + 350ms 后 focus #searchInput', async () => {
    const dom = mountDom()
    const w = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(81)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    const focusSpy = vi.spyOn(dom.searchInput, 'focus')
    dom.searchBtn.click()
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(false)
    expect(dom.panel.scrollTop).toBe(0)
    vi.advanceTimersByTime(350)
    expect(focusSpy).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('生命周期：卸载后 scroll 监听移除（再滚不响应、去双 class）', async () => {
    const dom = mountDom()
    const w = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    w.unmount()
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    dom.setScrollTop(200)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
  })

  it('watch(isMobile)：mobile → 非 mobile → mobile 重 attach 后重新响应 onScroll', async () => {
    const dom = mountDom()
    const w = await setup()
    await vi.advanceTimersByTimeAsync(0)
    uiHolder.isMobile = false
    await vi.advanceTimersByTimeAsync(0)
    uiHolder.isMobile = true
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    w.unmount()
  })
})
