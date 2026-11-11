import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ChatTurnRail from '../../components/chat/ChatTurnRail.vue'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'

function turn(id: string, role: 'user' | 'assistant', content: string): ChatTurn {
  return { id, role, content, timestamp: 0 }
}

const turns: ChatTurn[] = [
  turn('u1', 'user', '帮我找 bug'),
  turn('a1', 'assistant', '好的'),
  turn('u2', 'user', '继续深挖'),
  turn('a2', 'assistant', '收到'),
  turn('u3', 'user', ''), // 纯附件消息
]

function mountRail(activeId: string | null = 'u2') {
  return mount(ChatTurnRail, { props: { turns, activeId } })
}

describe('ChatTurnRail — 左侧消息锚点导航', () => {
  it('三轮提问渲染三个点，活跃轮高亮', () => {
    const w = mountRail('u2')
    const dots = w.findAll('.rail-dot')
    expect(dots).toHaveLength(3)
    expect(dots[1].classes()).toContain('is-active')
    expect(dots[0].classes()).not.toContain('is-active')
  })

  it('少于两轮不渲染导航带（不占用左侧空间）', () => {
    const w = mount(ChatTurnRail, {
      props: { turns: [turn('u1', 'user', '只有一轮')], activeId: null },
    })
    expect(w.find('.chat-turn-rail').exists()).toBe(false)
  })

  it('默认只显示点带，hover 后展开摘要面板', async () => {
    const w = mountRail()
    expect(w.find('.rail-panel').exists()).toBe(false)
    await w.trigger('mouseenter')
    await nextTick()
    expect(w.find('.rail-panel').exists()).toBe(true)
    expect(w.text()).toContain('帮我找 bug')
    expect(w.text()).toContain('继续深挖')
    // 纯附件消息走 i18n 兜底，不显示空白行
    expect(w.text()).toContain('（仅附件消息）')
    await w.trigger('mouseleave')
    await nextTick()
    expect(w.find('.rail-panel').exists()).toBe(false)
  })

  it('点击点带上的小点 emit jump(对应轮 id)', async () => {
    const w = mountRail()
    await w.findAll('.rail-dot')[2].trigger('click')
    expect(w.emitted('jump')).toEqual([['u3']])
  })

  it('展开面板里的条目与历史会话按钮都能跳转 / 打开抽屉', async () => {
    const w = mountRail()
    await w.trigger('mouseenter')
    await nextTick()
    await w.findAll('.rail-panel-item')[0].trigger('click')
    expect(w.emitted('jump')).toEqual([['u1']])
    await w.find('.rail-history-btn').trigger('click')
    expect(w.emitted('openHistory')).toHaveLength(1)
  })

  it('面板里活跃条目也高亮', async () => {
    const w = mountRail('u1')
    await w.trigger('mouseenter')
    await nextTick()
    expect(w.findAll('.rail-panel-item')[0].classes()).toContain('is-active')
  })
})

describe('接线防回退断言（静态）', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('AiWorkspace 挂载了 ChatTurnRail 且会话顶栏 sticky 常驻', () => {
    const s = read('src/components/chat/AiWorkspace.vue')
    expect(s).toContain('<ChatTurnRail')
    expect(s).toContain('@jump="jumpToTurn"')
    const block = s.slice(s.indexOf('.ai-stream-meta-header {'), s.indexOf('.stream-title-text {'))
    expect(block).toContain('position: sticky')
    expect(block).toContain('top: 0')
  })

  it('ChatStream 每条用户消息都带 data-turn-id 锚点并预留 sticky 高度', () => {
    const s = read('src/components/chat/ChatStream.vue')
    expect(s).toContain(':data-turn-id="turn.role === \'user\' ? turn.id : undefined"')
    expect(s).toContain('scroll-margin-top: 72px')
  })
})
