/**
 * useE2E.ts — 端到端加密管理
 *
 * 职责：
 * - 主密码设置/验证/缓存
 * - Recovery Key 生成与验证
 * - 加密密钥派生与管理
 * - 加密/解密字段辅助函数
 */
import { ref } from 'vue'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from './useAuth.js'
import { deriveKey, generateCanary, verifyCanary, encrypt, decrypt } from '../../crypto.js'

const isE2EEnabled = ref(false)
const isUnlocked = ref(false)
let _cryptoKey: CryptoKey | null = null
let _unlockTimer: ReturnType<typeof setTimeout> | null = null
const LOCK_TIMEOUT = 30 * 60 * 1000 // 30 分钟自动锁定

// ── 需要加密的字段 ──
const ENCRYPT_FIELDS = {
  bookmark: ['title', 'url', 'username', 'password', 'notes'] as const,
  group: ['name', 'notes'] as const,
  category: ['name'] as const,
  attribute: ['name'] as const,
}

// ── Recovery Key 工具 ──
function _generateRandomKey(length: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉容易混淆的 I/O/0/1
  const arr = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(arr).map(b => chars[b % chars.length]).join('')
}

function _formatRecoveryKey(raw: string): string {
  // 格式: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
  return raw.match(/.{1,4}/g)?.join('-') || raw
}

function _parseRecoveryKey(formatted: string): string {
  return formatted.replace(/-/g, '').toUpperCase()
}

