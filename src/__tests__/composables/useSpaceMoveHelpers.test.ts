/**
 * useSpaceMoveHelpers.test.ts — 移入私密空间纯函数护栏单测
 *
 * _mergeById / _attrIdsUsed 是 useSpaceMove「主页→私密数据集合并」的纯合成核心：
 * 现有 useSpaceMove.test.ts 只经 async 动作（mock IDB）间接达，
 * 本文件直锁两个纯函数的合并/聚合契约 + undefined 兜底边界。
 */
import { describe, it, expect } from 'vitest'
import { _mergeById, _attrIdsUsed } from '../../composables/domain/useSpaceMove.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

describe('_mergeById', () => {
  it('existing 全保留 + incoming 新 id push', () => {
    const existing = [{ id: '1' }, { id: '2' }]
    const incoming = [{ id: '3' }, { id: '4' }]
    const out = _mergeById(existing, incoming)
    expect(out.map(x => x.id)).toEqual(['1', '2', '3', '4'])
  })

  it('incoming 同 id 跳过不覆盖（核心契约 —— 避免同 id 误合并覆盖 vault 已有项）', () => {
    const existing = [{ id: '1', v: 'old' } as any]
    const incoming = [{ id: '1', v: 'new' } as any, { id: '2', v: 'new' } as any]
    const out = _mergeById(existing, incoming)
    expect(out.map(x => x.id)).toEqual(['1', '2'])
    // 同 id 保留 existing 的值，不取 incoming
    expect((out[0] as any).v).toBe('old')
    expect((out[1] as any).v).toBe('new')
  })

  it('incoming 内部重复 id 去重只 push 一次（idSet 阻断后续重复）', () => {
    const existing = [{ id: '1' }] as any
    const incoming = [{ id: '2' } as any, { id: '2' } as any, { id: '2' } as any]
    const out = _mergeById(existing, incoming)
    expect(out.map(x => x.id)).toEqual(['1', '2'])
  })

  it('空 incoming 返回 existing 副本（空数组透传，不返同一引用）', () => {
    const existing = [{ id: '1' }] as any
    const out = _mergeById(existing, [] as any)
    expect(out.map((x: any) => x.id)).toEqual(['1'])
    expect(out).not.toBe(existing)
  })

  it('空 existing 等价于复制 incoming', () => {
    const incoming = [{ id: '3' } as any, { id: '4' } as any]
    const out = _mergeById([] as any, incoming)
    expect(out.map((x: any) => x.id)).toEqual(['3', '4'])
  })

  it('不改变入参 existing 与 incoming（无副作用）', () => {
    const existing = [{ id: '1' }] as any
    const incoming = [{ id: '2' }] as any
    const existingSnap = existing.length
    const incomingSnap = incoming.length
    _mergeById(existing, incoming)
    expect(existing.length).toBe(existingSnap)
    expect(incoming.length).toBe(incomingSnap)
  })
})

describe('_attrIdsUsed', () => {
  const mkBm = (id: string, attrs: Record<string, boolean> | undefined): Bookmark =>
    ({ id, attributes: attrs } as unknown as Bookmark)
  const mkGrp = (id: string, attrs: Record<string, boolean> | undefined): SiblingGroup =>
    ({ id, attributes: attrs } as unknown as SiblingGroup)

  it('bookmark.attributes + group.attributes 两源 union 去重', () => {
    const bm = mkBm('b1', { a1: true, a2: false })
    const bm2 = mkBm('b2', { a2: true, a3: true })
    const grp = mkGrp('g1', { a3: true, a4: true })
    const ids = _attrIdsUsed([bm, bm2], [grp])
    expect([...ids].sort()).toEqual(['a1', 'a2', 'a3', 'a4'])
  })

  it('attributes 为 undefined 走 || {} 兜底空对象（旧数据不抛 TypeError）', () => {
    const bmUndef = mkBm('b1', undefined)
    const grpUndef = mkGrp('g1', undefined)
    // 不抛错 + 返回空 Set
    const ids = _attrIdsUsed([bmUndef], [grpUndef])
    expect(ids.size).toBe(0)
  })

  it('attributes 为 null 同样兜底（b.attributes || {} 对 null 也降级空对象）', () => {
    const bmNull = mkBm('b1', null as unknown as undefined)
    const ids = _attrIdsUsed([bmNull], [])
    expect(ids.size).toBe(0)
  })

  it('attributes 空对象 {} 无键贡献', () => {
    const bmEmpty = mkBm('b1', {})
    const grpEmpty = mkGrp('g1', {})
    const ids = _attrIdsUsed([bmEmpty], [grpEmpty])
    expect(ids.size).toBe(0)
  })

  it('空输入返回空 Set', () => {
    const ids = _attrIdsUsed([], [])
    expect(ids.size).toBe(0)
  })

  it('仅 bookmark 有 attr 时 group 空贡献不影响收集', () => {
    const bm = mkBm('b1', { onlyBm: true })
    const ids = _attrIdsUsed([bm], [])
    expect([...ids]).toEqual(['onlyBm'])
  })
})
