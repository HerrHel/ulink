import { describe, it, expect } from 'vitest'
import { collectDescendantIds } from '../lib/collectSubIds.js'
import type { Bookmark } from '../types.js'

/** 构造一个最小可用的 Bookmark（仅 id/parentId 用于本测试） */
function bm(id: string, parentId: string | null = null): Bookmark {
  return {
    id, parentId,
    title: '', url: '', icon: '', username: '', password: '',
    notes: '', categoryId: '', order: 0, useCount: 0,
    attributes: {}, isExpanded: false,
    createdAt: 0, updatedAt: 0,
  } as unknown as Bookmark
}

describe('collectDescendantIds', () => {
  it('单点无子书签时只返回自身', () => {
    const cm: Record<string, Bookmark[]> = {}
    expect(collectDescendantIds(pid => cm[pid], 'a')).toEqual(['a'])
  })

  it('收集一级子书签', () => {
    const cm: Record<string, Bookmark[]> = { a: [bm('b'), bm('c')] }
    expect(collectDescendantIds(pid => cm[pid], 'a').sort()).toEqual(['a', 'b', 'c'])
  })

  it('深度递归收集子孙多层', () => {
    // a → b → d, a → b → e, a → c
    const cm: Record<string, Bookmark[]> = {
      a: [bm('b'), bm('c')],
      b: [bm('d'), bm('e')],
      c: [],
    }
    expect(collectDescendantIds(pid => cm[pid], 'a').sort())
      .toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('getChildren 返回 undefined 视为无子(不抛错)', () => {
    expect(collectDescendantIds(() => undefined, 'x')).toEqual(['x'])
  })

  it('子孙不含自身重复（无环结构下 id 唯一）', () => {
    const cm: Record<string, Bookmark[]> = { a: [bm('b')] }
    const ids = collectDescendantIds(pid => cm[pid], 'a')
    expect(ids.length).toBe(2)
    expect(new Set(ids).size).toBe(2)
  })
})
