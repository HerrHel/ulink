import { describe, it, expect } from 'vitest'
import { cloneDeep } from '../lib/clone.js'

describe('cloneDeep', () => {
  it('深拷贝嵌套对象,修改副本不影响原对象', () => {
    const nestedChild = { c: 3 }
    const obj = { a: 1, nested: { b: [1, 2, nestedChild] as Array<number | { c: number }> } }
    const copy = cloneDeep(obj)
    expect(copy).toEqual(obj)
    const copyChild = copy.nested.b[2] as { c: number }
    copyChild.c = 30
    ;(copy.nested.b as Array<number | { c: number }>).push(99)
    expect(obj.nested.b).toEqual([1, 2, { c: 3 }])
  })

  it('数组深拷贝', () => {
    const arr = [{ id: 'a' }, { id: 'b' }]
    const copy = cloneDeep(arr)
    copy[0].id = 'x'
    expect(arr[0].id).toBe('a')
  })

  it('原始值与 undefined/null 透传', () => {
    expect(cloneDeep(42)).toBe(42)
    expect(cloneDeep('x')).toBe('x')
    expect(cloneDeep(null)).toBe(null)
  })

  it('空对象/空数组拷贝独立', () => {
    const o = {}
    const a: unknown[] = []
    expect(cloneDeep(o)).toEqual({})
    expect(cloneDeep(a)).toEqual([])
    expect(cloneDeep(o)).not.toBe(o)
    expect(cloneDeep(a)).not.toBe(a)
  })

  it('JSON 法语义:函数/undefined 字段被丢弃(与 JSON.stringify 一致)', () => {
    const obj = { a: 1, fn: () => void 0, u: undefined }
    const copy = cloneDeep(obj) as Record<string, unknown>
    expect(copy.a).toBe(1)
    expect('fn' in copy).toBe(false)
    expect('u' in copy).toBe(false)
  })
})
