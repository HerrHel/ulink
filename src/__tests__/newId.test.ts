import { describe, it, expect } from 'vitest'
import { newId, newBookmarkId, newGroupId } from '../lib/newId.js'

describe('newId', () => {
  it('生成结果以指定前缀开头', () => {
    expect(newId('b').startsWith('b')).toBe(true)
    expect(newId('g').startsWith('g')).toBe(true)
    expect(newId('cat').startsWith('cat')).toBe(true)
  })

  it('含时间戳与随机串(长度合理)', () => {
    const id = newId('b')
    // 前缀 'b' + ts(base36,>=1字符) + rand(6字符) = 至少 8 字符
    expect(id.length).toBeGreaterThanOrEqual(8)
  })

  it('连续生成不重复(无 uniqHint,靠随机串防碰)', () => {
    const set = new Set<string>()
    for (let i = 0; i < 500; i++) set.add(newId('b'))
    expect(set.size).toBe(500)
  })

  it('同毫秒循环加 uniqHint 后缀,保证不碰', () => {
    // 模拟同毫秒批量生成
    const set = new Set<string>()
    for (let i = 0; i < 200; i++) set.add(newId('b', i))
    expect(set.size).toBe(200)
  })

  it('uniqHint 为 0 时不被省略', () => {
    const id = newId('b', 0)
    // 0 的 base36 是 '0',应被 toString 后缀拼上
    expect(id.endsWith('0')).toBe(true)
  })

  it('newBookmarkId / newGroupId 便捷封装前缀正确', () => {
    expect(newBookmarkId().startsWith('b')).toBe(true)
    expect(newGroupId().startsWith('g')).toBe(true)
    expect(newBookmarkId(5).startsWith('b')).toBe(true)
  })
})
