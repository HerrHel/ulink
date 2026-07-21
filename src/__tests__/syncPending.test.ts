import { describe, it, expect, beforeEach } from 'vitest'
import {
  _isPendingSync, _markPendingSync, _clearPendingSync, __testPendingSync,
} from '../composables/domain/syncPending.js'

describe('syncPending', () => {
  beforeEach(() => {
    __testPendingSync.clear()
  })

  it('初始为空', () => {
    expect(_isPendingSync('x')).toBe(false)
    expect(__testPendingSync.has('x')).toBe(false)
  })

  it('_markPendingSync 批量标记', () => {
    _markPendingSync(['a', 'b'])
    expect(_isPendingSync('a')).toBe(true)
    expect(_isPendingSync('b')).toBe(true)
    expect(_isPendingSync('c')).toBe(false)
  })

  it('_clearPendingSync 仅清指定 id', () => {
    _markPendingSync(['a', 'b', 'c'])
    _clearPendingSync(['b'])
    expect(_isPendingSync('a')).toBe(true)
    expect(_isPendingSync('b')).toBe(false)
    expect(_isPendingSync('c')).toBe(true)
  })

  it('重复 mark 幂等', () => {
    _markPendingSync(['a'])
    _markPendingSync(['a'])
    expect(_isPendingSync('a')).toBe(true)
    _clearPendingSync(['a'])
    expect(_isPendingSync('a')).toBe(false)
  })

  it('clear 不存在的 id 不抛', () => {
    expect(() => _clearPendingSync(['nope'])).not.toThrow()
  })

  it('__testPendingSync 钩子可 add/delete/clear', () => {
    __testPendingSync.add('t1')
    expect(__testPendingSync.has('t1')).toBe(true)
    __testPendingSync.delete('t1')
    expect(__testPendingSync.has('t1')).toBe(false)
    __testPendingSync.add('t2')
    __testPendingSync.clear()
    expect(__testPendingSync.has('t2')).toBe(false)
  })
})
