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

describe('detectParentChildRelations — 跨子域归入根域名主页', () => {
  it('子域名页面归入根域名主页（带 www 的主页同样算根域名主页）', () => {
    const links = detectParentChildRelations([
      bm('home', 'https://www.deepseek.com/'),
      bm('chat', 'https://chat.deepseek.com/'),
      bm('platform', 'https://platform.deepseek.com/usage'),
    ])
    expect(linkSet(links)).toEqual(new Set(['chat->home', 'platform->home']))
  })

  it('没有根域名主页时，兄弟子域之间互不归拢', () => {
    const links = detectParentChildRelations([
      bm('chat', 'https://chat.deepseek.com/'),
      bm('platform', 'https://platform.deepseek.com/usage'),
    ])
    expect(links).toHaveLength(0)
  })

  it('父级必须是根域名主页：带路径的根域名页面不跨子域收纳', () => {
    const links = detectParentChildRelations([
      bm('docs', 'https://deepseek.com/docs'),
      bm('chat', 'https://chat.deepseek.com/docs/x'),
    ])
    expect(links).toHaveLength(0)
  })

  it('父级必须在根域名上：子域名主页不收纳别的子域', () => {
    const links = detectParentChildRelations([
      bm('chat', 'https://chat.deepseek.com/'),
      bm('deep', 'https://a.chat.deepseek.com/x'),
      bm('platform', 'https://platform.deepseek.com/'),
    ])
    expect(links).toHaveLength(0)
  })

  it('同主机名的父级优先于跨子域父级，最终拍平到根域名主页一层', () => {
    const links = detectParentChildRelations([
      bm('home', 'https://github.com/'),
      bm('docs', 'https://docs.github.com/'),
      bm('actions', 'https://docs.github.com/actions'),
    ])
    expect(linkSet(links)).toEqual(new Set(['docs->home', 'actions->home']))
  })

  it('多段后缀：同一根域名才归拢，不把 com.cn 当根域名', () => {
    const links = detectParentChildRelations([
      bm('sina', 'https://www.sina.com.cn/'),
      bm('news', 'https://news.sina.com.cn/china'),
      bm('other', 'https://www.other.com.cn/'),
      bm('otherSub', 'https://shop.another.com.cn/'),
    ])
    expect(linkSet(links)).toEqual(new Set(['news->sina']))
  })

  it('co.uk 下不同公司的站点互不归拢', () => {
    const links = detectParentChildRelations([
      bm('bbc', 'https://www.bbc.co.uk/'),
      bm('guardian', 'https://shop.theguardian.co.uk/'),
    ])
    expect(links).toHaveLength(0)
  })

  it('共享托管后缀：不同用户的 github.io 站点互不归拢，也不归到 github.io 下', () => {
    const links = detectParentChildRelations([
      bm('gh', 'https://github.io/'),
      bm('alice', 'https://alice.github.io/'),
      bm('bob', 'https://bob.github.io/blog'),
    ])
    expect(links).toHaveLength(0)
  })

  it('共享托管后缀：同一用户站点的子页与子域仍可归拢', () => {
    const links = detectParentChildRelations([
      bm('alice', 'https://alice.github.io/'),
      bm('post', 'https://alice.github.io/blog/post'),
      bm('sub', 'https://docs.alice.github.io/'),
    ])
    expect(linkSet(links)).toEqual(new Set(['post->alice', 'sub->alice']))
  })

  it('IP 与 localhost 不做跨主机归拢', () => {
    const links = detectParentChildRelations([
      bm('ip1', 'http://1.1.1.1/'),
      bm('ip2', 'http://2.1.1.1/x'),
      bm('lh', 'http://localhost/'),
      bm('lhSub', 'http://app.localhost/x'),
    ])
    expect(links).toHaveLength(0)
  })

  it('不同根域名互不归拢（后缀相同不算同站）', () => {
    const links = detectParentChildRelations([
      bm('a', 'https://deepseek.com/'),
      bm('b', 'https://chat.notdeepseek.com/'),
      bm('c', 'https://deepseek.com.evil.net/'),
    ])
    expect(links).toHaveLength(0)
  })

  it('官方书签与已有归属的子书签不参与跨子域归拢', () => {
    const links = detectParentChildRelations([
      bm('bm_ulink_home', 'https://ulink.ren/'),
      bm('app', 'https://app.ulink.ren/'),
      bm('home', 'https://deepseek.com/'),
      bm('chat', 'https://chat.deepseek.com/', { parentId: 'someone' }),
    ])
    expect(links).toHaveLength(0)
  })
})
