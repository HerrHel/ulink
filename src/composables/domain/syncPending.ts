/**
 * syncPending — in-flight 同步 id 集合（H3）
 *
 * drain dirty 入队后、op 真正 push 成功前，远端 newer 应转 conflict 而非静默 assign。
 */
import { safeGetItem, safeSetItem } from '../../lib/storageSafe.js'

const _pendingSyncIds = new Set<string>()

export function _isPendingSync(id: string): boolean {
  return _pendingSyncIds.has(id)
}

export function _markPendingSync(ids: Iterable<string>): void {
  for (const id of ids) _pendingSyncIds.add(id)
}

export function _clearPendingSync(ids: Iterable<string>): void {
  for (const id of ids) {
    if (_pendingSyncIds.has(id)) _pendingSyncIds.delete(id)
  }
}

/**
 * 清空全部 in-flight pending id（登出/切账号时调用）。
 * 审计 R1：登出不清 _pendingSyncIds 致旧账号残留 pending 标记跨账号串留，与 IDB syncOps
 * 残留 op 一起在 B 登录 initialSync 时被推到 B 云端。登出需一并清队列与 pending 标记。
 */
export function _clearAllPendingSync(): void {
  _pendingSyncIds.clear()
}

/** 测试专用：模拟已 drain 待推送；beforeEach 需 clear */
export const __testPendingSync = {
  add: (id: string) => _pendingSyncIds.add(id),
  clear: () => _pendingSyncIds.clear(),
  /** 单测断言用：死信 clear 后应 false */
  has: (id: string) => _pendingSyncIds.has(id),
  delete: (id: string) => _pendingSyncIds.delete(id),
}

// ── 死信 delete 墓碑（补偿队列）────────────────────────────────────
// delete op 达重试上限被物理出队后，本地已无该实体，常规 _enqueueMissingToCloud
// 无法为它补推；而云端若仍存活该行，fullSync/pull 会把删除项插回本地（删除复活）。
// 因此把「本地已彻底删除、但 DELETE 尚未成功上云」的 id 持久化，用于：
//   1) resync/initial/full/online 时重新入队；
//   2) pull 合并时跳过远端对应行，直到 DELETE 真正成功。
export interface DeadDeleteEntry {
  table: string
  itemId: string
  ts: number
}

const DEAD_DELETES_KEY = 'lv_sync_dead_deletes'
const MAX_DEAD_DELETES = 1000
const DEAD_DELETE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
// pull 会对每条远端行调用 isDeadDelete；不能每行都 JSON.parse 一次 localStorage。
// 短 TTL 缓存兼顾「跨标签页写入」与主线程开销（同一次 pull 内只解析一次）。
let _deadDeletesCache: DeadDeleteEntry[] | null = null
let _deadDeletesCacheAt = 0
const DEAD_DELETES_CACHE_MS = 2000

function _readDeadDeletes(): DeadDeleteEntry[] {
  if (_deadDeletesCache && Date.now() - _deadDeletesCacheAt < DEAD_DELETES_CACHE_MS) {
    return _deadDeletesCache
  }
  try {
    const raw = safeGetItem(DEAD_DELETES_KEY)
    if (!raw) {
      _deadDeletesCache = []
      _deadDeletesCacheAt = Date.now()
      return _deadDeletesCache
    }
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) {
      _deadDeletesCache = []
      _deadDeletesCacheAt = Date.now()
      return _deadDeletesCache
    }
    const now = Date.now()
    _deadDeletesCache = list.filter((d): d is DeadDeleteEntry =>
      !!d && typeof d.table === 'string' && typeof d.itemId === 'string' &&
      typeof d.ts === 'number' && now - d.ts < DEAD_DELETE_MAX_AGE_MS,
    )
    _deadDeletesCacheAt = Date.now()
    return _deadDeletesCache
  } catch {
    return []
  }
}

function _writeDeadDeletes(list: DeadDeleteEntry[]): void {
  const capped = list.slice(-MAX_DEAD_DELETES)
  _deadDeletesCache = capped
  _deadDeletesCacheAt = Date.now()
  safeSetItem(DEAD_DELETES_KEY, JSON.stringify(capped))
}

export function rememberDeadDelete(table: string, itemId: string): void {
  if (!table || !itemId) return
  const list = _readDeadDeletes().filter((d) => !(d.table === table && d.itemId === itemId))
  list.push({ table, itemId, ts: Date.now() })
  _writeDeadDeletes(list)
}

export function forgetDeadDelete(table: string, itemId: string): void {
  if (!table || !itemId) return
  _writeDeadDeletes(_readDeadDeletes().filter((d) => !(d.table === table && d.itemId === itemId)))
}

export function isDeadDelete(table: string, itemId: string): boolean {
  return _readDeadDeletes().some((d) => d.table === table && d.itemId === itemId)
}

export function listDeadDeletes(): DeadDeleteEntry[] {
  const list = _readDeadDeletes()
  _writeDeadDeletes(list)
  return list
}