export function useE2E() {
  const { isLoggedIn } = useAuth()

  /** 检查用户是否已设置主密码 */
  async function checkE2EStatus(): Promise<boolean> {
    if (!isLoggedIn.value) return false
    const { user } = useAuth()
    const userId = user.value?.id
    if (!userId) return false

    const { data } = await supabase.from('user_security')
      .select('master_canary')
      .eq('user_id', userId)
      .maybeSingle()

    isE2EEnabled.value = !!(data?.master_canary)
    return isE2EEnabled.value
  }

  /** 生成 Recovery Key（在设置主密码前调用） */
  function generateRecoveryKey(masterPassword: string): string {
    const raw = _generateRandomKey(24)
    return _formatRecoveryKey(raw)
  }

  /** 设置主密码（首次） */
  async function setupMasterPassword(password: string, recoveryKey?: string): Promise<boolean> {
    const { user } = useAuth()
    const userId = user.value?.id
    if (!userId) return false

    const salt = crypto.getRandomValues(new Uint8Array(32))
    const key = await deriveKey(password, salt)
    const canary = await generateCanary(key)

    let recoveryCanary: string | null = null
    let recoverySalt: number[] | null = null
    if (recoveryKey) {
      const rkSalt = crypto.getRandomValues(new Uint8Array(32))
      const rkKey = await deriveKey(_parseRecoveryKey(recoveryKey), rkSalt)
      recoveryCanary = await generateCanary(rkKey)
      recoverySalt = Array.from(rkSalt)
    }

    const { error } = await supabase.from('user_security').upsert({
      user_id: userId,
      master_canary: {
        canary,
        salt: Array.from(salt),
        recovery_canary: recoveryCanary,
        recovery_salt: recoverySalt,
      },
    }, { onConflict: 'user_id' })

    if (error) {
      console.warn('[e2e] setup failed:', error)
      return false
    }

    _cryptoKey = key
    isE2EEnabled.value = true
    isUnlocked.value = true
    _startLockTimer()
    return true
  }

  /** 使用 Recovery Key 重置主密码 */
  async function resetWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<boolean> {
    const { user } = useAuth()
    const userId = user.value?.id
    if (!userId) return false

    const { data } = await supabase.from('user_security')
      .select('master_canary')
      .eq('user_id', userId)
      .maybeSingle()

    if (!data?.master_canary) return false

    const canaryData = data.master_canary as { canary: string; salt: number[]; recovery_canary?: string; recovery_salt?: number[] }

    // 使用 recovery canary 验证（如果有）
    if (!canaryData.recovery_canary || !canaryData.recovery_salt) {
      console.warn('[e2e] no recovery canary found')
      return false
    }

    const rkKey = await deriveKey(_parseRecoveryKey(recoveryKey), new Uint8Array(canaryData.recovery_salt))
    const ok = await verifyCanary(canaryData.recovery_canary, rkKey)
    if (!ok) return false

    // Recovery key 验证通过，设置新主密码
    const newSalt = crypto.getRandomValues(new Uint8Array(32))
    const newKey = await deriveKey(newPassword, newSalt)
    const newCanary = await generateCanary(newKey)

    // 生成新的 recovery canary
    const newRkSalt = crypto.getRandomValues(new Uint8Array(32))
    const newRkKey = await deriveKey(_parseRecoveryKey(recoveryKey), newRkSalt)
    const newRecoveryCanary = await generateCanary(newRkKey)

    const { error } = await supabase.from('user_security').upsert({
      user_id: userId,
      master_canary: {
        canary: newCanary,
        salt: Array.from(newSalt),
        recovery_canary: newRecoveryCanary,
        recovery_salt: Array.from(newRkSalt),
      },
    }, { onConflict: 'user_id' })

    if (error) {
      console.warn('[e2e] reset failed:', error)
      return false
    }

    _cryptoKey = newKey
    isE2EEnabled.value = true
    isUnlocked.value = true
    _startLockTimer()
    return true
  }

  /** 解锁（验证主密码） */
  async function unlock(password: string): Promise<boolean> {
    const { user } = useAuth()
    const userId = user.value?.id
    if (!userId) return false

    const { data } = await supabase.from('user_security')
      .select('master_canary')
      .eq('user_id', userId)
      .maybeSingle()

    if (!data?.master_canary) return false

    const canaryData = data.master_canary as { canary: string; salt: number[] }
    const salt = new Uint8Array(canaryData.salt)
    const key = await deriveKey(password, salt)

    const ok = await verifyCanary(canaryData.canary, key)
    if (!ok) return false

    _cryptoKey = key
    isUnlocked.value = true
    _startLockTimer()
    return true
  }

  /** 锁定（清除内存中的密钥） */
  function lock() {
    _cryptoKey = null
    isUnlocked.value = false
    if (_unlockTimer) { clearTimeout(_unlockTimer); _unlockTimer = null }
  }

  function _startLockTimer() {
    if (_unlockTimer) clearTimeout(_unlockTimer)
    _unlockTimer = setTimeout(() => {
      lock()
    }, LOCK_TIMEOUT)
  }

  /** 加密单个字段值 */
  async function encryptField(value: string): Promise<string> {
    if (!_cryptoKey || !value) return value
    return encrypt(value, _cryptoKey)
  }

  /** 解密单个字段值 */
  async function decryptField(value: string): Promise<string> {
    if (!_cryptoKey || !value) return value
    return decrypt(value, _cryptoKey)
  }

  /** 加密对象的敏感字段 */
  async function encryptItem<T extends Record<string, unknown>>(
    type: 'bookmark' | 'group' | 'category' | 'attribute',
    item: T,
  ): Promise<T> {
    if (!_cryptoKey) return item
    const fields = ENCRYPT_FIELDS[type]
    const result = { ...item } as Record<string, unknown>
    for (const f of fields) {
      const val = result[f]
      if (typeof val === 'string' && val) {
        result[f] = await encryptField(val)
      }
    }
    return result as T
  }

  /** 解密对象的敏感字段 */
  async function decryptItem<T extends Record<string, unknown>>(
    type: 'bookmark' | 'group' | 'category' | 'attribute',
    item: T,
  ): Promise<T> {
    if (!_cryptoKey) return item
    const fields = ENCRYPT_FIELDS[type]
    const result = { ...item } as Record<string, unknown>
    for (const f of fields) {
      const val = result[f]
      if (typeof val === 'string' && val) {
        result[f] = await decryptField(val)
      }
    }
    return result as T
  }

  return {
    isE2EEnabled,
    isUnlocked,
    checkE2EStatus,
    generateRecoveryKey,
    setupMasterPassword,
    resetWithRecoveryKey,
    unlock,
    lock,
    encryptItem,
    decryptItem,
  }
}
