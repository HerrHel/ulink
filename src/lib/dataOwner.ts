/**
 * dataOwner.ts — 本地数据「归属账号」与按账号分仓
 *
 * 问题：本地书签是本地权威数据，登出/会话过期都不清。旧实现只靠一个一次性的
 * 「刚切换账号」标记跳过一次补推，刷新后、强制重传、熔断恢复、断线遗留队列……
 * 任一路径都会把 A 的本地数据当成「云端缺失」推进 B 的云端。
 *
 * 方案（三条不变量）：
 * 1. **归属标记**：本地主数据整体属于一个账号（owner）。'' 表示从未登录过的游客数据；
 *    登出、会话过期、断线都**不改** owner。
 * 2. **同步总闸**：入队 / 推送 / 拉取前统一检查 `isSyncAllowedFor(uid)`——本实例载入的
 *    数据与持久化 owner 一致，且 owner 是当前账号（或游客数据待首次并入）。不满足即
 *    什么都不做。A 的数据永远走不进 B 的推送路径。
 * 3. **整体换仓**：当前账号 ≠ owner 时，把本机属于 owner 的全部本地状态（主数据、私密
 *    空间、推送队列、死信、脏标记、E2E/私密空间校验值、AI 个人数据、本地历史……）
 *    原样收进 IDB 的 owner 分仓，再取出目标账号的分仓（没有则空白），最后改 owner。
 *    换仓从不删除数据；换仓后整页重载，内存态（undo 栈、解密密钥、各模块缓存）全部重建。
 *
 * 多实例：每个实例记住自己载入时的 owner（instanceOwner）。持久化 owner 一旦变化，
 * 旧实例的保存一律被围栏拒绝（防把 A 的内存快照写进 B 的仓），并通过 storage 事件重载。
 *
 * 崩溃安全：换仓前写日志（journal），按阶段恢复——stashing 阶段崩溃 → 现场仍是 from
 * 的数据，回退 owner；loading 阶段崩溃 → from 已入仓，重做载入。
 *
 * 本模块不得 import persist / app 等上层 store（persist 依赖本模块做写入围栏）。
 */
import { idbGet, idbSet, drainSyncOps, replaceAllSyncOps, type SyncOp } from '../stores/storage.js'
import { safeGetItem, safeSetItem, safeRemoveItem, safeJsonParse } from './storageSafe.js'

export const K_DATA_OWNER = 'lv_data_owner'
export const K_OWNER_JOURNAL = 'lv_data_owner_journal'
export const K_STASH_INDEX = 'lv_acct_stash_index'
export const STASH_PREFIX = 'lv_acct_stash:'
/** 从未登录过的游客数据 */
export const GUEST_OWNER = ''
/** 升级迁移时无法判定归属（旧版「刚切换账号」标记仍挂着）的数据 */
export const UNKNOWN_OWNER = '__unknown__'
/** 换仓进行中：所有实例的写入都被围栏拒绝 */
const SWITCHING = '__switching__'

/** 旧版遗留键：仅用于一次性迁移出 owner */
const LEGACY_LAST_USER_ID = 'lv_last_user_id'
const LEGACY_ACCOUNT_SWITCHED = 'lv_account_switched'

/** 主数据 / 私密空间的存储键（IDB 与 localStorage 同名；与 persist._keys 保持一致） */
const MAIN_KEY = 'linkvault_v2'
const VAULT_KEY = 'linkvault_vault_v1'

/**
 * 随账号走的 localStorage 键。新增账号相关的本地键时必须登记在这里，
 * 否则换号后会串到另一个账号（单测 dataOwner.test 有清单守卫）。
 */
