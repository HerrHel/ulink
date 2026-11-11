import { describe, it, expect } from 'vitest'
import { buildTurnAnchors } from '../../lib/ai/turnAnchors.js'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'

function turn(id: string, role: 'user' | 'assistant', content: string): ChatTurn {
  return { id, role, content, timestamp: 0 }
}

describe('buildTurnAnchors — 左侧消息锚点纯函数', () => {
  it('只保留 user 轮次且保持原始顺序', () => {
    const turns = [
      turn('u1', 'user', '帮我找 bug'),
      turn('a1', 'assistant', '好的'),
      turn('u2', 'user', '继续深挖'),
      turn('a2', 'assistant', '收到'),
    ]
    expect(buildTurnAnchors(turns)).toEqual([
      { id: 'u1', label: '帮我找 bug' },
      { id: 'u2', label: '继续深挖' },
    ])
  })

  it('折叠换行/连续空白，避免摘要里出现大段空白', () => {
    expect(buildTurnAnchors([turn('u', 'user', '  第一行\n\n  第二行\t  ')])[0].label)
      .toBe('第一行 第二行')
  })

  it('超长提问截断到 60 字并补省略号', () => {
    const label = buildTurnAnchors([turn('u', 'user', '啊'.repeat(120))])[0].label
    expect(label).toHaveLength(61)
    expect(label.endsWith('…')).toBe(true)
  })

  it('纯附件消息（content 为空）保留锚点、label 为空串由 UI 兜底', () => {
    expect(buildTurnAnchors([turn('u', 'user', '')])).toEqual([{ id: 'u', label: '' }])
    expect(buildTurnAnchors([turn('u', 'user', '   ')])[0].label).toBe('')
  })

  it('空会话返回空数组', () => {
    expect(buildTurnAnchors([])).toEqual([])
    expect(buildTurnAnchors([turn('a', 'assistant', '只有回复')])).toEqual([])
  })
})
