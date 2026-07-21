import { describe, it, expect, vi, afterEach } from 'vitest'
import { safeSetItem, safeGetItem, safeRemoveItem } from '../lib/storageSafe.js'

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
})
