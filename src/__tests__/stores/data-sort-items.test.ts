import { describe, it, expect } from 'vitest'
import { _sortItems } from '../../stores/data.js'

// D1-14：data.ts:95 `_sortItems` 是 Pinia store 排序核。仅补测试锁定现有排序行为契约，
// 不动逻辑（data.ts 排序核硬约束 —— 不借优化之名改）。
// 行为契约来源（按实现 data.ts:95-109 逐分支锁定）：
//   1. pinnedAt 分区优先：置顶项恒排最前，置顶项之间按当前 sortMode 内部排序
//   2. useCount/title：乘 sortDir（asc=1 / desc=-1）
//   3. dateDesc/dateAsc：方向已编码进比较式，勿再乘 sortDir（注释 A1-001 易回归点）
//   4. 兜底分支（order）：乘 sortDir
//   5. dateKey 缺失/NaN 走 `|| 0` 兜底（不产生 NaN 打乱排序）
//   6. in-place 排序（mutates 输入数组），返回 undefined

// 辅助：从 items 数组提取 id 序列，便于断言排序后顺序
const idsOf = <T extends { id: string }>(arr: T[]): string[] => arr.map((x) => x.id)

// 构造测试 item（title/name 同值简测，nameKey/dateKey 由调用方按场景指定）
type Item = { id: string; title: string; name: string; createdAt: number; updatedAt: number; useCount: number; order: number; pinnedAt?: number }

