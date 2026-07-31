import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  resolveListCardKey,
  handleListCardKeydown,
  listCardsInGrid,
  isNestedInteractiveTarget,
  focusAdjacentListCard,
  focusEdgeListCard,
} from '../../composables/interaction/listCardKeyboard'

function key(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
}

describe('resolveListCardKey', () => {
  it('Enter → primary', () => {
    expect(resolveListCardKey(key('Enter'), { canExpand: false, expanded: false }).type).toBe('primary')
  })

  it('Space → detail（与空白单击一致）', () => {
    expect(resolveListCardKey(key(' '), { canExpand: true, expanded: false }).type).toBe('detail')
    expect(resolveListCardKey(key(' '), { canExpand: false, expanded: false }).type).toBe('detail')
  })

  it('→ 仅未展开时 expand；已展开为 none', () => {
    expect(resolveListCardKey(key('ArrowRight'), { canExpand: true, expanded: false }).type).toBe('expand')
    expect(resolveListCardKey(key('ArrowRight'), { canExpand: true, expanded: true }).type).toBe('none')
    expect(resolveListCardKey(key('ArrowRight'), { canExpand: false, expanded: false }).type).toBe('none')
  })

  it('← 仅已展开时 collapse', () => {
    expect(resolveListCardKey(key('ArrowLeft'), { canExpand: true, expanded: true }).type).toBe('collapse')
    expect(resolveListCardKey(key('ArrowLeft'), { canExpand: true, expanded: false }).type).toBe('none')
  })

  it('修饰键不触发', () => {
    expect(resolveListCardKey(key('Enter', { ctrlKey: true }), { canExpand: true, expanded: false }).type).toBe('none')
  })
})

describe('handleListCardKeydown 导航', () => {
  let grid: HTMLElement
  let a: HTMLElement
  let b: HTMLElement
  let c: HTMLElement

  beforeEach(() => {
    grid = document.createElement('div')
    grid.id = 'cardGrid'
    grid.className = 'card-grid list-view'
    a = document.createElement('div')
    b = document.createElement('div')
    c = document.createElement('div')
    for (const el of [a, b, c]) {
      el.className = 'card'
      el.setAttribute('role', 'listitem')
      el.tabIndex = 0
      // jsdom 默认 offsetParent 为 null；用 mock 让 listCardsInGrid 能收录
      Object.defineProperty(el, 'offsetParent', { get: () => grid, configurable: true })
      grid.appendChild(el)
    }
    document.body.appendChild(grid)
    a.focus = vi.fn()
    b.focus = vi.fn()
    c.focus = vi.fn()
    a.scrollIntoView = vi.fn()
    b.scrollIntoView = vi.fn()
    c.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    grid.remove()
  })

  it('listCardsInGrid 返回可见 listitem', () => {
    expect(listCardsInGrid(a)).toEqual([a, b, c])
  })

  it('ArrowDown 移到下一张', () => {
    const e = key('ArrowDown')
    const spy = vi.spyOn(e, 'preventDefault')
    const action = handleListCardKeydown(e, a, { canExpand: false, expanded: false })
    expect(action.type).toBe('none')
    expect(spy).toHaveBeenCalled()
    expect(b.focus).toHaveBeenCalled()
  })

  it('ArrowUp 移到上一张', () => {
    handleListCardKeydown(key('ArrowUp'), b, { canExpand: false, expanded: false })
    expect(a.focus).toHaveBeenCalled()
  })

  it('Home / End 到首尾', () => {
    handleListCardKeydown(key('End'), a, { canExpand: false, expanded: false })
    expect(c.focus).toHaveBeenCalled()
    handleListCardKeydown(key('Home'), c, { canExpand: false, expanded: false })
    expect(a.focus).toHaveBeenCalled()
  })

  it('内嵌 button 上的按键不处理', () => {
    const btn = document.createElement('button')
    a.appendChild(btn)
    expect(isNestedInteractiveTarget(btn, a)).toBe(true)
    const e = key('Enter')
    Object.defineProperty(e, 'target', { value: btn })
    const action = handleListCardKeydown(e, a, { canExpand: true, expanded: false })
    expect(action.type).toBe('none')
  })

  it('卡片根上 Enter → primary 并 preventDefault', () => {
    const e = key('Enter')
    Object.defineProperty(e, 'target', { value: a })
    const spy = vi.spyOn(e, 'preventDefault')
    const action = handleListCardKeydown(e, a, { canExpand: false, expanded: false })
    expect(action.type).toBe('primary')
    expect(spy).toHaveBeenCalled()
  })
})

// D1-27：focusAdjacentListCard / focusEdgeListCard 底层纯函数边界契约护栏。
// 此前仅经 handleListCardKeydown 间接覆盖（普通位置间移动），边界钳制 / same-pos 短路 /
// current 不在集 / 空集 / null 入参 这些不变量无直接断言，靠实现口头维护。
// 复用同文件 grid setup 模式（offsetParent mock + focus/scrollIntoView spy）。
function makeGridWithCards(n: number): { grid: HTMLElement; cards: HTMLElement[] } {
  const grid = document.createElement('div')
  grid.id = 'cardGrid'
  grid.className = 'card-grid list-view'
  const cards: HTMLElement[] = []
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div')
    el.className = 'card'
    el.setAttribute('role', 'listitem')
    el.tabIndex = 0
    Object.defineProperty(el, 'offsetParent', { get: () => grid, configurable: true })
    el.focus = vi.fn()
    el.scrollIntoView = vi.fn()
    cards.push(el)
    grid.appendChild(el)
  }
  document.body.appendChild(grid)
  return { grid, cards }
}

