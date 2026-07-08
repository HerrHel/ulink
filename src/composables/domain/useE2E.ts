/**
 * useE2E.ts — 端到端加密管理
 *
 * A3: 下放给本地用户。canary 存 localStorage（键 lv_e2e_canary），
 * 登录用户额外存 Supabase user_security 表用于多设备共享。
 *
 * 职责：
 * - 主密码设置/验证/缓存
 * - Recovery Key 生成与验证
 * - 加密密钥派生与管理（密钥缓存移至 e2eStore）
 * - 加密/解密字段辅助函数
 */
import { computed } from 'vue'
import { useAuth } from './useAuth.js'
import { useE2EStore } from '../../stores/e2e.js'
import { supabase } from '../../lib/supabase.js'
import { deriveKey, generateCanary, verifyCanary, encrypt, decrypt } from '../../crypto.js'
import type { EntityType } from '../../types.js'

const LOCAL_CANARY_KEY = 'lv_e2e_canary'

// ── 需要加密的字段 ──
const ENCRYPT_FIELDS = {
  bookmark: ['title', 'url', 'username', 'password', 'notes'] as const,
  group: ['name', 'notes'] as const,
  category: ['name'] as const,
  attribute: ['name'] as const,
}

// ── 本地 canary 读写 ──
function _readLocalCanary(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(LOCAL_CANARY_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function _writeLocalCanary(canaryData: Record<string, unknown>) {
  try { localStorage.setItem(LOCAL_CANARY_KEY, JSON.stringify(canaryData)) } catch { /* ignore */ }
}

function _removeLocalCanary() {
  try { localStorage.removeItem(LOCAL_CANARY_KEY) } catch { /* ignore */ }
}

// ── Recovery Key 工具 ──
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

/** 获取当前构建 canary data（含本地 + 云端读写切换） */
function _getCanaryData(): Promise<Record<string, unknown> | null> {
  const local = _readLocalCanary()
  if (local) return Promise.resolve(local)
  // 本地无 canary，尝试从云端拉取（登录用户多设备场景）
  try {
    const auth = useAuth()
    if (!auth || !auth.user) return Promise.resolve(null)
    const userId = auth.user?.id
    if (!userId) return Promise.resolve(null)
    return Promise.resolve(supabase.from('user_security')
      .select('master_canary')
      .eq('user_id', userId)
      .maybeSingle())
      .then(res => res.data?.master_canary as Record<string, unknown> ?? null)
      .catch(() => null)
  } catch {
    return Promise.resolve(null)
  }
}

function _saveCanaryData(canaryData: Record<string, unknown>): Promise<boolean> {
  // 总是写本地
  _writeLocalCanary(canaryData)
  // 登录用户额外写云端（多设备共享）
  const auth = useAuth()
  const userId = auth.user?.id
  if (!userId) return Promise.resolve(true)
  return Promise.resolve(supabase.from('user_security').upsert({
    user_id: userId,
    master_canary: canaryData,
  }, { onConflict: 'user_id' })).then(r => !r.error).catch(() => false)
}

export function useE2E() {
  const e2eStore = useE2EStore()
  const isE2EEnabled = computed(() => e2eStore.isE2EEnabled)
  const isUnlocked = computed(() => e2eStore.isUnlocked)

  /** 获取缓存的密钥（仅在 isUnlocked=true 时有效） */
  function _getKey(): CryptoKey | null {
    // e2e.ts 通过 readonly() 暴露 cryptoKey，TS 上其 usages 为 readonly KeyUsage[]，
    // 与目标 CryptoKey（可变 KeyUsage[]）类型不兼容；这里只丢弃 readonly 标记，运行时无影响。
    return e2eStore.cryptoKey as CryptoKey | null
  }

  /** 设置密钥到 Store 并启动定时器 */
  function _setKey(key: CryptoKey) {
    e2eStore.setKey(key)
    e2eStore.resetLockTimer()
  }

  /** 检查用户是否已设置主密码 */
  async function checkE2EStatus(): Promise<boolean> {
    const hasLocal = !!_readLocalCanary()
    if (hasLocal) { e2eStore.setEnabled(true); return true }
    // 本地无 canary，尝试云端（登录用户）
    const data = await _getCanaryData()
    e2eStore.setEnabled(!!data)
    return isE2EEnabled.value
  }

  /** 生成 Recovery Key（在设置主密码前调用） */
  function generateRecoveryKey(): string {
    const raw = _generateRandomKey(24)
    return _formatRecoveryKey(raw)
  }

  /** 设置主密码（首次） */
  async function setupMasterPassword(password: string, recoveryKey?: string): Promise<boolean> {
    const salt = crypto.getRandomValues(new Uint8Array(32))
    const key = await deriveKey(password, salt)
    const canary = await generateCanary(key)

    const canaryData: Record<string, unknown> = {
      canary,
      salt: Array.from(salt),
    }
    if (recoveryKey) {
      const rkSalt = crypto.getRandomValues(new Uint8Array(32))
      const rkKey = await deriveKey(_parseRecoveryKey(recoveryKey), rkSalt)
      canaryData.recovery_canary = await generateCanary(rkKey)
      canaryData.recovery_salt = Array.from(rkSalt)
    }

    const ok = await _saveCanaryData(canaryData)
    if (!ok) return false

    e2eStore.setEnabled(true)
    _setKey(key)
    e2eStore.setUnlocked(true)
    e2eStore.initVisibilityLock()
    return true
  }

  /** 使用 Recovery Key 重置主密码 */
  async function resetWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<boolean> {
    const canaryData = await _getCanaryData() as Record<string, unknown> | null
    if (!canaryData?.recovery_canary || !canaryData?.recovery_salt) return false

    const rkKey = await deriveKey(_parseRecoveryKey(recoveryKey), new Uint8Array(canaryData.recovery_salt as number[]))
    const ok = await verifyCanary(canaryData.recovery_canary as string, rkKey)
    if (!ok) return false

    const newSalt = crypto.getRandomValues(new Uint8Array(32))
    const newKey = await deriveKey(newPassword, newSalt)
    const newCanary = await generateCanary(newKey)

    const newRkSalt = crypto.getRandomValues(new Uint8Array(32))
    const newRkKey = await deriveKey(_parseRecoveryKey(recoveryKey), newRkSalt)

    const ok2 = await _saveCanaryData({
      canary: newCanary,
      salt: Array.from(newSalt),
      recovery_canary: await generateCanary(newRkKey),
      recovery_salt: Array.from(newRkSalt),
    })
    if (!ok2) return false

    e2eStore.setEnabled(true)
    _setKey(newKey)
    e2eStore.setUnlocked(true)
    e2eStore.initVisibilityLock()
    return true
  }

  /** 解锁（验证主密码） */
  async function unlock(password: string): Promise<boolean> {
    const canaryData = await _getCanaryData() as { canary: string; salt: number[] } | null
    if (!canaryData) return false

    const salt = new Uint8Array(canaryData.salt)
    const key = await deriveKey(password, salt)
    const ok = await verifyCanary(canaryData.canary, key)
    if (!ok) return false

    _setKey(key)
    e2eStore.setUnlocked(true)
    e2eStore.initVisibilityLock()
    return true
  }

  /** 锁定（清除内存中的密钥 + 停止所有定时器） */
  function lock() {
    e2eStore.lock()
  }

  async function encryptField(value: string): Promise<string> {
    const key = _getKey()
    if (!key || !value) return value
    return encrypt(value, key)
  }

  async function decryptField(value: string): Promise<string> {
    const key = _getKey()
    if (!key || !value) return value
    return decrypt(value, key)
  }

  async function encryptItem<T extends Record<string, unknown>>(type: EntityType, item: T): Promise<T> {
    const key = _getKey()
    if (!key) return item
    const fields = ENCRYPT_FIELDS[type]
    const result = { ...item } as Record<string, unknown>
    for (const f of fields) {
      const val = result[f]
      if (typeof val === 'string' && val) result[f] = await encryptField(val)
    }
    return result as T
  }

  async function decryptItem<T extends Record<string, unknown>>(type: EntityType, item: T): Promise<T> {
    const key = _getKey()
    if (!key) return item
    const fields = ENCRYPT_FIELDS[type]
    const result = { ...item } as Record<string, unknown>
    for (const f of fields) {
      const val = result[f]
      if (typeof val === 'string' && val) result[f] = await decryptField(val)
    }
    return result as T
  }

  return {
    isE2EEnabled, isUnlocked,
    checkE2EStatus, generateRecoveryKey,
    setupMasterPassword, resetWithRecoveryKey,
    unlock, lock, encryptItem, decryptItem,
  }
}
