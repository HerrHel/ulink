import { describe, it, expect } from 'vitest'
import { _indexOfById } from '../../stores/data.js'

// D1-16：data.ts:84 `_indexOfById` 是 Pinia store 全表 CRUD 的 id→下标定位核心
// （被 categories/customAttributes/bookmarks/siblingGroups 共 20 处调用方依赖）。
// 仅补测试锁定现有行为契约，不动逻辑（data.ts 核硬约束 —— 不借优化之名改）。
// 行为契约来源（按实现 data.ts:84-93 逐分支锁定）：
//   1. map 命中 + arr.indexOf 命中（≥0）→ 返回该下标（O(1) 快路径）
//   2. map 命中但 arr.indexOf===-1（map 与数组偶发不同步）→ 回退 findIndex
//      ——「CRUD 不丢写」护栏核心：map 漂移时不能误返 -1 导致写丢
//   3. map 未命中 id 不在 map → findIndex 兜底
//   4. map 未命中且数组也找不到 → findIndex 返 -1
//   5. 空数组 + 空 map → -1
//   6. 多元素时定位到正确下标（非首个，佐证非短路返 0）
//   7. map 有 id 对应实体但该实体不在数组（跨实例同名 id 引用漂移）→ findIndex 仍能在数组找到同 id 项

type Item = { id: string; v: number }

describe('_indexOfById 定位核护栏', () => {
  it('map 命中 + indexOf 命中 → 返回该下标（O(1) 快路径）', () => {
    const a: Item = { id: 'a', v: 1 }
    const c: Item = { id: 'c', v: 3 }
    const arr: Item[] = [a, { id: 'b', v: 2 }, c]
    const map: Record<string, Item> = { a, b: arr[1], c }
    // b 在数组中下标为 1，map[b] 即数组里的同一引用 → indexOf 命中
    expect(_indexOfById(arr, map, 'b')).toBe(1)
    expect(_indexOfById(arr, map, 'a')).toBe(0)
    expect(_indexOfById(arr, map, 'c')).toBe(2)
  })

  it('map 命中但 indexOf===-1（map 与数组不同步）→ 回退 findIndex（CRUD 不丢写护栏核心）', () => {
    const arr: Item[] = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]
    // map 里 b 指向一个「不在数组里的另一实例」—— 模拟 map 漂移（旧引用被换出但 map 未同步清理）
    const staleB: Item = { id: 'b', v: 99 }
    const map: Record<string, Item> = { a: arr[0], b: staleB }
    // map[b] 命中，但 arr.indexOf(staleB)===-1 → 不能返 -1，必须回退 findIndex
    // findIndex(arr, x => x.id === 'b') === 1 —— 数组里 id='b' 的项在下标 1
    expect(_indexOfById(arr, map, 'b')).toBe(1)
  })

  it('map 未命中（id 不在 map）→ findIndex 兜底', () => {
    const arr: Item[] = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]
    const map: Record<string, Item> = { a: arr[0] } // b 不在 map
    // map[b]===undefined（falsy）→ 不走 if 分支 → 直接 findIndex
    expect(_indexOfById(arr, map, 'b')).toBe(1)
  })

  it('map 未命中且数组也找不到 → findIndex 返 -1', () => {
    const arr: Item[] = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]
    const map: Record<string, Item> = { a: arr[0] }
    // z 既不在 map 也不在数组 → findIndex 返 -1
    expect(_indexOfById(arr, map, 'z')).toBe(-1)
  })

  it('空数组 + 空 map → -1', () => {
    const arr: Item[] = []
    const map: Record<string, Item> = {}
    expect(_indexOfById(arr, map, 'x')).toBe(-1)
  })

  it('多元素时定位到正确下标（非首个，佐证非短路返 0）', () => {
    const arr: Item[] = [
      { id: 'x1', v: 1 },
      { id: 'x2', v: 2 },
      { id: 'x3', v: 3 },
      { id: 'x4', v: 4 },
      { id: 'x5', v: 5 },
    ]
    const map: Record<string, Item> = Object.fromEntries(arr.map((x) => [x.id, x]))
    // 命中末项下标 4，非 0 —— 排除「恒返 0」或「恒返首项」的退化实现
    expect(_indexOfById(arr, map, 'x5')).toBe(4)
    expect(_indexOfById(arr, map, 'x3')).toBe(2)
  })

  it('map 有 id 对应实体但该实体不在数组（跨实例同 id 漂移）→ findIndex 仍在数组找到同 id 项', () => {
    // 衔接用例 2 的反面场景：map 里的实例虽漂移，但数组里确有同 id 的另一实例
    const arrItemB: Item = { id: 'b', v: 2 }
    const arr: Item[] = [{ id: 'a', v: 1 }, arrItemB, { id: 'c', v: 3 }]
    const detachedB: Item = { id: 'b', v: 222 } // 另一实例同 id
    const map: Record<string, Item> = { a: arr[0], b: detachedB, c: arr[2] }
    // map[b]=detachedB，arr.indexOf(detachedB)===-1 → fallback findIndex
    // findIndex 在 arr 找 id==='b' → 命中 arrItemB 下标 1
    const idx = _indexOfById(arr, map, 'b')
    expect(idx).toBe(1)
    expect(arr[idx]).toBe(arrItemB) // 返回的是数组里真实存在的项，非 map 里的漂移实例
  })

  it('map 命中且 indexOf 命中时，返回的项与 map[id] 同引用', () => {
    const a: Item = { id: 'a', v: 1 }
    const b: Item = { id: 'b', v: 2 }
    const arr: Item[] = [a, b]
    const map: Record<string, Item> = { a, b }
    const idx = _indexOfById(arr, map, 'b')
    // 快路径下 arr[idx] 应就是 map[id] 引用（indexOf 语义保证），而非 findIndex 找到的"同 id 别实例"
    expect(arr[idx]).toBe(map['b'])
    expect(idx).toBe(1)
  })
})
