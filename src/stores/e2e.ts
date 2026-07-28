/**
 * e2e.ts — E2E 加密状态 Store
 *
 * 职责：
 * - 是否启用/解锁
 * - AES-256-GCM 密钥缓存（Web Crypto API CryptoKey）
 * - 自动锁定定时器（超时 + 后台可见性）
 */
import { ref, readonly } from 'vue'
import { defineStore } from 'pinia'

export const useE2EStore = defineStore('e2e', () => {
  const isE2EEnabled = ref(false)
  const isUnlocked = ref(false)
  /** 是否已录入本机指纹凭据（持久态，与解锁态解耦，lock 不清零） */
  const isBiometricEnrolled = ref(false)
  /**
   * 按需解锁：非空数组时表示有操作正在等待解锁完成。
   * B-2 修复：旧实现是单值 ref，第二次 saveBm 撞解锁窗口时覆盖第一次的 resolve，
   * 导致第一次 Promise 永挂、saveBm 永卡。改为数组，允许多个等待者同时被通知。
   * 每个 resolve(true) → 解锁成功继续；resolve(false) → 用户取消。
   */
  const pendingUnlock = ref<((ok: boolean) => void)[]>([])
  /** 缓存的 AES-256-GCM 密钥 — 仅在 isUnlocked=true 时有效 */
  const cryptoKey = ref<CryptoKey | null>(null)

  /**
   * canaryData 云端写失败标记：changeMasterPassword 步骤 9 写 user_security 失败时置 true。
   * 语义：本地 canary 已成功（先写本地），本机用新主密码正常 unlock 无碍；但云端仍是旧
   * canary → 其他设备凭旧主密码能验通旧 canary，却用旧 key 解本设备已 push 的新 key 密文，
   * 全部失败 → 对其他设备业务数据永久不可读。置此标记由 UI 给强提示，引导用户在其他设备
   * 用 Recovery Key 走 resetWithRecoveryKey（清空重建为空库），把「永久丢失卡死」降级为
   * 「需在新主密码下重置」。下次 _saveCanaryData 成功时清零。
   */
  const cloudCanaryStale = ref(false)

  const LOCK_TIMEOUT = 15 * 60 * 1000 // 15 分钟无操作自动锁定
  const PRE_LOCK_DELAY = 60 * 1000 // 页面后台后 60s 锁定

  let _lockTimer: ReturnType<typeof setTimeout> | null = null
  let _preLockTimer: ReturnType<typeof setTimeout> | null = null
  let _visibilityHandler: (() => void) | null = null

  function setEnabled(v: boolean) { isE2EEnabled.value = v }
  function setUnlocked(v: boolean) { isUnlocked.value = v }
  function setBiometricEnrolled(v: boolean) { isBiometricEnrolled.value = v }

  function setKey(key: CryptoKey | null) { cryptoKey.value = key }

  function setCloudCanaryStale(v: boolean) { cloudCanaryStale.value = v }

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

  /** 锁定：清除密钥 + 停止所有定时器 */
  function lock() {
    cryptoKey.value = null
    isUnlocked.value = false
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
    isE2EEnabled, isUnlocked, isBiometricEnrolled: readonly(isBiometricEnrolled), cryptoKey: readonly(cryptoKey), cloudCanaryStale: readonly(cloudCanaryStale), pendingUnlock,
    setEnabled, setUnlocked, setBiometricEnrolled, setKey, setCloudCanaryStale, resetLockTimer,
    initVisibilityLock, destroyVisibilityLock,
    lock, cleanup,
  }
})
