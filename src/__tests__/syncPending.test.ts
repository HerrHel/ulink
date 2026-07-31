import { describe, it, expect, beforeEach } from 'vitest'
import {
  _isPendingSync, _markPendingSync, _clearPendingSync,
  _clearAllPendingSync, __testPendingSync,
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

  // ---- D1-7：_clearAllPendingSync 护栏（审计 R1 登出清队列核心，此前无独立单测） ----

  it('_clearAllPendingSync 清空全部 in-flight id', () => {
    _markPendingSync(['a', 'b', 'c', 'd'])
    expect(_isPendingSync('a')).toBe(true)
    _clearAllPendingSync()
    expect(_isPendingSync('a')).toBe(false)
    expect(_isPendingSync('b')).toBe(false)
    expect(_isPendingSync('c')).toBe(false)
    expect(_isPendingSync('d')).toBe(false)
  })

  it('_clearAllPendingSync 空集调用幂等不抛', () => {
    // 初始无 in-flight id，登出再登入场景下两次清空不应留残留也不抛
    expect(() => _clearAllPendingSync()).not.toThrow()
    expect(__testPendingSync.has('any')).toBe(false)
    _clearAllPendingSync()
    expect(__testPendingSync.has('any')).toBe(false)
  })

  it('_clearAllPendingSync 后可重新标记（跨账号残留不复返）', () => {
    // R1 跨账号残留：A 登出的 pending id 清空后，B 登入 mark 自己的 id 不应看到 A 的旧 id
    _markPendingSync(['userA-id'])
    _clearAllPendingSync()
    _markPendingSync(['userB-id'])
    expect(_isPendingSync('userA-id')).toBe(false)
    expect(_isPendingSync('userB-id')).toBe(true)
  })

  it('_clearAllPendingSync 不影响后续 _clearPendingSync 选择性清理', () => {
    _clearAllPendingSync()
    _markPendingSync(['x', 'y'])
    _clearPendingSync(['x'])
    expect(_isPendingSync('x')).toBe(false)
    expect(_isPendingSync('y')).toBe(true)
  })
})