describe('_sortItems 排序核护栏', () => {
  it('pinnedAt 分区恒优先：置顶项排最前，与 sortMode 无关', () => {
    const items: Item[] = [
      { id: 'a', name: 'aaa', title: 'aaa', createdAt: 100, updatedAt: 100, useCount: 0, order: 5 },
      { id: 'b', name: 'bbb', title: 'bbb', createdAt: 200, updatedAt: 200, useCount: 9, order: 1, pinnedAt: 1 },
      { id: 'c', name: 'ccc', title: 'ccc', createdAt: 300, updatedAt: 300, useCount: 0, order: 3 },
    ]
    const copy = [...items]
    _sortItems(copy, { sortMode: 'useCount', sortDir: 'desc' }, 'name', 'updatedAt')
    // b 唯一置顶 → 恒在最前，尽管 useCount 最高也是它；a/c 按其他逻辑排在 b 之后
    expect(copy[0].id).toBe('b')
    expect(idsOf(copy)).toEqual(['b', ...idsOf(items.filter((x) => x.id !== 'b'))])
  })

  it('多个置顶项之间按 sortMode 内部排序', () => {
    const items: Item[] = [
      { id: 'x', name: 'x', title: 'x', createdAt: 100, updatedAt: 100, useCount: 1, order: 0, pinnedAt: 2 },
      { id: 'y', name: 'y', title: 'y', createdAt: 50, updatedAt: 50, useCount: 9, order: 0, pinnedAt: 1 },
    ]
    // useCount desc：置顶区间内 y(useCount=9) 在 x(useCount=1) 前
    _sortItems(items, { sortMode: 'useCount', sortDir: 'desc' }, 'name', 'updatedAt')
    expect(idsOf(items)).toEqual(['y', 'x'])
  })

  it('useCount 乘 sortDir：asc 升序 / desc 降序', () => {
    const asc: Item[] = [
      { id: 'high', name: 'h', title: 'h', createdAt: 0, updatedAt: 0, useCount: 9, order: 0 },
      { id: 'low', name: 'l', title: 'l', createdAt: 0, updatedAt: 0, useCount: 1, order: 0 },
    ]
    _sortItems([...asc].sort(() => 0), { sortMode: 'useCount', sortDir: 'asc' }, 'name', 'updatedAt')
    // 直接对原构造数组排序验证方向
    const ascItems: Item[] = [
      { id: 'high', name: 'h', title: 'h', createdAt: 0, updatedAt: 0, useCount: 9, order: 0 },
      { id: 'low', name: 'l', title: 'l', createdAt: 0, updatedAt: 0, useCount: 1, order: 0 },
    ]
    _sortItems(ascItems, { sortMode: 'useCount', sortDir: 'asc' }, 'name', 'updatedAt')
    expect(idsOf(ascItems)).toEqual(['low', 'high'])

    const descItems: Item[] = [
      { id: 'low', name: 'l', title: 'l', createdAt: 0, updatedAt: 0, useCount: 1, order: 0 },
      { id: 'high', name: 'h', title: 'h', createdAt: 0, updatedAt: 0, useCount: 9, order: 0 },
    ]
    _sortItems(descItems, { sortMode: 'useCount', sortDir: 'desc' }, 'name', 'updatedAt')
    expect(idsOf(descItems)).toEqual(['high', 'low'])
  })

  it('title 按 localeCompare 乘 sortDir', () => {
    const asc: Item[] = [
      { id: 'bbb', name: 'bbb', title: 'bbb', createdAt: 0, updatedAt: 0, useCount: 0, order: 0 },
      { id: 'aaa', name: 'aaa', title: 'aaa', createdAt: 0, updatedAt: 0, useCount: 0, order: 0 },
    ]
    _sortItems(asc, { sortMode: 'title', sortDir: 'asc' }, 'name', 'updatedAt')
    // 此处 nameKey 传 'name'，数据 name=aaa/bbb；asc → aaa 在前
    expect(idsOf(asc)).toEqual(['aaa', 'bbb'])

    const desc: Item[] = [
      { id: 'aaa', name: 'aaa', title: 'aaa', createdAt: 0, updatedAt: 0, useCount: 0, order: 0 },
      { id: 'bbb', name: 'bbb', title: 'bbb', createdAt: 0, updatedAt: 0, useCount: 0, order: 0 },
    ]
    _sortItems(desc, { sortMode: 'title', sortDir: 'desc' }, 'name', 'updatedAt')
    expect(idsOf(desc)).toEqual(['bbb', 'aaa'])
  })

  it('dateDesc 方向已编码进比较式，与 sortDir 无关（A1-001 易回归点）', () => {
    // dateDesc = b.date - a.date（恒降序，新在前），sortDir 传 asc 或 desc 结果应相同
    const data = (): Item[] => [
      { id: 'old', name: 'o', title: 'o', createdAt: 100, updatedAt: 100, useCount: 0, order: 0 },
      { id: 'new', name: 'n', title: 'n', createdAt: 300, updatedAt: 300, useCount: 0, order: 0 },
      { id: 'mid', name: 'm', title: 'm', createdAt: 200, updatedAt: 200, useCount: 0, order: 0 },
    ]
    const ascItems = data()
    _sortItems(ascItems, { sortMode: 'dateDesc', sortDir: 'asc' }, 'name', 'updatedAt')
    expect(idsOf(ascItems)).toEqual(['new', 'mid', 'old'])

    const descItems = data()
    _sortItems(descItems, { sortMode: 'dateDesc', sortDir: 'desc' }, 'name', 'updatedAt')
    // dateDesc 不乘 sortDir，故仍恒降序（与 asc 同）
    expect(idsOf(descItems)).toEqual(['new', 'mid', 'old'])
  })

  it('dateAsc 方向已编码进比较式，与 sortDir 无关', () => {
    const data = (): Item[] => [
      { id: 'old', name: 'o', title: 'o', createdAt: 100, updatedAt: 100, useCount: 0, order: 0 },
      { id: 'new', name: 'n', title: 'n', createdAt: 300, updatedAt: 300, useCount: 0, order: 0 },
    ]
    const asc = data()
    _sortItems(asc, { sortMode: 'dateAsc', sortDir: 'asc' }, 'name', 'updatedAt')
    expect(idsOf(asc)).toEqual(['old', 'new'])

    const desc = data()
    _sortItems(desc, { sortMode: 'dateAsc', sortDir: 'desc' }, 'name', 'updatedAt')
    // dateAsc 不乘 sortDir，仍恒升序
    expect(idsOf(desc)).toEqual(['old', 'new'])
  })

  it('dateKey 缺失/NaN 走 || 0 兜底，不打乱排序', () => {
    const items: Item[] = [
      { id: 'undef', name: 'u', title: 'u', createdAt: 0, updatedAt: 0 as number, useCount: 0, order: 0 },
      { id: 'latest', name: 'l', title: 'l', createdAt: 999, updatedAt: 999, useCount: 0, order: 0 },
    ]
    // 把 undef.updatedAt 置为 undefined（TS 上用 as number 绕过），模拟缺失 dateKey
    ;(items[0] as { updatedAt?: number }).updatedAt = undefined
    _sortItems(items, { sortMode: 'dateDesc', sortDir: 'desc' }, 'name', 'updatedAt')
    // dateDesc：new 在前。undef.date 视 0，故 latest(999) 在 undef(0) 前
    expect(idsOf(items)).toEqual(['latest', 'undef'])
  })

  it('order 兜底分支乘 sortDir', () => {
    const asc: Item[] = [
      { id: 'b', name: 'b', title: 'b', createdAt: 0, updatedAt: 0, useCount: 0, order: 3 },
      { id: 'a', name: 'a', title: 'a', createdAt: 0, updatedAt: 0, useCount: 0, order: 1 },
    ]
    _sortItems(asc, { sortMode: 'order', sortDir: 'asc' }, 'name', 'updatedAt')
    expect(idsOf(asc)).toEqual(['a', 'b'])

    const desc: Item[] = [
      { id: 'a', name: 'a', title: 'a', createdAt: 0, updatedAt: 0, useCount: 0, order: 1 },
      { id: 'b', name: 'b', title: 'b', createdAt: 0, updatedAt: 0, useCount: 0, order: 3 },
    ]
    _sortItems(desc, { sortMode: 'order', sortDir: 'desc' }, 'name', 'updatedAt')
    expect(idsOf(desc)).toEqual(['b', 'a'])
  })

  it('in-place 排序：mutates 输入数组，返回 undefined', () => {
    const items: Item[] = [
      { id: 'b', name: 'b', title: 'b', createdAt: 0, updatedAt: 0, useCount: 0, order: 2 },
      { id: 'a', name: 'a', title: 'a', createdAt: 0, updatedAt: 0, useCount: 0, order: 1 },
    ]
    const ret = _sortItems(items, { sortMode: 'order', sortDir: 'asc' }, 'name', 'updatedAt')
    expect(ret).toBeUndefined()
    expect(items[0].id).toBe('a')
  })

  it('空数组 / 单元素数组不抛', () => {
    const empty: Item[] = []
    expect(() => _sortItems(empty, { sortMode: 'title', sortDir: 'asc' }, 'name', 'updatedAt')).not.toThrow()
    expect(empty).toEqual([])

    const single: Item[] = [{ id: 'solo', name: 's', title: 's', createdAt: 0, updatedAt: 0, useCount: 0, order: 0 }]
    _sortItems(single, { sortMode: 'useCount', sortDir: 'desc' }, 'name', 'updatedAt')
    expect(idsOf(single)).toEqual(['solo'])
  })

  it('pinnedAt=0（falsy）不算置顶，1 才算', () => {
    const items: Item[] = [
      { id: 'z', name: 'z', title: 'z', createdAt: 0, updatedAt: 0, useCount: 5, order: 0, pinnedAt: 0 as number | undefined },
      { id: 'top', name: 't', title: 't', createdAt: 0, updatedAt: 0, useCount: 0, order: 99, pinnedAt: 1 },
    ]
    _sortItems(items, { sortMode: 'useCount', sortDir: 'desc' }, 'name', 'updatedAt')
    // top.pinnedAt=1 置顶排前；z.pinnedAt=0 ≠ 置顶
    expect(items[0].id).toBe('top')
  })
})
