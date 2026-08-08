/**
 * D1-41：search.ts 搜索索引构建链 + 库未就绪降级复合纯函数护栏（精简版）
 *
 * 补 search.ts 中 _buildAttrNameMap / _attrsToAttrNames（属性 id→名称映射,决定勾选属性可搜）
 * 与 _fallbackBmIds / _fallbackGrpIds（库未就绪 includes 降级路径,决定降级搜索范围与 Fuse 覆盖
 * 一致性——L6 修复点:旧降级漏 attrNames 致按属性名搜不到书签,已追加 attrNames 匹配）。
 *
 * 原 38 例含真契约(同 id 覆盖/软删入映射/未命中空串剔除/空名剔除/★L6 attrNames 降级修复/大小写
 * 不敏感/子书签 title+url 经 bookmarkMap 解析/悬空 id 跳过)与基础镜像(Map 构造/逐字段 includes
 * 对称/query 空/仅空格对称)。此精简版留 ~24 例守核心,fallback 逐字段命中对称留 title 代表。
 *
 * 仅给四私有函数增 export 关键字供测试 import,函数体逐字未动,零逻辑改动。
 */
import { describe, it, expect } from 'vitest'
import type { Bookmark, SiblingGroup, CustomAttribute } from '../../types.js'
import {
  _buildAttrNameMap,
  _attrsToAttrNames,
  _fallbackBmIds,
  _fallbackGrpIds,
} from '../../lib/search.js'

function attr(id: string, name: string): CustomAttribute {
  return { id, name, type: 'boolean' } as CustomAttribute
}

// ─── _buildAttrNameMap ───
describe('_buildAttrNameMap', () => {
  it('空/单/多元素逐一映射 id→name（Map 构造基础语义）', () => {
    expect(_buildAttrNameMap([]).size).toBe(0)
    expect(_buildAttrNameMap([attr('a1', '前端')]).get('a1')).toBe('前端')
    const m = _buildAttrNameMap([attr('a1', '前端'), attr('a2', '后端'), attr('a3', '工具')])
    expect(m.get('a1')).toBe('前端')
    expect(m.get('a2')).toBe('后端')
    expect(m.get('a3')).toBe('工具')
    expect(m.size).toBe(3)
  })

  it('name 原样保留不规范化（含特殊字符/空格）', () => {
    const m = _buildAttrNameMap([attr('a1', 'My Tag!'), attr('a2', '中 文')])
    expect(m.get('a1')).toBe('My Tag!')
    expect(m.get('a2')).toBe('中 文')
  })

  it('同 id 重复后者覆盖前者（Map 构造语义契约）', () => {
    const m = _buildAttrNameMap([attr('a1', '旧'), attr('a1', '新')])
    expect(m.get('a1')).toBe('新')
    expect(m.size).toBe(1)
  })

  it('软删属性（含 deletedAt）仍入映射不过滤——索引构建对软删透明', () => {
    const soft = { ...attr('a1', '已删'), deletedAt: 1700000000000 }
    const m = _buildAttrNameMap([soft])
    expect(m.get('a1')).toBe('已删')
    expect(m.size).toBe(1)
  })
})

// ─── _attrsToAttrNames ───
describe('_attrsToAttrNames', () => {
  it('undefined / 空对象 attributes 返空串（|| {} 兜底）', () => {
    expect(_attrsToAttrNames(undefined, _buildAttrNameMap([]))).toBe('')
    expect(_attrsToAttrNames({}, _buildAttrNameMap([]))).toBe('')
  })

  it('全 falsey 属性全过滤返空串', () => {
    const attributes: Record<string, boolean> = { a1: false, a2: false }
    expect(_attrsToAttrNames(attributes, _buildAttrNameMap([attr('a1', '前端'), attr('a2', '后端')]))).toBe('')
  })

  it('部分勾选：只映射 truthy 属性为名称 + join 空格保留顺序', () => {
    const attributes: Record<string, boolean> = { a1: true, a2: false, a3: true }
    const r = _attrsToAttrNames(attributes, _buildAttrNameMap([attr('a1', '前端'), attr('a2', '后端'), attr('a3', '工具')]))
    expect(r).toBe('前端 工具')
  })

  it('★attrMap 未命中 attrId 用空串兜底被 filter Boolean 剔除不污染串', () => {
    const attributes: Record<string, boolean> = { aX: true, a1: true }
    const r = _attrsToAttrNames(attributes, _buildAttrNameMap([attr('a1', '前端')]))
    expect(r).toBe('前端')
  })

  it('name 为空串的属性被 filter Boolean 剔除（空名属性不进搜索串）', () => {
    const attributes: Record<string, boolean> = { a1: true, a2: true }
    const r = _attrsToAttrNames(attributes, _buildAttrNameMap([attr('a1', '前端'), attr('a2', '')]))
    expect(r).toBe('前端')
  })

  it('truthy 非 boolean（如 1）也被纳入（宽松真值收取语义）', () => {
    const attributes: Record<string, unknown> = { a1: 1, a2: 0 }
    const r = _attrsToAttrNames(attributes as Record<string, boolean>, _buildAttrNameMap([attr('a1', '前端'), attr('a2', '后端')]))
    expect(r).toBe('前端')
  })
})

// ─── _fallbackBmIds（库未就绪 includes 降级） ───
function mkBm(id: string, fields: Partial<Bookmark>): Bookmark {
  return { id, title: '', url: '', notes: '', username: '', attributes: undefined, ...fields } as unknown as Bookmark
}

