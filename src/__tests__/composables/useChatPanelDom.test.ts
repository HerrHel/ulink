/**
 * useChatPanelDom 单测：DetailPanel 面板 DOM 行为抽取后的回归锁
 * 覆盖：输入框自适应高度阈值、滚动到底（smooth/fallback）、拖拽悬停高亮与
 * 拖拽结束复位、下滑关闭手势 30% 阈值、panelStyle transform、卸载移除触摸监听。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useChatPanelDom } from '../../composables/ui/useChatPanelDom.js'
import { useUIStore } from '../../stores/ui.js'

// isMobile 决定手势是否启用：锁定 true
vi.mock('../../utils.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../utils.js')>()
  return { ...mod, isMobile: () => true }
})

type Api = ReturnType<typeof useChatPanelDom>

interface Harness {
  api: Api
  panel: HTMLElement
  textarea: HTMLTextAreaElement
  scroll: HTMLElement
  query: { value: string }
  wrapper: ReturnType<typeof mount>
}

function makeHarness(panelHeight = 300): Harness {
  // 手势起手要求面板处于打开态（ui.panels.detail），否则 onSwipeStart 直接 return
  useUIStore().panels.detail = true
  const query = { value: '' }
  let api!: Api
  const panelRef = ref<HTMLElement | null>(null)
  const textareaRef = ref<HTMLTextAreaElement | null>(null)
  const scrollRef = ref<HTMLElement | null>(null)

  const Comp = defineComponent({
    setup() {
      api = useChatPanelDom({
        panelRef,
        textareaRef,
        scrollRef,
        getQuery: () => query.value,
      })
      return () =>
        h('div', { ref: panelRef }, [
          h('div', { class: 'detail-drag-handle' }),
          h('textarea', { ref: textareaRef }),
          h('div', { ref: scrollRef }),
        ])
    },
  })
  const wrapper = mount(Comp, { attachTo: document.body })
  const panel = panelRef.value as HTMLElement
  Object.defineProperty(panel, 'offsetHeight', { value: panelHeight, configurable: true })
  return {
    api,
    panel,
    textarea: textareaRef.value as HTMLTextAreaElement,
    scroll: scrollRef.value as HTMLElement,
    query,
    wrapper,
  }
}

/** 构造带 touches 的TouchEvent（jsdom 无 TouchEvent 构造器） */
function touchEvent(type: string, clientY: number, target: EventTarget): TouchEvent {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'touches', { value: [{ clientY }] })
  Object.defineProperty(ev, 'target', { value: target })
  return ev as TouchEvent
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('useChatPanelDom 输入框自适应高度', () => {
  it('空输入固定 24px 且隐藏滚动条', async () => {
    const h1 = makeHarness()
    h1.api.adjustTextareaHeight()
    await nextTick()
    expect(h1.textarea.style.height).toBe('24px')
    expect(h1.textarea.style.overflowY).toBe('hidden')
    h1.wrapper.unmount()
  })

  it('有内容按 scrollHeight 截断到 160px，超出后允许滚动', async () => {
    const h1 = makeHarness()
    h1.query.value = '一些问题'
    Object.defineProperty(h1.textarea, 'scrollHeight', { value: 200, configurable: true })
    h1.api.adjustTextareaHeight()
    await nextTick()
    expect(h1.textarea.style.height).toBe('160px')
    expect(h1.textarea.style.overflowY).toBe('auto')
    h1.wrapper.unmount()
  })
})

