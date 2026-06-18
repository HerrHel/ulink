/**
 * useScrollHeader — 移动端滚动折叠 header/search
 * 从 app-legacy.js 中提取的移动端滚动逻辑。
 * 滚动距离超过阈值时，逐步折叠搜索栏和标题栏。
 */
import { onMounted, onUnmounted } from 'vue'
import { isMobile } from '../../utils.js'

export function useScrollHeader() {
  onMounted(() => {
    if (!isMobile()) return
    const content = document.getElementById('panelContent')
    const wrapper = document.querySelector('.panel-main-inner')
    if (!content || !wrapper) return

    const THRESHOLD_SEARCH = 60
    const THRESHOLD_HEADER = 120
    const HYSTERESIS = 20
    let ticking = false

    function onScroll() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = content.scrollTop
        const hasSearch = wrapper.classList.contains('scrolled-search')
        const hasHeader = wrapper.classList.contains('scrolled-header')

        if (y > THRESHOLD_HEADER + (hasHeader ? 0 : HYSTERESIS)) {
          if (!hasSearch) wrapper.classList.add('scrolled-search')
          if (!hasHeader) wrapper.classList.add('scrolled-header')
        } else if (y > THRESHOLD_SEARCH + (hasSearch ? 0 : HYSTERESIS)) {
          if (!hasSearch) wrapper.classList.add('scrolled-search')
          if (hasHeader) wrapper.classList.remove('scrolled-header')
        } else {
          if (hasSearch) wrapper.classList.remove('scrolled-search')
          if (hasHeader) wrapper.classList.remove('scrolled-header')
        }
        ticking = false
      })
    }

    content.addEventListener('scroll', onScroll, { passive: true })

    // 搜索切换按钮：展开搜索并聚焦
    const searchBtn = document.getElementById('searchToggleBtn')
    function onSearchToggle() {
      wrapper.classList.remove('scrolled-search', 'scrolled-header')
      content.scrollTop = 0
      setTimeout(() => { document.getElementById('searchInput')?.focus() }, 350)
    }
    if (searchBtn) searchBtn.addEventListener('click', onSearchToggle)

    onUnmounted(() => {
      content.removeEventListener('scroll', onScroll)
      if (searchBtn) searchBtn.removeEventListener('click', onSearchToggle)
    })
  })
}
