import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  resolveListCardKey,
  handleListCardKeydown,
  listCardsInGrid,
  isNestedInteractiveTarget,
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
