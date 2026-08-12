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
import { deriveKey, generateCanary, verifyCanary, encrypt, decryptForDisplay, isThreePartCipher, safeDecodePassword, PBKDF2_ITERATIONS, PBKDF2_DEFAULT_ITERATIONS } from '../../crypto.js'
import { safeGetItem, safeSetItem, safeRemoveItem, safeJsonParse } from '../../lib/storageSafe.js'
import { useBiometric } from './useBiometric.js'
import { useSyncStore } from '../../stores/sync.js'
import { clearAllSyncOps } from '../../stores/storage.js'
import { _cancelPendingHist } from '../../stores/data.js'
import { enqueueDirtyAsOps, pushFromQueue } from './syncPush.js'
import { subscribeRealtime, unsubscribeRealtime } from './useSyncRealtime.js'
import { pullChanges } from './syncPull.js'
import { _clearAllPendingSync } from './syncPending.js'
import { _getUserId } from './useSyncHistory.js'
import { withLock } from '../../lib/withLock.js'
import { flushSaveAppData } from '../../stores/app.js'
import type { EntityType } from '../../types.js'

const LOCAL_CANARY_KEY = 'lv_e2e_canary'

// ── 需要加密的字段 ──
// E2E 启用时由全局 CryptoKey 加密的字段。
// 加密范围已收窄：title/url/分类名/属性名 改存云端明文，仅用户名与笔记留密文。
// 这样锁定态（无 key）也能同步只改了 title/url 的书签——push 走明文覆盖、
// pull 走 LEGACY_DECRYPT_FIELDS 还原旧密文，几轮同步后云端自然全量明文化。
// password 不在此列：它有独立加密路径——useBookmark.saveBm 在 E2E 解锁时用
// e2eStore.cryptoKey（unlock 一次性派生的 global cryptoKey）调 crypto.encrypt 输出
// salt.iv.data 三段串，再拆回 EncryptedPassword 对象存本地。其中 salt 是 encrypt 内部
// 随机生成的占位盐——展示链路 crypto.decryptPasswordWithKey 解密只用 iv + data +
// 同一把 global cryptoKey，不依赖 salt、也不重新派生（与加密侧同 key）。若把 password
// 放进 ENCRYPT_FIELDS（即用全局 key 经 encryptItem 重新加密成三段串再存云端）：
//   - 对 EncryptedPassword 对象：encryptItem 因 typeof !== 'string' 跳过（碰巧无害）
//   - 对历史 string 密码：encryptItem 会用全局 key 加密成三段串存云端，回程被
//     _parseRemotePassword 还原成 EncryptedPassword 对象，但该对象的 data 是用
//     全局 key 加密的，autoMigratePassword 对象分支用「独立 salt + 主密码」派生出
//     不同的 key 解 → GCM 认证失败 → 二次损坏（autoMigratePassword 与
//     decryptPasswordWithKey 走两把不同 key，前者为迁移旧数据、后者为运行时展示）。
// 故 password 显式排除，保持它原样在云端传输（saveBm 加密态或旧 base64）。
//
// 扩展端经 AUDIT-R19+R44 方向 E：原扩展 crypto.autoDecryptPassword 对 EncryptedPassword
// 对象误用占位 salt + 主密码派生 key（即 autoMigratePassword 那条独立路径），与主项目
// global cryptoKey 不一致 → 扩展端 sidepanel 显示密码解不开（pre-existing bug，非主项目
// 数据损坏）。修复后扩展端从 user_security.master_canary 读 canaryData（含 salt + it）
// 重建同一把 global cryptoKey，经 decryptWithGlobalKey 复用 decryptPasswordWithKey 语义
// 解 EncryptedPassword 对象/三段串，与主项目展示链路一致。主项目本文件零代码改。
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
  const obj = safeJsonParse<Record<string, unknown> | null>(safeGetItem(LOCAL_CANARY_KEY), null)
  return obj && typeof obj === 'object' ? obj : null
}

function _writeLocalCanary(canaryData: Record<string, unknown>) {
  safeSetItem(LOCAL_CANARY_KEY, JSON.stringify(canaryData))
}

