/**
 * useScrollHeader — 移动端滚动折叠 header/search
 * 从 app-legacy.js 中提取的移动端滚动逻辑。
 * 滚动距离超过阈值时，逐步折叠搜索栏和标题栏。
 *
 * 旧实现在 onMounted 时用 isMobile() 一次性判断是否挂监听：PC 加载页时
 * isMobile()=false 直接 return，之后用 F12 切到移动端也不会补挂监听，
 * 滚动折叠失效，需刷新才生效。改为 watch(uiStore.isMobile) 动态挂载/卸载。
 */
import { watch, onUnmounted } from 'vue'
import { useUIStore } from '../../stores/ui.js'

export function useScrollHeader() {
  const ui = useUIStore()
  let content: HTMLElement | null = null
  let wrapper: HTMLElement | null = null
  let searchBtn: HTMLElement | null = null

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

  // 搜索切换按钮：展开搜索并聚焦
  function onSearchToggle() {
    wrapper?.classList.remove('scrolled-search', 'scrolled-header')
    if (content) content.scrollTop = 0
    setTimeout(() => { document.getElementById('searchInput')?.focus() }, 350)
  }

  function attach() {
    content = document.getElementById('panelContent')
    wrapper = document.querySelector('.panel-main-inner')
    searchBtn = document.getElementById('searchToggleBtn')
    if (!content || !wrapper) return
    content.addEventListener('scroll', onScroll, { passive: true })
    searchBtn?.addEventListener('click', onSearchToggle)
  }

  function detach() {
    if (content) content.removeEventListener('scroll', onScroll)
    if (searchBtn) searchBtn.removeEventListener('click', onSearchToggle)
    wrapper?.classList.remove('scrolled-search', 'scrolled-header')
    content = null
    wrapper = null
    searchBtn = null
  }

  // 切移动端挂监听，切回 PC 卸载并清除残留的折叠态 class
  const stopWatch = watch(() => ui.isMobile, (mobile) => {
    detach()
    if (mobile) attach()
  }, { immediate: true })

  onUnmounted(() => { detach(); stopWatch() })
}