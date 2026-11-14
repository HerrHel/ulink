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
  // 受管资源：滚动 rAF 与 focus 定时器，detach 时必须取消，否则悬挂回调读 null / ticking 卡死
  let scrollRaf = 0
  let focusTimer: ReturnType<typeof setTimeout> | null = null

  const THRESHOLD_SEARCH = 60
  const THRESHOLD_HEADER = 120
  const HYSTERESIS = 20
  let ticking = false

  function onScroll() {
    if (ticking || !content || !wrapper) return
    ticking = true
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      // 根因：detach 后 content/wrapper 已置空，悬挂回调读 null 会抛异常且 ticking 永久卡死；
      // 回调开头先判空并复位 ticking，主逻辑再用 try/finally 保证 ticking 一定复位。
      if (!content || !wrapper) { ticking = false; return }
      try {
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
      } finally {
        ticking = false
      }
    })
  }

  function onSearchToggle() {
    wrapper?.classList.remove('scrolled-search', 'scrolled-header')
    if (content) content.scrollTop = 0
    // focus 定时器受管清理：detach 后不再聚焦到已卸载的输入框
    if (focusTimer) clearTimeout(focusTimer)
    focusTimer = setTimeout(() => {
      focusTimer = null
      document.getElementById('searchInput')?.focus()
    }, 350)
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
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0 }
    if (focusTimer) { clearTimeout(focusTimer); focusTimer = null }
    // 悬挂 rAF 被取消后不会再复位 ticking，必须手动清零，否则重新 attach 后 onScroll 永久空转
    ticking = false
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
      // 代次校验：nextTick/rAF 排队期间 isMobile 可能在同一 tick 内回翻
      // （PC↔移动切换），此时回调不该再挂监听，否则会在非移动端错误挂上滚动监听。
      if (!ui.isMobile) return
      if (attach()) return
      retryRaf = requestAnimationFrame(() => {
        retryRaf = 0
        if (!ui.isMobile) return
        if (!attach()) {
          retryRaf = requestAnimationFrame(() => {
            retryRaf = 0
            if (!ui.isMobile) return
            attach()
          })
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