function _removeLocalCanary() {
  safeRemoveItem(LOCAL_CANARY_KEY)
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

// ── 多设备主密码一致性检测（云端 canary 单槽冲突防护） ──
// 云端 user_security.master_canary 是单行单槽：多设备各设各的主密码时，后写覆盖先写，
// 且各 key 互解不开对方密文（加密字段跨设备不可读），另一设备一旦本地 canary 丢失即锁死。
// 登录后检测到不一致时由 UI 引导解决：
//  - adoptCloudCanary：切到云端 canary 统一主密码（本机旧 key 加密数据不可逆失效，UI 需提示）
//  - 保留本机：接受加密字段不互通，且禁止在本机改主密码/重置（防覆盖云端 canary 锁死其他设备）

/** 直接读云端 canary（不经本地优先，仅登录用户有值） */
function _getCloudCanary(): Promise<Record<string, unknown> | null> {
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

/** 两 canary 是否同源：canary 验证串与派生盐一致 → 同一主密码设置 */
function _sameCanary(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return a.canary === b.canary && JSON.stringify(a.salt) === JSON.stringify(b.salt)
}

export interface E2ECanaryMismatch {
  mismatch: boolean
  hasLocal: boolean
  hasCloud: boolean
  /** 云端 canary 带 prev_*（其他设备主动改过主密码）→ 应走跟随迁移而非多设备冲突 */
  upgraded: boolean
}

export function useE2E() {
  const e2eStore = useE2EStore()
  const biometric = useBiometric()
  const isE2EEnabled = computed(() => e2eStore.isE2EEnabled)
  const isUnlocked = computed(() => e2eStore.isUnlocked)
  const isBiometricEnrolled = computed(() => e2eStore.isBiometricEnrolled)
  /** canaryData 云端写失败（多设备数据风险）标记，详见 e2eStore.cloudCanaryStale 注释 */
  const cloudCanaryStale = computed(() => e2eStore.cloudCanaryStale)
  // 层二 cancel token：组件层在 watch 负向分支调 cancelSetup() 推进 _setupGen，
  // setupMasterPassword 在每个 await 后判 gen 一致跳过副作用
  let _setupGen = 0
  const cancelSetup = () => { _setupGen++ }

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

  /**
   * 确保本机主密码设置对云端可见（「一个主密码解锁所有设备」的最后一环）。
   * 场景：本机设置主密码时未登录（canary 只写本地），之后才登录——登录动作本身不推 canary，
   * 云端 master_canary 一直是 null，其他设备登录后拉不到 canary，会被引导重新设置主密码 →
   * 各设各的 key → 加密字段互不可读。本函数在登录后把本地 canary 推上云（云端无 canary 时），
   * 使其他设备登录后能用同一主密码解锁。云端已有 canary → 不自动覆盖（一致性交给
   * detectCloudCanaryMismatch 冲突弹窗处理，防止覆盖锁死其他设备）。
   */
  async function ensureCloudCanarySynced(): Promise<void> {
    const local = _readLocalCanary()
    if (!local) return
    const cloud = await _getCloudCanary()
    if (cloud) return
    const auth = useAuth()
    if (!auth.user) return
    await _saveCanaryData(local)
  }

  /** 登录后检测本机与云端主密码设置是否一致（多设备冲突 / 主密码升级，canary 单槽覆盖风险） */
  async function detectCloudCanaryMismatch(): Promise<E2ECanaryMismatch> {
    const local = _readLocalCanary()
    const cloud = await _getCloudCanary()
    if (!local || !cloud) return { mismatch: false, hasLocal: !!local, hasCloud: !!cloud, upgraded: false }
    const mismatch = !_sameCanary(local, cloud)
    // upgraded：云端带 prev_*（其他设备 changeMasterPassword 过）→ 走「跟随迁移」而非多设备冲突
    return { mismatch, hasLocal: true, hasCloud: true, upgraded: mismatch && !!cloud.prev_canary }
  }

  /**
   * 切到云端 canary（与其他设备统一主密码）：覆盖本地 canary + 复位为锁定态，
   * 随后由 UI 引导输入其他设备的原主密码解锁（key 由云端 canary 的 salt 派生）。
   * 代价：本机此前用本机主密码加密的数据（key 已换）将不可逆失效，UI 必须在调用前提示。
   */
  async function adoptCloudCanary(): Promise<boolean> {
    const cloud = await _getCloudCanary()
    if (!cloud) return false
    _writeLocalCanary(cloud)
    e2eStore.setEnabled(true)
    e2eStore.setUnlocked(false)
    e2eStore.setKey(null)
    e2eStore.setCloudCanaryStale(false)
    return true
  }

  /** 检查用户是否已设置主密码 */
  async function checkE2EStatus(): Promise<boolean> {
    const hasLocal = !!_readLocalCanary()
    if (hasLocal) { e2eStore.setEnabled(true); e2eStore.setBiometricEnrolled(biometric.isBiometricEnrolled()); return true }
    const data = await _getCanaryData()
    e2eStore.setEnabled(!!data)
    if (data) e2eStore.setBiometricEnrolled(biometric.isBiometricEnrolled())
    return isE2EEnabled.value
  }

  /** 生成 Recovery Key（在设置主密码前调用） */
  function generateRecoveryKey(): string {
    const raw = _generateRandomKey(24)
    return _formatRecoveryKey(raw)
  }

  /** 设置主密码（首次） */
  async function setupMasterPassword(password: string, recoveryKey?: string): Promise<boolean | 'cancelled'> {
    const gen = _setupGen
    const salt = crypto.getRandomValues(new Uint8Array(32))
    // PBKDF2 迭代数随 canaryData 持久化——升级常量后旧 canary 仍按其原始 it 派生 key 验证。
    // 新 setup 用当前加密常量 PBKDF2_ITERATIONS（将来升级后新密文带新值）。
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
      _removeLocalCanary()
      return 'cancelled'
    }
    if (!ok) return false

    e2eStore.setEnabled(true)
    _setKey(key)
    e2eStore.setUnlocked(true)
    e2eStore.setCloudCanaryStale(false)
    e2eStore.initVisibilityLock()
    return true
  }

  /** 使用 Recovery Key 重置主密码 */
  async function resetWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<boolean> {
    const canaryData = await _getCanaryData() as Record<string, unknown> | null
    if (!canaryData?.recovery_canary || !canaryData?.recovery_salt) return false

    // 用 recovery canary 生成时的迭代数派生——旧数据无 recovery_it 字段则回退
    // PBKDF2_DEFAULT_ITERATIONS（固化 600000，不随 PBKDF2_ITERATIONS 演进，兼容现网旧数据）
    const rkIt = typeof canaryData.recovery_it === 'number' ? canaryData.recovery_it : PBKDF2_DEFAULT_ITERATIONS
    const rkKey = await deriveKey(_parseRecoveryKey(recoveryKey), new Uint8Array(canaryData.recovery_salt as number[]), rkIt)
    const ok = await verifyCanary(canaryData.recovery_canary as string, rkKey)
    if (!ok) return false

    const newSalt = crypto.getRandomValues(new Uint8Array(32))
    // reset 后的新密文/新 canary 用当前加密常量
    const newIt = PBKDF2_ITERATIONS
    const newKey = await deriveKey(newPassword, newSalt, newIt)
    const newCanary = await generateCanary(newKey)

    const newRkSalt = crypto.getRandomValues(new Uint8Array(32))
    const newRkIt = PBKDF2_ITERATIONS
    const newRkKey = await deriveKey(_parseRecoveryKey(recoveryKey), newRkSalt, newRkIt)

    const ok2 = await _saveCanaryData({
      canary: newCanary,
      salt: Array.from(newSalt),
      it: newIt,
      recovery_canary: await generateCanary(newRkKey),
      recovery_salt: Array.from(newRkSalt),
      recovery_it: newRkIt,
    })
    if (!ok2) return false

    e2eStore.setEnabled(true)
    _setKey(newKey)
    e2eStore.setUnlocked(true)
    e2eStore.setCloudCanaryStale(false) // reset 后云端是新 canary，清旧 stale
    e2eStore.initVisibilityLock()
    await biometric.removeBiometric()
    e2eStore.setBiometricEnrolled(false)
    return true
  }

  /** 解锁（验证主密码） */
  async function unlock(password: string): Promise<boolean> {
    const canaryData = await _getCanaryData() as { canary: string; salt: number[]; it?: number } | null
    if (!canaryData) return false

    // 用 canary 生成时的迭代数派生——旧数据无 it 字段则回退 PBKDF2_DEFAULT_ITERATIONS
    // （固化 600000，不随 PBKDF2_ITERATIONS 演进，兼容现网旧数据）
    const it = typeof canaryData.it === 'number' ? canaryData.it : PBKDF2_DEFAULT_ITERATIONS
    const salt = new Uint8Array(canaryData.salt)
    const key = await deriveKey(password, salt, it)
    const ok = await verifyCanary(canaryData.canary, key)
    if (!ok) return false

    // 解锁成功即证明 canary 存在（本地或云端），E2E 必然已启用。
    // 修复：本地无 canary、仅云端有（换设备/清缓存后登录）时，checkE2EStatus 在未登录
    // 阶段已把 isE2EEnabled 判为 false，登录动作本身不刷新它。openBmModal 只看 isUnlocked
    // 会弹解锁，但解锁成功后 enabled 仍 false → BookmarkModal 字段继续锁定并引导「设置主
    // 密码」，用户明明已解锁却看不到密码字段。此处 unlock 成功即 setEnabled(true) 兜底，
    // 保证「已解锁 = 已启用」不变量始终成立。
    e2eStore.setEnabled(true)
    _setKey(key)
    e2eStore.setUnlocked(true)
    e2eStore.initVisibilityLock()
    // 补解密：unlock 前若 Realtime 推过远端密文条目（useSyncRealtime 仅在 isUnlocked=true 才解），
    // 那批条目残留密文态，UI 显示乱码。解锁后 key 就绪，补扫 store 解开密文还原视图。
    // await 而非 fire-and-forget：unlock 真正完成补解密再返，调用方拿到「已就绪」状态，
    // 避免 UI 立刻读 store 仍见密文的瞬时窗口。
    try { await decryptStoreItems() } catch (e) { console.warn('[e2e] decryptStoreItems after unlock failed:', e) }
    // 解锁后重推锁定期间积压队列：锁定态下带敏感字段的 upsert op 被 pushFromQueue 静默跳过
    // 留 syncOps 队列（见 syncPush lockedItemKeys 分支），unlock 前 key 不在内存、推不上去；
    // unlock 后 key 就绪，立即 fire 一次 push 把队列清空。否则这批 op 要等下次 autoSync
    // tick / 可见性回前台才被动推（autoSync 关掉的用户压根不会被推），徽章长期显「N 项待同步」
    // 误导成「同步坏了」。与 _reencryptCloudPush 末尾用法一致（enqueue + withLock push），
    // fire-and-forget：unlock 不必等云端返回，补解密已 await 保证视图可用即足够。
    if (_getUserId()) {
      enqueueDirtyAsOps()
      void withLock('linkvault-sync', pushFromQueue)
    }
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
    if (!value) return value
    if (!key) {
      // 未解锁兜底：key 不在内存时报不出明文。明文（非三段）原样穿透给 UI 显示；
      // 三段密文（salt.iv.data）一旦原样进模板 {{ bookmark.notes }}/{{ bookmark.username }}
      // 会渲染成长串乱码——返空，与"已解锁但用错 key 解不开"语义一致（见下），UI 显空不显乱码。
      // 解锁后 decryptStoreItems 仍能用真 key 把真密文补解成明文，故不会丢数据。
      return isThreePartCipher(value) ? '' : value
    }
    // 走展示专用解密：解不开（三段但 GCM 认证失败 / key 不匹配）返 '' 而非返原密文。
    // decryptField 服务于 decryptItem / decryptStoreItems 还原视图给 UI 的展示语境——
    // decrypt（同步管线容错版）对"三段+失败"返原 ciphertext，会被模板 {{ bookmark.notes }}
    // 直接渲染成长串密文乱码（改密码后旧 key 密文用新 key 解、或异 E2E 状态密文进 store
    // 后用错 key 解时即落入此分支）。改走 decryptForDisplay 后解不开返空，与 password
    // 路径 decryptPasswordWithKey 语义一致。同步管线本身不调用本函数（先 decryptItem 再
    // merge，merge 不再解密），故此处改严格不影响同步容错。
    return decryptForDisplay(value, key)
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
      if (typeof val === 'string' && val) {
        const decrypted = await decryptField(val)
        // 解不开（decryptField 对三段但 GCM 认证失败 / 错 key 返 ''）时保留原密文，绝不置空：
        // 置空会经 merge assign 用空串覆盖本地 url/notes 并 saveAppData 落盘，push 再把空值
        // 推回云端覆盖明文，造成不可逆丢失（真实事故：登录后一批书签 url 变空白）。
        result[f] = decrypted !== '' ? decrypted : val
      }
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
      // 解不开（decryptField 对三段但 GCM 认证失败 / 错 key 返 ''）时保留原密文，绝不置空：
      // 置空会让 UI 显示空白，且后续 saveAppData/push 把空值回写云端覆盖明文，永久丢失。
      // UI 乱码由渲染层兜底；此处以数据安全为优先。
      if (decrypted !== '' && decrypted !== v) { obj[f] = decrypted; changed = true }
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

  /**
   * 检测 store 是否存在 E2E 密文数据（EncryptedPassword 对象 / 三段 salt.iv.data 串）。
   * 换设备防呆：本机无 canary 却已有历史密文时，setupMasterPassword 会生成全新 key，
   * 旧主密码加密的数据永久解不开（用户报的换设备密码乱码的根因场景）。UI 在 setup 弹窗
   * 打开时据此给出警告，引导用户走「原主密码解锁」（若已随备份导入 canary）而非静默覆盖。
   * 只读当前内存数据（curSpace 数据集），不做 IDB/云端查询。
   */
  function hasEncryptedData(): boolean {
    const ds = useDataStore()
    const isCipher = (v: unknown): boolean => typeof v === 'string' && isThreePartCipher(v)
    const isPwObj = (v: unknown): boolean =>
      typeof v === 'object' && v !== null && (v as { encrypted?: boolean }).encrypted === true
    return ds.bookmarks.some(b => isPwObj(b.password) || isCipher(b.password) || isCipher(b.username) || isCipher(b.notes))
      || ds.siblingGroups.some(g => isCipher(g.name) || isCipher(g.notes))
      || ds.categories.some(c => isCipher(c.name))
      || ds.customAttributes.some(a => isCipher(a.name))
  }

  // ── 修改主密码（数据层重加密迁移）──
  // 根因：setup/reset 换 key 时生成新 salt+新 key 并直接覆盖 canaryData，但云端历史
  // 密文（username/notes/name + password 独立路径）仍是旧 key 加密 → 新 key 解不开 →
  // 数据永久丢失。本函数把「换 key」补成完整链路：旧 key 解全量历史密文 → 新 key 重
  // 加密 → 内存存明文（password 存 newKey 对象）→ push 走 syncPush 的 encryptItem(newKey)
  // 加密一次上传（无双重加密）→ 覆盖 canaryData（复用旧 recovery_* 不改 recovery key）。
  // 失败恢复：逐条幂等可重试——push 失败的 op 留 syncOps 队列下次 online 重试，重试时
  // 内存是明文+password 对象，encryptItem(newKey) 加密一次，幂等安全，无双重加密。
  // 不做整批回滚（对齐 syncPush 部分成功语义）；IDB 写失败才回滚 _setKey(oldKey)+store 还原。
  // 限制：reset（忘旧主密码、只有 recovery key）路径不动——rkKey 只加密 recovery_canary、
  // 从不加密业务数据，reset 拿不到旧 key，数据救不回是它的本来语义。
  /**
   * 修改主密码（数据层重加密迁移）。
   * @param overrideCanary 可选——「跟随迁移」时传入云端新 canary（其他设备改过主密码），
   *   复用其 salt/it 派生新 key（使本机 key 与其他设备完全一致），canaryData 原样覆盖云端。
   *   未提供时走常规改密：随机新 salt + 生成新 canary，并记录 prev_*（旧 canary，标记升级）。
   */
  async function changeMasterPassword(oldPw: string, newPw: string, overrideCanary?: Record<string, unknown>): Promise<boolean> {
    if (newPw.length < 8) return false
    const canaryData = await _getCanaryData() as Record<string, unknown> | null
    if (!canaryData?.canary || !canaryData?.salt) return false

    // ── 步骤 2：派生 oldKey ──
    // 已 unlock：复用全局 cryptoKey（省旧密码一步），但仍 verifyCanary 校验与当前 canary 一致
    let oldKey: CryptoKey
    if (e2eStore.isUnlocked && e2eStore.cryptoKey) {
      oldKey = e2eStore.cryptoKey as CryptoKey
      const verified = await verifyCanary(canaryData.canary as string, oldKey)
      if (!verified) return false
    } else {
      if (!oldPw) return false
      const oldIt = typeof canaryData.it === 'number' ? canaryData.it : PBKDF2_DEFAULT_ITERATIONS
      const oldSalt = new Uint8Array(canaryData.salt as number[])
      const derived = await deriveKey(oldPw, oldSalt, oldIt)
      if (!(await verifyCanary(canaryData.canary as string, derived))) return false
      oldKey = derived
    }

    // ── 步骤 3：派生 newKey（局部，未设进 cryptoKey）──
    // 跟随迁移（overrideCanary）复用云端 canary 的 salt/it → 派生 key 与其他设备完全一致；
    // 常规改密则随机新 salt。
    const newSalt = overrideCanary
      ? new Uint8Array(overrideCanary.salt as number[])
      : crypto.getRandomValues(new Uint8Array(32))
    const newIt = overrideCanary
      ? (typeof overrideCanary.it === 'number' ? overrideCanary.it : PBKDF2_DEFAULT_ITERATIONS)
      : PBKDF2_ITERATIONS
    const newKey = await deriveKey(newPw, newSalt, newIt)

    // ── 步骤 4：内存浅克隆四数组并重加密到「目标态副本」──
    // 目标态规则（与现有 push 链路对齐，避免双重加密）：
    //  - username/notes/name（ENCRYPT_FIELDS）：存「明文」（push 时 syncPush encryptItem(newKey) 加密一次）
    //  - password：存 newKey 加密的 EncryptedPassword 对象（不在 ENCRYPT_FIELDS，push 不经 encryptItem，
    //    _serializePassword 仅重组三段串上传，故必须在内存就上锁成对象）
    //  - category/attribute：ENCRYPT_FIELDS 空，仅 bump updatedAt
    // 全部 bump updatedAt=now（否则 push 后远端 isRemoteNewer=false → skip → 迁移静默失败）
    const ds = useDataStore()
    const now = Date.now()
    const origSnapshot = {
      bookmarks: ds.bookmarks.slice(),
      siblingGroups: ds.siblingGroups.slice(),
      categories: ds.categories.slice(),
      customAttributes: ds.customAttributes.slice(),
    }

    const reencryptFieldToPlain = async (v: string): Promise<string> => {
      if (typeof v !== 'string' || !v) return v
      if (!isThreePartCipher(v)) return v // 明文原样
      const plain = await decryptForDisplay(v, oldKey)
      return plain === '' ? v : plain // 三段但 oldKey 解不开（脏数据）→ 保留原串
    }

    const reencryptPassword = async (p: unknown): Promise<unknown> => {
      if (p == null) return p
      // EncryptedPassword 对象 → 重组三段串 → oldKey 解 → newKey 加 → 拆回新对象
      if (typeof p === 'object' && (p as { encrypted?: boolean }).encrypted === true) {
        const ep = p as { salt?: string; iv?: string; data?: string }
        if (ep.salt && ep.iv && ep.data) {
          const cipher = `${ep.salt}.${ep.iv}.${ep.data}`
          const plain = await decryptForDisplay(cipher, oldKey)
          if (plain === '') return p // oldKey 也解不开 → 保留原对象
          const newCipher = await encrypt(plain, newKey)
          const [salt, iv, data] = newCipher.split('.')
          return { encrypted: true, salt, iv, data }
        }
        return p
      }
      if (typeof p === 'string') {
        if (isThreePartCipher(p)) {
          const plain = await decryptForDisplay(p, oldKey)
          if (plain === '') return p
          const newCipher = await encrypt(plain, newKey)
          const [salt, iv, data] = newCipher.split('.')
          return { encrypted: true, salt, iv, data }
        }
        // 旧 base64 / 明文 string：safeDecode 不需 key → newKey 上锁成对象
        const plain = safeDecodePassword(p)
        if (!plain) return p
        const newCipher = await encrypt(plain, newKey)
        const [salt, iv, data] = newCipher.split('.')
        return { encrypted: true, salt, iv, data }
      }
      return p
    }

    let newBookmarks: Array<Record<string, unknown>>
    let newGroups: Array<Record<string, unknown>>
    try {
      newBookmarks = await Promise.all(ds.bookmarks.map(async b => {
        const nb: Record<string, unknown> = { ...b }
        nb.username = await reencryptFieldToPlain(b.username as string)
        nb.notes = await reencryptFieldToPlain(b.notes as string)
        if (b.password != null && b.password !== '') nb.password = await reencryptPassword(b.password)
        nb.updatedAt = now
        return nb
      }))
      newGroups = await Promise.all(ds.siblingGroups.map(async g => {
        const ng: Record<string, unknown> = { ...g }
        ng.name = await reencryptFieldToPlain(g.name as string)
        ng.notes = await reencryptFieldToPlain(g.notes as string)
        ng.updatedAt = now
        return ng
      }))
    } catch {
      // 步骤 4 任一字段抛错：store/IDB/canary 全未动，cryptoKey 旧值未变，零损失
      return false
    }
    const newCategories = ds.categories.map(c => ({ ...c, updatedAt: now }))
    const newAttrs = ds.customAttributes.map(a => ({ ...a, updatedAt: now }))

    // ── 步骤 5：提前切全局 key 为 newKey，为步骤 8 push 时 encryptItem 用 newKey ──
    // 此处尚未 mutate store，失败回滚只需 _setKey(oldKey)（store 仍是旧态）
    _setKey(newKey)

    // ── 步骤 6：commit 目标态副本进 store（直接 mutate，绕 CRUD/历史/回声，对齐 decryptStoreItems）──
    ds.bookmarks = newBookmarks as never
    ds.siblingGroups = newGroups as never
    ds.categories = newCategories as never
    ds.customAttributes = newAttrs as never
    ds._syncMaps()
    ds._bumpSearchVersion()
    _cancelPendingHist()

    // ── 步骤 7：落 IDB（内存是明文+password 对象，与现有架构一致）──
    // flushSaveAppData 内部 _dataSnapshot + safeParse + saveData
    const flushed = await flushSaveAppData()
    if (!flushed) {
      // IDB 写失败：回滚 _setKey(oldKey) + store 还原原引用 + 重建索引
      _setKey(oldKey)
      ds.bookmarks = origSnapshot.bookmarks as never
      ds.siblingGroups = origSnapshot.siblingGroups as never
      ds.categories = origSnapshot.categories as never
      ds.customAttributes = origSnapshot.customAttributes as never
      ds._syncMaps()
      return false
    }

    // ── 步骤 8：push 覆盖云端（整行 upsert，带新 updatedAt 覆盖远端旧密文）──
    await _reencryptCloudPush()

    // ── 步骤 9：覆盖 canaryData（无条件，即便 push 部分失败也覆盖——否则本机下次 unlock 用旧 canary 失败）──
    let newCanaryData: Record<string, unknown>
    if (overrideCanary) {
      // 跟随迁移：云端 canary 原样覆盖（含 prev_* 等全部字段），保证多设备 canaryData 完全一致
      //（_sameCanary 按 canary+salt 对比，不一致会被误报为多设备冲突）。
      newCanaryData = { ...overrideCanary }
    } else {
      // recovery_* 全部复用旧值（changeMasterPassword 不改 recovery key）
      const newCanary = await generateCanary(newKey)
      newCanaryData = {
        canary: newCanary,
        salt: Array.from(newSalt),
        it: newIt,
        // prev_* 记录旧 canary：标记「这是主密码升级」供其他设备 detect 出 upgraded 场景
        //（走跟随迁移而非误判为多设备冲突），并保留旧派生参数供其他设备派生旧 key 解本机数据。
        prev_canary: canaryData.canary,
        prev_salt: canaryData.salt,
        prev_it: canaryData.it,
        recovery_canary: canaryData.recovery_canary,
        recovery_salt: canaryData.recovery_salt,
        recovery_it: canaryData.recovery_it,
      }
    }
    const canaryOk = await _saveCanaryData(newCanaryData)
    if (!canaryOk) {
      // 本地 canary 已写（_saveCanaryData 总先写本地），本机可用；云端写失败 → 置
      // cloudCanaryStale：其他设备凭旧 canary/旧主密码能验通却解不开本设备 push 的新 key
      // 密文，业务数据对它们永久不可读。UI 读此标记给强提示，引导在其他设备用 Recovery
      // Key 走 resetWithRecoveryKey（清空重建空库），把"永久丢失卡死"降级为"需重置"。
      e2eStore.setCloudCanaryStale(true)
      console.warn('[e2e] canaryData 云端写入失败：本机可用，其他设备主密码需用 Recovery Key 重置')
    } else {
      e2eStore.setCloudCanaryStale(false)
    }

    return true
  }

  /**
   * 跟随其他设备的主密码修改（多设备「同步修改」）。
   * 前置：云端 canary 带 prev_*（设备 A 改过主密码）且本机本地 canary 仍是旧值。
   * 用本机旧主密码 + 本地旧 canary 派生 oldKey 解本机数据；用「云端新 canary 的 salt + 新主密码」
   * 派生与 A 完全一致的 newKey 重加密，canaryData 原样覆盖云端 → 本机与 A 用同一把 key，互通。
   * 失败返回 false（如云端无 prev_*、本地 canary 已丢）。
   */
  async function followMasterPasswordChange(oldPw: string, newPw: string): Promise<boolean> {
    const cloud = await _getCloudCanary()
    if (!cloud?.prev_canary || !cloud?.salt) return false
    return changeMasterPassword(oldPw, newPw, cloud)
  }

  // 重加密 push：unsubscribeRealtime + 暂停 autoSync + setReencrypting → 清旧队列防
  // 旧密文 op 复活 → 标全部 dirty+newIds（强制整行 upsert）→ enqueueDirtyAsOps + pushFromQueue
  async function _reencryptCloudPush(): Promise<boolean> {
    const syncStore = useSyncStore()
    const ds = useDataStore()
    const userId = _getUserId()
    if (!userId) return true // 未登录：本地已够，无需 push

    const wasAutoSync = syncStore.autoSync
    syncStore.setAutoSync(false)
    syncStore.setReencrypting(true)
    unsubscribeRealtime()

    let result = false
    try {
      await clearAllSyncOps()
      _clearAllPendingSync()
      // 标全部 id dirty + newIds：强制走整行 upsert（syncPush L215 isNew||!changedFields），
      // 带 bumped updatedAt 覆盖远端旧密文行。不写 _changedFields → 避开 partial patch
      for (const b of ds.bookmarks) { ds._markDirty(b.id); ds._newIds.add(b.id) }
      for (const g of ds.siblingGroups) { ds._markDirty(g.id); ds._newIds.add(g.id) }
      for (const c of ds.categories) { ds._markDirty(c.id); ds._newIds.add(c.id) }
      for (const a of ds.customAttributes) { ds._markDirty(a.id); ds._newIds.add(a.id) }
      enqueueDirtyAsOps()
      const pushed = await withLock('linkvault-sync', () => pushFromQueue())
      // pushed=false：失败 op 留 syncOps 队列下次 online 重试（幂等，无双重加密）
      // canary 在调用方（changeMasterPassword 步骤 9）无条件覆盖，避免本机 unlock 失败
      result = !!pushed
    } finally {
      syncStore.setReencrypting(false)
      syncStore.setAutoSync(wasAutoSync)
      // 无条件重生 Realtime 订阅：autoSync 只控制是否自动触发 sync，不决定是否订阅
      // Realtime。autoSync=false 的用户原本仍有订阅，unsubscribe 仅为防回声，结束必须恢复，
      // 否则该用户实时推送永久丢失直到 reload。
      subscribeRealtime(pullChanges)
    }
    return result
  }

  // ── 指纹解锁方法（Facade 转发 + Store 同步）──
  const isBiometricAvailableFn = biometric.isBiometricAvailable

  async function enrollBiometricFn(masterPassword: string): Promise<boolean> {
    const ok = await biometric.enrollBiometric(masterPassword)
    if (ok) e2eStore.setBiometricEnrolled(true)
    return ok
  }

  const unlockWithBiometricFn = biometric.unlockWithBiometric

  async function removeBiometricFn(): Promise<void> {
    await biometric.removeBiometric()
    e2eStore.setBiometricEnrolled(false)
  }

  return {
    isE2EEnabled, isUnlocked, isBiometricEnrolled, cloudCanaryStale,
    checkE2EStatus, generateRecoveryKey,
    setupMasterPassword, resetWithRecoveryKey, changeMasterPassword,
    unlock, lock, encryptItem, decryptItem, encryptField, decryptField, decryptStoreItems, hasEncryptedData,
    detectCloudCanaryMismatch, adoptCloudCanary, ensureCloudCanarySynced, followMasterPasswordChange,
    isBiometricAvailable: isBiometricAvailableFn,
    enrollBiometric: enrollBiometricFn,
    unlockWithBiometric: unlockWithBiometricFn,
    removeBiometric: removeBiometricFn,
    // 层二 cancel token：组件层在 watch 负向分支调此函数短路 setupMasterPassword 副作用
    cancelSetup,
  }
}
