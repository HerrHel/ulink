/**
 * localClustering-nesting — detectParentChildRelations 纯函数测试
 * 验收点（子链接从属关系）：
 * 1. 同站子页识别为父页面的子级（最长路径匹配、一层扁平嵌套）；
 * 2. 路径段边界匹配，杜绝 /a/b 误配 /a/bc；
 * 3. 同路径仅参数不同互不为父子；
 * 4. 已有 parentId 的子书签与系统官方书签绝不参与。
 */
import { describe, it, expect } from 'vitest'
import { detectParentChildRelations } from '../../lib/ai/localClustering.js'
import type { Bookmark } from '../../types.js'

function bm(id: string, url: string, extra: Partial<Bookmark> = {}): Bookmark {
  return { id, title: id, url, categoryId: 'uncategorized', ...extra } as Bookmark
}

function linkSet(links: Array<{ childId: string; parentId: string }>): Set<string> {
  return new Set(links.map((l) => `${l.childId}->${l.parentId}`))
}

describe('detectParentChildRelations — 同站子页从属关系识别', () => {
  it('同站子页归入最长匹配父级，且拍平为一层扁平嵌套', () => {
    const links = detectParentChildRelations([
      bm('a', 'https://site.com/docs'),
      bm('b', 'https://site.com/docs/api'),
      bm('c', 'https://site.com/docs/api/ref'),
    ])
    // b、c 都挂在最近的栏目页 a 下：拍平后 c 不经由 b 形成祖孙链
    expect(linkSet(links)).toEqual(new Set(['b->a', 'c->a']))
  })

  it('仅子页独有时挂在最长匹配的顶层父级下', () => {
    const links = detectParentChildRelations([
      bm('root', 'https://site.com'),
      bm('sub', 'https://site.com/v/123'),
    ])
    expect(linkSet(links)).toEqual(new Set(['sub->root']))
  })

  it('路径段边界匹配：/a/b 不是 /a/bc 的父级', () => {
    const links = detectParentChildRelations([
      bm('p', 'https://site.com/a/b'),
      bm('c', 'https://site.com/a/bc'),
    ])
    expect(links).toHaveLength(0)
  })

  it('同路径仅查询参数不同互不为父子', () => {
    const links = detectParentChildRelations([
      bm('v1', 'https://site.com/watch?v=1'),
      bm('v2', 'https://site.com/watch?v=2'),
    ])
    expect(links).toHaveLength(0)
  })

  it('www 与裸域视为同一站点', () => {
    const links = detectParentChildRelations([
      bm('p', 'https://www.site.com/'),
      bm('c', 'https://site.com/page/deep'),
    ])
    expect(linkSet(links)).toEqual(new Set(['c->p']))
  })

  it('跨域站点互不嵌套', () => {
    const links = detectParentChildRelations([
      bm('p', 'https://a.com/x'),
      bm('c', 'https://b.com/x/y'),
    ])
    expect(links).toHaveLength(0)
  })

  it('已有 parentId 的子书签与系统官方书签绝不参与', () => {
    const links = detectParentChildRelations([
      bm('bm_ulink_home', 'https://site.com'),
      bm('nested', 'https://site.com/already/child', { parentId: 'someone' }),
      bm('c1', 'https://site.com/already/child/deep'),
    ])
    // nested 已有归属，不作父也不作子；c1 只能挂在官方书签下，但官方书签受保护不参与嵌套
    expect(links).toHaveLength(0)
  })

  it('已删除与非法 URL 的书签不参与嵌套建议', () => {
    const links = detectParentChildRelations([
      bm('p', 'https://site.com/docs'),
      bm('bad', 'not-a-url/docs/x'),
      bm('gone', 'https://site.com/docs/deleted', { deletedAt: 1 }),
      bm('c', 'https://site.com/docs/api'),
    ])
    expect(linkSet(links)).toEqual(new Set(['c->p']))
  })
})
