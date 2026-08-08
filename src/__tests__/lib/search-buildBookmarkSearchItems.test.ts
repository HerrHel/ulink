/**
 * search.ts `_buildBookmarkSearchItems` 索引构建护栏（精简版）
 *
 * 原文件 15 例随 r9 补入,逐边界各立一例。索引构建此前经 searchBookmarkIds 黑盒间接覆盖,
 * 本护栏补直接断言。此精简版留 6 例守核心结构契约 + 1 例拼音行为(锁非空不锁具体串,
 * 防 pinyin-pro 升级假阳性)+ 1 例 attrName 综合。
 *
 * 删去:逐字拼音断言('ceshi'/'kaifa')、attrNameMap miss/falsy 单项镜像、英文图标长度镜像等。
 *
 * 仅给私有 `_buildBookmarkSearchItems` 增 export 供测试 import,函数体逐字未动。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { Bookmark, CustomAttribute } from '../../types.js'
import { _buildBookmarkSearchItems, preloadSearchLibs } from '../../lib/search.js'

function attr(id: string, name: string): CustomAttribute {
  return { id, name, type: 'boolean' as const } as CustomAttribute
}
function bm(p: Partial<Pick<Bookmark, 'id' | 'title' | 'url' | 'notes' | 'username' | 'attributes'>>): Bookmark {
  return {
    id: p.id ?? 'b1', title: p.title, url: p.url, notes: p.notes, username: p.username,
    password: '', icon: '', categoryId: 'uncat', parentId: null, order: 0, useCount: 0,
    attributes: p.attributes, isExpanded: false, createdAt: 0, updatedAt: 0,
  } as Bookmark
}

describe('_buildBookmarkSearchItems 索引构建契约护栏', () => {
  // _toPy 依赖 pinyin-pro 懒加载（ensureSearchLibs 触发异步 import）；同步调用时 pinyinFn
  // 可能仍为 null → titlePy 返空串。本地此前靠模块状态泄漏幸过，CI 隔离调度下竞态失败。
  // beforeAll 预热等待 import resolve，保证依赖拼音的断言（titlePy.length>0）稳定。
  beforeAll(async () => {
    await preloadSearchLibs()
  })

  it('一一映射：索引项 id 与 bookmark 一一对应、顺序保留', () => {
    const items = _buildBookmarkSearchItems(
      [bm({ id: 'a', title: 'A', url: 'ua' }), bm({ id: 'b', title: 'B', url: 'ub' })],
      [],
    )
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe('a')
    expect(items[1].id).toBe('b')
  })

  it('空 bookmarks → 空索引数组', () => {
    expect(_buildBookmarkSearchItems([], [])).toEqual([])
  })

  it('空字段兜底：title/url/notes/username 为 undefined → 各字段空串', () => {
    const [item] = _buildBookmarkSearchItems([bm({ id: 'x' })], [])
    expect(item.id).toBe('x')
    expect(item.title).toBe('')
    expect(item.url).toBe('')
    expect(item.notes).toBe('')
    expect(item.username).toBe('')
  })

  it('中文标题经 _toPy 出非空 titlePy（中文标题可被拼音搜到；不锁具体串防 pinyin-pro 版本行为变化）', () => {
    const [item] = _buildBookmarkSearchItems([bm({ id: 'b', title: '测试文档' })], [])
    // 只锁非空保证可搜,不锁具体拼音字面(防库升级假阳性)
    expect(item.titlePy.length).toBeGreaterThan(0)
  })

  it('空标题 titlePy 为空串', () => {
    const [item] = _buildBookmarkSearchItems([bm({ id: 'b', title: undefined })], [])
    expect(item.titlePy).toBe('')
  })

  it('勾选 attr 经 attrNameMap 映射出 attrNames 名串；falsy/miss 跳过', () => {
    const [item] = _buildBookmarkSearchItems(
      [bm({ id: 'b', attributes: { 'a1': true, 'a2': false, 'ghost': true } })],
      [attr('a1', '常用')], // 仅 a1,无 a2/ghost: falsy 与 miss 都应跳过
    )
    // 仅 a1=true 且在 customAttributes 渲染为名,'ghost' miss 跳过不留空段
    expect(item.attrNames).toBe('常用')
  })

  it('attributes undefined → attrNames 空串', () => {
    const [item] = _buildBookmarkSearchItems([bm({ id: 'b' })], [attr('a1', '常用')])
    expect(item.attrNames).toBe('')
  })

  it('多 bookmark 多 attr 复合投影：各项独立互不串染', () => {
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
    expect(items[1].titlePy.length).toBeGreaterThan(0)
  })
})
