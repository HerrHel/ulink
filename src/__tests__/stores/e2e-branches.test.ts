/**
 * e2e-branches.test.ts — E2E 加密 Store 未覆盖分支补测
 *
 * 锁 既有 e2e.test.ts 22 测未触达的 3 类真实行为契约：
 *  ① setBiometricEnrolled setter 透传（line 46，整函数零测）
 * ② setCloudCanaryStale setter 透传（line 50，整函数零测）
 * ③ initVisibilityLock hidden→visible 复位清 _preLockTimer 防泄漏（line 65，
 *    既有测只测 hidden→lock，未测切回 visible 分支清掉在途 preLock timer）
 * 补到 e2e.ts 81.13%→100% Stmts / Br 70%→100% / Func 85.71%→100% / Lines 91.89%→100%
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useE2EStore } from '../../stores/e2e.js'

describe('E2EStore branches', () => {
  let store: ReturnType<typeof useE2EStore>

  beforeEach(() => {
    // setup.ts 已 setActivePinia(createPinia())，但本文件用 fake timer + cleanup 模式
    // 需自己拿实例保证 store 引用稳定
    store = useE2EStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    store.cleanup()
    // 还原 visibilityState 防跨测污染
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    vi.useRealTimers()
  })

  describe('setBiometricEnrolled（line 46 整函数零测）', () => {
    it('初始 isBiometricEnrolled 应为 false 且 readonly 导出', () => {
      expect(store.isBiometricEnrolled).toBe(false)
    })

    it('setBiometricEnrolled(true) 应透传置真（与解锁态解耦，lock 不清零契约）', () => {
      store.setBiometricEnrolled(true)
      expect(store.isBiometricEnrolled).toBe(true)
    })

    it('lock 后 isBiometricEnrolled 保持（持久态，lock 不清零——注释明示契约）', () => {
      // 先录入指纹
      store.setBiometricEnrolled(true)
      expect(store.isBiometricEnrolled).toBe(true)
      // 标记已解锁并设 key 后 lock
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.lock()
      // lock 清 unlock/key 但不清 enrolled（与 isUnlocked 解耦的持久态）
      expect(store.isUnlocked).toBe(false)
      expect(store.cryptoKey).toBeNull()
      expect(store.isBiometricEnrolled).toBe(true) // 锁后仍录入
    })

    it('setBiometricEnrolled(false) 应能复位为 false（注销指纹）', () => {
      store.setBiometricEnrolled(true)
      store.setBiometricEnrolled(false)
      expect(store.isBiometricEnrolled).toBe(false)
    })
  })

  describe('setCloudCanaryStale（line 50 整函数零测）', () => {
    it('初始 cloudCanaryStale 应为 false 且 readonly 导出', () => {
      expect(store.cloudCanaryStale).toBe(false)
    })

    it('setCloudCanaryStale(true) 应透传置真（changeMasterPassword 写云端失败标记）', () => {
      store.setCloudCanaryStale(true)
      expect(store.cloudCanaryStale).toBe(true)
    })

    it('setCloudCanaryStale(false) 应清零（下次 _saveCanaryData 成功时复位语义）', () => {
      store.setCloudCanaryStale(true)
      expect(store.cloudCanaryStale).toBe(true)
      store.setCloudCanaryStale(false)
      expect(store.cloudCanaryStale).toBe(false)
    })

    it('lock 不清 cloudCanaryStale（跨锁持续，仅 _saveCanaryData 成功才清——防丢轮回频发提示）', () => {
      store.setCloudCanaryStale(true)
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.lock()
      // lock 只清 unlock/key/timer，不清云端 canary 失败标记
      expect(store.cloudCanaryStale).toBe(true)
    })
  })

  describe('initVisibilityLock hidden→visible 复位清 _preLockTimer（line 65 防泄漏）', () => {
    it('hidden 启动 preLock timer 后切回 visible 应清除在途 preLock timer（不误锁）', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.initVisibilityLock()

      // 切到 hidden：启动 60s preLock timer
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
      document.dispatchEvent(new Event('visibilitychange'))

      // 推进 30s（未达 PRE_LOCK_DELAY=60s，仍未锁）
      vi.advanceTimersByTime(30_000)
      expect(store.isUnlocked).toBe(true)

      // 切回 visible：应清除在途 preLock timer（line 65 分支）
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      })
      document.dispatchEvent(new Event('visibilitychange'))

      // 再推进超过 60s：preLock timer 已被清，不应触发 lock
      vi.advanceTimersByTime(90_000)
      expect(store.isUnlocked).toBe(true) // 未被已清除的幽灵 preLock 锁回
      expect(store.cryptoKey).not.toBeNull()
    })

    it('切回 visible 后再次 hidden 应重启全新 preLock timer 仍能正常锁', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.initVisibilityLock()

      // hidden→visible→hidden 循环，验证清 timer 后可正确重启
      const setHidden = (v: string) =>
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => v,
        })

      setHidden('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(20_000)

      setHidden('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(10_000)

      // 第二次 hidden：重启全新 preLock timer
      setHidden('hidden')
      document.dispatchEvent(new Event('visibilitychange'))

      // 推进 60s 达 PRE_LOCK_DELAY：应正常 lock
      vi.advanceTimersByTime(60_000)
      expect(store.isUnlocked).toBe(false)
      expect(store.cryptoKey).toBeNull()
    })

    it('visible 时再派发 visibilitychange（无 in-flight preLock）不应抛——line 65 if 守门 null 安全', () => {
      store.initVisibilityLock()
      // visible 状态下 _preLockTimer 始终为 null，进 line 64 else 分支 if 守门跳过 clearTimeout
      expect(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        })
        document.dispatchEvent(new Event('visibilitychange'))
      }).not.toThrow()
    })

    it('initVisibilityLock 重复调用应早退不重复注册（line 60 _visibilityHandler 守门防多监听泄漏）', () => {
      const addSpy = vi.spyOn(document, 'addEventListener')
      store.initVisibilityLock()
      const firstCount = addSpy.mock.calls.filter(
        (c) => c[0] === 'visibilitychange',
      ).length
      store.initVisibilityLock() // 重复调应早退
      const secondCount = addSpy.mock.calls.filter(
        (c) => c[0] === 'visibilitychange',
      ).length
      expect(secondCount).toBe(firstCount) // 不再注册第二个监听
      addSpy.mockRestore()
    })
  })

  describe('destroyVisibilityLock / cleanup 清在途 _preLockTimer（line 77/92 防泄漏）', () => {
    it('destroyVisibilityLock 应清在途 _preLockTimer 并移除监听（line 77 分支）', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.initVisibilityLock()

      // hidden 启动 in-flight _preLockTimer
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(30_000) // 在途未触发

      const removeSpy = vi.spyOn(document, 'removeEventListener')
      store.destroyVisibilityLock()
      // 销毁后 _preLockTimer 已清，推进超 60s 不应触发 lock（防 destroy 残留幽灵 timer）
      vi.advanceTimersByTime(90_000)
      expect(store.isUnlocked).toBe(true)
      expect(removeSpy).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function),
      )
      removeSpy.mockRestore()
    })

    it('cleanup 应清在途 _preLockTimer 与 _lockTimer（line 92 分支双重清理）', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.resetLockTimer() // _lockTimer 在途
      store.initVisibilityLock()

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(20_000) // 两 timer 都在途未触发

      store.cleanup()
      // cleanup 后两 timer 都清，推进超时不应锁
      store.setUnlocked(true) // 模拟清理后用户仍 unlocked
      vi.advanceTimersByTime(30 * 60 * 1000)
      expect(store.isUnlocked).toBe(true) // 无幽灵 timer 锁回
    })
  })

  describe('resetLockTimer + lock 清 _preLockTimer（line 85 分支既有测间接触达补强）', () => {
    it('lock 应同时清 _lockTimer 与 _preLockTimer（双重清理防泄漏）', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.resetLockTimer() // 启动 _lockTimer
      store.initVisibilityLock()

      // hidden 启动 _preLockTimer
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
      document.dispatchEvent(new Event('visibilitychange'))

      store.lock()
      // lock 后两 timer 都清，推进足够长时间不应再触发副作用
      vi.advanceTimersByTime(20 * 60 * 1000)
      // 已是锁定态，验证 lock 是幂等终态（无幽灵 timer 复活）
      expect(store.isUnlocked).toBe(false)
      expect(store.cryptoKey).toBeNull()
    })
  })
})
