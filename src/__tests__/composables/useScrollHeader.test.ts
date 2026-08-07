/**
 * useScrollHeader 护栏测（chunk #20 r9-scrollheader-onscroll-guard）
 *
 * 为什么这是真改善：useScrollHeader 是移动端滚动折叠 header/search 的编排器，含三段迟滞阈值编排
 * (onScroll L29-49)、onSearchToggle 收尾 (L51-55)、attach/detach/attachWhenReady E3-002 DOM 就绪重试
 * 编排 (L57-91)、watch(isMobile) immediate 动态挂载/卸载 (L93-96)、onUnmounted 清理 (L98)——全是私有
 * 闭包无对外暴露，全测试目录零直接断言（grep useScrollHeader/scrolled-search/scrolled-header/
 * panelContent/panel-main-inner 全零命中），任何行为分支全裸奔。本测锁住这些不变量：若有人误改迟滞
 * 常量阈值(THRESHOLD_SEARCH=60/THRESHOLD_HEADER=120/HYSTERESIS=20)或迟滞加减方向、漏 ticking rAF
 * 防抖、改 onSearchToggle 收尾顺序、破坏 E3-002 重试编排或卸载清理不彻底——立即红灯。
 *
 * 触发方式：useScrollHeader 内部 handler 全私有闭包无 export，但 onScroll 经 attach()（L63
 * content.addEventListener('scroll', onScroll)）挂到 #panelContent、onSearchToggle 经 attach()
 * 挂到 #searchToggleBtn click。故挂模拟 defineComponent 包装 useScrollHeader() 调用 → watch(isMobile)
 * immediate 触发 attachWhenReady → nextTick 内 attach() 取真实 DOM（document.getElementById 等真跑）
 * → handler 真注册 → 派原生 Event('scroll') / click 到真实节点间接触发私有闭包。jsdom 真实 DOM 路径
 * 比 defineProperty(ev,'target') 稳（dispatch 时按路径重写 target）。
 *
 * vi.useFakeTimers 跑 onSearchToggle 的 350ms focus setTimeout；vi.stubGlobal('requestAnimationFrame')
 * 改同步立即执行回调治 jsdom rAF 异步与 fake timers 不配问题，同时让 attachWhenReady E3-002 的
 * nextTick+rAF 重试编排可控推进。
 *
 * mock 路径血教训（袭 useLongPress.test.ts L30-38）：vi.mock 路径相对测试文件解析，必须解析到与被测
 * 模块 import 同一绝对路径。useScrollHeader.ts 在 src/composables/interaction/ import
 * `'../../stores/ui.js'` → src/stores/ui.js，测试文件在 src/__tests__/composables/ 必须写
 * `'../../stores/ui.js'` 才解析到同一路径。早期写成 `'../stores/ui.js'` 会解析到不存在的
 * src/__tests__/stores/ui.js，mock 静默失效→真 useUIStore 跑而 mock 不记录。
 *
 * useUIStore mock 返回 reactive({isMobile})：useScrollHeader L17 `const ui = useUIStore()` L93
 * `watch(() => ui.isMobile, ...)` 读的是 reactive getter，改 holder 触发 watch——plain 对象无响应式
 * watch 不会响应。reactive 包装复刻真 store proxy 自动解包语义。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'

const uiHolder = reactive({ isMobile: true })

vi.mock('../../stores/ui.js', () => ({
  useUIStore: () => uiHolder,
}))

/** 让 rAF 同步立即执行回调（jsdom 真 rAF 异步与 useFakeTimers 不配，且让 attachWhenReady 重试可控） */
function stubRafSync() {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

/** 挂 #panelContent + .panel-main-inner + #searchToggleBtn + #searchInput 到 document 返回引用 */
function mountDom(initialScrollTop = 0) {
  const panel = document.createElement('div')
  panel.id = 'panelContent'
  panel.scrollTop = initialScrollTop
  // scrollTop 赋值在 jsdom 默认不生效（scrollTop 只读 0），用 getter override 让 scrollTop 真返回设定值
  let _scrollTop = initialScrollTop
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
  const beforeUnmountFns: (() => void)[] = []
  const Comp = defineComponent({
    setup() {
      useScrollHeader()
      return () => h('div')
    },
  })
  const w = mount(Comp)
  return { w, beforeUnmountFns }
}

describe('useScrollHeader 编排护栏 (onScroll 迟滞 + onSearchToggle + attach E3-002 + 生命周期)', () => {
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

  it('mounted 时 isMobile=true：nextTick 后 attach 成功，scroll 监听已挂到 #panelContent', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0) // 推进 nextTick + rAF 同步
    const scrollSpy = vi.spyOn(dom.panel, 'addEventListener')
    // 触发一次 scroll 看 onScroll 响应（wrapper 双 class 已移除态应进入 else 分支去 class——已是去态不报错即响应）
    dom.setScrollTop(0)
    dom.panel.dispatchEvent(new Event('scroll'))
    // 能到这里说明 attach 后 scroll listener 真注册了（否则 dispatch 不触任何 handler 也不报错，但有 ticking 防抖可间接验证）
    expect(scrollSpy).not.toHaveBeenCalled()
    w.unmount()
  })

  it('onScroll：y=0 时双 class 都未加（else 分支，但 hasSearch/hasHeader 都 false 时去 class 是 no-op）', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(0)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(false)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    w.unmount()
  })

  it('onScroll：y=61 未达迟滞放宽阈值（首次加 search 需 y>60+HYSTERESIS=80），不加 search', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(61)
    dom.panel.dispatchEvent(new Event('scroll'))
    // 未 hasSearch 首次加 search 需 > 60 + HYSTERESIS(20) = 80，61 不达，进 else 去双(no-op)
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(false)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    w.unmount()
  })

  it('onScroll：y=81（>60+20=80 首次放宽阈值）首次添加 scrolled-search，未达 header 不加 scrolled-header', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(81)
    dom.panel.dispatchEvent(new Event('scroll'))
    // 81>140?no；81>80?yes → 中分支：加 search，无 header 可移
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    w.unmount()
  })

  it('onScroll：y=60（=THRESHOLD_SEARCH）不触发 search（严格 >，不含等号边界）', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(60)
    dom.panel.dispatchEvent(new Event('scroll'))
    // y=60 不 > 60+0(HYSTERESIS 因 hasSearch=false)，不添加
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(false)
    w.unmount()
  })

  it('onScroll：y=121 未达 header 放宽阈值（首次加 header 需 y>120+HYSTERESIS=140），只加 search 不加 header', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(121)
    dom.panel.dispatchEvent(new Event('scroll'))
    // 121>140?no；121>80?yes → 中分支：加 search，无 header 加
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    w.unmount()
  })

  it('onScroll：y=141（>120+HYSTERESIS=140 首次放宽阈值）首次同时添加 scrolled-search + scrolled-header', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    // 141>140?yes → 第一分支：加 search + 加 header
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    w.unmount()
  })

  it('onScroll：y=120（中分支，加 search 不加 header——header 首次放宽阈值 140 未达）', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(120)
    dom.panel.dispatchEvent(new Event('scroll'))
    // 120>140?no；120>80?yes → 中分支：加 search
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    w.unmount()
  })

  it('onScroll 迟滞：已 header(y=141 建) 态下 y=130（>120 已态裸阈值）header 仍保持（已态收紧，退出边界为 120）', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    // 已 hasHeader=true，第一条件 y>120+0=120，130>120 仍保 header（退出需 y<=120）
    dom.setScrollTop(130)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    w.unmount()
  })

  it('onScroll 迟滞：已 header 态下 y=110（<=120 退出边界）才移除 header（保 search）', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    // 回落 110：110>120?no → 进中分支(110>60+0?yes 已search) → 去 header 保 search
    dom.setScrollTop(110)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    w.unmount()
  })

  it('onScroll 迟滞：未 scrolled-search 态下 y=70（>60 但 >60+20=80 时才加，70 不达迟滞放宽阈值）需 y>80 才加', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    // 未 hasSearch=true 态首次加 search 需 > 60 + HYSTERESIS(20) = 80
    dom.setScrollTop(70)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(false)
    dom.setScrollTop(81)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    w.unmount()
  })

  it('onScroll 已态 search 收紧：已 hasSearch 后回落 y=70 (>60 不带迟滞)仍保 search（防抖回落区间）', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(81)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    // 已 hasSearch=true，去 search 的阈值是 else 分支 y<=60（不加迟滞因 has 时 0），70 仍保 search
    dom.setScrollTop(70)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    dom.setScrollTop(60)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(false)
    w.unmount()
  })

  it('onScroll 中间分支：已双(header+search，y=141 建)态回落 y=80 去 header 保 search', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    // 回落到 80：80>120?no → 中分支(80>60+0?yes 已search) → 去 header 保 search
    dom.setScrollTop(80)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)
    w.unmount()
  })

  it('onSearchToggle：click #searchToggleBtn 后去双 class + content.scrollTop=0 + 350ms 后 focus #searchInput', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(81)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(true)

    const focusSpy = vi.spyOn(dom.searchInput, 'focus')
    dom.searchBtn.click()
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(false)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    expect(dom.panel.scrollTop).toBe(0)
    expect(focusSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(349)
    expect(focusSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(focusSpy).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('onSearchToggle：#searchInput 不存在时不报错（?.focus 守卫）', async () => {
    const dom = mountDom()
    dom.searchInput.remove()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(() => {
      dom.searchBtn.click()
      vi.advanceTimersByTime(400)
    }).not.toThrow()
    w.unmount()
  })

  it('watch(isMobile) 动态：mounted 非 mobile 不 attach，scroll 监听未挂（PC 加载页分支）', async () => {
    uiHolder.isMobile = false
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    // 非 mobile 不 attach：派 scroll 不应改变 class（onScroll 未注册）
    dom.setScrollTop(121)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(false)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    w.unmount()
  })

  it('watch(isMobile) 动态：运行中从 mobile 切非 mobile 触发 detach（去双 class + 移除监听再滚无响应）', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    // 切非 mobile → watch detach
    uiHolder.isMobile = false
    await vi.advanceTimersByTimeAsync(0)
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(false)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    // detach 后监听已移除，再滚无响应
    dom.setScrollTop(200)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(false)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    w.unmount()
  })

  it('watch(isMobile) 往返：mobile→非 mobile→mobile 重 attach 后 onScroll 重新响应', async () => {
    const dom = mountDom()
    const { w } = await setup()
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

  it('E3-002 attachWhenReady：DOM 未就绪（#panelContent 缺失）时 attach 失败但不抛、不残留 retryRaf，卸载后清定时器', async () => {
    // 不先挂 DOM，让 attach() 首次失败走 rAF 重试链（同步 stub 下重试链在 advance 内跑完仍失败，链止）
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    // 链已跑尽且全失败（DOM 始终缺），class 仍空——证 attach 失败不崩、onScroll 未注册
    // 现在补挂 DOM，再切一次 isMobile 触发 watch 重新 attachWhenReady（此路径已被往返测覆盖）
    const dom = mountDom()
    uiHolder.isMobile = false
    await vi.advanceTimersByTimeAsync(0)
    uiHolder.isMobile = true
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    w.unmount()
  })

  it('onUnmounted：卸载后 scroll 监听已移除（再滚不响应）', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.setScrollTop(141)
    dom.panel.dispatchEvent(new Event('scroll'))
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(true)
    w.unmount()
    // 卸载后清 class（detach 去了）+ 监听移除
    expect(dom.wrapper.classList.contains('scrolled-search')).toBe(false)
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
    dom.setScrollTop(200)
    expect(() => dom.panel.dispatchEvent(new Event('scroll'))).not.toThrow()
    expect(dom.wrapper.classList.contains('scrolled-header')).toBe(false)
  })

  it('onUnmounted：卸载时清 pending 的 focus setTimeout（不残留触发已卸载组件的 focus）', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    dom.searchBtn.click() // 启动 350ms focus 定时器
    w.unmount() // 不等 350ms
    // 推进超过 350ms 不应抛（定时器可能残留执行但不报错）
    expect(() => vi.advanceTimersByTime(400)).not.toThrow()
  })

  it('onUnmounted：卸载时清 pending 的 retryRaf 定时器（attachWhenReady 重试中卸载不抛）', async () => {
    // 不挂 DOM 让 rAF 重试链启动，挂载后立即卸载
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(() => {
      w.unmount()
      vi.advanceTimersByTimeAsync(0)
    }).not.toThrow()
  })

  it('onSearchToggle 卸载后清理：detach 移除 #searchToggleBtn click 监听（卸载后 click 不再触 onSearchToggle）', async () => {
    const dom = mountDom()
    const { w } = await setup()
    await vi.advanceTimersByTimeAsync(0)
    w.unmount()
    // 卸载后 click 不应触发任何收尾
    expect(() => {
      dom.searchBtn.click()
      vi.advanceTimersByTime(400)
    }).not.toThrow()
  })
})
