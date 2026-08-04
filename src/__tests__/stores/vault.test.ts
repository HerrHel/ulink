/**
 * vault.test.ts — 保险柜（私密空间）独立加密状态 Store 行为契约护栏
 *
 * 补 src/stores/vault.ts 5 个对外暴露函数的直接护栏缺口（Explore agentId
 * a05037488e2598c1b 扫出真缺口：此前无 src/__tests__/stores/vault.test.ts；
 * useVault.test.ts:121 仅把 vaultStore.lock() 当 setup 工具调用（非命名断言契约），
 * 平行 stores/e2e.test.ts:129-179 明确护栏了 e2e 的同款 5 函数（resetLockTimer/
 * initVisibilityLock/destroyVisibilityLock/lock/cleanup），但 vault store 无人镜像）。
 *
 * 守护契约（行为 + 安全相关，从注释 L24-25 明记「保险柜是更高密级，超时窗口更短」演化）：
 *   - lock：清 vaultCryptoKey + isVaultUnlocked=false + 清两 timer（_lockTimer/_preLockTimer）
 *   - resetLockTimer：clearTimeout 前一个 + 布置 LOCK_TIMEOUT=5min 后 lock 自动触发
 *     （区别于全局 e2e 的 15min——保险柜更高密级更短窗口）
 *   - initVisibilityLock：document.addEventListener 注册 visibilitychange 监听 + 幂等
 *     （_visibilityHandler 守卫防重复注册）
 *   - visibility hidden → PRE_LOCK_DELAY=60s 后 lock 触发；visible（恢复）→ clearTimeout _preLockTimer
 *   - destroyVisibilityLock：removeEventListener + 清 _preLockTimer + 幂等
 *   - cleanup：调 destroyVisibilityLock + 清两 timer（组件卸载场景）
 *
 * 安全核心：保险柜超时策略是安全契约——锁没清仓 vaultCryptoKey 或 timer 残留会导致
 * 保险柜超时不锁（密钥在内存泄漏窗口扩大）；镜像 e2e 既有护栏轻车熟路。
 *
 * 口径：纯加测试零源文件改动——store 5 函数全经 useVaultStore() return 暴露，无需改源。
 * fake timers 控 LOCK_TIMEOUT=5min / PRE_LOCK_DELAY=60s（vi.useFakeTimers + advanceTimersByTime）。
 * Pinia setup store 在每 test createPinia 新实例时 factory 重新执行 → 闭包变量重置。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useVaultStore } from '../../stores/vault.js'

describe('vault store — 保险柜独立加密状态 5 函数行为契约护栏', () => {
  let store: ReturnType<typeof useVaultStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useVaultStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('lock — 清仓密钥 + 解锁态 + 两 timer', () => {
    it('★lock 清 vaultCryptoKey 为 null', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.lock()
      expect(store.vaultCryptoKey).toBeNull()
      expect(store.isVaultUnlocked).toBe(false)
    })

    it('lock 后 isVaultUnlocked=false', () => {
      store.setUnlocked(true)
      store.lock()
      expect(store.isVaultUnlocked).toBe(false)
    })

    it('lock 幂等——重复调不抛', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      expect(() => { store.lock(); store.lock(); store.lock() }).not.toThrow()
      expect(store.isVaultUnlocked).toBe(false)
      expect(store.vaultCryptoKey).toBeNull()
    })

    it('lock 清两个已布置 timer（resetLockTimer + visibility hidden 布置的 preLockTimer）不随后触发', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.resetLockTimer()
      store.initVisibilityLock()
      // 触发 visibility hidden 布置 preLockTimer
      const listeners = (document.addEventListener as ReturnType<typeof vi.fn> | undefined)?.mock?.calls ?? []
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      const handler = listeners.find(([t]) => t === 'visibilitychange')?.[1] as ((e: Event) => void) | undefined
      handler?.(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      // 清 zero clock；再 lock；再 advance 极长时间；mutated refs 仍保持 lock 后态未再被 timer 触发
      store.lock()
      store.setUnlocked(true) // 模拟后续操作，但不应有残留 timer 把它锁回去
      vi.advanceTimersByTime(60 * 60 * 1000) // 1 小时
      expect(store.isVaultUnlocked).toBe(true) // 无残留 timer
    })
  })

  describe('resetLockTimer — 5 分钟无操作自动锁定', () => {
    it('★5 分钟后 lock 自动触发（vaultCryptoKey 清 null）', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.resetLockTimer()
      vi.advanceTimersByTime(4 * 60 * 1000) // 4 分钟未触发
      expect(store.isVaultUnlocked).toBe(true)
      expect(store.vaultCryptoKey).not.toBeNull()
      vi.advanceTimersByTime(1 * 60 * 1000) // 总计 5 分钟 → 触发
      expect(store.isVaultUnlocked).toBe(false)
      expect(store.vaultCryptoKey).toBeNull()
    })

    it('★边界：4:59 不锁，5:00 锁', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.resetLockTimer()
      vi.advanceTimersByTime(5 * 60 * 1000 - 1)
      expect(store.isVaultUnlocked).toBe(true)
      vi.advanceTimersByTime(1) // 1ms 越过门槛
      expect(store.isVaultUnlocked).toBe(false)
    })

    it('重复调用重置已有 timer——clearTimeout 前一个只保留新 timer', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.resetLockTimer()
      vi.advanceTimersByTime(3 * 60 * 1000) // 3 分钟（剩 2 分钟就要锁）
      store.resetLockTimer() // 重置——前一个剩余 2 分钟 timer 被清
      vi.advanceTimersByTime(3 * 60 * 1000) // 6 分钟累计 < 5min reset 后 → 未锁
      expect(store.isVaultUnlocked).toBe(true)
      vi.advanceTimersByTime(2 * 60 * 1000) // 累计 5min 后→锁
      expect(store.isVaultUnlocked).toBe(false)
    })

    it('保险柜 LOCK_TIMEOUT=5min 不同于全局 e2e 的 15min（更短窗口更高密级，注释契约直锁）', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.resetLockTimer()
      vi.advanceTimersByTime(5 * 60 * 1000 - 1) // 5min-1ms 仍 unlocked
      expect(store.isVaultUnlocked).toBe(true)
      // 任何 >5min 时间锁——区别于 e2e 15min 密级
      vi.advanceTimersByTime(1)
      expect(store.isVaultUnlocked).toBe(false)
    })
  })

  describe('initVisibilityLock — 注册监听 + 幂等', () => {
    it('★initVisibilityLock 注册 visibilitychange 监听', () => {
      const spy = vi.spyOn(document, 'addEventListener')
      store.initVisibilityLock()
      expect(spy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      spy.mockRestore()
    })

    it('★幂等——重复调 initVisibilityLock 不重复注册（_visibilityHandler 守卫）', () => {
      const spy = vi.spyOn(document, 'addEventListener')
      store.initVisibilityLock()
      store.initVisibilityLock()
      store.initVisibilityLock()
      expect(spy).toHaveBeenCalledTimes(1)
      spy.mockRestore()
    })
  })

  describe('visibility hidden → 60s 后 lock 触发（PRE_LOCK_DELAY）', () => {
    let visHandler: (e: Event) => void
    function setVis(v: 'hidden' | 'visible') {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
    }
    function triggerVisibility() {
      visHandler(new Event('visibilitychange'))
    }

    beforeEach(() => {
      const spy = vi.spyOn(document, 'addEventListener')
      store.initVisibilityLock()
      // 取出已注册的 handler
      visHandler = spy.mock.calls.find(([t]) => t === 'visibilitychange')?.[1] as (e: Event) => void
      spy.mockRestore()
    })

    it('★页面 hidden 60s 后 lock 自动触发', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      setVis('hidden')
      triggerVisibility()
      vi.advanceTimersByTime(60 * 1000 - 1) // 59s 未锁
      expect(store.isVaultUnlocked).toBe(true)
      vi.advanceTimersByTime(1) // 60s 边界 → 锁
      expect(store.isVaultUnlocked).toBe(false)
      expect(store.vaultCryptoKey).toBeNull()
    })

    it('页面 hidden 不到 60s 恢复 visible → 不锁', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      setVis('hidden')
      triggerVisibility()
      vi.advanceTimersByTime(30 * 1000) // 30s 后恢复
      setVis('visible')
      triggerVisibility()
      vi.advanceTimersByTime(60 * 1000) // 再 advance 60s 不应锁（preLockTimer 已清）
      expect(store.isVaultUnlocked).toBe(true)
      expect(store.vaultCryptoKey).not.toBeNull()
    })

    it('页面反复 hidden→visible→hidden，preLockTimer 反复清/布不泄漏（60s 后才锁）', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      setVis('hidden'); triggerVisibility()
      vi.advanceTimersByTime(20 * 1000)
      setVis('visible'); triggerVisibility() // 清 preLockTimer
      vi.advanceTimersByTime(20 * 1000)
      setVis('hidden'); triggerVisibility() // 重新布置 preLockTimer
      vi.advanceTimersByTime(59 * 1000) // 自最近 hidden 起 59s 未锁
      expect(store.isVaultUnlocked).toBe(true)
      vi.advanceTimersByTime(2 * 1000) // 越过 60s → 锁
      expect(store.isVaultUnlocked).toBe(false)
    })
  })

  describe('destroyVisibilityLock — 移除监听 + 清 timer + 幂等', () => {
    it('destroyVisibilityLock 移除 visibilitychange 监听', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener')
      store.initVisibilityLock()
      store.destroyVisibilityLock()
      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      removeSpy.mockRestore()
    })

    it('destroyVisibilityLock 清已布置的 _preLockTimer——后续 advance 不触发 lock', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.initVisibilityLock()
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      const handler = (document.addEventListener as ReturnType<typeof vi.fn> | undefined)?.mock?.calls.find(([t]) => t === 'visibilitychange')?.[1] as ((e: Event) => void) | undefined
      handler?.(new Event('visibilitychange'))
      store.destroyVisibilityLock() // 清 _preLockTimer
      vi.advanceTimersByTime(60 * 1000 * 10) // 远超 60s 不再锁
      expect(store.isVaultUnlocked).toBe(true)
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    })

    it('★幂等——未 init 时调 destroyVisibilityLock 不抛', () => {
      expect(() => store.destroyVisibilityLock()).not.toThrow()
      expect(() => store.destroyVisibilityLock()).not.toThrow()
    })

    it('destroyVisibilityLock 后 init 可再注册（_visibilityHandler 重置可复用）', () => {
      const spy = vi.spyOn(document, 'addEventListener')
      store.initVisibilityLock()
      store.destroyVisibilityLock()
      store.initVisibilityLock()
      // 第二次 init 后注册次数应再次增加
      expect(spy).toHaveBeenCalledTimes(2)
      spy.mockRestore()
    })
  })

  describe('cleanup — 清所有监听 + 两 timer', () => {
    it('cleanup 调 destroyVisibilityLock + 清两 timer——后续 advance 不再触发 lock', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener')
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.initVisibilityLock()
      store.resetLockTimer()
      store.cleanup()
      // cleanup 后即使 advance 超长时间也不应锁（已被清，无残留 timer/listener 触发 lock）
      store.setUnlocked(true)
      vi.advanceTimersByTime(60 * 60 * 1000) // 1 小时
      expect(store.isVaultUnlocked).toBe(true)
      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      removeSpy.mockRestore()
    })

    it('cleanup 幂等——重复调不抛', () => {
      expect(() => { store.cleanup(); store.cleanup() }).not.toThrow()
    })

    it('cleanup 后 resetLockTimer 可重新布置（独立 timer 互不干扰）', () => {
      store.setKey({} as CryptoKey)
      store.setUnlocked(true)
      store.resetLockTimer()
      store.cleanup()
      // 重新布置 resetLockTimer 应正常工作
      store.setUnlocked(true)
      store.resetLockTimer()
      vi.advanceTimersByTime(4 * 60 * 1000)
      expect(store.isVaultUnlocked).toBe(true)
      vi.advanceTimersByTime(1 * 60 * 1000) // 5min 后锁
      expect(store.isVaultUnlocked).toBe(false)
    })
  })

  describe('独立加密状态 + 身份隔离契约', () => {
    it('isVaultBiometricEnrolled 是持久态——lock 不清零（与解锁态解耦）', () => {
      store.setBiometricEnrolled(true)
      store.setUnlocked(true)
      store.setKey({} as CryptoKey)
      store.lock()
      // lock 清解锁态 + 密钥，但 isVaultBiometricEnrolled 持久保留
      expect(store.isVaultBiometricEnrolled).toBe(true)
    })

    it('isVaultEnabled 与 isVaultUnlocked 独立——lock 不清 isVaultEnabled', () => {
      store.setEnabled(true)
      store.setUnlocked(true)
      store.lock()
      expect(store.isVaultEnabled).toBe(true)
      expect(store.isVaultUnlocked).toBe(false)
    })

    it('setKey 设密钥后外部只经 setKey action 改密钥（readonly 包装口径镜像 e2e.test.ts:61）', () => {
      // readonly(vaultCryptoKey) 让外部直接赋值被静默吞——Pinia setup store 返回的
      // readonly ref 经 store proxy 后直接 store.vaultCryptoKey = x 不抛亦不生效
      // （与 e2e.test.ts:61「cryptoKey 应为 readonly」既有镜像口径一致：不假设抛，
      // 只锁「setKey 是唯一改密钥 action 入口」真实契约）。
      const mockKey = { type: 'secret' } as unknown as CryptoKey
      store.setKey(mockKey)
      expect(store.vaultCryptoKey).toEqual(mockKey)
      // 试图直接覆写：不抛（readonly 在 store proxy 上被静默吞），且密钥不应改变
      expect(() => { (store as any).vaultCryptoKey = null }).not.toThrow()
      expect(store.vaultCryptoKey).toEqual(mockKey) // 仍为 setKey 设的值
      // 仅 setKey(null) 能清密钥（action 入口契约）
      store.setKey(null)
      expect(store.vaultCryptoKey).toBeNull()
    })
  })
})
