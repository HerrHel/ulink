/**
 * useScrollHeader — 移动端滚动折叠 header/search
 * 从 app-legacy.js 中提取的移动端滚动逻辑。
 * 滚动距离超过阈值时，逐步折叠搜索栏和标题栏。
 *
 * 旧实现在 onMounted 时用 isMobile() 一次性判断是否挂监听：PC 加载页时
 * isMobile()=false 直接 return，之后用 F12 切到移动端也不会补挂监听，
 * 滚动折叠失效，需刷新才生效。改为 watch(uiStore.isMobile) 动态挂载/卸载。
 *
 * E3-002：setup 期 immediate attach 时 #panelContent 尚未 mount，真机冷启动
 * isMobile 已为 true 会静默失败且不再触发。改为 nextTick + 失败时 rAF 再试。
 */
import { watch, onUnmounted, nextTick } from 'vue'
import { useUIStore } from '../../stores/ui.js'

export function useScrollHeader() {
  const ui = useUIStore()
  let content: HTMLElement | null = null
  let wrapper: HTMLElement | null = null
  let searchBtn: HTMLElement | null = null
  let attached = false
  let retryRaf = 0

  const THRESHOLD_SEARCH = 60
  const THRESHOLD_HEADER = 120
  const HYSTERESIS = 20
  let ticking = false

  function onScroll() {
    if (ticking || !content || !wrapper) return
    ticking = true
    requestAnimationFrame(() => {
      const y = content!.scrollTop
      const hasSearch = wrapper!.classList.contains('scrolled-search')
      const hasHeader = wrapper!.classList.contains('scrolled-header')

      if (y > THRESHOLD_HEADER + (hasHeader ? 0 : HYSTERESIS)) {
        if (!hasSearch) wrapper!.classList.add('scrolled-search')
        if (!hasHeader) wrapper!.classList.add('scrolled-header')
      } else if (y > THRESHOLD_SEARCH + (hasSearch ? 0 : HYSTERESIS)) {
        if (!hasSearch) wrapper!.classList.add('scrolled-search')
        if (hasHeader) wrapper!.classList.remove('scrolled-header')
      } else {
        if (hasSearch) wrapper!.classList.remove('scrolled-search')
        if (hasHeader) wrapper!.classList.remove('scrolled-header')
      }
      ticking = false
    })
  }

  function onSearchToggle() {
    wrapper?.classList.remove('scrolled-search', 'scrolled-header')
    if (content) content.scrollTop = 0
    setTimeout(() => { document.getElementById('searchInput')?.focus() }, 350)
  }

  function attach(): boolean {
    if (attached) return true
    content = document.getElementById('panelContent')
    wrapper = document.querySelector('.panel-main-inner')
    searchBtn = document.getElementById('searchToggleBtn')
    if (!content || !wrapper) return false
    content.addEventListener('scroll', onScroll, { passive: true })
    searchBtn?.addEventListener('click', onSearchToggle)
    attached = true
    return true
  }

  function detach() {
    if (retryRaf) { cancelAnimationFrame(retryRaf); retryRaf = 0 }
    if (content) content.removeEventListener('scroll', onScroll)
    if (searchBtn) searchBtn.removeEventListener('click', onSearchToggle)
    wrapper?.classList.remove('scrolled-search', 'scrolled-header')
    content = null
    wrapper = null
    searchBtn = null
    attached = false
  }

  /** E3-002：DOM 就绪后再挂；失败时下一帧再试 */
  function attachWhenReady() {
    nextTick(() => {
      if (attach()) return
      retryRaf = requestAnimationFrame(() => {
        retryRaf = 0
        if (!attach()) {
          retryRaf = requestAnimationFrame(() => { retryRaf = 0; attach() })
        }
      })
    })
  }

  const stopWatch = watch(() => ui.isMobile, (mobile) => {
    detach()
    if (mobile) attachWhenReady()
  }, { immediate: true })

  onUnmounted(() => { detach(); stopWatch() })
}
