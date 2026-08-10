/**
 * boundedCache — 有上界 LRU 缓存纯函数测
 *
 * 锁定 useVirtualScroll._styleCache 由裸 Map 改 LRU 的新行为契约：
 *  - size 永不超过 maxSize（核心：原裸 Map 只写不逐出，这是被修掉的缺陷）
 *  - 满后新键淘汰最早插入项
 *  - 覆盖已有 key 不增 size
 *  - get/has/delete/clear 与 Map 语义对齐
 *  - maxSize 非法值抛错（防误用）
 *
 * 这测是「修 F1 内存泄漏」配的回归测（锁住"上界不被突破"新行为），不是补护栏。
 */
import { describe, it, expect } from 'vitest'
import { createBoundedCache } from '../../lib/boundedCache.js'

describe('createBoundedCache', () => {
  it('set/get/has 基本读写', () => {
    const c = createBoundedCache<string, number>(3)
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
    expect(c.has('a')).toBe(true)
    expect(c.get('missing')).toBeUndefined()
    expect(c.has('missing')).toBe(false)
    expect(c.size).toBe(1)
  })

  it('size 永不超过 maxSize —— 核心修复契约（原裸 Map 只写不逐出会无限涨）', () => {
    const c = createBoundedCache<string, number>(3)
    for (let i = 0; i < 100; i++) c.set(`k${i}`, i)
    expect(c.size).toBe(3)
    // 只剩最后 3 个键
    expect(c.has('k97')).toBe(true)
    expect(c.has('k98')).toBe(true)
    expect(c.has('k99')).toBe(true)
    expect(c.has('k0')).toBe(false)
  })

  it('满后新键淘汰最早插入项（Map 插入序 = LRU 顺序）', () => {
    const c = createBoundedCache<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    expect(c.size).toBe(2)
    // 插入 c 满，淘汰最旧的 a
    c.set('c', 3)
    expect(c.size).toBe(2)
    expect(c.has('a')).toBe(false)
    expect(c.get('b')).toBe(2)
    expect(c.get('c')).toBe(3)
    // 再插 d 淘汰 b
    c.set('d', 4)
    expect(c.has('b')).toBe(false)
    expect(c.get('d')).toBe(4)
  })

  it('覆盖已有 key 不增 size（key 复用而非新增）', () => {
    const c = createBoundedCache<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.set('a', 100) // 覆盖不新增
    expect(c.size).toBe(2)
    expect(c.get('a')).toBe(100)
    expect(c.get('b')).toBe(2)
    // 覆盖后仍满，新键淘汰最旧
    c.set('c', 3)
    expect(c.size).toBe(2)
    // a 仍是最早插入序（覆盖不改变插入序），b 第二 —— 淘汰 a 还是 b？
    // Map 覆盖已存在 key 不改变其插入序位置，所以 a 仍最早 → 淘汰 a
    // 但若实现用 Map.set 覆盖，js 引擎规约：覆盖不重排，a 仍首项
    expect(c.has('a')).toBe(false)
    expect(c.get('b')).toBe(2)
    expect(c.get('c')).toBe(3)
  })

  it('delete 与 clear', () => {
    const c = createBoundedCache<string, number>(5)
    c.set('a', 1)
    c.set('b', 2)
    c.delete('a')
    expect(c.size).toBe(1)
    expect(c.has('a')).toBe(false)
    c.clear()
    expect(c.size).toBe(0)
    expect(c.has('b')).toBe(false)
  })

  it('maxSize=1：每 set 后立即淘汰前一项', () => {
    const c = createBoundedCache<string, number>(1)
    c.set('a', 1)
    expect(c.size).toBe(1)
    c.set('b', 2)
    expect(c.size).toBe(1)
    expect(c.has('a')).toBe(false)
    expect(c.get('b')).toBe(2)
  })

  it('maxSize 非法抛错（防误用：0 / 负 / NaN / Infinity）', () => {
    expect(() => createBoundedCache(0)).toThrow()
    expect(() => createBoundedCache(-1)).toThrow()
    expect(() => createBoundedCache(Number.NaN)).toThrow()
    expect(() => createBoundedCache(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => createBoundedCache(1.5)).not.toThrow() // 1.5 是 finite，不抛（防误用仅拦非法类）
  })
})
