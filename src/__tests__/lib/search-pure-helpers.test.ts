/**
 * D1-41：search.ts 搜索索引构建链 + 库未就绪降级复合纯函数护栏
 *
 * 补 D1-40 高亮段拼装核姐妹缺口——同文件 search.ts 中：
 * - _buildAttrNameMap / _attrsToAttrNames（搜索索引构建链：属性 id→名称映射，决定搜索时
 *   勾选属性能否被搜到）
 * - _fallbackBmIds / _fallbackGrpIds（库未就绪时 includes 降级路径，决定降级搜索范围
 *   是否与正常 Fuse 路径覆盖一致——L6 修复点：旧降级漏 attrNames 致按属性名搜不到对应
 *   书签，已追加 attrNames 匹配）
 *
 * 这四个真纯合成函数（无模块级状态、无 IO、仅依赖入参）此前零直接测试、仅经
 * searchBookmarkIds/searchGroupIds 黑盒间接覆盖，真实隐性行为靠实现口头维护。
 * 仅给四私有函数增 export 关键字供测试 import，函数体逐字未动，零逻辑改动。
 */
import { describe, it, expect } from 'vitest'
import type { Bookmark, SiblingGroup, CustomAttribute } from '../../types.js'
import {
  _buildAttrNameMap,
  _attrsToAttrNames,
  _fallbackBmIds,
  _fallbackGrpIds,
} from '../../lib/search.js'

// 工厂辅助：构造最小 CustomAttribute
function attr(id: string, name: string): CustomAttribute {
  return { id, name, type: 'boolean' } as CustomAttribute
}

