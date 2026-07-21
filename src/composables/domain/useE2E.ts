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
import { useDataStore } from '../../stores/data.js'
import { supabase } from '../../lib/supabase.js'
import { deriveKey, generateCanary, verifyCanary, encrypt, decrypt, isThreePartCipher } from '../../crypto.js'
import type { EntityType } from '../../types.js'

const LOCAL_CANARY_KEY = 'lv_e2e_canary'

// ── 需要加密的字段 ──
// E2E 启用时由全局 CryptoKey 加密的字段。
// 加密范围已收窄：title/url/分类名/属性名 改存云端明文，仅用户名与笔记留密文。
// 这样锁定态（无 key）也能同步只改了 title/url 的书签——push 走明文覆盖、
// pull 走 LEGACY_DECRYPT_FIELDS 还原旧密文，几轮同步后云端自然全量明文化。
// password 不在此列：它有独立加密路径——useBookmark.saveBm 在 E2E 解锁时
// 用每条独立 salt 派生 key 生成 EncryptedPassword 对象（见 crypto.encryptPassword），
// 而非全局 key。若把 password 放进来：
//   - 对 EncryptedPassword 对象：encryptItem 因 typeof !== 'string' 跳过（碰巧无害）
//   - 对历史 string 密码：encryptItem 会用全局 key 加密成三段串存云端，回程被
//     _parseRemotePassword 还原成 EncryptedPassword 对象，但该对象的 data 是用
//     全局 key 加密的，autoMigratePassword 用「独立 salt + 主密码」解不开 → 二次损坏。
// 故 password 显式排除，保持它原样在云端传输（已是加密态或旧 base64）。
export const ENCRYPT_FIELDS = {
  bookmark: ['username', 'notes'] as const,
  group: ['name', 'notes'] as const,
  category: [] as const,
  attribute: [] as const,
}

