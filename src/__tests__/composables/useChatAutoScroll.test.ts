import { describe, it, expect, beforeEach } from 'vitest'
import { ref, defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useChatAutoScroll } from '../../composables/ui/useChatAutoScroll.js'

type AutoScrollApi = ReturnType<typeof useChatAutoScroll>

function createTouchEvent(type: string, clientY: number, target: EventTarget): TouchEvent {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'touches', { value: [{ clientY }] })
  Object.defineProperty(ev, 'target', { value: target })
  return ev as TouchEvent
}

function setMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

function makeHarness() {
  let api!: AutoScrollApi
  const scrollRef = ref<HTMLElement | null>(null)
  const innerRef = ref<HTMLElement | null>(null)

  const Comp = defineComponent({
    setup() {
      api = useChatAutoScroll({ scrollRef })
      return () =>
        h('div', { ref: scrollRef }, [
          h('div', { ref: innerRef, style: 'overflow-y: auto;' }),
        ])
    },
  })

  const wrapper = mount(Comp, { attachTo: document.body })
  return {
    api,
    el: scrollRef.value as HTMLElement,
    innerEl: innerRef.value as HTMLElement,
    wrapper,
  }
}

describe('useChatAutoScroll', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('流式增量期间默认持续吸底跟随', async () => {
    const { api, el, wrapper } = makeHarness()
    setMetrics(el, 800, 400)

    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(800)
    expect(api.userScrolledUp.value).toBe(false)

    // 模拟流式增长
    setMetrics(el, 1100, 400)
    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(1100)
    expect(api.userScrolledUp.value).toBe(false)

    wrapper.unmount()
  })

  it('用户手动向上滚动（即使仅上翻 15px）立即暂停自动跟随，不被后续增量拽回底部', async () => {
    const { api, el, wrapper } = makeHarness()
    setMetrics(el, 1000, 400)
    // 贴近真实浏览器钳制后的最大 scrollTop = 600
    el.scrollTop = 600
    el.dispatchEvent(new Event('scroll'))
    // 先把 lastScrollTop 同步到真实底部 600 后模拟继续跟随
    el.scrollTop = 585 // 距离底部 15px > detachThreshold(8)
    el.dispatchEvent(new Event('scroll'))

    expect(api.userScrolledUp.value).toBe(true)

    // 后续流式内容继续生成
    setMetrics(el, 1400, 400)
    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(585)

    wrapper.unmount()
  })

  it('向上滚轮 (wheel deltaY < 0) 立即暂停自动跟随，阻止同帧后续 delta 抢控制权', async () => {
    const { api, el, wrapper } = makeHarness()
    setMetrics(el, 1200, 400)
    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(1200)

    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }))
    expect(api.userScrolledUp.value).toBe(true)

    el.scrollTop = 760
    setMetrics(el, 1500, 400)
    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(760)

    wrapper.unmount()
  })

  it('ctrlKey 缩放滚轮与未溢出容器不误触发暂停', async () => {
    const { api, el, wrapper } = makeHarness()

    // 未溢出时向上滚轮不应暂停
    setMetrics(el, 400, 400)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }))
    expect(api.userScrolledUp.value).toBe(false)

    // 溢出后 ctrlKey 捏合缩放手势不应暂停，且后续仍正常跟随
    setMetrics(el, 1000, 400)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, bubbles: true }))
    expect(api.userScrolledUp.value).toBe(false)
    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(1000)

    wrapper.unmount()
  })

  it('内部可滚动子容器（如思考过程框）向上滚轮时不提前暂停外层跟随', () => {
    const { api, el, innerEl, wrapper } = makeHarness()
    setMetrics(el, 1200, 400)
    setMetrics(innerEl, 500, 200)
    innerEl.scrollTop = 120

    innerEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, bubbles: true }))
    expect(api.userScrolledUp.value).toBe(false)

    // 当内部滚动框已到顶 (scrollTop === 0) 时，滚轮才外溢到主容器
    innerEl.scrollTop = 0
    innerEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, bubbles: true }))
    expect(api.userScrolledUp.value).toBe(true)

    wrapper.unmount()
  })

  it('scrollToBottom 与异步 scroll 事件之间内容恰好增长，不误判为用户上滑', async () => {
    const { api, el, wrapper } = makeHarness()
    setMetrics(el, 1000, 400)
    el.scrollTop = 500
    el.dispatchEvent(new Event('scroll'))
    api.resetAutoScroll()

    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(1000)

    // 在异步 scroll 派发前，新内容又撑高了 120px
    setMetrics(el, 1120, 400)
    el.dispatchEvent(new Event('scroll'))
    expect(api.userScrolledUp.value).toBe(false)

    wrapper.unmount()
  })

  it('折叠收起导致 scrollHeight 变矮、scrollTop 被浏览器钳制到新底部时，不误判为用户上滑', async () => {
    const { api, el, wrapper } = makeHarness()
    setMetrics(el, 1200, 400)
    el.scrollTop = 800
    el.dispatchEvent(new Event('scroll'))
    expect(api.userScrolledUp.value).toBe(false)

    // 思考框收起：总高度降到 950，浏览器把 scrollTop 钳制到 550（distanceToBottom === 0）
    setMetrics(el, 950, 400)
    el.scrollTop = 550
    el.dispatchEvent(new Event('scroll'))
    expect(api.userScrolledUp.value).toBe(false)

    // 后续正文增长时照常自动贴底
    setMetrics(el, 1300, 400)
    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(1300)

    wrapper.unmount()
  })

  it('移动端手指下滑（内容上翻）与按住触摸期间暂停自动跟随', async () => {
    const { api, el, wrapper } = makeHarness()
    setMetrics(el, 1000, 400)
    api.scrollToBottom()
    await nextTick()

    el.dispatchEvent(createTouchEvent('touchstart', 200, el))
    // 手指刚按住还没移动时也不抢滚动
    el.scrollTop = 580
    setMetrics(el, 1150, 400)
    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(580)

    // 手指下滑 > 4px，永久标记为上翻暂停
    el.dispatchEvent(createTouchEvent('touchmove', 230, el))
    el.dispatchEvent(createTouchEvent('touchend', 230, el))
    expect(api.userScrolledUp.value).toBe(true)

    setMetrics(el, 1300, 400)
    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(580)

    wrapper.unmount()
  })

  it('手动滚回底部贴近区后自动恢复吸底；半途向下翻不恢复', async () => {
    const { api, el, wrapper } = makeHarness()
    setMetrics(el, 1000, 400)
    el.scrollTop = 600
    el.dispatchEvent(new Event('scroll'))

    // 往上翻到 200
    el.scrollTop = 200
    el.dispatchEvent(new Event('scroll'))
    expect(api.userScrolledUp.value).toBe(true)

    // 往下翻到 400（距底部 200px，仍在半途）
    el.scrollTop = 400
    el.dispatchEvent(new Event('scroll'))
    expect(api.userScrolledUp.value).toBe(true)

    // 滚回底部（距底部 10px <= 24px）
    el.scrollTop = 590
    el.dispatchEvent(new Event('scroll'))
    expect(api.userScrolledUp.value).toBe(false)

    setMetrics(el, 1250, 400)
    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(1250)

    wrapper.unmount()
  })

  it('force=true 或 notifyManualScroll 分别用于新提问强制贴底与锚点跳转暂停', async () => {
    const { api, el, wrapper } = makeHarness()
    setMetrics(el, 1500, 500)

    // 跳转到上方历史消息（target = 100，距底部 900px）
    api.notifyManualScroll(100)
    expect(api.userScrolledUp.value).toBe(true)

    el.scrollTop = 100
    setMetrics(el, 1700, 500)
    api.scrollToBottom()
    await nextTick()
    expect(el.scrollTop).toBe(100)

    // 提交新消息（force: true）恢复吸底并滚到底部
    api.scrollToBottom({ force: true })
    await nextTick()
    expect(api.userScrolledUp.value).toBe(false)
    expect(el.scrollTop).toBe(1700)

    wrapper.unmount()
  })
})
