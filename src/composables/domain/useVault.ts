/**
 * useVault.ts — 保险柜（私密空间）独立加密管理
 *
 * 与 useE2E 同构但解耦：保险柜有独立主密码 + 独立 canary + 独立派生密钥，
 * 与全局 E2E 完全独立。即便全局 E2E 被攻破，保险柜仍独立安全。
 *
 * 职责：
 * - 保险柜主密码设置/验证/缓存
 * - 保险柜 Recovery Key 生成与验证
 * - 独立加密密钥派生与管理（密钥缓存移至 vaultStore）
 *
 * 私密空间 = 一套独立本地数据集（linkvault_vault_v1），与主页互不可见。
 * 本期：保险柜仅做「私密空间的解锁门禁」，不单独加密数据集字段
 * （私密数据集的 username/notes 等如有敏感字段仍走全局 E2E 加密路径）。
 * vaultCryptoKey 仍派生并存内存——它是解锁成功的证明，未来若要单独加密
 * 私密空间字段可直接复用，无需改本 composable 的密钥管理。
 */
import { computed } from 'vue'
import { useAuth } from './useAuth.js'
import { useVaultStore } from '../../stores/vault.js'
import { supabase } from '../../lib/supabase.js'
import { deriveKey, generateCanary, verifyCanary, PBKDF2_ITERATIONS, PBKDF2_DEFAULT_ITERATIONS } from '../../crypto.js'
import { safeGetItem, safeSetItem, safeRemoveItem, safeJsonParse } from '../../lib/storageSafe.js'
import { useVaultBiometric } from './useVaultBiometric.js'

const LOCAL_CANARY_KEY = 'lv_vault_canary'

// 层二 cancel token：组件层在 watch 负向分支调 vault.cancelSetup() 推进 _setupGen，
// setupVaultPassword/resetVaultWithRecoveryKey 在每个 await 后判 gen 一致跳过副作用。
let _setupGen = 0

// ── 本地 canary 读写（键独立于 lv_e2e_canary） ──
function _readLocalCanary(): Record<string, unknown> | null {
  const obj = safeJsonParse<Record<string, unknown> | null>(safeGetItem(LOCAL_CANARY_KEY), null)
  return obj && typeof obj === 'object' ? obj : null
}

function _writeLocalCanary(canaryData: Record<string, unknown>): boolean {
  // 契约消费：透传 safeSetItem 结果（配额满/禁写→false），供 _saveCanaryData 判定
  return safeSetItem(LOCAL_CANARY_KEY, JSON.stringify(canaryData))
}

function _removeLocalCanary() {
  safeRemoveItem(LOCAL_CANARY_KEY)
}

// ── Recovery Key 工具（与 useE2E 同实现） ──
function _generateRandomKey(length: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const arr = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(arr).map(b => chars[b % chars.length]).join('')
}

function _formatRecoveryKey(raw: string): string {
  return raw.match(/.{1,4}/g)?.join('-') || raw
}

function _parseRecoveryKey(formatted: string): string {
  return formatted.replace(/-/g, '').toUpperCase()
}

/**
 * 获取当前保险柜 canary data（含本地 + 云端读写切换）。
 * 登录用户的保险柜 canary 额外存 Supabase user_security.vault_canary 列用于多设备共享。
 * 与 useE2E 的 master_canary 列分离。
 */
function _getCanaryData(): Promise<Record<string, unknown> | null> {
  const local = _readLocalCanary()
  if (local) return Promise.resolve(local)
  try {
    const auth = useAuth()
    if (!auth || !auth.user) return Promise.resolve(null)
    const userId = auth.user?.id
    if (!userId) return Promise.resolve(null)
    return Promise.resolve(supabase.from('user_security')
      .select('vault_canary')
      .eq('user_id', userId)
      .maybeSingle())
      .then(res => res.data?.vault_canary as Record<string, unknown> ?? null)
      .catch(() => null)
  } catch {
    return Promise.resolve(null)
  }
}

