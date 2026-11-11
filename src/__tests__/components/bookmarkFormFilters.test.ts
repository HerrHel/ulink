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
import { selectableParents, selectableChildren, sortedParents, filterParents } from '../../components/modals/bookmarkFormFilters.js'
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

  it('传入 currentParentId 时，即使该父级自身也是子书签（parentId 非空），仍纳入候选项以供正常回显', () => {
    const out = selectableParents([
      mk({ id: 'top', parentId: null }),
      mk({ id: 'childParent', parentId: 'top' }), // 自身是子书签
      mk({ id: 'otherChild', parentId: 'top' }),
    ], undefined, 'childParent')
    expect(out.map(b => b.id).sort()).toEqual(['childParent', 'top'])
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

describe('sortedParents — 父级下拉拼音/字母 A-Z 排序', () => {
  it('混合中英文按拼音与字母顺序排列且不修改原数组', () => {
    const input = [
      mk({ id: '1', title: '抖音', url: 'https://douyin.com' }),
      mk({ id: '2', title: 'Agnes', url: 'https://agnes.example' }),
      mk({ id: '3', title: 'QQ邮箱', url: 'https://mail.qq.com' }),
      mk({ id: '4', title: 'DeepSeek', url: 'https://deepseek.com' }),
      mk({ id: '5', title: 'Steam', url: 'https://store.steampowered.com' }),
      mk({ id: '6', title: '联想异常修复', url: 'https://lenovo.com' }),
    ]
    const out = sortedParents(input)
    // Agnes -> DeepSeek -> 抖音(douyin) -> 联想异常修复(lianxiang...) -> QQ邮箱(qqyouxiang) -> Steam
    expect(out.map(b => b.id)).toEqual(['2', '4', '1', '6', '3', '5'])
    // 原数组保持不变
    expect(input.map(b => b.id)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('title 为空时回退到 url 排序', () => {
    const out = sortedParents([
      mk({ id: 'z', title: '', url: 'https://zeta.example' }),
      mk({ id: 'a', title: '', url: 'https://alpha.example' }),
    ])
    expect(out.map(b => b.id)).toEqual(['a', 'z'])
  })
})

describe('filterParents — 父级下拉多维检索', () => {
  const list = [
    mk({ id: 'dy', title: '抖音', url: 'https://www.douyin.com' }),
    mk({ id: 'gh', title: 'GitHub', url: 'https://github.com' }),
    mk({ id: 'qq', title: 'QQ邮箱', url: 'https://mail.qq.com' }),
    mk({ id: 'lx', title: '联想官网', url: 'https://www.lenovo.com.cn' }),
  ]

  it('空查询返完整列表', () => {
    expect(filterParents(list, '').map(b => b.id)).toEqual(['dy', 'gh', 'qq', 'lx'])
    expect(filterParents(list, '   ').map(b => b.id)).toEqual(['dy', 'gh', 'qq', 'lx'])
  })

  it('支持中文直接匹配与大小写无关英文匹配', () => {
    expect(filterParents(list, '抖音').map(b => b.id)).toEqual(['dy'])
    expect(filterParents(list, 'github').map(b => b.id)).toEqual(['gh'])
  })

  it('支持拼音首字母与全拼匹配', () => {
    expect(filterParents(list, 'dy').map(b => b.id)).toEqual(['dy'])
    expect(filterParents(list, 'douyin').map(b => b.id)).toEqual(['dy'])
    expect(filterParents(list, 'lxgw').map(b => b.id)).toEqual(['lx'])
  })

  it('支持 URL / 域名匹配', () => {
    expect(filterParents(list, 'mail.qq.com').map(b => b.id)).toEqual(['qq'])
    expect(filterParents(list, 'lenovo').map(b => b.id)).toEqual(['lx'])
  })
})
