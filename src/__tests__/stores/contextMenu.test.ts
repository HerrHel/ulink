import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useContextMenuStore } from '../../stores/contextMenu.js'

describe('contextMenuStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('初始状态为关闭', () => {
    const s = useContextMenuStore()
    expect(s.open).toBe(false)
    expect(s.type).toBe('')
    expect(s.id).toBe('')
  })

  it('show 设置位置和类型', () => {
    const s = useContextMenuStore()
    s.show({ clientX: 100, clientY: 200 } as MouseEvent, 'card', 'b1')
    expect(s.open).toBe(true)
    expect(s.x).toBe(100)
    expect(s.y).toBe(200)
    expect(s.type).toBe('card')
    expect(s.id).toBe('b1')
  })

  it('hide 重置状态', () => {
    const s = useContextMenuStore()
    s.show({ clientX: 100, clientY: 200 } as MouseEvent, 'card', 'b1')
    s.hide()
    expect(s.open).toBe(false)
    expect(s.type).toBe('')
    expect(s.id).toBe('')
  })
})
