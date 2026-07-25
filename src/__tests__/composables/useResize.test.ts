import { describe, it, expect } from 'vitest'
import { parseWidthPx } from '../../composables/interaction/useResize.js'

/**
 * parseWidthPx — 面板宽度持久化前的健壮解析。
 * 关键场景：'NaNpx' 落 localStorage 会永久损坏详情面板宽度记忆，
 * 故空/无效值必须返回 null 让调用方跳过存储。
 */
describe('useResize.parseWidthPx', () => {
  it('解析正常 px 值', () => {
    expect(parseWidthPx('320px')).toBe(320)
    expect(parseWidthPx('0px')).toBe(0)
  })

  it('空字符串返回 null（mousedown 后未移动直接 mouseup → style.width 为空）', () => {
    expect(parseWidthPx('')).toBeNull()
  })

  it('null / undefined 返回 null', () => {
    expect(parseWidthPx(null)).toBeNull()
    expect(parseWidthPx(undefined)).toBeNull()
  })

  it('无数字内容返回 null，避免 String(NaN) 落盘', () => {
    expect(parseWidthPx('NaNpx')).toBeNull()
    expect(parseWidthPx('px')).toBeNull()
    expect(parseWidthPx('auto')).toBeNull()
  })

  it('带前导空白的数值仍可解析', () => {
    expect(parseWidthPx('  280px')).toBe(280)
  })
})