// ─── _buildAttrNameMap ───
describe('_buildAttrNameMap', () => {
  it('空数组返空 Map', () => {
    expect(_buildAttrNameMap([]).size).toBe(0)
  })

  it('单元素映射 id→name', () => {
    const m = _buildAttrNameMap([attr('a1', '前端')])
    expect(m.get('a1')).toBe('前端')
  })

  it('多元素逐一映射', () => {
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

  it('同 id 重复后者覆盖前者（Map 构造语义）', () => {
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
  it('undefined attributes 返空串', () => {
    expect(_attrsToAttrNames(undefined, _buildAttrNameMap([]))).toBe('')
  })

  it('空对象 attributes 返空串', () => {
    expect(_attrsToAttrNames({}, _buildAttrNameMap([]))).toBe('')
  })

  it('全 falsey 属性全部被过滤返空串', () => {
    const attributes: Record<string, boolean> = { a1: false, a2: false }
    expect(_attrsToAttrNames(attributes, _buildAttrNameMap([attr('a1', '前端'), attr('a2', '后端')]))).toBe('')
  })

  it('部分勾选：只映射 truthy 属性为名称', () => {
    const attributes: Record<string, boolean> = { a1: true, a2: false, a3: true }
    const r = _attrsToAttrNames(attributes, _buildAttrNameMap([attr('a1', '前端'), attr('a2', '后端'), attr('a3', '工具')]))
    expect(r).toBe('前端 工具')
  })

  it('attrMap 未命中 attrId 用空串兜底被 filter Boolean 剔除不污染串', () => {
    // a1 在 attrMap 缺失 → get 返 undefined → || '' → filter(Boolean) 剔除
    const attributes: Record<string, boolean> = { aX: true, a1: true }
    const r = _attrsToAttrNames(attributes, _buildAttrNameMap([attr('a1', '前端')]))
    expect(r).toBe('前端')
  })

  it('多个勾选属性 join 空格分隔保留顺序', () => {
    const attributes: Record<string, boolean> = { a3: true, a1: true, a2: true }
    const r = _attrsToAttrNames(attributes, _buildAttrNameMap([attr('a1', '前端'), attr('a2', '后端'), attr('a3', '工具')]))
    // 顺序按 attributes 的 key 插入顺序：a3,a1,a2
    expect(r).toBe('工具 前端 后端')
  })

  it('name 为空串的属性被 filter Boolean 剔除（空名属性不进搜索串）', () => {
    const attributes: Record<string, boolean> = { a1: true, a2: true }
    const r = _attrsToAttrNames(attributes, _buildAttrNameMap([attr('a1', '前端'), attr('a2', '')]))
    expect(r).toBe('前端')
  })

  it('truthy 非 boolean（如 1）也被纳入 filter（宽松真值）', () => {
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
  it('query 空：trim 后空串，各字段 includes("") 恒 true 全命中', () => {
    const bks = [mkBm('b1', { title: 'A' }), mkBm('b2', { title: 'B' })]
    // ''.includes('') === true，所有书签命中
    const r = _fallbackBmIds(bks, '', [])
    expect(r.size).toBe(2)
    expect(r.has('b1')).toBe(true)
    expect(r.has('b2')).toBe(true)
  })

  it('query 仅空格：trim 归空同上全命中', () => {
    const bks = [mkBm('b1', { title: 'A' })]
    expect(_fallbackBmIds(bks, '   ', []).size).toBe(1)
  })

  it('title 命中（大小写不敏感：toLowerCase）', () => {
    const bks = [mkBm('b1', { title: 'Vue Guide' }), mkBm('b2', { title: 'Other' })]
    const r = _fallbackBmIds(bks, 'vue', [])
    expect([...r]).toEqual(['b1'])
  })

  it('url 命中', () => {
    const bks = [mkBm('b1', { url: 'https://example.com/path' })]
    expect([..._fallbackBmIds(bks, 'example', [])]).toEqual(['b1'])
  })

  it('notes 命中', () => {
    const bks = [mkBm('b1', { notes: '一些重要备注' })]
    expect([..._fallbackBmIds(bks, '重要', [])]).toEqual(['b1'])
  })

  it('username 命中', () => {
    const bks = [mkBm('b1', { username: 'admin_user' })]
    expect([..._fallbackBmIds(bks, 'min', [])]).toEqual(['b1'])
  })

  it('★L6 修复点：勾选属性名命中（attrNames 匹配，降级路径与 Fuse 覆盖一致）', () => {
    // 书签勾选属性 a1=true，属性 a1 名为「前端」，query「前端」应命中该书签
    const bks = [mkBm('b1', { attributes: { a1: true } }), mkBm('b2', { attributes: { a1: false } })]
    const r = _fallbackBmIds(bks, '前端', [attr('a1', '前端')])
    expect([...r]).toEqual(['b1'])
  })

  it('attrNames 匹配大小写不敏感（toLowerCase）', () => {
    const bks = [mkBm('b1', { attributes: { a1: true } })]
    expect([..._fallbackBmIds(bks, 'FRONTEND', [attr('a1', 'frontend')])]).toEqual(['b1'])
  })

  it('attrMap 缺失该 attrId 时不致命中（空串不匹配非空 query）', () => {
    // b1 勾选 aX，但 attrMap 无 aX → attrsToAttrNames 返空串 → 不命中
    const bks = [mkBm('b1', { attributes: { aX: true } })]
    expect(_fallbackBmIds(bks, '前端', [attr('a1', '前端')]).size).toBe(0)
  })

  it('返回 Set 去重（多字段都命中同一书签只入一次）', () => {
    const bks = [mkBm('b1', { title: 'a', url: 'a', notes: 'a' })]
    expect(_fallbackBmIds(bks, 'a', []).size).toBe(1)
  })

  it('空 bookmarks 返空 Set', () => {
    expect(_fallbackBmIds([], 'foo', []).size).toBe(0)
  })

  it('全不命中返空 Set', () => {
    const bks = [mkBm('b1', { title: 'X' })]
    expect(_fallbackBmIds(bks, '不存在', []).size).toBe(0)
  })

  it('title 为空兜底不影响（|| "" 防 null/undefined 抛错）', () => {
    const bks = [mkBm('b1', { title: undefined as unknown as string })]
    // 不抛 + query 非空不命中
    expect(_fallbackBmIds(bks, 'foo', []).size).toBe(0)
  })
})

// ─── _fallbackGrpIds（库未就绪 includes 降级） ───
function mkGrp(id: string, fields: Partial<SiblingGroup>): SiblingGroup {
  return { id, name: '', attributes: undefined, bookmarkIds: [], ...fields } as unknown as SiblingGroup
}

describe('_fallbackGrpIds', () => {
  it('name 命中', () => {
    const groups = [mkGrp('g1', { name: '开发工具集' })]
    expect([..._fallbackGrpIds(groups, '工具', {})]).toEqual(['g1'])
  })

  it('★子书签 title 命中（经 bookmarkMap 解析子项）', () => {
    const groups = [mkGrp('g1', { bookmarkIds: ['b1', 'b2'] })]
    const bookmarkMap: Record<string, Bookmark> = {
      b1: mkBm('b1', { title: 'Vue' }),
      b2: mkBm('b2', { title: 'React' }),
    }
    expect([..._fallbackGrpIds(groups, 'react', bookmarkMap)]).toEqual(['g1'])
  })

  it('★子书签 url 命中', () => {
    const groups = [mkGrp('g1', { bookmarkIds: ['b1'] })]
    const bookmarkMap: Record<string, Bookmark> = { b1: mkBm('b1', { url: 'https://vue.dev' }) }
    expect([..._fallbackGrpIds(groups, 'vue.dev', bookmarkMap)]).toEqual(['g1'])
  })

  it('大小写不敏感（toLowerCase）', () => {
    const groups = [mkGrp('g1', { name: 'Tools' })]
    expect([..._fallbackGrpIds(groups, 'TOOLS', {})]).toEqual(['g1'])
  })

  it('子 bookmarkMap 未命中 bookmarkId 跳过不抛（悬空 id）', () => {
    const groups = [mkGrp('g1', { bookmarkIds: ['ghost', 'b1'] })]
    const bookmarkMap: Record<string, Bookmark> = { b1: mkBm('b1', { title: 'Vue' }) }
    // ghost 不在 map，b1 命中
    expect([..._fallbackGrpIds(groups, 'vue', bookmarkMap)]).toEqual(['g1'])
  })

  it('bookmarkIds 缺省（null/undefined）回退不命中', () => {
    const groups = [mkGrp('g1', { bookmarkIds: undefined as unknown as string[] })]
    expect(_fallbackGrpIds(groups, 'vue', {}).size).toBe(0)
  })

  it('name 与子项都不命中返空', () => {
    const groups = [mkGrp('g1', { name: 'X', bookmarkIds: ['b1'] })]
    const bookmarkMap: Record<string, Bookmark> = { b1: mkBm('b1', { title: 'Y' }) }
    expect(_fallbackGrpIds(groups, '不存在', bookmarkMap).size).toBe(0)
  })

  it('query trim 真生效', () => {
    const groups = [mkGrp('g1', { name: 'Tools' })]
    expect([..._fallbackGrpIds(groups, '  Tools  ', {})]).toEqual(['g1'])
  })

  it('空 groups 返空 Set', () => {
    expect(_fallbackGrpIds([], 'foo', {}).size).toBe(0)
  })

  it('返回 Set 去重（group 命中不重复入）', () => {
    const groups = [mkGrp('g1', { name: 'a', bookmarkIds: ['b1'] })]
    const bookmarkMap: Record<string, Bookmark> = { b1: mkBm('b1', { title: 'a' }) }
    // name 命中 + 子项命中，仍只入一次
    expect(_fallbackGrpIds(groups, 'a', bookmarkMap).size).toBe(1)
  })

  it('query 空：name "".includes("")===true 全命中', () => {
    const groups = [mkGrp('g1', { name: 'A' }), mkGrp('g2', { name: 'B' })]
    expect(_fallbackGrpIds(groups, '', {}).size).toBe(2)
  })
})
