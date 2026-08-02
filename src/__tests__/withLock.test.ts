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

  // 以下 d1-99 用例锁 `typeof navigator !== 'undefined'` 守卫「无 navigator 全局不抛 ReferenceError」核心契约——
  // withLock 被 useCloudSync/useE2E/useSyncRealtime 三条云端链路消费，环境无 navigator（Node SSR/某些 WebView/SSR validator）
  // 时若误删 typeof 守卫直接 `navigator.locks` 会抛 ReferenceError 致 sync push/pull/realtime 整链路失败。
  it('navigator 全 undefined（无 navigator 全局）→ typeof 守卫短路直接执行 fn 不抛 ReferenceError', async () => {
    // jsdom 默认 navigator 存在，须显式 unstub 成 undefined 触发守卫真实求值分支
    vi.unstubAllGlobals()
    // 显式把 navigator 置为 undefined：用 stubGlobal 覆盖为 undefined 后再验证 typeof 守卫
    vi.stubGlobal('navigator', undefined)
    const fn = vi.fn(async () => 'fallback-result')
    // 关键：直接执行 fn 返回其结果，不抛 ReferenceError（typeof navigator !== 'undefined' 为 false 短路不取 .locks）
    const result = await withLock('lv-sync', fn)
    expect(result).toBe('fallback-result')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('navigator = null（typeof null === "object" 非 "undefined"）→ 守卫不拦第二判据 null.locks 真实抛 TypeError（守卫仅防 undefined 不防 null 边界直锁）', async () => {
    vi.stubGlobal('navigator', null)
    const fn = vi.fn(async () => 99)
    // 真实隐特性：typeof null === 'object' 非 'undefined' 故 typeof 守卫为 true 进入第二判据，
    // 但 navigator.locks 即 null.locks 抛 TypeError "Cannot read properties of null"，
    // 故typeof 守卫的真实防护范围仅 navigator=undefined，不含 null——护栏直锁此边界防未来误加 null 容错断言
    await expect(withLock('t', fn)).rejects.toThrow(TypeError)
    expect(fn).not.toHaveBeenCalled()
  })

  it('navigator 存在但 locks = null（部分实现无 lock 接口）→ navigator.locks falsy 短路直接执行 fn 不调 request', async () => {
    vi.stubGlobal('navigator', { locks: null })
    const request = vi.fn()
    const fn = vi.fn(async () => 5)
    await expect(withLock('t', fn)).resolves.toBe(5)
    expect(fn).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })
})