export const ACCOUNT_SCOPED_KEYS: readonly string[] = [
  MAIN_KEY, VAULT_KEY,
  // 同步状态
  'lv_sync_dead_deletes', 'lv_sync_dead_upserts', 'lv_sync_dirty_v1',
  'lv_delGroupMems', 'lv_delAttrMems',
  // 加密 / 私密空间（校验值与生物识别包裹的是该账号的主密码）
  'lv_e2e_canary', 'lv_e2e_biometric', 'lv_vault_canary', 'lv_vault_biometric',
  // AI 个人数据
  'lv_ai_profile', 'lv_ai_habits', 'lv_ai_graph_v1', 'lv_ai_note_suggestions',
  'lv_ai_ambient_v1', 'lv_ai_query_expand_v1', 'lv_ai_sessions_v1', 'lv_ai_cur_session_v1',
  // 资料 / 权益缓存
  'lv_user_nickname', 'lv_user_avatar', 'lv_entitlement_v1', 'ulink_entitlement_v1',
  // 死链检测（针对该账号的书签）
  'lv_deadLinkBaseline', 'lv_deadLinkHistory', 'lv_deadLinkWhitelist',
]
export const ACCOUNT_SCOPED_PREFIXES: readonly string[] = ['lv_hist:', 'lv_ai_enrich_']

interface StashPayload {
  v: 1
  owner: string
  savedAt: number
  main: unknown
  vault: unknown
  ops: SyncOp[]
  ls: Record<string, string>
}

export interface StashIndexEntry {
  savedAt: number
  /** 主空间书签 + 组数量（提示文案用） */
  count: number
  /** 用户已对「不明归属」分仓做过选择，不再提示 */
  ack?: boolean
}

interface Journal { from: string; to: string; stage: 'stashing' | 'loading' }

// ── owner 读写 ──

let _instanceOwner: string | null = null

function _readOwnerRaw(): string | null {
  return safeGetItem(K_DATA_OWNER)
}

/** 一次性迁移：老版本没有 owner 键，按旧标记推断 */
function _migrateOwner(): string {
  const last = safeGetItem(LEGACY_LAST_USER_ID) || ''
  const switched = safeGetItem(LEGACY_ACCOUNT_SWITCHED) === '1'
  // 旧版「刚切换账号」标记仍挂着：本地数据混有上一个账号的存量，归属不明
  const owner = switched ? UNKNOWN_OWNER : last
  safeSetItem(K_DATA_OWNER, owner)
  safeRemoveItem(LEGACY_ACCOUNT_SWITCHED)
  return owner
}

/** 持久化的本地数据归属账号（'' = 游客数据） */
export function getDataOwner(): string {
  const raw = _readOwnerRaw()
  return raw === null ? _migrateOwner() : raw
}

function _setOwner(owner: string): void {
  safeSetItem(K_DATA_OWNER, owner)
}

/** 本实例内存数据所属的账号（首次读取时以持久化 owner 为准） */
export function getInstanceOwner(): string {
  if (_instanceOwner === null) _instanceOwner = getDataOwner()
  return _instanceOwner
}

/**
 * 写入围栏：本实例内存里的数据是否仍属于当前持久化 owner。
 * 换仓进行中或已换到别的账号时返回 false——此时任何落盘都会把旧账号的内存快照
 * 写进新账号的仓。
 */
export function isWriteAllowed(): boolean {
  const owner = getDataOwner()
  if (owner === SWITCHING) return false
  return owner === getInstanceOwner()
}

/**
 * 同步总闸：本地数据可否以 userId 身份上传 / 拉取合并。
 * 游客数据（从未登录过）允许并入首个登录账号——这是「首次登录上传本地数据」的既有语义。
 */
export function isSyncAllowedFor(userId: string | null | undefined): boolean {
  if (!userId) return false
  if (!isWriteAllowed()) return false
  const owner = getDataOwner()
  return owner === userId || owner === GUEST_OWNER
}

// ── 分仓索引 ──

export function readStashIndex(): Record<string, StashIndexEntry> {
  return safeJsonParse<Record<string, StashIndexEntry>>(safeGetItem(K_STASH_INDEX), {})
}

function _writeStashIndex(idx: Record<string, StashIndexEntry>): void {
  safeSetItem(K_STASH_INDEX, JSON.stringify(idx))
}

