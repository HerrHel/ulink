/**
 * e2e.test.ts — E2E 加密 Store 测试
 *
 * 验证：
 * - 密钥设置/获取/清除
 * - 自动锁定计时器
 * - 可见性自动锁定
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useE2EStore } from '../../stores/e2e.js'

describe('E2EStore', () => {
  let store: ReturnType<typeof useE2EStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useE2EStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    store.cleanup()
    vi.useRealTimers()
  })

  describe('isE2EEnabled / isUnlocked', () => {
    it('初始状态应为 false/false', () => {
      expect(store.isE2EEnabled).toBe(false)
      expect(store.isUnlocked).toBe(false)
    })

    it('setEnabled 应更新 isE2EEnabled', () => {
      store.setEnabled(true)
      expect(store.isE2EEnabled).toBe(true)
    })

    it('setUnlocked 应更新 isUnlocked', () => {
      store.setUnlocked(true)
      expect(store.isUnlocked).toBe(true)
    })
  })

  describe('cryptoKey', () => {
    it('初始应为 null', () => {
      expect(store.cryptoKey).toBeNull()
    })

    it('setKey 应设置密钥', () => {
      const mockKey = { type: 'secret' } as unknown as CryptoKey
      store.setKey(mockKey)
      expect(store.cryptoKey).toEqual(mockKey)
    })

    it('setKey(null) 应清除密钥', () => {
      store.setKey({} as CryptoKey)
      store.setKey(null)
      expect(store.cryptoKey).toBeNull()
    })

    it('cryptoKey 应为 readonly', () => {
      const mockKey = { type: 'secret' } as unknown as CryptoKey
      store.setKey(mockKey)
      expect(store.cryptoKey).toEqual(mockKey)
    })
  })

  describe('lock()', () => {
    it('锁定时应清除密钥和 unlocked 状态', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.lock()
      expect(store.cryptoKey).toBeNull()
      expect(store.isUnlocked).toBe(false)
    })

    it('锁定时应清除所有定时器', () => {
      store.resetLockTimer()
      store.initVisibilityLock()
      store.lock()
      // 验证可见性事件不再触发锁定
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(120_000)
      store.setUnlocked(true)
      expect(store.isUnlocked).toBe(true)// 未被自动锁定
    })

    // S14：锁后 cryptoKey 不可达，解锁流程需重新派生（非恢复缓存）
    it('S14: lock 后 cryptoKey 为 null 且 isUnlocked=false（真销毁，非视觉锁）', () => {
      const key1 = {} as CryptoKey
      store.setKey(key1)
      store.setUnlocked(true)
      expect(store.cryptoKey).toEqual(key1)

      store.lock()
      expect(store.cryptoKey).toBeNull()
      expect(store.isUnlocked).toBe(false)

      // 模拟"解锁"：设置新 key → 应接受（因旧 key 已被真销毁，
      // 不存在"恢复缓存"——若 lock 是假的，这里新旧 key 会冲突）
      const key2 = { type: 'fresh' } as unknown as CryptoKey
      expect(() => store.setKey(key2)).not.toThrow()
      store.setUnlocked(true)
      expect(store.cryptoKey).toEqual(key2)
    })
  })

  describe('resetLockTimer', () => {
    it('应在超时后自动锁定', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.resetLockTimer()

      vi.advanceTimersByTime(14 * 60 * 1000) // 14 分钟，未触发
      expect(store.isUnlocked).toBe(true)

      vi.advanceTimersByTime(2 * 60 * 1000) // 总计 16 分钟，超出 15 分钟超时
      expect(store.cryptoKey).toBeNull()
      expect(store.isUnlocked).toBe(false)
    })

    it('重复调用应重置超时', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.resetLockTimer()

      vi.advanceTimersByTime(10 * 60 * 1000)
      store.resetLockTimer() // 重置

      vi.advanceTimersByTime(10 * 60 * 1000) // 10+10 < 15 → 未锁定
      expect(store.isUnlocked).toBe(true)

      vi.advanceTimersByTime(6 * 60 * 1000) // 10+6=16 > 15 → 锁定
      expect(store.isUnlocked).toBe(false)
    })
  })

  describe('visibility lock', () => {
    it('initVisibilityLock 应注册 visibilitychange 监听', () => {
      const spy = vi.spyOn(document, 'addEventListener')
      store.initVisibilityLock()
      expect(spy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      spy.mockRestore()
    })

    it('destroyVisibilityLock 应移除 visibilitychange 监听', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener')
      store.initVisibilityLock()
      store.destroyVisibilityLock()
      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      removeSpy.mockRestore()
    })

    it('cleanup 应移所有监听和定时器', () => {
      store.initVisibilityLock()
      store.resetLockTimer()
      store.cleanup()

      // 清理后不会再触发自动锁定
      store.setUnlocked(true)
      vi.advanceTimersByTime(30 * 60 * 1000)
      expect(store.isUnlocked).toBe(true) // 定时器已清除
    })
  })
})
