/**
 * useChatDisplay 单测：DetailPanel 展示层纯逻辑抽取后的回归锁
 * 覆盖：formatTimeAgo 阈值、formatReasoningSec 小数裁剪、getCleanCopyText 围栏剥离、
 * sessionItemTitle 默认标题回退、getTurnAttachedCards 附件回溯、getTurnSegments
 * 随文卡片合并/兜底追加、copyMessage 已复制态与失败兜底（断言 mock 被调用防假绿）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useChatDisplay } from '../../composables/ui/useChatDisplay.js'
import type { ChatTurn, AiChatSession } from '../../lib/ai/chatSessions.js'

// toast 走 Pinia store，这里只验证失败分支被触达（copyFailed 文案键）
const toastSpy = vi.fn()
vi.mock('../../lib/toast.js', () => ({ toast: (...args: unknown[]) => toastSpy(...args) }))

function makeTurn(over: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: 't1',
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    ...over,
  } as ChatTurn
}

/** 在组件 setup 中调用 composable（useDataStore 需活跃 Pinia，setup.ts 已建） */
function mountWith(turns: ChatTurn[]) {
  let api!: ReturnType<typeof useChatDisplay>
  const Comp = defineComponent({
    setup() {
      api = useChatDisplay(ref(turns))
      return () => h('div')
    },
  })
  mount(Comp)
  return api
}

beforeEach(() => {
  toastSpy.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useChatDisplay 格式化', () => {
  it('formatTimeAgo：分钟/小时阈值与日期回退', () => {
    const { formatTimeAgo } = mountWith([])
    const now = Date.now()
    expect(formatTimeAgo(now)).toBe('刚刚')
    expect(formatTimeAgo(now - 5 * 60000)).toContain('5')
    expect(formatTimeAgo(now - 2 * 3600000)).toContain('2')
    // 超过一天 → 本地化日期（zh-CN 下含月/日数字）
    expect(formatTimeAgo(now - 3 * 86400000)).toMatch(/\d/)
  })

  it('formatReasoningSec：零/缺省回退 1，整秒裁掉 .0', () => {
    const { formatReasoningSec } = mountWith([])
    expect(formatReasoningSec(undefined)).toBe('1')
    expect(formatReasoningSec(0)).toBe('1')
    expect(formatReasoningSec(2000)).toBe('2')
    expect(formatReasoningSec(1500)).toBe('1.5')
  })

  it('getCleanCopyText：剥离 ulink-card 围栏并 trim', () => {
    const { getCleanCopyText } = mountWith([])
    expect(getCleanCopyText(undefined)).toBe('')
    expect(getCleanCopyText('前文\n```ulink-card\n[{"url":"https://a.com"}]\n```\n后文')).toBe('前文\n\n后文')
    expect(getCleanCopyText('纯文本')).toBe('纯文本')
  })

  it('sessionItemTitle：默认/空标题回退 i18n，自定义标题保留', () => {
    const { sessionItemTitle } = mountWith([])
    const s = (title: string) => ({ id: 's1', title, turns: [] } as unknown as AiChatSession)
    expect(sessionItemTitle(s(''))).not.toBe('')
    expect(sessionItemTitle(s('新会话'))).not.toBe('新会话')
    expect(sessionItemTitle(s('我的会话'))).toBe('我的会话')
  })
})

describe('useChatDisplay 轮次渲染数据组装', () => {
  it('getTurnAttachedCards：自身附件优先，缺省回溯前一条 user 轮次', () => {
    const own = [{ type: 'bm' as const, id: 'b1', title: 'B1', url: 'https://b1.com' }]
    const prev = [{ type: 'group' as const, id: 'g1', title: 'G1', url: '' }]
    const turns = [
      makeTurn({ id: 'u1', role: 'user', attachedCards: prev }),
      makeTurn({ id: 'a1' }),
      makeTurn({ id: 'a2', attachedCards: own }),
    ]
    const { getTurnAttachedCards, getAttachedNotes } = mountWith(turns)
    expect(getTurnAttachedCards(turns[1])).toEqual(prev) // 回溯
    expect(getTurnAttachedCards(turns[2])).toEqual(own) // 自身优先
    expect(getTurnAttachedCards(turns[0])).toEqual(prev)
    expect(getAttachedNotes(turns[1])).toEqual(prev) // 只留 group
  })

  it('getTurnSegments：正文内嵌卡片解析合并进 turn.candidates', () => {
    const turn = makeTurn({
      content: '推荐：\n```ulink-card\n[{"title":"A","url":"https://a.com"}]\n```',
    })
    const { getTurnSegments } = mountWith([turn])
    const segs = getTurnSegments(turn)
    expect(segs.some((s) => s.type === 'card')).toBe(true)
    expect(turn.candidates?.length).toBe(1)
    expect(turn.candidates?.[0].url).toBe('https://a.com')
  })

  it('getTurnSegments：无围栏语法时 candidates 兜底追加为内嵌卡片', () => {
    const turn = makeTurn({
      content: '本地静态搜索结果',
      candidates: [{ title: 'B', url: 'https://b.com' }] as ChatTurn['candidates'],
    })
    const { getTurnSegments } = mountWith([turn])
    const segs = getTurnSegments(turn)
    expect(segs.filter((s) => s.type === 'card').length).toBe(1)
  })

  it('getTurnSegments：空内容且无候选返回空数组', () => {
    const turn = makeTurn()
    const { getTurnSegments } = mountWith([turn])
    expect(getTurnSegments(turn)).toEqual([])
  })
})

describe('useChatDisplay copyMessage', () => {
  it('写入成功设置已复制态，1.5s 后自动清除', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { copyMessage, copiedActionKey } = mountWith([])
    await copyMessage('文本', 'key-1')
    expect(writeText).toHaveBeenCalledWith('文本')
    expect(copiedActionKey.value).toBe('key-1')
    vi.advanceTimersByTime(1500)
    expect(copiedActionKey.value).toBeNull()
  })

  it('剪贴板失败走 toast 兜底（断言被调用防假绿）', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { copyMessage, copiedActionKey } = mountWith([])
    await copyMessage('文本', 'key-2')
    expect(writeText).toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledTimes(1)
    expect(copiedActionKey.value).toBeNull()
  })
})
