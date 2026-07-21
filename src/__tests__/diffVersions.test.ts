import { describe, it, expect } from 'vitest'
import { diffVersions } from '../lib/diffVersions.js'

describe('diffVersions', () => {
  it('相同对象返回空数组', () => {
    const data = { title: 'a', url: 'https://x.test' }
    expect(diffVersions(data, { ...data })).toEqual([])
  })

  it('默认排除 id/时间戳字段', () => {
    const oldData = { id: '1', title: 'a', updatedAt: 1, createdAt: 1 }
    const newData = { id: '1', title: 'a', updatedAt: 9, createdAt: 2, updated_at: 3, created_at: 4 }
    expect(diffVersions(oldData, newData)).toEqual([])
  })

  it('检测 added / removed / changed', () => {
    const diffs = diffVersions(
      { title: 'old', notes: 'keep', gone: 'x' },
      { title: 'new', notes: 'keep', extra: 'y' },
    )
    expect(diffs).toEqual(expect.arrayContaining([
      { key: 'title', label: '标题', type: 'changed', oldValue: 'old', newValue: 'new' },
      { key: 'gone', label: 'gone', type: 'removed', oldValue: 'x' },
      { key: 'extra', label: 'extra', type: 'added', newValue: 'y' },
    ]))
    expect(diffs).toHaveLength(3)
  })

  it('使用 FIELD_LABELS 中文标签，未知 key 原样', () => {
    const diffs = diffVersions({ url: 'a', customX: 1 }, { url: 'b', customX: 2 })
    expect(diffs.find(d => d.key === 'url')?.label).toBe('链接')
    expect(diffs.find(d => d.key === 'customX')?.label).toBe('customX')
  })

  it('password 敏感字段只占位不泄露值', () => {
    const diffs = diffVersions(
      { password: 'secret-old', title: 't' },
      { password: 'secret-new', title: 't' },
    )
    expect(diffs).toEqual([{
      key: 'password', label: '密码', type: 'changed',
      oldValue: '••••', newValue: '••••',
    }])
  })

  it('password 新增/移除也用占位', () => {
    expect(diffVersions({}, { password: 'p' })).toEqual([{
      key: 'password', label: '密码', type: 'added', newValue: '••••',
    }])
    expect(diffVersions({ password: 'p' }, {})).toEqual([{
      key: 'password', label: '密码', type: 'removed', oldValue: '••••',
    }])
  })

  it('长值截断到 80 字符并加省略号', () => {
    const long = 'x'.repeat(100)
    const diffs = diffVersions({ notes: 'short' }, { notes: long })
    expect(diffs[0].newValue).toBe('x'.repeat(80) + '…')
    expect(diffs[0].oldValue).toBe('short')
  })

  it('对象值经 JSON.stringify 比较与展示', () => {
    const diffs = diffVersions(
      { attributes: { a: true } },
      { attributes: { a: false } },
    )
    expect(diffs).toHaveLength(1)
    expect(diffs[0].type).toBe('changed')
    expect(diffs[0].oldValue).toContain('"a":true')
    expect(diffs[0].newValue).toContain('"a":false')
  })

  it('null/undefined 显示为（空）', () => {
    const diffs = diffVersions({ notes: null }, { notes: 'hi' })
    expect(diffs[0].oldValue).toBe('（空）')
    expect(diffs[0].newValue).toBe('hi')
  })

  it('支持自定义 excludeKeys', () => {
    const diffs = diffVersions(
      { title: 'a', icon: '1' },
      { title: 'b', icon: '2' },
      ['icon'],
    )
    expect(diffs).toEqual([{
      key: 'title', label: '标题', type: 'changed', oldValue: 'a', newValue: 'b',
    }])
  })
})