describe('useChatPanelDom 滚动到底', () => {
  it('smooth 走 scrollTo，随后同步 scrollTop', async () => {
    const h1 = makeHarness()
    const scrollTo = vi.fn()
    Object.defineProperty(h1.scroll, 'scrollTo', { value: scrollTo, configurable: true })
    Object.defineProperty(h1.scroll, 'scrollHeight', { value: 500, configurable: true })
    h1.api.scrollToBottom(true)
    await nextTick()
    expect(scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'smooth' })
    expect(h1.scroll.scrollTop).toBe(500)
    h1.wrapper.unmount()
  })

  it('scrollTo 抛错时兜底直接赋值 scrollTop', async () => {
    const h1 = makeHarness()
    Object.defineProperty(h1.scroll, 'scrollTo', {
      value: () => { throw new Error('no') },
      configurable: true,
    })
    Object.defineProperty(h1.scroll, 'scrollHeight', { value: 300, configurable: true })
    h1.api.scrollToBottom(true)
    await nextTick()
    expect(h1.scroll.scrollTop).toBe(300)
    h1.wrapper.unmount()
  })
})

describe('useChatPanelDom 拖拽悬停', () => {
  it('拖拽中 dragover 置高亮，出界 dragleave 复位，drop 复位', async () => {
    const h1 = makeHarness()
    const ui = useUIStore()

    // 拖拽中 dragover → 高亮（防假绿：走真实置位路径）
    ui.isDraggingCard = true
    h1.api.onPanelDragOver()
    expect(h1.api.isDragOverPanel.value).toBe(true)

    // drop → 复位
    h1.api.onPanelDrop()
    expect(h1.api.isDragOverPanel.value).toBe(false)

    // 出界 dragleave：客户端坐标在面板 rect 外
    Object.defineProperty(h1.panel, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
      configurable: true,
    })
    h1.api.onPanelDragLeave({ clientX: 200, clientY: 50 } as DragEvent)
    expect(h1.api.isDragOverPanel.value).toBe(false)
    h1.wrapper.unmount()
  })
})

describe('useChatPanelDom 下滑关闭手势', () => {
  it('超过面板高度 30% 松手关闭面板，panelStyle 跟手', async () => {
    const h1 = makeHarness(300)
    const handle = h1.panel.querySelector('.detail-drag-handle') as HTMLElement
    h1.panel.dispatchEvent(touchEvent('touchstart', 100, handle))
    h1.panel.dispatchEvent(touchEvent('touchmove', 250, handle))
    expect(h1.api.isSwiping.value).toBe(true)
    expect(h1.api.translateY.value).toBe(150)
    expect(h1.api.panelStyle.value).toEqual({ transform: 'translateY(150px)' })

    h1.panel.dispatchEvent(touchEvent('touchend', 250, handle))
    // 超阈值 → 面板关闭（store 真实状态断言，防假绿）
    expect(useUIStore().panels.detail).toBe(false)
    expect(h1.api.translateY.value).toBe(0)
    expect(h1.api.isSwiping.value).toBe(false)
    expect(h1.api.panelStyle.value).toBeUndefined()
    h1.wrapper.unmount()
  })

  it('未超阈值松手不关闭且复位', async () => {
    const h1 = makeHarness(300)
    const handle = h1.panel.querySelector('.detail-drag-handle') as HTMLElement
    h1.panel.dispatchEvent(touchEvent('touchstart', 100, handle))
    h1.panel.dispatchEvent(touchEvent('touchmove', 150, handle))
    h1.panel.dispatchEvent(touchEvent('touchend', 150, handle))
    expect(useUIStore().panels.detail).toBe(true) // 未超阈值不关闭
    expect(h1.api.translateY.value).toBe(0)
    expect(h1.api.isSwiping.value).toBe(false)
    h1.wrapper.unmount()
  })

  it('起手不在拖拽手柄上不触发手势', async () => {
    const h1 = makeHarness()
    const other = h1.panel.querySelector('textarea') as HTMLElement
    h1.panel.dispatchEvent(touchEvent('touchstart', 100, other))
    h1.panel.dispatchEvent(touchEvent('touchmove', 300, other))
    expect(h1.api.isSwiping.value).toBe(false)
    expect(h1.api.translateY.value).toBe(0)
    h1.wrapper.unmount()
  })
})
