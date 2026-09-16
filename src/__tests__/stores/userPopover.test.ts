import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUserPopoverStore } from '../../stores/overlay.js'

describe('useUserPopoverStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('初始状态为关闭，triggerRect 为 null', () => {
    const store = useUserPopoverStore()
    expect(store.open).toBe(false)
    expect(store.triggerRect).toBeNull()
  })

  it('show 打开气泡并记录坐标', () => {
    const store = useUserPopoverStore()
    store.show({ top: 100, bottom: 140, left: 20, right: 180, width: 160, height: 40 })
    expect(store.open).toBe(true)
    expect(store.triggerRect).toEqual({
      top: 100,
      bottom: 140,
      left: 20,
      right: 180,
      width: 160,
      height: 40,
    })
  })

  it('hide 关闭气泡', () => {
    const store = useUserPopoverStore()
    store.show()
    expect(store.open).toBe(true)
    store.hide()
    expect(store.open).toBe(false)
  })

  it('toggle 正确切换开启与关闭状态', () => {
    const store = useUserPopoverStore()
    store.toggle({ top: 50, bottom: 80, left: 10, right: 60 })
    expect(store.open).toBe(true)
    expect(store.triggerRect?.left).toBe(10)

    store.toggle()
    expect(store.open).toBe(false)
  })
})
