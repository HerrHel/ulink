// 坏数据防御回归用例（2026-08-10 由 repro-badcat 复现测试转正收编）：
// 用户真实数据坏分类形态（categoryId=undefined / id=undefined / 脏字段类型等）
// 曾致 filteredGroups 栈溢出（RangeError: Maximum call stack size exceeded），
// 锁「坏数据下各 getter/过滤路径不抛异常」防御不被回归。
import { describe, it, expect } from 'vitest'
import { useDataStore } from '../../stores/data'
import { useUIStore } from '../../stores/ui'

interface AnyObj { [k: string]: any }

function seed(bms: AnyObj[], grps: AnyObj[], cats: AnyObj[], uiPatch?: AnyObj) {
  const ds = useDataStore()
  const ui = useUIStore()
  ds.bookmarks = bms as any
  ds.siblingGroups = grps as any
  ds.categories = cats as any
  if (uiPatch) Object.assign(ui, uiPatch)
  return { ds, ui }
}

describe('repro: bad category data', () => {
  it('A: 书签 categoryId=undefined + curCat=undefined', () => {
    seed(
      [{ id: 'b1', title: 'x', categoryId: undefined, order: 0 }],
      [],
      [],
      { curCat: undefined as any },
    )
    expect(() => useDataStore().filteredGroups).not.toThrow()
    expect(() => useDataStore().filteredBookmarks).not.toThrow()
  })

  it('B: 分类 id=undefined + 书签 categoryId=undefined + curCat=undefined', () => {
    seed(
      [{ id: 'b1', title: 'x', categoryId: undefined, order: 0 }],
      [],
      [{ id: undefined, name: '坏分类', order: 0 }],
      { curCat: undefined as any },
    )
    expect(() => useDataStore().filteredGroups).not.toThrow()
  })

  it('C: 书签 id=undefined（_bmMap key 污染互相覆盖）', () => {
    seed(
      [
        { id: undefined, title: 'a', order: 0 },
        { id: undefined, title: 'b', order: 1 },
      ],
      [],
      [],
    )
    const ds = useDataStore()
    expect(() => ds.filteredBookmarks).not.toThrow()
    expect(() => ds.bookmarkMap).not.toThrow()
  })

  it('D: 搜索路径 + categoryId=undefined', () => {
    seed(
      [{ id: 'b1', title: 'x', categoryId: undefined, order: 0 }],
      [],
      [],
      { searchQuery: 'x' },
    )
    expect(() => useDataStore().filteredGroups).not.toThrow()
  })

  it('E: 组 categoryId=undefined + curCat=undefined + 搜索', () => {
    seed(
      [],
      [{ id: 'g1', name: '组', categoryId: undefined, order: 0, updatedAt: 1, useCount: 0 }],
      [],
      { searchQuery: '组', curCat: undefined as any },
    )
    expect(() => useDataStore().filteredGroups).not.toThrow()
  })

  it('F: curCat=坏分类 id（存在但 name undefined）', () => {
    seed(
      [{ id: 'b1', title: 'x', categoryId: 'bad-cat', order: 0 }],
      [],
      [{ id: 'bad-cat', name: undefined, order: 0 }],
      { curCat: 'bad-cat' },
    )
    const ds = useDataStore()
    expect(() => ds.filteredGroups).not.toThrow()
    expect(() => ds.filteredBookmarks).not.toThrow()
  })

  it('G: 组 pinnedAt/name 为对象引用（脏字段类型）', () => {
    const shared = { weird: true }
    seed(
      [],
      [{ id: 'g1', name: shared as any, categoryId: 'all', order: 0, updatedAt: 1, useCount: 0, pinnedAt: shared as any }],
      [],
      { sortMode: 'title' },
    )
    expect(() => useDataStore().filteredGroups).not.toThrow()
  })

  it('H: 组合拳——书签 categoryId 是分类对象引用 + curCat 同引用', () => {
    const catRef: any = { id: 'c1' }
    seed(
      [{ id: 'b1', title: 'x', categoryId: catRef, order: 0 }],
      [],
      [catRef],
      { curCat: catRef },
    )
    expect(() => useDataStore().filteredGroups).not.toThrow()
  })
})
