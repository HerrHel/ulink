/**
 * chunkLoadRecovery 单测：旧 HTML 指向已清理的 hashed asset → 清缓存 + 刷新一次；
 * 60s 内不重复自愈（防刷新死循环）；非本站 /assets/ 资源不触发。
 */
import { describe, it, expect, vi } from 'vitest'
import { installChunkLoadRecovery } from '../../lib/chunkLoadRecovery.js'

/** 最小事件宿主：手动派发，不依赖 jsdom 的 window 生命周期 */
function makeHost() {
  const listeners = new Map<string, EventListener>()
  return {
    host: {
      addEventListener: (type: string, cb: EventListener) => { listeners.set(type, cb) },
      removeEventListener: (type: string) => { listeners.delete(type) },
    } as any,
    emit(type: string, event: unknown) { listeners.get(type)?.(event as Event) },
    has(type: string) { return listeners.has(type) },
  }
}

function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    dump: () => Object.fromEntries(map),
  }
}

function assetError(tagName: string, url: string) {
  return { target: { tagName, src: tagName === 'SCRIPT' ? url : undefined, href: tagName === 'LINK' ? url : undefined } }
}

describe('installChunkLoadRecovery', () => {
  it('script 资源加载失败 → 清 workbox 缓存并刷新一次', async () => {
    const { host, emit } = makeHost()
    const clearCaches = vi.fn().mockResolvedValue(undefined)
    const reload = vi.fn()
    installChunkLoadRecovery({ window: host, clearCaches, reload, storage: makeStorage(), warn: () => {} })

    emit('error', assetError('SCRIPT', 'https://ulink.ren/assets/app-abc123.js'))
    await Promise.resolve()
    await Promise.resolve()

    expect(clearCaches).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('css（LINK）失效同样自愈', async () => {
    const { host, emit } = makeHost()
    const clearCaches = vi.fn().mockResolvedValue(undefined)
    const reload = vi.fn()
    installChunkLoadRecovery({ window: host, clearCaches, reload, storage: makeStorage(), warn: () => {} })

    emit('error', assetError('LINK', 'https://ulink.ren/assets/main-def456.css'))
    await Promise.resolve()
    await Promise.resolve()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('60s 内第二次失败不再刷新（防刷新死循环）', async () => {
    const { host, emit } = makeHost()
    const clearCaches = vi.fn().mockResolvedValue(undefined)
    const reload = vi.fn()
    let t = 1_000_000
    installChunkLoadRecovery({
      window: host, clearCaches, reload, storage: makeStorage(), warn: () => {}, now: () => t,
    })

    emit('error', assetError('SCRIPT', 'https://ulink.ren/assets/app-abc123.js'))
    await Promise.resolve(); await Promise.resolve()
    expect(reload).toHaveBeenCalledTimes(1)

    t += 5_000 // 5s 后再失败
    emit('error', assetError('SCRIPT', 'https://ulink.ren/assets/app-abc123.js'))
    await Promise.resolve(); await Promise.resolve()
    expect(reload).toHaveBeenCalledTimes(1) // 没重复刷
    expect(clearCaches).toHaveBeenCalledTimes(1)
  })

  it('超过 60s 后允许再次自愈', async () => {
    const { host, emit } = makeHost()
    const reload = vi.fn()
    let t = 1_000_000
    installChunkLoadRecovery({
      window: host, clearCaches: vi.fn().mockResolvedValue(undefined), reload,
      storage: makeStorage(), warn: () => {}, now: () => t,
    })
    emit('error', assetError('SCRIPT', 'https://ulink.ren/assets/app-a.js'))
    await Promise.resolve(); await Promise.resolve()
    t += 61_000
    emit('error', assetError('SCRIPT', 'https://ulink.ren/assets/app-b.js'))
    await Promise.resolve(); await Promise.resolve()
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('非本站 /assets/ 资源失败不触发（第三方脚本、图片等）', async () => {
    const { host, emit } = makeHost()
    const reload = vi.fn()
    installChunkLoadRecovery({
      window: host, clearCaches: vi.fn().mockResolvedValue(undefined), reload,
      storage: makeStorage(), warn: () => {},
    })
    emit('error', assetError('SCRIPT', 'https://cdn.third-party.com/widget.js'))
    emit('error', assetError('IMG', 'https://ulink.ren/assets/logo.png'))
    await Promise.resolve(); await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
  })

  it('vite:preloadError → 自愈并 preventDefault（避免未捕获错误冒到全局）', async () => {
    const { host, emit, has } = makeHost()
    const reload = vi.fn()
    installChunkLoadRecovery({
      window: host, clearCaches: vi.fn().mockResolvedValue(undefined), reload,
      storage: makeStorage(), warn: () => {},
    })
    expect(has('vite:preloadError')).toBe(true)
    const preventDefault = vi.fn()
    emit('vite:preloadError', { preventDefault })
    await Promise.resolve(); await Promise.resolve()
    expect(preventDefault).toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('清缓存失败也会刷新（不能因为清缓存抛错就停在白屏）', async () => {
    const { host, emit } = makeHost()
    const reload = vi.fn()
    installChunkLoadRecovery({
      window: host, clearCaches: vi.fn().mockRejectedValue(new Error('quota')), reload,
      storage: makeStorage(), warn: () => {},
    })
    emit('error', assetError('SCRIPT', 'https://ulink.ren/assets/app-x.js'))
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('无 window 宿主 → 返回 no-op disposer（SSR / 测试环境安全）', () => {
    const dispose = installChunkLoadRecovery({ window: null })
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })

  it('disposer 卸载后不再响应事件', async () => {
    const { host, emit, has } = makeHost()
    const reload = vi.fn()
    const dispose = installChunkLoadRecovery({
      window: host, clearCaches: vi.fn().mockResolvedValue(undefined), reload,
      storage: makeStorage(), warn: () => {},
    })
    dispose()
    expect(has('error')).toBe(false)
    expect(has('vite:preloadError')).toBe(false)
    emit('error', assetError('SCRIPT', 'https://ulink.ren/assets/app-y.js'))
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
  })
})
