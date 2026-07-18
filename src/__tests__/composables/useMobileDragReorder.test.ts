import { describe, it, expect } from 'vitest'
import { applyIntervalOrder } from '../../composables/interaction/useMobileDragReorder.js'

function makeItems(orders: number[]) {
  return orders.map((order, i) => ({ data: { id: `id${i}`, order } }))
}

describe('applyIntervalOrder (H12)', () => {
  it('向下拖到末尾：区间 order 唯一且相对序正确', () => {
    // A1 B2 C3 D4 E5，from=0 toIdx=4 → [B,C,D,E,A]
    const items = makeItems([1, 2, 3, 4, 5])
    // 模拟 splice：先从 0 删 A，再插入末尾
    const a = items[0]
    const arr = items.slice()
    arr.splice(0, 1)
    arr.splice(4, 0, a)
    const dirty: string[] = []
    applyIntervalOrder(arr, 0, 4, (id) => dirty.push(id))
    // B1 C2 D3 E4 A5
    expect(arr.map(x => x.data.order)).toEqual([1, 2, 3, 4, 5])
    expect(arr.map(x => x.data.id)).toEqual(['id1', 'id2', 'id3', 'id4', 'id0'])
    // 无重复
    expect(new Set(arr.map(x => x.data.order)).size).toBe(5)
  })

  it('向下拖到中间：不与邻项 order 重复', () => {
    // A1 B2 C3 D4，from=0 toIdx=2 → [B,C,A,D]
    const items = makeItems([1, 2, 3, 4])
    const a = items[0]
    const arr = items.slice()
    arr.splice(0, 1)
    arr.splice(2, 0, a)
    applyIntervalOrder(arr, 0, 2, () => {})
    // B1 C2 A3 D4
    expect(arr.map(x => x.data.order)).toEqual([1, 2, 3, 4])
    expect(arr.map(x => x.data.id)).toEqual(['id1', 'id2', 'id0', 'id3'])
    expect(new Set(arr.map(x => x.data.order)).size).toBe(4)
  })

  it('向上拖到开头', () => {
    // A1 B2 C3 D4，from=3 toIdx=0 → [D,A,B,C]
    const items = makeItems([1, 2, 3, 4])
    const d = items[3]
    const arr = items.slice()
    arr.splice(3, 1)
    arr.splice(0, 0, d)
    applyIntervalOrder(arr, 3, 0, () => {})
    // D1 A2 B3 C4
    expect(arr.map(x => x.data.order)).toEqual([1, 2, 3, 4])
    expect(arr.map(x => x.data.id)).toEqual(['id3', 'id0', 'id1', 'id2'])
    expect(new Set(arr.map(x => x.data.order)).size).toBe(4)
  })

  it('from===toIdx 时 no-op', () => {
    const items = makeItems([1, 2, 3])
    applyIntervalOrder(items, 1, 1, () => { throw new Error('should not mark dirty') })
    expect(items.map(x => x.data.order)).toEqual([1, 2, 3])
  })
})
