/**
 * 分类分享卡片网格的切分口径护栏（splitCategoryItems 纯函数直测）。
 *
 * 背景：分类分享页（SSR /s/c/<sid> + 应用内 ShareView）改为「组卡在前 + 散落书签卡在后」
 * 的卡片网格后，一张书签究竟出现在哪里必须唯一确定，否则会重复成卡或漏卡：
 * - 组内书签按 group.bookmarkIds 顺序取（与 App 组内顺序一致），不存在的 id 跳过
 * - 散落书签 = 不属于任何组 且 非子书签（parentId 非空在 App 内嵌在父书签下，不单独成卡）
 * - 同一书签被多组引用时以首个组为准（used 去重）
 * 该函数与 functions/_lib/share-render.ts 的 splitCategoryItems 是同一口径的
 * camelCase / snake_case 两个版本，改任一侧时两侧都要改（SSR 侧由
 * scripts/verify_share_category_render.ts 护栏）。
 */
import { describe, it, expect } from 'vitest'
import { splitCategoryItems } from '../../views/splitCategoryItems.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

function bm(id: string, extra: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    title: `t-${id}`,
    url: `https://example.com/${id}`,
    notes: '',
    categoryId: 'cat1',
    order: 0,
    useCount: 0,
    attributes: {},
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  } as Bookmark
}

function grp(id: string, bookmarkIds: string[]): SiblingGroup {
  return {
    id,
    name: `g-${id}`,
    categoryId: 'cat1',
    order: 0,
    bookmarkIds,
    notes: '',
    isExpanded: false,
    attributes: {},
    useCount: 0,
    updatedAt: 0,
  } as SiblingGroup
}

describe('splitCategoryItems — 分类分享卡片切分', () => {
  it('组内书签按 bookmarkIds 顺序取，不存在的 id 跳过', () => {
    const { groupCards } = splitCategoryItems(
      [grp('g1', ['b2', 'ghost', 'b1'])],
      [bm('b1'), bm('b2')],
    )
    expect(groupCards[0].items.map((b) => b.id)).toEqual(['b2', 'b1'])
  })

  it('未入组的书签进散落区（保持原顺序）', () => {
    const { loose } = splitCategoryItems([grp('g1', ['b1'])], [bm('b1'), bm('b2'), bm('b3')])
    expect(loose.map((b) => b.id)).toEqual(['b2', 'b3'])
  })

  it('子书签（parentId 非空）不单独成卡', () => {
    const { loose } = splitCategoryItems(
      [],
      [bm('b1'), bm('b1-child', { parentId: 'b1' })],
    )
    expect(loose.map((b) => b.id)).toEqual(['b1'])
  })

  it('同一书签被多组引用时只出现在首个组（不重复成卡）', () => {
    const { groupCards, loose } = splitCategoryItems(
      [grp('g1', ['b1']), grp('g2', ['b1', 'b2'])],
      [bm('b1'), bm('b2')],
    )
    expect(groupCards[0].items.map((b) => b.id)).toEqual(['b1'])
    expect(groupCards[1].items.map((b) => b.id)).toEqual(['b2'])
    expect(loose).toHaveLength(0)
  })

  it('无组时全部非子书签进散落区', () => {
    const { groupCards, loose } = splitCategoryItems([], [bm('b1'), bm('b2')])
    expect(groupCards).toHaveLength(0)
    expect(loose.map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('空数据不炸：undefined / 空数组都返回空结果', () => {
    expect(splitCategoryItems([], [])).toEqual({ groupCards: [], loose: [] })
    expect(splitCategoryItems(undefined as never, undefined as never)).toEqual({
      groupCards: [],
      loose: [],
    })
  })

  it('组缺 bookmarkIds 字段时视为空组，其书签不丢失（落到散落区）', () => {
    const { groupCards, loose } = splitCategoryItems(
      [{ ...grp('g1', []), bookmarkIds: undefined } as unknown as SiblingGroup],
      [bm('b1')],
    )
    expect(groupCards[0].items).toHaveLength(0)
    expect(loose.map((b) => b.id)).toEqual(['b1'])
  })
})
