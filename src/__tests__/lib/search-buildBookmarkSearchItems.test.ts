/**
 * D1-117(本轮 r9)：search.ts `_buildBookmarkSearchItems` 索引构建护栏
 *
 * `_buildBookmarkSearchItems(bookmarks, customAttributes)` 是书签搜索索引的构建核——
 * 把 Bookmark[] 映射成 BookmarkSearchItem[]（8 字段：id/title/url/notes/username/
 * attrNames/titlePy/notesPy），供 Fuse.js 搜索时按这些字段匹配。书签能否被搜到、
 * 中文能否经拼音搜到、勾选属性能否被搜到，全靠此函数把元数据正确投影到索引项。
 *
 * 真实隐性行为此前零直接单测，仅经 searchBookmarkIds 黑盒间接覆盖（兄弟函数
 * `_buildGroupSearchItems` 在 search.test.ts 有间接覆盖，但 bookmark 版零直接对称测）。
 * 补 13 用例直接锁构建契约：
 *   - 一一对应 + 顺序保留 + id 一致
 *   - 空字段兜底（title/url/notes/username undefined|null → ''）
 *   - attrNames 经 _attrsToAttrNames（勾选 attr→名称串、attrNameMap miss 跳过、falsy 跳过）
 *   - titlePy/notesPy 经 _toPy（中文标题出全拼拼音串、空标题→''、英文标题透传拼音常叠为自身）
 *   - 空 bookmarks → 空数组
 *   - 空 customAttributes → attrNames 恒空串
 *   - bookmark.attributes undefined → attrNames 空串
 *   - 多 bookmark 多 attr 复合投影
 *
 * 仅给私有 `_buildBookmarkSearchItems` 增 export 关键字供测试 import，函数体逐字未动，
 * 零逻辑改动。同 D1-41 search-pure-helpers「搜索索引构建链护栏」姐妹补强口径。
 */
import { describe, it, expect } from 'vitest'
import type { Bookmark, CustomAttribute } from '../../types.js'
import { _buildBookmarkSearchItems } from '../../lib/search.js'

// 工厂辅助：构造最小 CustomAttribute
function attr(id: string, name: string): CustomAttribute {
  return { id, name, type: 'boolean' } as CustomAttribute
}

// 工厂辅助：构造最小 Bookmark（仅放下本测试关心的可变字段）
function bm(p: Partial<Pick<Bookmark, 'id' | 'title' | 'url' | 'notes' | 'username' | 'attributes'>>): Bookmark {
  return {
    id: p.id ?? 'b1',
    title: p.title,
    url: p.url,
    notes: p.notes,
    username: p.username,
    password: '',
    icon: '',
    categoryId: 'uncat',
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: p.attributes,
    isExpanded: false,
    createdAt: 0,
    updatedAt: 0,
  } as Bookmark
}

