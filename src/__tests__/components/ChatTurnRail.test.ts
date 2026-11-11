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

describe('ChatTurnRail — 左侧消息锚点导航（点带自身展开）', () => {
  it('三轮提问渲染三个条目，活跃轮高亮', () => {
    const w = mountRail('u2')
    const items = w.findAll('.turn-rail-item')
    expect(items).toHaveLength(3)
    expect(items[1].classes()).toContain('is-active')
    expect(items[0].classes()).not.toContain('is-active')
    expect(w.findAll('.turn-rail-node')).toHaveLength(3)
  })

  it('少于两轮不渲染导航带（不占用左侧空间）', () => {
    const w = mount(ChatTurnRail, {
      props: { turns: [turn('u1', 'user', '只有一轮')], activeId: null },
    })
    expect(w.find('.chat-turn-rail').exists()).toBe(false)
  })

  it('默认收起，hover 时容器自身展开而不是弹出独立面板', async () => {
    const w = mountRail()
    expect(w.classes()).not.toContain('is-expanded')
    // 形态约束：不允许再出现旁边悬浮的卡片
    expect(w.find('.rail-panel').exists()).toBe(false)
    await w.trigger('mouseenter')
    await nextTick()
    expect(w.classes()).toContain('is-expanded')
    expect(w.find('.rail-panel').exists()).toBe(false)
    // 摘要就在圆点所在的同一批条目里
    expect(w.findAll('.turn-rail-label')).toHaveLength(3)
    // 需求：展开态不写「对话导航」这类标题，直接展示内容
    expect(w.text()).not.toContain('对话导航')
    expect(w.find('.turn-rail-caption').exists()).toBe(false)
    expect(w.text()).toContain('帮我找 bug')
    expect(w.text()).toContain('继续深挖')
    expect(w.text()).toContain('（仅附件消息）')
    await w.trigger('mouseleave')
    expect(w.classes()).not.toContain('is-expanded')
  })

  it('收起只渲染 10 个点（两端淡化），展开后渲染全部轮次供滚动挑选', async () => {
    const many: ChatTurn[] = []
    for (let i = 0; i < 20; i++) {
      many.push(turn('u' + i, 'user', '问题 ' + i), turn('a' + i, 'assistant', '答 ' + i))
    }

    const atStart = mount(ChatTurnRail, { props: { turns: many, activeId: 'u0' } })
    const s0 = atStart.findAll('.turn-rail-item')
    expect(s0).toHaveLength(10)
    expect(s0[0].classes()).not.toContain('is-ghost')
    expect(s0[9].classes()).toContain('is-ghost')

    const atMiddle = mount(ChatTurnRail, { props: { turns: many, activeId: 'u10' } })
    const m = atMiddle.findAll('.turn-rail-item')
    expect(m[0].classes()).toContain('is-ghost')
    expect(m[9].classes()).toContain('is-ghost')
    // 当前轮本身不淡化
    const active = m.find(x => x.classes().includes('is-active'))!
    expect(active.classes()).not.toContain('is-ghost')

    // 展开后不再窗口化：20 轮全部在列表里，靠滚动条挑选
    await atMiddle.trigger('mouseenter')
    await nextTick()
    expect(atMiddle.findAll('.turn-rail-item')).toHaveLength(20)
    expect(atMiddle.findAll('.turn-rail-item').some(x => x.classes().includes('is-ghost'))).toBe(false)
  })

  it('点击条目 emit jump(对应轮 id)', async () => {
    const w = mountRail()
    await w.findAll('.turn-rail-item')[2].trigger('click')
    expect(w.emitted('jump')).toEqual([['u3']])
  })

  it('活跃条目的摘要也高亮', async () => {
    const w = mountRail('u1')
    await w.trigger('mouseenter')
    await nextTick()
    expect(w.findAll('.turn-rail-item')[0].classes()).toContain('is-active')
  })

  it('键盘聚焦同样展开，焦点移出后收起', async () => {
    const w = mountRail()
    await w.trigger('focusin')
    expect(w.classes()).toContain('is-expanded')
    await w.trigger('focusout', { relatedTarget: null })
    expect(w.classes()).not.toContain('is-expanded')
  })
})

