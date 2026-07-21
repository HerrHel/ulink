import { describe, it, expect, vi, afterEach } from 'vitest'
import { safeSetItem, safeGetItem, safeRemoveItem, safeJsonParse } from '../lib/storageSafe.js'

describe('storageSafe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    try { localStorage.clear() } catch { /* ignore */ }
  })

  it('正常读写删除', () => {
    expect(safeSetItem('k', 'v')).toBe(true)
    expect(safeGetItem('k')).toBe('v')
    safeRemoveItem('k')
    expect(safeGetItem('k')).toBeNull()
  })

  it('setItem 抛错时返回 false', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => { throw new Error('quota') },
      getItem: () => null,
      removeItem: () => {},
    })
    expect(safeSetItem('k', 'v')).toBe(false)
  })

  it('getItem 抛错时返回 null', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {},
      getItem: () => { throw new Error('denied') },
      removeItem: () => {},
    })
    expect(safeGetItem('k')).toBeNull()
  })

  it('safeJsonParse 正常解析', () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 })
    expect(safeJsonParse('[1,2]', [])).toEqual([1, 2])
  })

  it('safeJsonParse 非法/空返回 fallback', () => {
    expect(safeJsonParse('{bad', { x: 1 })).toEqual({ x: 1 })
    expect(safeJsonParse(null, 0)).toBe(0)
    expect(safeJsonParse(undefined, 'd')).toBe('d')
    expect(safeJsonParse('', [])).toEqual([])
  })
})