// ── 旧密文遗留字段（legacy 解密专用，不再加密）──
// 这些字段云端现已改存明文，但历史数据里仍是 E2E 密文。pull/Realtime 进来时
// 对它们也跑一次 decryptField：真密文（三段且 key 匹配）解回明文，明文/解不开
// 的原样返回（见 crypto.decrypt 的优雅降级）。push 侧不再加密它们，几轮同步后
// 云端密文被明文覆盖，完成单向迁移。含义上与 ENCRYPT_FIELDS 互斥。
const LEGACY_DECRYPT_FIELDS: Record<EntityType, readonly string[]> = {
  bookmark: ['title', 'url'] as const,
  group: [] as const,
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
    // 补解密：unlock 前若 Realtime 推过远端密文条目（useSyncRealtime 仅在 isUnlocked=true 才解），
    // 那批条目残留密文态，UI 显示乱码。解锁后 key 就绪，补扫 store 解开密文还原视图。
    // await 而非 fire-and-forget：unlock 真正完成补解密再返，调用方拿到「已就绪」状态，
    // 避免 UI 立刻读 store 仍见密文的瞬时窗口。
    try { await decryptStoreItems() } catch (e) { console.warn('[e2e] decryptStoreItems after unlock failed:', e) }
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
    // E2E 启用但未解锁时禁止静默返回明文：若本次确有非空敏感字段需加密，则 throw，
    // 由调用方（_pushFromQueue）判定该条目静默排队等解锁。若敏感字段全空（如只改了
    // title/url 的书签、或无所谓敏感的 category），无需 key 即可明文推送——支持锁定态
    // 同步普通内容。未启用 E2E 时无 key 属正常路径，原样透传。
    if (!key) {
      if (isE2EEnabled.value) {
        const needsEnc = ENCRYPT_FIELDS[type].some(f => {
          const v = (item as Record<string, unknown>)[f]
          return typeof v === 'string' && v.length > 0
        })
        if (needsEnc) throw new Error('E2E 已启用但未解锁，无法加密后推送')
      }
      return item
    }
    const fields = ENCRYPT_FIELDS[type]
    const result = { ...item } as Record<string, unknown>
    for (const f of fields) {
      const val = result[f]
      if (typeof val === 'string' && val) result[f] = await encryptField(val)
    }
    return result as T
  }

  /** 返回浅拷贝后的解密对象，不 mutate 入参；调用方必须使用返回值。 */
  async function decryptItem<T extends Record<string, unknown>>(type: EntityType, item: T): Promise<T> {
    const key = _getKey()
    if (!key) return item
    // 加密字段 + 旧密文遗留字段并集：前者是当前仍会加密的敏感字段，后者是云端已改明文
    // 但历史行里可能仍是密文的字段。crypto.decrypt 对非三段/解不开的输入原样返回，
    // 故明文串安全穿透，只有真旧密文被解开。两组并集去重逐字段 try decrypt。
    const fields = new Set<string>([...ENCRYPT_FIELDS[type], ...LEGACY_DECRYPT_FIELDS[type]])
    const result = { ...item } as Record<string, unknown>
    for (const f of fields) {
      const val = result[f]
      if (typeof val === 'string' && val) result[f] = await decryptField(val)
    }
    return result as T
  }

  /**
   * 解锁后补解密：Realtime 在 E2E 未解锁期间推来的远端条目被 storeItem 落盘时
   * 仅在 isUnlocked=true 才解密（见 useSyncRealtime._handleRealtimeChange），未解锁
   * 那批条目的 title/url/username/notes 等停留为密文态进 store → 解锁后 UI 显示乱码。
   * 本函数在 unlock/resetWithRecoveryKey 成功（key 已入内存）后调用，遍历 store 全部条目，
   * 对 ENCRYPT_FIELDS ∪ LEGACY_DECRYPT_FIELDS 字段逐个 decryptField：
   *   - 真密文（三段 salt.iv.data）→ 解出明文，赋值改 store（reactive 触发 UI 刷新）
   *   - 非密文/明文 → crypto.decrypt 返回原文（相等），不动
   *   - 三段但 GCM auth 失败的「伪密文」明文 → decrypt 失败回退原文，不动
   * 旧密文遗留字段（title/url/category-name/attr-name）一并补解，使迁移期 UI 不显乱码。
   * 直接改数组元素字段值而非 updateBookmark/updateGroup，避免 _markDirty/_trackChange 引发
   * 回声推送（密文本就来自远端，补解密是本地视图还原，不该推回远端）。
   * 有变更时 _bumpSearchVersion 让搜索索引重建（title/name 改了 Fuse 缓存要失效）。
   */
  async function decryptStoreItems() {
    const key = _getKey()
    if (!key) return
    const ds = useDataStore()
    let changed = false
    const tryField = async (obj: Record<string, unknown>, f: string) => {
      const v = obj[f]
      if (typeof v !== 'string' || !v) return
      // L15：粗筛走 isThreePartCipher；L17：实体内字段并行、跨实体并行
      if (!isThreePartCipher(v)) return
      const decrypted = await decryptField(v)
      if (decrypted !== v) { obj[f] = decrypted; changed = true }
    }
    const fieldsOf = (t: EntityType) => new Set<string>([...ENCRYPT_FIELDS[t], ...LEGACY_DECRYPT_FIELDS[t]])
    const bmFields = fieldsOf('bookmark')
    const grpFields = fieldsOf('group')
    const catFields = fieldsOf('category')
    const attrFields = fieldsOf('attribute')
    await Promise.all([
      ...ds.bookmarks.map(b => {
        const o = b as unknown as Record<string, unknown>
        return Promise.all([...bmFields].map(f => tryField(o, f)))
      }),
      ...ds.siblingGroups.map(g => {
        const o = g as unknown as Record<string, unknown>
        return Promise.all([...grpFields].map(f => tryField(o, f)))
      }),
      ...ds.categories.map(c => {
        const o = c as unknown as Record<string, unknown>
        return Promise.all([...catFields].map(f => tryField(o, f)))
      }),
      ...ds.customAttributes.map(a => {
        const o = a as unknown as Record<string, unknown>
        return Promise.all([...attrFields].map(f => tryField(o, f)))
      }),
    ])
    if (changed) ds._bumpSearchVersion()
  }

  return {
    isE2EEnabled, isUnlocked,
    checkE2EStatus, generateRecoveryKey,
    setupMasterPassword, resetWithRecoveryKey,
    unlock, lock, encryptItem, decryptItem, encryptField, decryptField, decryptStoreItems,
  }
}