function _countItems(main: unknown): number {
  if (!main || typeof main !== 'object') return 0
  const d = main as { bookmarks?: Array<{ deletedAt?: number }>; siblingGroups?: Array<{ deletedAt?: number }> }
  const live = (arr?: Array<{ deletedAt?: number }>) => (Array.isArray(arr) ? arr.filter(x => !x?.deletedAt).length : 0)
  return live(d.bookmarks) + live(d.siblingGroups)
}

export async function readStash(owner: string): Promise<StashPayload | null> {
  const v = await idbGet(STASH_PREFIX + owner)
  return v && typeof v === 'object' && (v as StashPayload).v === 1 ? (v as StashPayload) : null
}

// ── 现场 ↔ 分仓 ──

function _isScopedKey(k: string): boolean {
  return ACCOUNT_SCOPED_KEYS.includes(k) || ACCOUNT_SCOPED_PREFIXES.some(p => k.startsWith(p))
}

function _scopedLsKeys(): string[] {
  const out: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && _isScopedKey(k)) out.push(k)
    }
  } catch { /* localStorage 不可用 */ }
  return out
}

async function _captureLive(owner: string): Promise<StashPayload> {
  const ls: Record<string, string> = {}
  for (const k of _scopedLsKeys()) {
    const v = safeGetItem(k)
    if (v !== null) ls[k] = v
  }
  const [main, vault, ops] = await Promise.all([idbGet(MAIN_KEY), idbGet(VAULT_KEY), drainSyncOps()])
  return { v: 1, owner, savedAt: Date.now(), main: main ?? null, vault: vault ?? null, ops, ls }
}

/** 新账号在本机没有分仓时的主数据：真空（不生成示例书签，避免把示例推进该账号云端） */
function _emptyMain(): Record<string, unknown> {
  return {
    bookmarks: [],
    siblingGroups: [],
    categories: [
      { id: 'all', name: '全部', icon: 'grid', color: '#122E8A', order: 0 },
      { id: 'uncategorized', name: '未分类', icon: 'bookmark', color: '#6E6860', order: 1 },
    ],
    customAttributes: [],
  }
}

async function _restoreLive(stash: StashPayload | null): Promise<boolean> {
  // 1) 清掉现场所有随账号走的 localStorage 键，再写回目标账号的
  for (const k of _scopedLsKeys()) safeRemoveItem(k)
  if (stash) {
    for (const [k, v] of Object.entries(stash.ls || {})) safeSetItem(k, v)
  }
  // 2) IDB 主数据 / 私密空间 / 推送队列
  const okMain = await idbSet(MAIN_KEY, stash?.main ?? _emptyMain())
  const okVault = await idbSet(VAULT_KEY, stash?.vault ?? null)
  const okOps = await replaceAllSyncOps(stash?.ops ?? [])
  return okMain && okVault && okOps
}

function _readJournal(): Journal | null {
  const j = safeJsonParse<Journal | null>(safeGetItem(K_OWNER_JOURNAL), null)
  return j && typeof j.from === 'string' && typeof j.to === 'string' ? j : null
}

/**
 * 启动时调用（载入数据之前）：完成迁移、从中断的换仓中恢复，并锁定本实例的 owner。
 */
export async function initDataOwner(): Promise<void> {
  const j = _readJournal()
  if (j) {
    if (j.stage === 'loading') {
      // from 已安全入仓：重做目标账号的载入
      const stash = await readStash(j.to)
      await _restoreLive(stash)
      _setOwner(j.to)
    } else {
      // 入仓未完成：现场仍是 from 的数据
      _setOwner(j.from)
    }
    safeRemoveItem(K_OWNER_JOURNAL)
  } else if (_readOwnerRaw() === SWITCHING) {
    // 没有日志却停在换仓态（不应发生）：归属不明，交给提示流程
    _setOwner(UNKNOWN_OWNER)
  }
  _instanceOwner = getDataOwner()
}

export type EnsureOwnerResult = 'same' | 'adopted' | 'switched' | 'stale' | 'failed'

/**
 * 确保本地数据归属 userId。调用方须先把本实例未落盘的编辑刷盘，并持有同步锁。
 * - same：已归属，照常同步
 * - adopted：游客数据并入该账号（首次登录）
 * - switched：已整体换仓，调用方必须整页重载
 * - stale：别的实例已完成换仓，本实例内存是旧账号数据，必须整页重载
 * - failed：换仓失败（IDB 不可写），现场已回滚；同步总闸保持关闭
 */
