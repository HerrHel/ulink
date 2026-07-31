// DetailPanel.buildDetailCards 护栏测试
// 锁 DetailPanel.vue entries computed 抽出的纯函数 buildDetailCards 契约：
// ui.detailCards 的 rawId 列表（含 `group:<gid>` 前缀）解析成可渲染 DetailEntry，
// 含两条软删过滤渲染层兜底契约（注释原自 DetailPanel.vue:68/73）。

import { describe, it, expect } from 'vitest'
import { buildDetailCards, type DetailEntry } from '../../components/shell/buildDetailCards.js'
import { domain } from '../../utils.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

// minimal Bookmark 造 fixture（测试只关心 id/title/url/deletedAt，其余字段由 buildDetailCards 不读）
function bm(id: string, opts: Partial<Pick<Bookmark, 'title' | 'url' | 'deletedAt'>> = {}): Bookmark {
  return {
    id,
    title: opts.title ?? undefined as never,
    url: opts.url ?? undefined as never,
    deletedAt: opts.deletedAt,
  } as unknown as Bookmark
}
function sg(id: string, opts: Partial<Pick<SiblingGroup, 'name' | 'deletedAt'>> = {}): SiblingGroup {
  return {
    id,
    name: opts.name ?? undefined as never,
    deletedAt: opts.deletedAt,
  } as unknown as SiblingGroup
}

const fixtureDomain = (u: string) => domain(u)

describe('buildDetailCards — 软删过滤渲染层兜底', () => {
  it('空 detailCards / null / undefined 均返空数组（不抛）', () => {
    expect(buildDetailCards([], {}, {}, fixtureDomain)).toEqual([])
    expect(buildDetailCards(null, {}, {}, fixtureDomain)).toEqual([])
    expect(buildDetailCards(undefined, {}, {}, fixtureDomain)).toEqual([])
  })

  it('普通书签 rawId：bookmarkMap 命中且未软删 → 详情项，name=title，domain=domain(url)', () => {
    const bookmarkMap = { b1: bm('b1', { title: 'Google', url: 'https://www.google.com/x' }) }
    const out = buildDetailCards(['b1'], {}, bookmarkMap, fixtureDomain)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual<DetailEntry>({
      rawId: 'b1', realIdx: 0, isGroup: false,
      data: bookmarkMap.b1 as Bookmark, name: 'Google', domain: 'google.com',
    })
  })

  it('group:<gid> 前缀：groupMap 命中且未软删 → 详情项 isGroup:true，name=组名，domain 空串', () => {
    const groupMap = { g1: sg('g1', { name: '开发收藏' }) }
    const out = buildDetailCards(['group:g1'], groupMap, {}, fixtureDomain)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual<DetailEntry>({
      rawId: 'group:g1', realIdx: 0, isGroup: true,
      data: groupMap.g1 as SiblingGroup, name: '开发收藏', domain: '',
    })
  })

  it('★软删组被跳过（渲染层兜底：刷新后 detailCards 残留软删组 id 仍不渲染已删组卡）', () => {
    const groupMap = { g1: sg('g1', { deletedAt: 1700 }) } // 软删
    expect(buildDetailCards(['group:g1'], groupMap, {}, fixtureDomain)).toEqual([])
  })

  it('★软删书签被跳过（渲染层兜底：刷新后 detailCards 残留软删书签 id 仍不渲染已删书签卡）', () => {
    const bookmarkMap = { b1: bm('b1', { deletedAt: 1700 }) } // 软删
    expect(buildDetailCards(['b1'], {}, bookmarkMap, fixtureDomain)).toEqual([])
  })

  it('map 未命中的 rawId 被跳过（悬空 id 不渲染）', () => {
    expect(buildDetailCards(['ghost'], {}, {}, fixtureDomain)).toEqual([])
    expect(buildDetailCards(['group:ghost'], {}, {}, fixtureDomain)).toEqual([])
  })
})

