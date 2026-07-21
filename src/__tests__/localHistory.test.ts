import { describe, it, expect, beforeEach } from 'vitest'
import { fetchLocalHistory, getLocalHistoryVersion } from '../stores/storage.js'
import { localStorageMock } from './setup.js'

describe('local history (storage)', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  it('无记录时 fetchLocalHistory 返回空数组', () => {
    expect(fetchLocalHistory('bm-1')).toEqual([])
  })

  it('解析合法 JSON 历史数组', () => {
    const versions = [
      { id: 100, data: { title: 'new' }, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 90, data: { title: 'old' }, created_at: '2025-12-01T00:00:00.000Z' },
    ]
    localStorage.setItem('lv_hist:bm-1', JSON.stringify(versions))
    expect(fetchLocalHistory('bm-1')).toEqual(versions)
  })

  it('损坏 JSON 时返回空数组且不抛', () => {
    localStorage.setItem('lv_hist:bm-1', '{not-json')
    expect(fetchLocalHistory('bm-1')).toEqual([])
  })

  it('getLocalHistoryVersion 按 id 取 data', () => {
    localStorage.setItem('lv_hist:g1', JSON.stringify([
      { id: 1, data: { notes: 'a' }, created_at: 't1' },
      { id: 2, data: { notes: 'b' }, created_at: 't2' },
    ]))
    expect(getLocalHistoryVersion('g1', 2)).toEqual({ notes: 'b' })
    expect(getLocalHistoryVersion('g1', 1)).toEqual({ notes: 'a' })
  })

  it('getLocalHistoryVersion 找不到返回 null', () => {
    localStorage.setItem('lv_hist:g1', JSON.stringify([
      { id: 1, data: { notes: 'a' }, created_at: 't1' },
    ]))
    expect(getLocalHistoryVersion('g1', 999)).toBeNull()
    expect(getLocalHistoryVersion('missing', 1)).toBeNull()
  })
})
