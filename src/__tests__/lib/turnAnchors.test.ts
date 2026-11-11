import { describe, it, expect } from 'vitest'
import { buildTurnAnchors, computeVisibleAnchors } from '../../lib/ai/turnAnchors.js'
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

describe('computeVisibleAnchors — 点列窗口化与两端淡化', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, label: `第 ${i} 问` }))

  it('总轮数不超过上限时全部显示、无淡化', () => {
    const out = computeVisibleAnchors(many.slice(0, 5), 'u2', 8)
    expect(out.map(a => a.id)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4'])
    expect(out.every(a => !a.fadeTop && !a.fadeBottom)).toBe(true)
    expect(out.map(a => a.index)).toEqual([0, 1, 2, 3, 4])
  })

  it('当前在开头、下面还有 → 只有最后一个点淡化', () => {
    const out = computeVisibleAnchors(many, 'u0', 8)
    expect(out).toHaveLength(8)
    expect(out[0].id).toBe('u0')
    expect(out[0].fadeTop).toBe(false)
    expect(out[7].fadeBottom).toBe(true)
    expect(out.slice(0, 7).some(a => a.fadeTop || a.fadeBottom)).toBe(false)
  })

  it('当前在末尾、上面还有 → 只有第一个点淡化', () => {
    const out = computeVisibleAnchors(many, 'u19', 8)
    expect(out).toHaveLength(8)
    expect(out[0].id).toBe('u12')
    expect(out[0].fadeTop).toBe(true)
    expect(out[7].fadeBottom).toBe(false)
    expect(out[7].id).toBe('u19')
  })

  it('当前在中间、上下都还有 → 首尾都淡化', () => {
    const out = computeVisibleAnchors(many, 'u10', 8)
    expect(out).toHaveLength(8)
    expect(out[0].fadeTop).toBe(true)
    expect(out[7].fadeBottom).toBe(true)
    // 当前轮永远不淡化
    const active = out.find(a => a.id === 'u10')!
    expect(active.fadeTop || active.fadeBottom).toBe(false)
  })

  it('窗口以当前轮为中心滑动，且 index 保留全局序号', () => {
    const out = computeVisibleAnchors(many, 'u10', 8)
    const idx = out.map(a => a.index)
    expect(idx).toHaveLength(8)
    // 连续递增，不跳号
    expect(idx[7] - idx[0]).toBe(7)
    idx.slice(1).forEach((v, i) => expect(v - idx[i]).toBe(1))
    // 当前轮落在窗口中间区域，而不是边缘
    const pos = out.findIndex(a => a.id === 'u10')
    expect(pos).toBeGreaterThanOrEqual(2)
    expect(pos).toBeLessThanOrEqual(5)
    expect(out[pos].index).toBe(10)
  })

  it('activeId 缺失或不在列表时回退到窗口开头（不抛错）', () => {
    expect(computeVisibleAnchors(many, null, 8)[0].id).toBe('u0')
    expect(computeVisibleAnchors(many, 'not-exist', 8)[0].id).toBe('u0')
  })

  it('上限非法时钳到最小值 2，且窗口长度恒等于上限', () => {
    expect(computeVisibleAnchors(many, 'u0', 0)).toHaveLength(2)
    expect(computeVisibleAnchors(many, 'u0', 8)).toHaveLength(8)
    expect(computeVisibleAnchors(many, 'u19', 8)).toHaveLength(8)
  })
})
