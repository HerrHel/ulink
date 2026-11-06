import { describe, it, expect } from 'vitest'
import {
  PROPOSE_ONLY_TOOLS,
  inferToolExecStatus,
  formatToolResultForModel,
} from '../../lib/ai/toolResult.js'

const cardText = '已生成行动卡片，请点击确认后执行'

describe('inferToolExecStatus — 工具执行语义状态推断', () => {
  it('PROPOSE_ONLY_TOOLS 内的工具只出卡片，判为 proposed', () => {
    expect(PROPOSE_ONLY_TOOLS.size).toBeGreaterThan(0)
    for (const name of PROPOSE_ONLY_TOOLS) {
      expect(inferToolExecStatus({ name, resultText: cardText })).toBe('proposed')
    }
  })

  it('merge_duplicates 仅 confirm:true 判为 executed，false / 缺省判为 proposed', () => {
    expect(inferToolExecStatus({ name: 'merge_duplicates', args: { confirm: true }, resultText: '已合并 3 条' })).toBe('executed')
    expect(inferToolExecStatus({ name: 'merge_duplicates', args: { confirm: false }, resultText: cardText })).toBe('proposed')
    expect(inferToolExecStatus({ name: 'merge_duplicates', args: {}, resultText: cardText })).toBe('proposed')
    expect(inferToolExecStatus({ name: 'merge_duplicates', resultText: cardText })).toBe('proposed')
  })

  it('deep_read_video 已下线，恒判为 not_executed', () => {
    expect(inferToolExecStatus({ name: 'deep_read_video', resultText: '解析完成' })).toBe('not_executed')
  })

  it('argsParseFailed / threw 判为 failed，且优先于其它状态', () => {
    expect(inferToolExecStatus({ name: 'audit_vault', argsParseFailed: true, resultText: cardText })).toBe('failed')
    expect(inferToolExecStatus({ name: 'manage_bookmarks', threw: true, resultText: '已新增 1 条' })).toBe('failed')
    expect(inferToolExecStatus({ name: 'merge_duplicates', args: { confirm: true }, threw: true, resultText: '已合并 3 条' })).toBe('failed')
  })

  it('notExecutedTexts 命中（与 trim 后原文精确相等）判为 not_executed', () => {
    expect(inferToolExecStatus({
      name: 'manage_bookmarks',
      resultText: '  暂未执行  ',
      notExecutedTexts: ['暂未执行', '未执行'],
    })).toBe('not_executed')
  })

  it('notExecutedTexts 优先于只出卡片工具与已下线工具', () => {
    expect(inferToolExecStatus({
      name: 'audit_vault',
      resultText: '暂未执行',
      notExecutedTexts: ['暂未执行'],
    })).toBe('not_executed')
  })

  it('notExecutedTexts 未命中时按工具本身语义判定', () => {
    expect(inferToolExecStatus({
      name: 'manage_bookmarks',
      resultText: '已新增 1 条书签',
      notExecutedTexts: ['暂未执行'],
    })).toBe('executed')
  })

  it('普通落地工具 manage_bookmarks 判为 executed', () => {
    expect(inferToolExecStatus({ name: 'manage_bookmarks', resultText: '已新增 1 条书签' })).toBe('executed')
  })
})

describe('formatToolResultForModel — role:tool 状态标记回传', () => {
  it('isZh 为 true / false 时都含状态标记且保留原文', () => {
    const text = '已新增 1 条书签：https://example.com'
    for (const isZh of [true, false]) {
      const out = formatToolResultForModel(text, 'executed', isZh)
      expect(out).toContain('[工具结果状态 executed]')
      expect(out).toContain(text)
    }
  })

  it('中英文提示文案不同，但状态标记与原文一致', () => {
    const zh = formatToolResultForModel('原文 A', 'proposed', true)
    const en = formatToolResultForModel('原文 A', 'proposed', false)
    expect(zh).toContain('[工具结果状态 proposed]')
    expect(en).toContain('[工具结果状态 proposed]')
    expect(zh).toContain('原文 A')
    expect(en).toContain('原文 A')
    expect(zh).not.toBe(en)
  })

  it('默认 isZh 为中文提示，且四种状态均带各自标记', () => {
    expect(formatToolResultForModel('原文 A', 'failed')).toContain('[工具结果状态 failed]')
    for (const status of ['executed', 'proposed', 'not_executed', 'failed'] as const) {
      expect(formatToolResultForModel('原文 A', status, true)).toContain(`[工具结果状态 ${status}]`)
    }
  })
})