function _saveCanaryData(canaryData: Record<string, unknown>): Promise<boolean> {
  _writeLocalCanary(canaryData)
  const auth = useAuth()
  const userId = auth.user?.id
  if (!userId) return Promise.resolve(true)
  return Promise.resolve(supabase.from('user_security').upsert({
    user_id: userId,
    vault_canary: canaryData,
  }, { onConflict: 'user_id' })).then(r => !r.error).catch(() => false)
}

export function useVault() {
  const vaultStore = useVaultStore()
  const biometric = useVaultBiometric()
  const isVaultEnabled = computed(() => vaultStore.isVaultEnabled)
  const isVaultUnlocked = computed(() => vaultStore.isVaultUnlocked)
  const isVaultBiometricEnrolled = computed(() => vaultStore.isVaultBiometricEnrolled)

  /** 获取缓存的密钥（仅在 isVaultUnlocked=true 时有效） */
  function _getKey(): CryptoKey | null {
    return vaultStore.vaultCryptoKey as CryptoKey | null
  }

  /** 设置密钥到 Store 并启动定时器 */
  function _setKey(key: CryptoKey) {
    vaultStore.setKey(key)
    vaultStore.resetLockTimer()
  }

  /** 检查用户是否已设置保险柜主密码 */
  async function checkVaultStatus(): Promise<boolean> {
    const hasLocal = !!_readLocalCanary()
    if (hasLocal) { vaultStore.setEnabled(true); vaultStore.setBiometricEnrolled(biometric.isBiometricEnrolled()); return true }
    const data = await _getCanaryData()
    vaultStore.setEnabled(!!data)
    if (data) vaultStore.setBiometricEnrolled(biometric.isBiometricEnrolled())
    return isVaultEnabled.value
  }

  /** 生成 Recovery Key（在设置保险柜主密码前调用） */
  function generateRecoveryKey(): string {
    const raw = _generateRandomKey(24)
    return _formatRecoveryKey(raw)
  }

  /** 设置保险柜主密码（首次） */
  async function setupVaultPassword(password: string, recoveryKey?: string): Promise<boolean | 'cancelled'> {
    const gen = _setupGen
    const salt = crypto.getRandomValues(new Uint8Array(32))
    const it = PBKDF2_ITERATIONS
    const key = await deriveKey(password, salt, it)
    if (gen !== _setupGen) return 'cancelled'
    const canary = await generateCanary(key)
    if (gen !== _setupGen) return 'cancelled'

    const canaryData: Record<string, unknown> = {
      canary,
      salt: Array.from(salt),
      it,
    }
    if (recoveryKey) {
      const rkSalt = crypto.getRandomValues(new Uint8Array(32))
      const rkIt = PBKDF2_ITERATIONS
      const rkKey = await deriveKey(_parseRecoveryKey(recoveryKey), rkSalt, rkIt)
      if (gen !== _setupGen) return 'cancelled'
      canaryData.recovery_canary = await generateCanary(rkKey)
      if (gen !== _setupGen) return 'cancelled'
      canaryData.recovery_salt = Array.from(rkSalt)
      canaryData.recovery_it = rkIt
    }

    const ok = await _saveCanaryData(canaryData)
    if (gen !== _setupGen) {
      // 取消时已写入的本地 canary 回滚（远端 upsert 不可逆，靠下次 setup 覆盖）
      _removeLocalCanary()
      return 'cancelled'
    }
    if (!ok) return false

    vaultStore.setEnabled(true)
    _setKey(key)
    vaultStore.setUnlocked(true)
    vaultStore.initVisibilityLock()
    return true
  }

  /** 使用 Recovery Key 重置保险柜主密码 */
  async function resetVaultWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<boolean | 'cancelled'> {
    const gen = _setupGen
    const canaryData = await _getCanaryData() as Record<string, unknown> | null
    if (!canaryData?.recovery_canary || !canaryData?.recovery_salt) return false
    if (gen !== _setupGen) return 'cancelled'

    const rkIt = typeof canaryData.recovery_it === 'number' ? canaryData.recovery_it : PBKDF2_DEFAULT_ITERATIONS
    const rkKey = await deriveKey(_parseRecoveryKey(recoveryKey), new Uint8Array(canaryData.recovery_salt as number[]), rkIt)
    const ok = await verifyCanary(canaryData.recovery_canary as string, rkKey)
    if (!ok) return false
    if (gen !== _setupGen) return 'cancelled'

    const newSalt = crypto.getRandomValues(new Uint8Array(32))
    const newIt = PBKDF2_ITERATIONS
    const newKey = await deriveKey(newPassword, newSalt, newIt)
    if (gen !== _setupGen) return 'cancelled'
    const newCanary = await generateCanary(newKey)
    if (gen !== _setupGen) return 'cancelled'

    const newRkSalt = crypto.getRandomValues(new Uint8Array(32))
    const newRkIt = PBKDF2_ITERATIONS
    const newRkKey = await deriveKey(_parseRecoveryKey(recoveryKey), newRkSalt, newRkIt)
    if (gen !== _setupGen) return 'cancelled'

    const ok2 = await _saveCanaryData({
      canary: newCanary,
      salt: Array.from(newSalt),
      it: newIt,
      recovery_canary: await generateCanary(newRkKey),
      recovery_salt: Array.from(newRkSalt),
      recovery_it: newRkIt,
    })
    if (gen !== _setupGen) {
      _removeLocalCanary()
      return 'cancelled'
    }
    if (!ok2) return false

    vaultStore.setEnabled(true)
    _setKey(newKey)
    vaultStore.setUnlocked(true)
    vaultStore.initVisibilityLock()
    await biometric.removeBiometric()
    vaultStore.setBiometricEnrolled(false)
    return true
  }

  /** 解锁保险柜（验证主密码） */
  async function unlockVault(password: string): Promise<boolean> {
    const canaryData = await _getCanaryData() as { canary: string; salt: number[]; it?: number } | null
    if (!canaryData) return false

    const it = typeof canaryData.it === 'number' ? canaryData.it : PBKDF2_DEFAULT_ITERATIONS
    const salt = new Uint8Array(canaryData.salt)
    const key = await deriveKey(password, salt, it)
    const ok = await verifyCanary(canaryData.canary, key)
    if (!ok) return false

    _setKey(key)
    vaultStore.setUnlocked(true)
    vaultStore.initVisibilityLock()
    return true
  }

  /** 锁定保险柜（清除内存中的密钥 + 停止所有定时器）。离开私密空间或超时时调用。 */
  function lockVault() {
    vaultStore.lock()
  }

  // ── 指纹解锁方法（Facade 转发 + Store 同步）──
  const isBiometricAvailableFn = biometric.isBiometricAvailable

  async function enrollBiometricFn(masterPassword: string): Promise<boolean> {
    const ok = await biometric.enrollBiometric(masterPassword)
    if (ok) vaultStore.setBiometricEnrolled(true)
    return ok
  }

  const unlockWithBiometricFn = biometric.unlockWithBiometric

  async function removeBiometricFn(): Promise<void> {
    await biometric.removeBiometric()
    vaultStore.setBiometricEnrolled(false)
  }

  return {
    isVaultEnabled, isVaultUnlocked, isVaultBiometricEnrolled,
    checkVaultStatus, generateRecoveryKey,
    setupVaultPassword, resetVaultWithRecoveryKey,
    unlockVault, lockVault,
    isBiometricAvailable: isBiometricAvailableFn,
    enrollBiometric: enrollBiometricFn,
    unlockWithBiometric: unlockWithBiometricFn,
    removeBiometric: removeBiometricFn,
    // 层二 cancel token：组件层在 watch 负向分支调此函数推进 _setupGen，short circuit
    cancelSetup: () => { _setupGen++ },
  }
}