describe('_fallbackBmIds', () => {
  it('query 空/仅空格:trim 归空串,各字段 includes("") 恒 true 全命中', () => {
    const bks = [mkBm('b1', { title: 'A' }), mkBm('b2', { title: 'B' })]
    expect(_fallbackBmIds(bks, '', []).size).toBe(2)
    expect(_fallbackBmIds([mkBm('b1', { title: 'A' })], '   ', []).size).toBe(1)
  })

  it('title 命中（大小写不敏感 toLowerCase,代表 url/notes/username 同 includes 路径）', () => {
    const bks = [mkBm('b1', { title: 'Vue Guide' }), mkBm('b2', { url: 'https://example.com/path' }), mkBm('b3', { notes: '一些重要备注' }), mkBm('b4', { username: 'admin_user' })]
    expect([..._fallbackBmIds(bks, 'vue', [])]).toEqual(['b1'])
    expect([..._fallbackBmIds(bks, 'example', [])]).toEqual(['b2'])
    expect([..._fallbackBmIds(bks, '重要', [])]).toEqual(['b3'])
    expect([..._fallbackBmIds(bks, 'min', [])]).toEqual(['b4'])
  })

  it('★L6 修复点:勾选属性名命中（attrNames 匹配,降级路径与 Fuse 覆盖一致）+ 大小写不敏感', () => {
    const bks = [mkBm('b1', { attributes: { a1: true } }), mkBm('b2', { attributes: { a1: false } })]
    expect([..._fallbackBmIds(bks, '前端', [attr('a1', '前端')])]).toEqual(['b1'])
    expect([..._fallbackBmIds([mkBm('b1', { attributes: { a1: true } })], 'FRONTEND', [attr('a1', 'frontend')])]).toEqual(['b1'])
  })

  it('★attrMap 缺失该 attrId 时不致命中（空串不匹配非空 query）', () => {
    const bks = [mkBm('b1', { attributes: { aX: true } })]
    expect(_fallbackBmIds(bks, '前端', [attr('a1', '前端')]).size).toBe(0)
  })

  it('返回 Set 去重（多字段都命中同一书签只入一次）', () => {
    expect(_fallbackBmIds([mkBm('b1', { title: 'a', url: 'a', notes: 'a' })], 'a', []).size).toBe(1)
  })

  it('空 bookmarks / 全不命中 / 空 title 兜底（|| "" 防 null/undefined 抛错）', () => {
    expect(_fallbackBmIds([], 'foo', []).size).toBe(0)
    expect(_fallbackBmIds([mkBm('b1', { title: 'X' })], '不存在', []).size).toBe(0)
    expect(_fallbackBmIds([mkBm('b1', { title: undefined as unknown as string })], 'foo', []).size).toBe(0)
  })
})

// ─── _fallbackGrpIds（库未就绪 includes 降级） ───
function mkGrp(id: string, fields: Partial<SiblingGroup>): SiblingGroup {
  return { id, name: '', attributes: undefined, bookmarkIds: [], ...fields } as unknown as SiblingGroup
}

describe('_fallbackGrpIds', () => {
  it('name 命中（含 query trim + 大小写不敏感 toLowerCase）', () => {
    expect([..._fallbackGrpIds([mkGrp('g1', { name: '开发工具集' })], '工具', {})]).toEqual(['g1'])
    expect([..._fallbackGrpIds([mkGrp('g1', { name: 'Tools' })], '  TOOLS  ', {})]).toEqual(['g1']) // trim + 大小写
  })

  it('★子书签 title 命中 + url 命中（经 bookmarkMap 解析子项）', () => {
    const groups = [mkGrp('g1', { bookmarkIds: ['b1', 'b2'] })]
    const bookmarkMap: Record<string, Bookmark> = {
      b1: mkBm('b1', { title: 'Vue' }),
      b2: mkBm('b2', { title: 'React' }),
    }
    expect([..._fallbackGrpIds(groups, 'react', bookmarkMap)]).toEqual(['g1'])
    const urlGroups = [mkGrp('g1', { bookmarkIds: ['b1'] })]
    const urlMap: Record<string, Bookmark> = { b1: mkBm('b1', { url: 'https://vue.dev' }) }
    expect([..._fallbackGrpIds(urlGroups, 'vue.dev', urlMap)]).toEqual(['g1'])
  })

  it('★子 bookmarkMap 未命中 bookmarkId 跳过不抛（悬空 id）/ bookmarkIds 缺省回退不命中', () => {
    const groups = [mkGrp('g1', { bookmarkIds: ['ghost', 'b1'] })]
    const bookmarkMap: Record<string, Bookmark> = { b1: mkBm('b1', { title: 'Vue' }) }
    expect([..._fallbackGrpIds(groups, 'vue', bookmarkMap)]).toEqual(['g1'])
    const nullBmGroups = [mkGrp('g1', { bookmarkIds: undefined as unknown as string[] })]
    expect(_fallbackGrpIds(nullBmGroups, 'vue', {}).size).toBe(0)
  })

  it('空 groups / 全不命中 / 返回 Set 去重（group 命中不重复入）', () => {
    expect(_fallbackGrpIds([], 'foo', {}).size).toBe(0)
    const groups = [mkGrp('g1', { name: 'X', bookmarkIds: ['b1'] })]
    expect(_fallbackGrpIds(groups, '不存在', { b1: mkBm('b1', { title: 'Y' }) }).size).toBe(0)
    const dupGroups = [mkGrp('g1', { name: 'a', bookmarkIds: ['b1'] })]
    expect(_fallbackGrpIds(dupGroups, 'a', { b1: mkBm('b1', { title: 'a' }) }).size).toBe(1) // name+子项都命中仍只入一次
  })

  it('query 空:name "".includes("")===true 全命中', () => {
    expect(_fallbackGrpIds([mkGrp('g1', { name: 'A' }), mkGrp('g2', { name: 'B' })], '', {}).size).toBe(2)
  })
})
