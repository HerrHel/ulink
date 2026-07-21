import { describe, it, expect, vi, afterEach } from 'vitest'
import { withLock } from '../lib/withLock.js'

describe('withLock', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('无 Web Locks 时直接执行 fn', async () => {
    vi.stubGlobal('navigator', {})
    const fn = vi.fn(async () => 42)
    await expect(withLock('t', fn)).resolves.toBe(42)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('有 Web Locks 时走 locks.request exclusive', async () => {
    const request = vi.fn((_name: string, _opts: unknown, cb: () => Promise<number>) => cb())
    vi.stubGlobal('navigator', { locks: { request } })
    const fn = vi.fn(async () => 7)
    await expect(withLock('linkvault-sync', fn)).resolves.toBe(7)
    expect(request).toHaveBeenCalledWith('linkvault-sync', { mode: 'exclusive' }, fn)
  })
})