describe('buildDetailCards — 混合与顺序不变量', () => {
  it('混合书签与组按原 rawId 数组顺序输出，悬空 id 跳过不占位', () => {
    const groupMap = { g2: sg('g2', { name: '组2' }) }
    // b1 → 卡 / group:g1 悬空跳过 / ghostbookmark 悬空跳过 / group:g2 → 组卡 / b2 软删跳过
    const bookmarkMap = { b1: bm('b1', { title: '书签1', url: 'https://a.com' }), b2: bm('b2', { deletedAt: 1 }) }
    const out = buildDetailCards(['b1', 'group:g1', 'ghostbookmark', 'group:g2', 'b2'], groupMap, bookmarkMap, fixtureDomain)
    expect(out).toHaveLength(2)
    expect(out[0].isGroup).toBe(false)
    expect(out[0].rawId).toBe('b1')
    expect(out[0].realIdx).toBe(0)
    expect(out[1].isGroup).toBe(true)
    expect(out[1].rawId).toEqual('group:g2')
    expect(out[1].realIdx).toBe(3) // 跟原 cards 数组下标，不是输出数组下标
  })

  it('realIdx 严格跟踪原 cards 数组下标（跳过项不重排后续 realIdx）', () => {
    const bookmarkMap = { last: bm('last', { title: '末', url: 'https://z.com' }) }
    const out = buildDetailCards(['ghost1', 'ghost2', 'last'], {}, bookmarkMap, fixtureDomain)
    expect(out[0].realIdx).toBe(2)
  })
})

describe('buildDetailCards — name 兜底与 domain 派生', () => {
  it('书签 title 为空字符串 falsy → name 兜底空串（|| 短路）', () => {
    const bookmarkMap = { b1: bm('b1', { title: '', url: 'https://a.com' }) }
    const out = buildDetailCards(['b1'], {}, bookmarkMap, fixtureDomain)
    expect(out[0].name).toBe('')
    expect(out[0].domain).toBe('a.com')
  })

  it('组 name 为空字符串 falsy → name 兜底空串', () => {
    const groupMap = { g1: sg('g1', { name: '' }) }
    const out = buildDetailCards(['group:g1'], groupMap, {}, fixtureDomain)
    expect(out[0].name).toBe('')
    expect(out[0].domain).toBe('')
  })

  it('组详情项 domain 恒空串（组无 url 字段，固定 domain:""）', () => {
    const groupMap = { g1: sg('g1', { name: '组' }) }
    expect(buildDetailCards(['group:g1'], groupMap, {}, fixtureDomain)[0].domain).toBe('')
  })

  it('书签 domain 委托注入的 domainFn（★javascript: scheme new URL 不抛 hostname 空串 → domain 返空串非 catch 走 try）', () => {
    // WHATWG URL 对 javascript: scheme 解析成功 hostname='' 不抛 TypeError，
    // 故 domain() 走 try 返空串（非 catch 返原串）——与 extractHostname(c8)/ShareView buildShareEntries(d1-43) 同款真实行为。
    const bookmarkMap = { b1: bm('b1', { title: '坏', url: 'javascript:alert(1)' }) }
    const out = buildDetailCards(['b1'], {}, bookmarkMap, fixtureDomain)
    expect(out[0].domain).toBe('')
  })

  it('注入的 domainFn 被实际调用而非硬编码（spy 证每书签调用一次）', () => {
    const bookmarkMap = {
      a: bm('a', { title: 'A', url: 'https://a.com' }),
      b: bm('b', { title: 'B', url: 'https://b.com' }),
    }
    let calls: string[] = []
    const spyDomain = (u: string) => { calls.push(u); return domain(u) }
    const out = buildDetailCards(['a', 'b'], {}, bookmarkMap, spyDomain)
    expect(out).toHaveLength(2)
    expect(calls).toEqual(['https://a.com', 'https://b.com'])
  })
})

