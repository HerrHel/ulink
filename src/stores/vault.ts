/**
 * vault.ts — 保险柜（私密空间）独立加密状态 Store
 *
 * 与 e2e.ts 同构但解耦——保险柜有独立主密码、独立派生密钥、独立自动锁定。
 * 即便全局 E2E 被攻破，保险柜仍独立安全。
 *
 * 职责：
 * - 保险柜是否启用/解锁
 * - 独立 AES-256-GCM 密钥缓存（CryptoKey）
 * - 进私密空间解锁 + 超时锁策略：解锁后 5 分钟无操作或页面后台 60s 自动锁
 *   （区别于全局 E2E 的 15 分钟——保险柜是更高密级，超时窗口更短）
 */
import { ref, readonly } from 'vue'
import { defineStore } from 'pinia'

export const useVaultStore = defineStore('vault', () => {
  const isVaultEnabled = ref(false)
  const isVaultUnlocked = ref(false)
  /** 是否已录入保险柜指纹凭据（持久态，与解锁态解耦，lock 不清零） */
  const isVaultBiometricEnrolled = ref(false)
  /** 缓存的保险柜独立 AES-256-GCM 密钥 — 仅在 isVaultUnlocked=true 时有效 */
  const vaultCryptoKey = ref<CryptoKey | null>(null)

  const LOCK_TIMEOUT = 5 * 60 * 1000 // 5 分钟无操作自动锁定（区别于全局 15 分钟）
  const PRE_LOCK_DELAY = 60 * 1000 // 页面后台后 60s 锁定

  let _lockTimer: ReturnType<typeof setTimeout> | null = null
  let _preLockTimer: ReturnType<typeof setTimeout> | null = null
  let _visibilityHandler: (() => void) | null = null

  function setEnabled(v: boolean) { isVaultEnabled.value = v }
  function setUnlocked(v: boolean) { isVaultUnlocked.value = v }
  function setBiometricEnrolled(v: boolean) { isVaultBiometricEnrolled.value = v }
  function setKey(key: CryptoKey | null) { vaultCryptoKey.value = key }

  /** 启动无操作自动锁定计时器（每次解锁/操作后调用重置） */
  function resetLockTimer() {
    if (_lockTimer) clearTimeout(_lockTimer)
    _lockTimer = setTimeout(() => { lock() }, LOCK_TIMEOUT)
  }

  /** 启动/重启可见性监听（页面隐藏后台过久自动锁定） */
  function initVisibilityLock() {
    if (_visibilityHandler) return // 防止重复注册
    _visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        _preLockTimer = setTimeout(() => { lock() }, PRE_LOCK_DELAY)
      } else {
        if (_preLockTimer) { clearTimeout(_preLockTimer); _preLockTimer = null }
      }
    }
    document.addEventListener('visibilitychange', _visibilityHandler)
  }

  /** 移除可见性监听 */
  function destroyVisibilityLock() {
    if (_visibilityHandler) {
      document.removeEventListener('visibilitychange', _visibilityHandler)
      _visibilityHandler = null
    }
    if (_preLockTimer) { clearTimeout(_preLockTimer); _preLockTimer = null }
  }

  /** 锁定：清除密钥 + 停止所有定时器。离开私密空间或超时时调用。 */
  function lock() {
    vaultCryptoKey.value = null
    isVaultUnlocked.value = false
    if (_lockTimer) { clearTimeout(_lockTimer); _lockTimer = null }
    if (_preLockTimer) { clearTimeout(_preLockTimer); _preLockTimer = null }
  }

  /** 清空所有定时器（用于组件卸载等清理场景） */
  function cleanup() {
    destroyVisibilityLock()
    if (_lockTimer) { clearTimeout(_lockTimer); _lockTimer = null }
    if (_preLockTimer) { clearTimeout(_preLockTimer); _preLockTimer = null }
  }

  return {
    isVaultEnabled, isVaultUnlocked, isVaultBiometricEnrolled: readonly(isVaultBiometricEnrolled), vaultCryptoKey: readonly(vaultCryptoKey),
    setEnabled, setUnlocked, setBiometricEnrolled, setKey, resetLockTimer,
    initVisibilityLock, destroyVisibilityLock,
    lock, cleanup,
  }
})