export async function ensureOwnerFor(userId: string): Promise<EnsureOwnerResult> {
  const from = getDataOwner()
  if (from === SWITCHING) return 'stale'
  if (getInstanceOwner() !== from) return 'stale'
  if (from === userId) return 'same'
  if (from === GUEST_OWNER) {
    _setOwner(userId)
    _instanceOwner = userId
    return 'adopted'
  }

  // 整体换仓：先关所有实例的写入围栏
  safeSetItem(K_OWNER_JOURNAL, JSON.stringify({ from, to: userId, stage: 'stashing' } satisfies Journal))
  _setOwner(SWITCHING)
  try {
    const live = await _captureLive(from)
    if (!(await idbSet(STASH_PREFIX + from, live))) throw new Error('stash write failed')
    const idx = readStashIndex()
    idx[from] = { savedAt: live.savedAt, count: _countItems(live.main), ack: idx[from]?.ack }
    delete idx[userId]
    _writeStashIndex(idx)
    safeSetItem(K_OWNER_JOURNAL, JSON.stringify({ from, to: userId, stage: 'loading' } satisfies Journal))
  } catch (e) {
    console.error('[dataOwner] 收仓失败，回滚归属（数据未改动）:', e)
    _setOwner(from)
    safeRemoveItem(K_OWNER_JOURNAL)
    return 'failed'
  }

  const target = await readStash(userId)
  const ok = await _restoreLive(target)
  if (!ok) {
    // from 已安全入仓；留下 loading 日志，下次启动 initDataOwner 会重做载入
    console.error('[dataOwner] 载入目标账号分仓未完成，下次启动时重试')
    return 'switched'
  }
  _setOwner(userId)
  safeRemoveItem(K_OWNER_JOURNAL)
  // 目标分仓已整体搬回现场：删除分仓，避免以后误用旧副本
  if (target) await idbSet(STASH_PREFIX + userId, null)
  console.info('[dataOwner] 已按账号换仓：本机原数据已保存在原账号名下，不会上传到当前账号')
  return 'switched'
}

// ── 不明归属分仓：交给用户决定 ──

const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 需要询问用户的分仓：归属不明（升级迁移）或疑似同一人的 Supabase 旧身份
 * （CloudBase 登录 id 与旧 uuid 格式不同，无法本地判定是否同一人）。
 */
export function ambiguousStashes(currentUserId: string): Array<{ owner: string } & StashIndexEntry> {
  const idx = readStashIndex()
  const out: Array<{ owner: string } & StashIndexEntry> = []
  for (const [owner, e] of Object.entries(idx)) {
    if (e.ack || !e.count || owner === currentUserId) continue
    const legacyLike = _UUID_RE.test(owner) && !_UUID_RE.test(currentUserId)
    if (owner === UNKNOWN_OWNER || legacyLike) out.push({ owner, ...e })
  }
  return out
}

/** 用户选择「保持分开」：不再提示（分仓保留） */
export function acknowledgeStash(owner: string): void {
  const idx = readStashIndex()
  if (idx[owner]) {
    idx[owner].ack = true
    _writeStashIndex(idx)
  }
}

// ── 多实例 / 重载 ──

let _reload: () => void = () => {
  try { window.location.reload() } catch { /* 非浏览器环境 */ }
}

/** 换仓后整页重载（测试可注入） */
export function requestReload(): void { _reload() }

export function __setReloadHandlerForTest(fn: () => void): void { _reload = fn }

/** 其他实例改了 owner → 本实例内存是旧账号数据，立即重载 */
export function watchOwnerChanges(): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key !== K_DATA_OWNER) return
    if (e.newValue === SWITCHING) return // 等换仓完成再重载
    if ((e.newValue ?? '') !== getInstanceOwner()) _reload()
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

export function __resetDataOwnerForTest(): void {
  _instanceOwner = null
  _reload = () => {}
}