describe('_buildBookmarkSearchItems', () => {
  it('一一映射：bookmark 数组顺序与 id 一一对应', () => {
    const items = _buildBookmarkSearchItems(
      [bm({ id: 'a', title: 'A', url: 'ua', username: 'ua-user' }), bm({ id: 'b', title: 'B', url: 'ub' })],
      [],
    )
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe('a')
    expect(items[1].id).toBe('b')
  })

  it('空 bookmarks 数组 → 空索引数组', () => {
    expect(_buildBookmarkSearchItems([], [])).toEqual([])
  })

  it('空字段兜底：title/url/notes/username 为 undefined → 字段均为空串', () => {
    const [item] = _buildBookmarkSearchItems([bm({ id: 'x' })], [])
    expect(item.id).toBe('x')
    expect(item.title).toBe('')
    expect(item.url).toBe('')
    expect(item.notes).toBe('')
    expect(item.username).toBe('')
  })

  it('非空字段原样映射到索引项', () => {
    const [item] = _buildBookmarkSearchItems(
      [bm({ id: 'b1', title: 'GitHub', url: 'https://github.com', notes: '代码托管', username: 'user1' })],
      [],
    )
    expect(item.title).toBe('GitHub')
    expect(item.url).toBe('https://github.com')
    expect(item.notes).toBe('代码托管')
    expect(item.username).toBe('user1')
  })

  it('中文标题经 _toPy 出全拼拼音串（titlePy 索引可被拼音搜）', () => {
    const [item] = _buildBookmarkSearchItems([bm({ id: 'b', title: '测试文档' })], [])
    // '测试文档' → ceshiwen dang（pinyin-pro type:array tone:none）
    expect(item.titlePy).toContain('ceshi')
  })

  it('空标题 titlePy 为空串', () => {
    const [item] = _buildBookmarkSearchItems([bm({ id: 'b', title: undefined })], [])
    expect(item.titlePy).toBe('')
  })

  it('中文 notes 经 notesPy 转拼音（notes 中文可被拼音搜）', () => {
    const [item] = _buildBookmarkSearchItems([bm({ id: 'b', notes: '开发文档' })], [])
    expect(item.notesPy).toContain('kaifa')
  })

  it('空 notes notesPy 为空串', () => {
    const [item] = _buildBookmarkSearchItems([bm({ id: 'b' })], [])
    expect(item.notesPy).toBe('')
  })

  it('空 customAttributes → 所有 attrNames 均为空串', () => {
    const [item] = _buildBookmarkSearchItems(
      [bm({ id: 'b', attributes: { 'a1': true } })],
      [],
    )
    expect(item.attrNames).toBe('')
  })

  it('attributes undefined → attrNames 空串', () => {
    const [item] = _buildBookmarkSearchItems([bm({ id: 'b' })], [attr('a1', '常用')])
    expect(item.attrNames).toBe('')
  })

  it('勾选 attr（true）经 attrNameMap 映射出 attrNames 空格分隔名串', () => {
    const [item] = _buildBookmarkSearchItems(
      [bm({ id: 'b', attributes: { 'a1': true, 'a2': true } })],
      [attr('a1', '常用'), attr('a2', '工作')],
    )
    // _attrsToAttrNames 用空格 join，且 Object.keys 顺序为插入顺序
    expect(item.attrNames).toBe('常用 工作')
  })

  it('falsy attr 值跳过（不收 false/未勾选）', () => {
    const [item] = _buildBookmarkSearchItems(
      [bm({ id: 'b', attributes: { 'a1': false, 'a2': true } })],
      [attr('a1', '常用'), attr('a2', '工作')],
    )
    expect(item.attrNames).toBe('工作')
  })

  it('attr id 未在 customAttributes（attrNameMap miss）→ 跳过该名不留空段', () => {
    const [item] = _buildBookmarkSearchItems(
      [bm({ id: 'b', attributes: { 'a1': true, 'ghost': true } })],
      [attr('a1', '常用')], // 无 'ghost'
    )
    // 'ghost' 无法映射为名称 → 经 filter(Boolean) 跳过
    expect(item.attrNames).toBe('常用')
  })

  it('多 bookmark 多 attr 复合投影：各项独立映射互不串染', () => {
    const items = _buildBookmarkSearchItems(
      [
        bm({ id: 'b1', title: 'GitHub', attributes: { 'a1': true } }),
        bm({ id: 'b2', title: '测试', attributes: { 'a2': true } }),
      ],
      [attr('a1', '常用'), attr('a2', '工作')],
    )
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('GitHub')
    expect(items[0].attrNames).toBe('常用')
    expect(items[1].title).toBe('测试')
    expect(items[1].attrNames).toBe('工作')
    expect(items[1].titlePy).toContain('ceshi')
  })

  it('英文标题 titlePy 不失真（英文无拼音转换需求，应保留可搜表示）', () => {
    const [item] = _buildBookmarkSearchItems([bm({ id: 'b', title: 'GitHub' })], [])
    // 英文经 pinyin-pro type:array 通常字符逐个拼音或保留——锁定「非空且长度>0」即可
    // 不锁定具体串（防 pinyin-pro 版本行为变化误判），只锁定索引项非空保证可搜
    expect(item.titlePy.length).toBeGreaterThan(0)
  })
})
