import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const streamControl = vi.hoisted(() => ({
  onReasoningDelta: undefined as ((delta: string, acc: string) => void) | undefined,
  onContentDelta: undefined as ((delta: string, acc: string) => void) | undefined,
  resolve: undefined as ((res: { reply: string; cleanText: string; reasoning: string; candidates: [] }) => void) | undefined,
}))

vi.mock('../../lib/ai/mimoClient.js', () => ({
  askMiMoStream: vi.fn((_prompt, _opts, callbacks) => {
    streamControl.onReasoningDelta = callbacks?.onReasoningDelta
    streamControl.onContentDelta = callbacks?.onContentDelta
    return new Promise((resolve) => {
      streamControl.resolve = resolve
    })
  }),
  getMiMoConfig: vi.fn(() => ({ enabled: true, model: 'test-model', apiKey: '', baseUrl: '' })),
  sanitizeToolResult: (s: string) => s,
}))

vi.mock('../../lib/ai/queryExpand.js', () => ({
  expandQueryTerms: vi.fn(async () => []),
}))

import AiWorkspace from '../../components/chat/AiWorkspace.vue'
import DetailPanel from '../../components/shell/DetailPanel.vue'
import { useUIStore } from '../../stores/ui.js'

function setScrollMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

async function flushAsync() {
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

describe('AI 对话流式输出与用户手动上翻控制权', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    streamControl.onReasoningDelta = undefined
    streamControl.onContentDelta = undefined
    streamControl.resolve = undefined
  })

  it('AiWorkspace：流式阶段跟随到底；用户手动上翻后不再强行翻回页脚，重新贴底或新提问后恢复', async () => {
    const wrapper = mount(AiWorkspace, { attachTo: document.body })
    const scrollEl = wrapper.find('.ai-scroll-view').element as HTMLElement
    setScrollMetrics(scrollEl, 900, 400)

    const ta = wrapper.find('.ai-minimal-textarea')
    await ta.setValue('帮我总结前端架构')
    await ta.trigger('keydown', { key: 'Enter' })
    await flushAsync()

    // 1. 首问提交后自动贴底，并在流式 delta 到来时跟随新高度
    expect(scrollEl.scrollTop).toBe(900)

    setScrollMetrics(scrollEl, 1200, 400)
    streamControl.onReasoningDelta?.('先分析一下...', '先分析一下...')
    await nextTick()
    expect(scrollEl.scrollTop).toBe(1200)

    setScrollMetrics(scrollEl, 1400, 400)
    streamControl.onContentDelta?.('第一段正文', '第一段正文')
    await nextTick()
    expect(scrollEl.scrollTop).toBe(1400)

    // 2. 用户手动向上翻看前文（滚轮上滑 / scrollTop 上移）
    scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true }))
    scrollEl.scrollTop = 300
    scrollEl.dispatchEvent(new Event('scroll'))

    // 3. 模型继续流式输出大量内容，屏幕停在用户阅读位置，不被强制翻到页脚
    setScrollMetrics(scrollEl, 1900, 400)
    streamControl.onContentDelta?.('第二段长正文...', '第一段正文\n\n第二段长正文...')
    await nextTick()
    expect(scrollEl.scrollTop).toBe(300)

    // 4. 生成结束（finally 触发收尾）也不得把正在上方阅读的用户拽回底部
    streamControl.resolve?.({
      reply: '第一段正文\n\n第二段长正文...',
      cleanText: '第一段正文\n\n第二段长正文...',
      reasoning: '先分析一下...',
      candidates: [],
    })
    await flushAsync()
    expect(scrollEl.scrollTop).toBe(300)

    // 5. 用户主动发起新一轮提问时，恢复自动跟随并滚到底部
    const dockTa = wrapper.find('.dock-capsule .ai-minimal-textarea')
    await dockTa.setValue('继续展开第二点')
    await dockTa.trigger('keydown', { key: 'Enter' })
    await flushAsync()
    expect(scrollEl.scrollTop).toBe(1900)

    // 再次流式输出照常自动贴底
    setScrollMetrics(scrollEl, 2200, 400)
    streamControl.onContentDelta?.('好的，展开如下', '好的，展开如下')
    await nextTick()
    expect(scrollEl.scrollTop).toBe(2200)

    streamControl.resolve?.({
      reply: '好的，展开如下',
      cleanText: '好的，展开如下',
      reasoning: '',
      candidates: [],
    })
    await flushAsync()
    wrapper.unmount()
  })

  it('AiWorkspace：流式生成期间点击左侧轮次锚点跳转后，不被后续输出拽回底部', async () => {
    const now = Date.now()
    localStorage.setItem('lv_ai_sessions_v1', JSON.stringify([
      {
        id: 'session-jump',
        title: '长对话',
        turns: [
          { id: 't-1', role: 'user', content: '第一轮问题', timestamp: now - 2000 },
          { id: 't-1-a', role: 'assistant', content: '第一轮回答', timestamp: now - 1000 },
        ],
        createdAt: now - 2000,
        updatedAt: now - 1000,
      },
    ]))
    localStorage.setItem('lv_ai_cur_session_v1', 'session-jump')

    const wrapper = mount(AiWorkspace, { attachTo: document.body })
    const scrollEl = wrapper.find('.ai-scroll-view').element as HTMLElement
    setScrollMetrics(scrollEl, 1600, 400)
    const scrollToSpy = vi.fn(({ top }: { top: number }) => {
      scrollEl.scrollTop = top
    })
    Object.defineProperty(scrollEl, 'scrollTo', { value: scrollToSpy, configurable: true })

    // 发起新提问进入流式输出
    const dockTa = wrapper.find('.dock-capsule .ai-minimal-textarea')
    await dockTa.setValue('第二轮问题')
    await dockTa.trigger('keydown', { key: 'Enter' })
    await flushAsync()
    expect(scrollEl.scrollTop).toBe(1600)

    // 模拟点击左侧轮次导轨跳回第一轮（target 远高于底部）
    const firstTurnEl = scrollEl.querySelector('[data-turn-id="t-1"]') as HTMLElement
    expect(firstTurnEl).toBeTruthy()
    Object.defineProperty(scrollEl, 'getBoundingClientRect', {
      value: () => ({ top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400 }),
      configurable: true,
    })
    Object.defineProperty(firstTurnEl, 'getBoundingClientRect', {
      value: () => ({ top: -1200, bottom: -1150, left: 0, right: 800, width: 800, height: 50 }),
      configurable: true,
    })

    const rail = wrapper.findComponent({ name: 'ChatTurnRail' })
    rail.vm.$emit('jump', 't-1')
    await nextTick()
    expect(scrollToSpy).toHaveBeenCalled()
    const jumpedTop = scrollEl.scrollTop
    expect(jumpedTop).toBeLessThan(500)

    // 后续流式 delta 到来时不把用户拉回底部
    setScrollMetrics(scrollEl, 2100, 400)
    streamControl.onContentDelta?.('继续生成...', '继续生成...')
    await nextTick()
    expect(scrollEl.scrollTop).toBe(jumpedTop)

    streamControl.resolve?.({ reply: '继续生成...', cleanText: '继续生成...', reasoning: '', candidates: [] })
    await flushAsync()
    wrapper.unmount()
  })

  it('DetailPanel 侧边 AI 栏：流式期间用户手动上翻后暂停吸底，滑回底部恢复', async () => {
    const ui = useUIStore()
    ui.panels.detail = true

    const wrapper = mount(DetailPanel, { attachTo: document.body })
    const scrollEl = wrapper.find('#detailInner').element as HTMLElement
    setScrollMetrics(scrollEl, 1000, 400)

    const ta = wrapper.find('textarea')
    await ta.setValue('侧边栏提问')
    await ta.trigger('keydown', { key: 'Enter' })
    await flushAsync()
    expect(scrollEl.scrollTop).toBe(1000)

    // 同步真实底部位置后，用户向上滚动离开底部 200px
    scrollEl.scrollTop = 600
    scrollEl.dispatchEvent(new Event('scroll'))
    scrollEl.scrollTop = 400
    scrollEl.dispatchEvent(new Event('scroll'))

    setScrollMetrics(scrollEl, 1400, 400)
    streamControl.onContentDelta?.('新增流式内容', '新增流式内容')
    await nextTick()
    expect(scrollEl.scrollTop).toBe(400)

    // 用户手动滚回底部附近（1400 - 990 - 400 = 10 <= 24）
    scrollEl.scrollTop = 990
    scrollEl.dispatchEvent(new Event('scroll'))

    setScrollMetrics(scrollEl, 1650, 400)
    streamControl.onContentDelta?.('继续追加', '新增流式内容继续追加')
    await nextTick()
    expect(scrollEl.scrollTop).toBe(1650)

    streamControl.resolve?.({ reply: '新增流式内容继续追加', cleanText: '新增流式内容继续追加', reasoning: '', candidates: [] })
    await flushAsync()
    wrapper.unmount()
  })
})
