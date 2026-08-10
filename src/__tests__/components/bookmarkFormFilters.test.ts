/**
 * 真 bug 复现：BookmarkModal parentOptions 漏 deletedAt 过滤
 *
 * 原 BookmarkModal.vue parentOptions computed 内联 `bookmarks.filter(b => !b.parentId && b.id !== bmForm.id)`
 * 漏 `!b.deletedAt` 过滤，而同文件下方 childBookmarks computed 明确做了 `&& !b.deletedAt`——
 * 同文件同约束两处不一致，软删书签仍出现在「父级（子网站）」下拉里。用户选中软删父保存后，
 * child.parentId 写在 deletedAt 非空的 parent 上，主视图看不到该父子关系（parent 不可见），
 * parent 恢复前 child 悬空。
 *
 * 修复：抽 selectableParents/selectableChildren 纯函数到 bookmarkFormFilters.ts，两 computed
 * 调用，消除「两处手写易漂」根因。此测锁定纯函数「软删排除 + 自身排除」行为。
 */
import { describe, it, expect } from 'vitest'
import { selectableParents, selectableChildren } from '../../components/modals/bookmarkFormFilters.js'
import type { Bookmark } from '../../types.js'

function mk(partial: Partial<Bookmark>): Bookmark {
  return {
    id: 'bm',
    title: '',
    url: '',
    icon: '',
    username: '',
    password: '',
    notes: '',
    categoryId: '',
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  } as Bookmark
}

describe('selectableParents — 「父级」下拉候选过滤', () => {
  it('只返无 parentId 的顶层书签', () => {
    const out = selectableParents([
      mk({ id: 'top', parentId: null }),
      mk({ id: 'child', parentId: 'top' }),
    ], undefined)
    expect(out.map(b => b.id)).toEqual(['top'])
  })

  it('★真 bug 复现：排除软删父（deletedAt 非空）——原实现漏此过滤', () => {
    // 原行为：软删顶层书签仍进入「父级」下拉，选中后 child 挂到 deletedAt 非空的 parent
    const out = selectableParents([
      mk({ id: 'alive', parentId: null }),
      mk({ id: 'trashed', parentId: null, deletedAt: 1700000000000 }),
    ], undefined)
    expect(out.map(b => b.id)).toEqual(['alive'])
  })

  it('排除当前编辑项自身（防自挂为父）', () => {
    const out = selectableParents([
      mk({ id: 'self', parentId: null }),
      mk({ id: 'other', parentId: null }),
    ], 'self')
    expect(out.map(b => b.id)).toEqual(['other'])
  })

  it('新增模式下 bmForm.id 为空串——不排除任何真书签（无 id 为空串的项）', () => {
    const out = selectableParents([
      mk({ id: 'a', parentId: null }),
      mk({ id: 'b', parentId: null }),
    ], '')
    expect(out.map(b => b.id).sort()).toEqual(['a', 'b'])
  })

  it('软删 + 自身排除同时作用', () => {
    const out = selectableParents([
      mk({ id: 'self', parentId: null }),
      mk({ id: 'selfTrashed', parentId: null, deletedAt: 1 }),
      mk({ id: 'alive', parentId: null }),
      mk({ id: 'trashed', parentId: null, deletedAt: 1 }),
    ], 'self')
    expect(out.map(b => b.id)).toEqual(['alive'])
  })
})

describe('selectableChildren — 当前编辑项的子书签候选（与父级同源防漂）', () => {
  it('返 parentId 指向当前编辑项的子书签', () => {
    const out = selectableChildren([
      mk({ id: 'c1', parentId: 'self' }),
      mk({ id: 'c2', parentId: 'other' }),
      mk({ id: 'top', parentId: null }),
    ], 'self')
    expect(out.map(b => b.id)).toEqual(['c1'])
  })

  it('排除软删子（与原 childBookmarks 约束保持一致）', () => {
    const out = selectableChildren([
      mk({ id: 'alive', parentId: 'self' }),
      mk({ id: 'trashed', parentId: 'self', deletedAt: 1 }),
    ], 'self')
    expect(out.map(b => b.id)).toEqual(['alive'])
  })

  it('parentId 为空串或 undefined 时返空（新增模式无子可显）', () => {
    expect(selectableChildren([mk({ id: 'c', parentId: 'self' })], '')).toEqual([])
    expect(selectableChildren([mk({ id: 'c', parentId: 'self' })], undefined)).toEqual([])
  })
})
