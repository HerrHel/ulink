/**
 * E1-001/E1-002：dataReady 门闩
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  isDataHydrated, whenDataReady, markDataReady,
  __testResetDataReady, __testMarkDataReady,
} from '../../lib/dataReady.js'

describe('dataReady 门闩', () => {
  beforeEach(() => {
    __testResetDataReady()
  })

  it('初始未 hydrate', () => {
    expect(isDataHydrated()).toBe(false)
  })

  it('markDataReady 后 isDataHydrated 为 true，whenDataReady 立即 resolve', async () => {
    const p = whenDataReady()
    markDataReady()
    await p
    expect(isDataHydrated()).toBe(true)
    await expect(whenDataReady()).resolves.toBeUndefined()
  })

  it('重复 mark 幂等', () => {
    __testMarkDataReady()
    __testMarkDataReady()
    expect(isDataHydrated()).toBe(true)
  })
})