describe('接线防回退断言（静态）', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('AiWorkspace 挂载 ChatTurnRail 与常驻会话顶栏；不再有滚动浮出胶囊', () => {
    const s = read('src/components/chat/AiWorkspace.vue')
    expect(s).toContain('<ChatTurnRail')
    expect(s).toContain('@jump="jumpToTurn"')
    // 历史 / 标题 / 新对话三件套常驻在 ChatConvHeader 里，滚动与否都能用
    expect(s).toContain('<ChatConvHeader')
    expect(s).toContain('@open-history="openHistoryDrawer"')
    expect(s).toContain('@new-chat="onNewConversation"')
    expect(s).toContain('@rename="onRenameSession"')
    // 旧的「滚离顶部才浮出胶囊」方案已下线，避免入口随滚动忽隐忽现
    expect(s).not.toContain('ai-new-chat-float')
    expect(s).not.toContain('showFloatNewChat')
    // 顶栏是绝对定位的雾化层，绝不 sticky（否则又变成一条横带）
    const header = read('src/components/chat/ChatConvHeader.vue')
    expect(header).not.toContain('position: sticky')
    expect(header).toContain('position: absolute')
  })

  it('会话标题可就地重命名（输入框 + Enter/失焦提交 + Esc 取消）', () => {
    const header = read('src/components/chat/ChatConvHeader.vue')
    expect(header).toContain('conv-title-input')
    expect(header).toContain("@keydown.enter.prevent=\"commit\"")
    expect(header).toContain("@keydown.esc.prevent=\"cancel\"")
    expect(header).toContain('@blur="commit"')
    expect(header).toContain("emit('rename'")
    // 空标题不是空壳，交给 store 恢复自动命名
    const store = read('src/lib/ai/chatSessions.ts')
    expect(store).toContain('export function renameSession')
    expect(store).toContain('extractSessionTitle(firstUserTurn.content)')
  })

  it('展开态可滚动挑选历史：自绘滚动条 + 全量轮次 + 当前轮自动滚到中部', () => {
    const s = read('src/components/chat/ChatTurnRail.vue')
    // 原生滚动条隐藏，改用自绘（overlay 滚动条在部分环境不可见）
    expect(s).toContain('scrollbar-width: none')
    expect(s).toContain('turn-rail-scrollbar')
    expect(s).toContain('updateScrollbar')
    expect(s).toContain('SCROLLBAR_INSET')
    // 展开时用全量 anchors，收起才窗口化
    expect(s).toContain('expanded.value')
    expect(s).toContain('computeVisibleAnchors')
    expect(s).toContain('itemsRef')
    expect(s).toContain('box.scrollTop = Math.max(')
  })

  it('跳转只滚内层容器，绝不用 scrollIntoView（避免整页上移）', () => {
    const s = read('src/components/chat/AiWorkspace.vue')
    const fn = s.slice(s.indexOf('function jumpToTurn'), s.indexOf('// 会话切换 / 新消息后重算高亮'))
    expect(fn).toContain('container.scrollTo')
    // 注释里会提到这个 API 名，所以只禁止「实际调用」而非字符串出现
    expect(fn).not.toMatch(/\.\s*scrollIntoView\s*\(/)
  })

  it('ChatStream 每条用户消息都带 data-turn-id 锚点', () => {
    const s = read('src/components/chat/ChatStream.vue')
    expect(s).toContain(':data-turn-id="turn.role === \'user\' ? turn.id : undefined"')
    expect(s).toContain('scroll-margin-top: 72px')
  })

  it('悬停的会话行不会盖住滚动条（滑块压在条目之上，且右侧留出安全距）', () => {
    const s = read('src/components/chat/ChatTurnRail.vue')
    // 条目 hover 底纹整行铺满，滚动条若在它下面就会被吃掉
    expect(s).toContain('z-index: 2')
    expect(s).toContain('padding: 6px 5px 6px 0')
    // 3px 太细，借左右 4px 做透明命中区，并支持拖动
    expect(s).toContain('left: -4px')
    expect(s).toContain('onScrollbarPointerDown')
    expect(s).toContain('dragging.value')
  })

  it('收起点距紧凑、展开才拉开，且容器高度不随展开变化（中心不跳）', () => {
    const s = read('src/components/chat/ChatTurnRail.vue')
    expect(s).toContain('width: 32px')
    expect(s).toContain('width: 300px')
    expect(s).not.toContain('rail-panel')
    // 收起 10px 行高 + 4px 间距；展开 30px 行高 + 0 间距
    expect(s).toContain('--rail-item-h: 10px')
    expect(s).toContain('--rail-gap: 4px')
    expect(s).toContain('--rail-item-h: 30px')
    expect(s).toContain('--rail-gap: 0px')
    // 容器高度按展开态固定（含上下 6px 留白 → 10 点 = 312px，与 300px 宽接近 1:1）
    expect(s).toContain('height: min(calc(var(--rail-count) * 30px + 12px), 62vh, 480px)')
    expect(s).toContain('justify-content: safe center')
    // 点列上限 + 两端淡化
    expect(s).toContain('MAX_DOTS = 10')
    expect(s).toContain("'is-ghost'")
    expect(s).toContain('computeVisibleAnchors')
    // 需求：展开态不写「对话导航」之类标题，直接展示内容
    expect(s).not.toContain('turn-rail-caption')
    expect(s).toContain('class="turn-rail-track"')
    expect(s).toContain('left: 15px')
  })

  it('展开形变由点带自身长出：表面与宽度同步、文字从左揭示', () => {
    const s = read('src/components/chat/ChatTurnRail.vue')
    // 表面绝不能加横向缩放：宽度先飞出去、材质追不上会变成「透明骨架先弹出」
    expect(s).not.toContain('scaleX')
    // 文字从左向右揭示，像被点带拉出来
    expect(s).toContain('clip-path: inset(0 100% 0 0)')
    expect(s).toContain('clip-path: inset(0 0 0 0)')
    expect(s).toContain('transform: translateX(-4px)')
  })
})