describe('buildDetailCards — 分支路由与边界', () => {
  it('group:<gid> 分支仅查 groupMap，普通 rawId 仅查 bookmarkMap（不串台）', () => {
    // 同名 id 在两 map 都有：group:g1 应查 groupMap 而非 bookmarkMap
    const groupMap = { g1: sg('g1', { name: '组同名' }) }
    const bookmarkMap = { g1: bm('g1', { title: '书签同名', url: 'https://x.com' }) }
    const out = buildDetailCards(['g1', 'group:g1'], groupMap, bookmarkMap, fixtureDomain)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ rawId: 'g1', isGroup: false, name: '书签同名' })
    expect(out[1]).toMatchObject({ rawId: 'group:g1', isGroup: true, name: '组同名' })
  })

  it('group: 前缀但 gid 空（group: 空串 gid）→ groupMap 无空键命中跳过不抛', () => {
    // slice(6) 后 gid='' ，groupMap[''] 未命中 → 跳过；map 须不含 '' 键（fixture 不塞空键对象以免造成命中）
    expect(buildDetailCards(['group:'], {}, {}, fixtureDomain)).toEqual([])
  })

  it('★rawId 非 string（数组里混入 number 123）真实行为：JS 对象[number] 转 "123" 命中 map 字符串键', () => {
    // rawId=123 非 string → typeof 检查 false 不进 group 分支；
    // bookmarkMap[123] 经 JS 对象属性访问 number→string 强制转换成 ['123'] 命中真直锁真实行为非我以为的未命中
    const bookmarkMap = { '123': bm('123', { title: '数字id', url: 'https://n.com' }) }
    // as unknown 跨层级转换 number 入 string[] 不触发 ts-expect-error（unknown 双断言宽进）
    const out = buildDetailCards([123] as unknown as string[], {}, bookmarkMap, fixtureDomain)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ realIdx: 0, isGroup: false, name: '数字id', domain: 'n.com' })
  })

  it('map 命中但对象缺 deletedAt 字段（undefined）按未软删处理正常渲染', () => {
    const bookmarkMap = { b1: bm('b1', { title: '无删除字段', url: 'https://a.com' }) } // deletedAt undefined
    const bm1 = bookmarkMap.b1
    expect((bm1 as any).deletedAt).toBeUndefined()
    const out = buildDetailCards(['b1'], {}, bookmarkMap, fixtureDomain)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('无删除字段')
  })
})

describe('buildDetailCards — 纯函数与确定性', () => {
  it('data 字段透传 map 命中的同对象引用（不重建克隆）', () => {
    const groupMap = { g1: sg('g1', { name: '组' }) }
    const bookmarkMap = { b1: bm('b1', { title: '书签', url: 'https://a.com' }) }
    const out = buildDetailCards(['group:g1', 'b1'], groupMap, bookmarkMap, fixtureDomain)
    expect(out[0].data).toBe(groupMap.g1)
    expect(out[1].data).toBe(bookmarkMap.b1)
  })

  it('多次调用同入参恒定返回结构（纯函数无副作用，不 mutate maps）', () => {
    const groupMap = { g1: sg('g1', { name: '组' }) }
    const bookmarkMap = { b1: bm('b1', { title: '书签', url: 'https://a.com' }) }
    const cards = ['group:g1', 'b1']
    const r1 = buildDetailCards([...cards], groupMap, bookmarkMap, fixtureDomain)
    const r2 = buildDetailCards([...cards], groupMap, bookmarkMap, fixtureDomain)
    expect(r1).toEqual(r2)
    // maps 键集未被 mutate
    expect(Object.keys(groupMap)).toEqual(['g1'])
    expect(Object.keys(bookmarkMap)).toEqual(['b1'])
  })

  it('返回值结构与 DetailEntry 联合类型一致（每项 isGroup 对应分支完整字段）', () => {
    const groupMap = { g1: sg('g1', { name: '组' }) }
    const bookmarkMap = { b1: bm('b1', { title: '书签', url: 'https://a.com' }) }
    const out = buildDetailCards(['group:g1', 'b1'], groupMap, bookmarkMap, fixtureDomain)
    for (const e of out) {
      expect(typeof e.rawId).toBe('string')
      expect(typeof e.realIdx).toBe('number')
      expect(typeof e.isGroup).toBe('boolean')
      expect(typeof e.name).toBe('string')
      expect(typeof e.domain).toBe('string')
    }
  })
})
