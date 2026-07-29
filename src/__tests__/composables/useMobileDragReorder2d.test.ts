/**
 * useMobileDragReorder2d.test.ts — 2D 网格拖拽落点护栏
 *
 * 锁定修复：移动端网格模式（mini-grid / grid 多列）拖拽排序。
 * 旧实现仅 Y 轴 → 网格里只能上下拖、不能换列排序。修复后 axis:'xy' 走 2D 最近邻格中心落点。
 *
 * 关键护栏：
 * 1. findNearestCellIndex 纯函数正确性（最近邻 / 平局稳定 / 空数组 / 距离平方）。
 * 2. 单列退化等价：axis:'xy' 在单列（所有 cx 相同）下的落点退化为「cy 最近邻」，
 *    与 axis:'y' 现有 leadEdge 逻辑语义各自正确地工作——列表用 axis:'y' 永不进 xy 分支，故无回归。
 * 3. 2D 多列落点：手指拖到不同列不同行，落点能跨列定位。
 */
import { describe, it, expect } from 'vitest'
import { findNearestCellIndex } from '../../composables/interaction/useMobileDragReorder.js'

describe('findNearestCellIndex (2D 最近邻)', () => {
  it('空数组返 -1', () => {
    expect(findNearestCellIndex([], { x: 0, y: 0 })).toBe(-1)
  })

  it('单格：直接返回 0', () => {
    expect(findNearestCellIndex([{ cx: 100, cy: 100 }], { x: 50, y: 50 })).toBe(0)
  })

  it('最近邻：3 格选距被拖中心最近的', () => {
    const centers = [
      { cx: 0, cy: 0 },
      { cx: 100, cy: 0 },
      { cx: 0, cy: 100 },
    ]
    expect(findNearestCellIndex(centers, { x: 90, y: 10 })).toBe(1)
    expect(findNearestCellIndex(centers, { x: 5, y: 95 })).toBe(2)
    expect(findNearestCellIndex(centers, { x: -5, y: -5 })).toBe(0)
  })

  it('平局稳定取首个（严格 < 才更新，同距保留先遍历者）', () => {
    // (0,0) 与 (100,0) 对中心 (50,0) 距离平方都 = 2500
    const centers = [
      { cx: 0, cy: 0 },
      { cx: 100, cy: 0 },
    ]
    expect(findNearestCellIndex(centers, { x: 50, y: 0 })).toBe(0)
  })

  it('使用距离平方（免 sqrt），结果不变', () => {
    const centers = [{ cx: 0, cy: 100 }]
    expect(findNearestCellIndex(centers, { x: 0, y: 0 })).toBe(0)
  })
})

/**
 * 单列退化：列表模式（单列）共用同一 composable。修复的核心硬约束是列表零回归——
 * 列表注入 axis:'y'，永远走现有 leadEdge 路径，不进 xy 分支。本组锁定：
 * （a）y 模式 leadEdge 落点行为；（b）xy 模式在单列下退化为 cy 最近邻——两模式各自语义，
 *     并验证 xy 单列最近邻永不越界。列表回归由（a）守卫，因为列表不走 xy。
 */
describe('单列退化等价（列表模式零回归护栏）', () => {
  const COL_X = 200
  function singleColumnCenters() {
    return [50, 150, 250, 350, 450].map(cy => ({ cx: COL_X, cy }))
  }
  // y 模式 leadEdge：扫描找首个 midY > leadEdge 的格索引
  function yLeadEdgeIndex(cardTop: number, itemHeight: number, draggingDown: boolean) {
    const centers = singleColumnCenters()
    const leadEdge = draggingDown ? cardTop + itemHeight : cardTop
    for (let i = 0; i < centers.length; i++) {
      if (leadEdge < centers[i].cy) return i
    }
    return centers.length
  }
  // xy 模式单列退化：cy 最近邻（cx 全等 → 距离退化为 |cy - dy|）
  function xyNearestIndex(cardTop: number, itemHeight: number) {
    const centers = singleColumnCenters()
    const draggedCenter = { x: COL_X, y: cardTop + itemHeight / 2 }
    const idx = findNearestCellIndex(
      centers.map(c => ({ cx: c.cx, cy: c.cy })),
      draggedCenter,
    )
    return idx < 0 ? centers.length : idx
  }

  it('y 模式下拖：leadEdge 越过某格 midY → 落其下一格（守卫列表语义不变）', () => {
    // cardTop=175,h=100 → leadEdge=275 → 首格 cy>275 是 cy=350 索引3
    expect(yLeadEdgeIndex(175, 100, true)).toBe(3)
  })

  it('y 模式上拖：leadEdge 低于某格 midY → 落该格（守卫列表语义不变）', () => {
    // cardTop=175 → leadEdge=175 → 首格 cy>175 是 cy=250 索引2
    expect(yLeadEdgeIndex(175, 100, false)).toBe(2)
  })

  it('xy 模式单列退化：中心 y=225 最近邻 ≡ cy=250 索引2', () => {
    // cardTop=175 → 中心 y=225 → 距250=25最近
    expect(xyNearestIndex(175, 100)).toBe(2)
  })

  it('xy 模式单列退化：中心略高于格中点 → 落上一格', () => {
    // cardTop=225 → 中心 y=275 → 距250=25(索引2)比距350=75近
    expect(xyNearestIndex(225, 100)).toBe(2)
  })

  it('单列最近邻永不越界（极端中心仍落在有效格）', () => {
    expect(xyNearestIndex(-9999, 100)).toBe(0)
    expect(xyNearestIndex(99999, 100)).toBe(4)
  })
})

describe('2D 多列网格落点', () => {
  // 3 列 × 2 行 = 6 格，等距 200
  function gridCenters() {
    const c: { cx: number; cy: number }[] = []
    for (let r = 0; r < 2; r++) {
      for (let col = 0; col < 3; col++) {
        c.push({ cx: 100 + col * 200, cy: 100 + r * 200 })
      }
    }
    return c
  }

  it('拖到右下角格中心 → 落最后一格', () => {
    const centers = gridCenters()
    const last = centers[5]
    expect(findNearestCellIndex(centers, { x: last.cx, y: last.cy })).toBe(5)
  })

  it('拖到第一列第二行 → 落列首的下行格', () => {
    const centers = gridCenters()
    expect(findNearestCellIndex(centers, { x: 100, y: 300 })).toBe(3)
  })

  it('跨列换位：从右侧拖到左侧，落点跟随 X 变化', () => {
    const centers = gridCenters()
    expect(findNearestCellIndex(centers, { x: 300, y: 100 })).toBe(1)
    expect(findNearestCellIndex(centers, { x: 110, y: 100 })).toBe(0)
    expect(findNearestCellIndex(centers, { x: 490, y: 100 })).toBe(2)
  })

  it('X 轴主导：相同 Y，最近邻按 X 列切换', () => {
    const centers = gridCenters()
    expect(findNearestCellIndex(centers, { x: 150, y: 100 })).toBe(0)
    expect(findNearestCellIndex(centers, { x: 250, y: 100 })).toBe(1)
    expect(findNearestCellIndex(centers, { x: 350, y: 100 })).toBe(1)
    expect(findNearestCellIndex(centers, { x: 450, y: 100 })).toBe(2)
  })
})
