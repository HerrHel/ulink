/**
 * useChatAutoScroll — 对话流滚动容器的粘性贴底（Sticky Bottom）控制
 *
 * 解决流式输出（onTurnsChanged）与用户手动上翻抢控制权的问题：
 * 1. 默认自动贴底跟随；
 * 2. 一旦用户主动向上滚动（滚轮 deltaY < 0、触屏手势下拉、键盘/滚动条上拖、锚点跳转），
 *    立即暂停自动跟随，后续流式输出不再把 scrollTop 拽回底部；
 * 3. 用户重新滚回底部贴近区、提交新问题或切换会话时，恢复自动跟随。
 */
import { getCurrentInstance, nextTick, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'

export interface ChatAutoScrollOptions {
  scrollRef: Ref<HTMLElement | null>
  /** 向上滚动脱离自动跟随的距离阈值（px），默认 8 */
  detachThreshold?: number
  /** 向下滚回底部恢复自动跟随的距离阈值（px），默认 24 */
  reattachThreshold?: number
}

export interface ScrollToBottomOptions {
  smooth?: boolean
  /** 强制滚到底部并恢复自动跟随（提交新问题、切换会话等主动操作） */
  force?: boolean
}

function hasInnerScrollableInDirection(
  target: EventTarget | null,
  container: HTMLElement,
  deltaY: number,
): boolean {
  let node = target instanceof Element ? target : null
  while (node && node !== container) {
    if (node.scrollHeight > node.clientHeight + 1) {
      let overflowY = 'visible'
      if (typeof getComputedStyle === 'function') {
        overflowY = getComputedStyle(node).overflowY
      }
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
        if (deltaY < 0 && node.scrollTop > 0) return true
        if (deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true
      }
    }
    node = node.parentElement
  }
  return false
}

export function useChatAutoScroll(options: ChatAutoScrollOptions) {
  const {
    scrollRef,
    detachThreshold = 8,
    reattachThreshold = 24,
  } = options

  const userScrolledUp = ref(false)

  let lastScrollTop = 0
  let programmaticTargetTop: number | null = null
  let programmaticRafId = 0
  let pendingScroll = false
  let pendingSmooth = false
  let pendingForce = false

  let isTouchActive = false
  let touchStartY: number | null = null
  let isScrollbarDragging = false
  let currentEl: HTMLElement | null = null

  function cancelProgrammaticClear() {
    if (programmaticRafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(programmaticRafId)
      programmaticRafId = 0
    }
  }

  function clearScrollbarDragListeners() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', onWindowPointerEnd)
      window.removeEventListener('pointercancel', onWindowPointerEnd)
    }
  }

  function onWindowPointerEnd() {
    isScrollbarDragging = false
    clearScrollbarDragListeners()
  }

  function onScroll() {
    const el = scrollRef.value
    if (!el) return

    const currentTop = el.scrollTop
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
    const distanceToBottom = el.scrollHeight - currentTop - el.clientHeight

    // 内容未溢出容器时无需暂停跟随
    if (el.scrollHeight <= el.clientHeight + 1) {
      programmaticTargetTop = null
      userScrolledUp.value = false
      lastScrollTop = currentTop
      return
    }

    // 忽略 scrollToBottom() 触发的同位置程序化 scroll 回调：
    // 防止在赋值 scrollTop 到异步 scroll 事件派发之间 scrollHeight 恰好增长时被误判为上滑
    if (
      programmaticTargetTop !== null &&
      Math.abs(currentTop - programmaticTargetTop) <= 1 &&
      currentTop >= lastScrollTop - 1
    ) {
      programmaticTargetTop = null
      lastScrollTop = currentTop
      return
    }
    programmaticTargetTop = null

    if (currentTop < lastScrollTop - 1) {
      // 向上滚动：只要离开底部超过 detachThreshold 即暂停自动跟随；
      // 若仅因上方折叠体收起导致 scrollHeight 变矮而被钳制到新底部，distanceToBottom ≈ 0，不误暂停
      if (distanceToBottom > detachThreshold) {
        userScrolledUp.value = true
      }
    } else if (currentTop > lastScrollTop + 1) {
      // 明确向下滚动：滚回底部贴近区才恢复自动跟随；尚未到底则保持脱离态
      if (distanceToBottom <= reattachThreshold) {
        userScrolledUp.value = false
      } else if (distanceToBottom > detachThreshold && maxScroll > 0) {
        userScrolledUp.value = true
      }
    }

    lastScrollTop = currentTop
  }

  function onWheel(e: WheelEvent) {
    const el = scrollRef.value
    if (!el) return
    // ctrlKey + wheel 为浏览器缩放手势，非滚动
    if (e.ctrlKey || e.deltaY === 0) return
    if (el.scrollHeight <= el.clientHeight + 1) return
    if (hasInnerScrollableInDirection(e.target, el, e.deltaY)) return

    if (e.deltaY < 0) {
      programmaticTargetTop = null
      userScrolledUp.value = true
      return
    }

    // 已经停在底部附近（如内容折叠后恰好贴底）且用户继续向下滚轮时恢复跟随
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (userScrolledUp.value && distanceToBottom <= reattachThreshold) {
      userScrolledUp.value = false
    }
  }

  function onTouchStart(e: TouchEvent) {
    isTouchActive = true
    touchStartY = e.touches?.[0]?.clientY ?? null
  }

  function onTouchMove(e: TouchEvent) {
    const el = scrollRef.value
    if (!el || touchStartY === null) return
    const curY = e.touches?.[0]?.clientY
    if (typeof curY !== 'number') return
    // 手指下滑即页面内容向上滚（查看历史消息）
    if (curY > touchStartY + 4 && el.scrollHeight > el.clientHeight + 1) {
      if (!hasInnerScrollableInDirection(e.target, el, -1)) {
        programmaticTargetTop = null
        userScrolledUp.value = true
      }
    }
  }

  function onTouchEnd() {
    isTouchActive = false
    touchStartY = null
  }

  function onPointerDown(e: PointerEvent) {
    const el = scrollRef.value
    if (!el || e.target !== el) return
    if (el.scrollHeight <= el.clientHeight + 1) return
    // 仅在点击经典纵向滚动条轨道区域时标记滚动条拖拽
    if (el.offsetWidth > el.clientWidth && typeof el.getBoundingClientRect === 'function') {
      const rect = el.getBoundingClientRect()
      if (e.clientX >= rect.left + el.clientLeft + el.clientWidth) {
        isScrollbarDragging = true
        if (typeof window !== 'undefined') {
          window.addEventListener('pointerup', onWindowPointerEnd)
          window.addEventListener('pointercancel', onWindowPointerEnd)
        }
      }
    }
  }

  function detach(el: HTMLElement | null) {
    if (!el) return
    el.removeEventListener('scroll', onScroll)
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('touchcancel', onTouchEnd)
    el.removeEventListener('pointerdown', onPointerDown)
  }

  function attach(el: HTMLElement | null) {
    if (!el) return
    lastScrollTop = el.scrollTop
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    el.addEventListener('pointerdown', onPointerDown, { passive: true })
  }

  function syncAttachedEl(nextEl: HTMLElement | null) {
    if (nextEl === currentEl) return
    if (currentEl) detach(currentEl)
    currentEl = nextEl
    if (nextEl) attach(nextEl)
  }

  watch(
    scrollRef,
    (nextEl) => {
      syncAttachedEl(nextEl)
    },
    { immediate: true },
  )

  if (getCurrentInstance()) {
    onMounted(() => {
      syncAttachedEl(scrollRef.value)
    })
  }

  onScopeDispose(() => {
    detach(currentEl)
    currentEl = null
    clearScrollbarDragListeners()
    cancelProgrammaticClear()
  })

  function executeScrollToBottom(smooth: boolean, force: boolean) {
    const el = scrollRef.value
    if (!el) return
    if (!force && (userScrolledUp.value || isTouchActive || isScrollbarDragging)) {
      return
    }
    if (force) {
      userScrolledUp.value = false
    }

    const prevTop = el.scrollTop
    if (typeof el.scrollTo === 'function' && smooth) {
      try {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: 'smooth',
        })
      } catch {
        // fallback to direct assignment
      }
    }
    el.scrollTop = el.scrollHeight
    const nextTop = el.scrollTop
    lastScrollTop = nextTop

    if (Math.abs(nextTop - prevTop) > 1) {
      programmaticTargetTop = nextTop
      cancelProgrammaticClear()
      if (typeof requestAnimationFrame === 'function') {
        programmaticRafId = requestAnimationFrame(() => {
          programmaticRafId = 0
          programmaticTargetTop = null
        })
      }
    } else {
      programmaticTargetTop = null
    }
  }

  function scrollToBottom(scrollOptions: ScrollToBottomOptions = {}) {
    const smooth = Boolean(scrollOptions.smooth)
    const force = Boolean(scrollOptions.force)

    if (force) {
      userScrolledUp.value = false
      pendingForce = true
    }
    if (smooth) {
      pendingSmooth = true
    }
    if (!force && (userScrolledUp.value || isTouchActive || isScrollbarDragging)) {
      return
    }
    if (pendingScroll) return
    pendingScroll = true
    nextTick(() => {
      const runSmooth = pendingSmooth
      const runForce = pendingForce
      pendingScroll = false
      pendingSmooth = false
      pendingForce = false
      executeScrollToBottom(runSmooth, runForce)
    })
  }

  /**
   * 显式手动定位（如左侧消息锚点跳转）前调用：
   * 若目标位置不在底部区域，提前切入暂停跟随，避免流式输出取消平滑跳转。
   */
  function notifyManualScroll(targetTop?: number) {
    const el = scrollRef.value
    programmaticTargetTop = null
    if (!el) {
      userScrolledUp.value = true
      return
    }
    if (typeof targetTop === 'number') {
      const distanceAtTarget = el.scrollHeight - targetTop - el.clientHeight
      userScrolledUp.value = distanceAtTarget > detachThreshold
      return
    }
    userScrolledUp.value = true
  }

  /** 重置为跟随底部状态（新对话 / 切换会话时调用） */
  function resetAutoScroll() {
    userScrolledUp.value = false
    programmaticTargetTop = null
    cancelProgrammaticClear()
    lastScrollTop = scrollRef.value?.scrollTop ?? 0
  }

  return {
    userScrolledUp,
    scrollToBottom,
    notifyManualScroll,
    resetAutoScroll,
  }
}
