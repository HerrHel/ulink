import { describe, it, expect } from 'vitest'
import { collectDescendantIds } from '../lib/collectSubIds.js'
import type { Bookmark } from '../types.js'

/**
 * d1-101 环数据护栏：collectDescendantIds 在 childrenMap 成环时必须收敛，
 * 不因无 visited 守卫导致 stack 永不空栈、子孙集合无限增长直至栈溢出崩溃主线程。
 *
 * 环数据来源（真实隐特性）：sync 冲突 merge 误填反向 parentId、importHTML 错误嵌套、
 * 用户级 bug。collectDescendantIds 被 useBatch(批量删)/useBookmark(嵌套删)/
 * DeadLinksPopover(死链检查)/useSpaceMove(空间移动) 四处调用，任一在环化数据上
 * 崩溃会让对应操作栈溢出且无告警。
 */
function bm(id: string, parentId: string | null = null): Bookmark {
  return {
    id, parentId,
    title: '', url: '', icon: '', username: '', password: '',
    notes: '', categoryId: '', order: 0, useCount: 0,
    attributes: {}, isExpanded: false,
    createdAt: 0, updatedAt: 0,
  } as unknown as Bookmark
}

describe('collectDescendantIds 环数据收敛护栏 (d1-101)', () => {
  it('自引用环 a→a 收敛不栈溢出（回边指向自身被 visited 拦）', () => {
    // a 的子是 a 自身 —— 无 visited 会无限推 stack[id=a,id=a,...] 炸栈
    const cm: Record<string, Bookmark[]> = { a: [bm('a')] }
    const ids = collectDescendantIds(pid => cm[pid], 'a')
    // 回边指向已 visited 的起始 a，不再入栈，栈收敛 -> 仅返回自身
    expect(ids).toEqual(['a'])
    expect(ids.length).toBe(1)
    expect(new Set(ids).size).toBe(1)
  })

  it('两节点互环 a→b→a 收敛（环内已访问 id 不再入栈）', () => {
    const cm: Record<string, Bookmark[]> = { a: [bm('b')], b: [bm('a')] }
    const ids = collectDescendantIds(pid => cm[pid], 'a')
    // a→b→a：b 推入后再 pop getChildren('b')=[a]，a 已 visited 拦截，栈空收
    expect(new Set(ids)).toEqual(new Set(['a', 'b']))
    expect(new Set(ids).size).toBe(2)
    expect(ids.length).toBe(2) // 无重复，a 在 result 只出现一次
  })

  it('三节点环 a→b→c→a 收敛含环内全集不溢出', () => {
    const cm: Record<string, Bookmark[]> = {
      a: [bm('b')], b: [bm('c')], c: [bm('a')],
    }
    const ids = collectDescendantIds(pid => cm[pid], 'a')
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c']))
    expect(ids.length).toBe(3)
    expect(new Set(ids).size).toBe(3)
  })

  it('环 + 正常叶子混合：环内节点 + 环外正常子全集收敛', () => {
    // a→b→c→b(环) + a→d(正常叶)
    const cm: Record<string, Bookmark[]> = {
      a: [bm('b'), bm('d')],
      b: [bm('c')],
      c: [bm('b')], // 回边指向 b 形成环 b→c→b
      d: [],
    }
    const ids = collectDescendantIds(pid => cm[pid], 'a')
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c', 'd']))
    expect(ids.length).toBe(4)
  })

  it('环内节点同时是起始 id 的回边，收敛且自身只出现一次', () => {
    // a→b→a：a 是起始同时在 b 的回边里，须确保 a 不被二次推入 ids
    const cm: Record<string, Bookmark[]> = { a: [bm('b')], b: [bm('a')] }
    const ids = collectDescendantIds(pid => cm[pid], 'a')
    const aCount = ids.filter(x => x === 'a').length
    expect(aCount).toBe(1) // 起始 a 仅 1 次，回边不重复
    expect(ids.length).toBe(2)
  })

  it('环数据下子孙集合 size 不超过图节点总数（收敛上界契约，防无限增长）', () => {
    // 三节点环图，收敛 id 上界 = 节点数 3
    const cm: Record<string, Bookmark[]> = {
      a: [bm('b')], b: [bm('c')], c: [bm('a')],
    }
    const ids = collectDescendantIds(pid => cm[pid], 'a')
    expect(ids.length).toBeLessThanOrEqual(3)
    expect(new Set(ids).size).toBeLessThanOrEqual(3)
  })

  it('无环 DAG 下同 id 跨多父被重复枚举时消重（visited 守护增强防重复入 ids）', () => {
    // a→[b,c], b→[d], c→[d] —— d 跨两父重复枚举，visited 守卫去重只计一次
    const cm: Record<string, Bookmark[]> = {
      a: [bm('b'), bm('c')],
      b: [bm('d')],
      c: [bm('d')],
      d: [],
    }
    const ids = collectDescendantIds(pid => cm[pid], 'a')
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c', 'd']))
    expect(ids.length).toBe(4) // d 去重，length 等于 Set.size
    expect(new Set(ids).size).toBe(4)
  })

  it('既有无环多层递归路径行为逐字不变（visited 不拦无环节点）', () => {
    // a → b → d,e ; a → c —— 既有 collectSubIds.test.ts 同款多层 DAG
    const cm: Record<string, Bookmark[]> = {
      a: [bm('b'), bm('c')],
      b: [bm('d'), bm('e')],
      c: [],
    }
    const ids = collectDescendantIds(pid => cm[pid], 'a')
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(ids.length).toBe(5)
    expect(new Set(ids).size).toBe(5)
  })

  it('空 childrenMap + 起始 id 仍返回自身（起始恒入 visited 与 result）', () => {
    const cm: Record<string, Bookmark[]> = {}
    const ids = collectDescendantIds(pid => cm[pid], 'x')
    expect(ids).toEqual(['x'])
  })

  it('深度环（多层后回边）收敛含全集', () => {
    // a→b→c→d→b（长路径后回边形成环，环跨 3 边）
    const cm: Record<string, Bookmark[]> = {
      a: [bm('b')], b: [bm('c')], c: [bm('d')], d: [bm('b')],
    }
    const ids = collectDescendantIds(pid => cm[pid], 'a')
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c', 'd']))
    expect(ids.length).toBe(4)
  })

  it('纯函数无副作用 + 返回恒 string[]（同入参多次调用结果一致）', () => {
    const cm: Record<string, Bookmark[]> = {
      a: [bm('b'), bm('c')],
      b: [bm('c')], // c 同时被 a 与 b 枚举
      c: [],
    }
    const r1 = collectDescendantIds(pid => cm[pid], 'a')
    const r2 = collectDescendantIds(pid => cm[pid], 'a')
    expect(r1).toEqual(r2)
    r1.forEach(x => expect(typeof x).toBe('string'))
    expect(Array.isArray(r1)).toBe(true)
  })

  it('大环（含正常分支 + 环）收敛且环外分支全集纳入', () => {
    // a→[b,c,d]; b→e→b(环 b→e→b); c→f(环外正常): 收敛含 {a,b,c,d,e,f}
    const cm: Record<string, Bookmark[]> = {
      a: [bm('b'), bm('c'), bm('d')],
      b: [bm('e')],
      e: [bm('b')], // 环 b→e→b
      c: [bm('f')],
      d: [],
      f: [],
    }
    const ids = collectDescendantIds(pid => cm[pid], 'a')
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c', 'd', 'e', 'f']))
    expect(ids.length).toBe(6)
  })
})
