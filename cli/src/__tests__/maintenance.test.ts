import { describe, it, expect } from 'vitest'
import { computeGroupOrphanFix } from '../lib/groupOrphanFix.js'

/**
 * BG-11 复现回归测：maintenance validate --fix 多孤儿引用 collective 清除。
 *
 * Bug：原实现遍历 group.bookmark_ids 时对每个孤儿单独 update，
 * 因 filter 只减当前 bmId 且 group.bookmark_ids（内存数组）遍历中不变，
 * 一个组含 ≥2 个孤儿时后续 update 用仍含前序孤儿的 newIds 覆盖 DB，
 * 最终只剩「最后一个孤儿被剔除、前序孤儿全部回潮」。
 * 修复后 computeGroupOrphanFix 先收集全部孤儿一次性剔除，单次写最终 cleaned。
 */
describe('computeGroupOrphanFix (BG-11)', () => {
  it('无孤儿：cleanedIds 与原数组等价副本，orphans 空', () => {
    const groupBookmarkIds = ['a', 'b', 'c']
    const valid = new Set(['a', 'b', 'c', 'd'])
    const r = computeGroupOrphanFix(groupBookmarkIds, valid)
    expect(r.orphans).toEqual([])
    expect(r.cleanedIds).toEqual(['a', 'b', 'c'])
    // 副本独立性：返回新数组而非原数组引用
    expect(r.cleanedIds).not.toBe(groupBookmarkIds)
  })

  it('单个孤儿：剔除该孤儿', () => {
    const groupBookmarkIds = ['a', 'x', 'b']
    const valid = new Set(['a', 'b'])
    const r = computeGroupOrphanFix(groupBookmarkIds, valid)
    expect(r.orphans).toEqual(['x'])
    expect(r.cleanedIds).toEqual(['a', 'b'])
  })

  it('★ 多孤儿（Bug 核心）：全部孤儿一次性集体剔除，无前序回潮', () => {
    // 复现场景：原数组 ['a','x','b','y']，x 与 y 均孤儿，valid 仅含 a/b
    // 旧实现逐孤儿 filter：x→['a','b','y'] 写库；y→filter 原数组=['a','x','b'] 覆盖写库
    // → 库最终 ['a','x','b']，x 孤儿回潮。新实现单次剔除 x+y → ['a','b']。
    const groupBookmarkIds = ['a', 'x', 'b', 'y']
    const valid = new Set(['a', 'b'])
    const r = computeGroupOrphanFix(groupBookmarkIds, valid)
    expect(r.orphans).toEqual(['x', 'y'])
    expect(r.cleanedIds).toEqual(['a', 'b'])
  })

  it('全部孤儿：cleanedIds 空，orphans 含全部原引用', () => {
    const groupBookmarkIds = ['x', 'y', 'z']
    const valid = new Set(['a'])
    const r = computeGroupOrphanFix(groupBookmarkIds, valid)
    expect(r.orphans).toEqual(['x', 'y', 'z'])
    expect(r.cleanedIds).toEqual([])
  })

  it('空数组 / null / undefined：安全降级不 throw', () => {
    expect(computeGroupOrphanFix([], new Set(['a']))).toEqual({ orphans: [], cleanedIds: [] })
    expect(computeGroupOrphanFix(null, new Set(['a']))).toEqual({ orphans: [], cleanedIds: [] })
    expect(computeGroupOrphanFix(undefined, new Set(['a']))).toEqual({ orphans: [], cleanedIds: [] })
  })

  it('保留原数组顺序（孤儿剔除后剩余项相对顺序不变）', () => {
    const groupBookmarkIds = ['k', 'a', 'x', 'm', 'y', 'z', 'b']
    const valid = new Set(['a', 'm', 'b'])
    const r = computeGroupOrphanFix(groupBookmarkIds, valid)
    expect(r.orphans).toEqual(['k', 'x', 'y', 'z'])
    expect(r.cleanedIds).toEqual(['a', 'm', 'b'])
  })
})