describe('focusAdjacentListCard 相邻移动', () => {
  let grid: HTMLElement
  let a: HTMLElement
  let b: HTMLElement
  let c: HTMLElement

  beforeEach(() => {
    ;({ grid, cards: [a, b, c] } = makeGridWithCards(3))
  })

  afterEach(() => {
    grid.remove()
  })

  it('delta=+1 从首张移到下一张并 focus + scrollIntoView，返回 true', () => {
    expect(focusAdjacentListCard(a, 1)).toBe(true)
    expect(b.focus).toHaveBeenCalledTimes(1)
    expect(b.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(a.focus).not.toHaveBeenCalled()
  })

  it('delta=-1 从中间移到上一张', () => {
    expect(focusAdjacentListCard(b, -1)).toBe(true)
    expect(a.focus).toHaveBeenCalled()
  })

  it('越界 delta 在末张被钳到末张（next===idx）→ false 不 focus', () => {
    expect(focusAdjacentListCard(c, 5)).toBe(false)
    expect(c.focus).not.toHaveBeenCalled()
  })

  it('越界 delta 在首张被钳到首张（next<0→0===idx）→ false 不 focus', () => {
    expect(focusAdjacentListCard(a, -5)).toBe(false)
    expect(a.focus).not.toHaveBeenCalled()
  })

  it('delta=0 → next===idx → false 不 focus（原地不触发焦点抖动）', () => {
    expect(focusAdjacentListCard(b, 0)).toBe(false)
    expect(b.focus).not.toHaveBeenCalled()
  })

  it('current 在 grid 之外（非卡片集中）→ listCardsInGrid 空集 → false 不 focus', () => {
    const alien = document.createElement('div')
    document.body.appendChild(alien) // 不在 #cardGrid 内 → listCardsInGrid 返空
    expect(focusAdjacentListCard(alien, 1)).toBe(false)
    alien.remove()
  })

  it('null current 不抛 → listCardsInGrid(null) 返空集 → false', () => {
    expect(focusAdjacentListCard(null, 1)).toBe(false)
    expect(focusAdjacentListCard(null, -1)).toBe(false)
  })

  it('空卡片集（grid 无 .card）→ false 不 focus', () => {
    const emptyGrid = document.createElement('div')
    emptyGrid.id = 'cardGrid'
    document.body.appendChild(emptyGrid)
    const lone = document.createElement('div')
    lone.className = 'card'
    lone.setAttribute('role', 'listitem')
    Object.defineProperty(lone, 'offsetParent', { get: () => null, configurable: true })
    emptyGrid.appendChild(lone) // offsetParent=null 被 listCardsInGrid filter 排除 → 空集
    expect(focusAdjacentListCard(lone, 1)).toBe(false)
    emptyGrid.remove()
  })
})

describe('focusEdgeListCard 首尾跳转', () => {
  let grid: HTMLElement
  let a: HTMLElement
  let c: HTMLElement

  beforeEach(() => {
    ;({ grid, cards: [a, , c] } = makeGridWithCards(3))
  })

  afterEach(() => {
    grid.remove()
  })

  it('end 从首张跳到末张 c 并 focus + scrollIntoView，返回 true', () => {
    expect(focusEdgeListCard(a, 'end')).toBe(true)
    expect(c.focus).toHaveBeenCalledTimes(1)
    expect(c.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('start 从末张跳到首张 a', () => {
    expect(focusEdgeListCard(c, 'start')).toBe(true)
    expect(a.focus).toHaveBeenCalled()
  })

  it('current 已在目标 edge（el===current）→ false 不 focus（避免无谓聚焦抖动）', () => {
    expect(focusEdgeListCard(a, 'start')).toBe(false)
    expect(a.focus).not.toHaveBeenCalled()
    expect(focusEdgeListCard(c, 'end')).toBe(false)
    expect(c.focus).not.toHaveBeenCalled()
  })

  it('null current → listCardsInGrid(null) 返空集 → false 不抛', () => {
    expect(focusEdgeListCard(null, 'start')).toBe(false)
    expect(focusEdgeListCard(null, 'end')).toBe(false)
  })

  it('空卡片集 → false 不 focus', () => {
    const emptyGrid = document.createElement('div')
    emptyGrid.id = 'cardGrid'
    document.body.appendChild(emptyGrid)
    const lone = document.createElement('div')
    lone.className = 'card'
    lone.setAttribute('role', 'listitem')
    Object.defineProperty(lone, 'offsetParent', { get: () => null, configurable: true })
    emptyGrid.appendChild(lone)
    expect(focusEdgeListCard(lone, 'start')).toBe(false)
    expect(focusEdgeListCard(lone, 'end')).toBe(false)
    emptyGrid.remove()
  })
})
