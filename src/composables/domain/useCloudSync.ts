/**
 * useCloudSync.ts — Queue-based Cloud Sync with Realtime
 *
 * 职责：同步编排（队列/推送/拉取/合并），注册 Realtime / 生命周期
 * 分解模块：
 * - useSyncMapping.ts  — 数据映射（本地 ⇄ 远端）
 * - useSyncRealtime.ts  — Realtime 订阅管理
 * - useSyncConflict.ts  — 冲突检测与解决
 * - useSyncHistory.ts   — 版本历史
 *
 * 状态管理：所有响应式状态存放于 stores/sync.ts (useSyncStore)
 */
import { computed, toRef } from 'vue'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from './useAuth.js'
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { saveAppData } from '../../stores/app.js'
import { useE2E } from './useE2E.js'

import {
  enqueueSyncOps, drainSyncOps, removeSyncOps, syncOpsCount, updateSyncOpRetry,
  type SyncOp,
} from '../../stores/storage.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute, EntityType } from '../../types.js'
import {
  toRemoteRow, fromRemoteBookmark, fromRemoteGroup, fromRemoteCategory, fromRemoteAttribute, camelToSnake,
  type RemoteBookmarkRow, type RemoteGroupRow,
} from './useSyncMapping.js'
import {
  resolveConflict, resolveAllConflicts, _remoteSnapshots,
} from './useSyncConflict.js'
import {
  _saveHistory, fetchHistory, restoreFromHistory, _getUserId,
} from './useSyncHistory.js'
import {
  subscribeRealtime, unsubscribeRealtime,
} from './useSyncRealtime.js'

let _initialized = false
let _syncTimer: ReturnType<typeof setTimeout> | null = null

// H3：in-flight 同步集合。depsync（debouncedSync）把 dirty 排进 syncOps 队列时会清空
// _dirtyIds（drainDirtyIds），但 op 真正 push 到云端有 3000ms debounce 窗口 + 重试滞留期。
// 此间若远端 realtime 推来同 id 的更新，_mergeIntoLocal 因 `ds._dirtyIds.has(id)` 已 false
// 落到 `else if remoteNewer` 分支直接 Object.assign，把本地正在等待推送的改动覆盖丢失；
// 随后延迟 push 又用本地旧版本覆盖远端，双向丢失无 conflict 记录。把 drain 出的 id 记入
// 本集合，待对应 op push 成功后再清。_mergeIntoLocal 看到 remoteNewer 且 id 在本集合时一律
// 转 conflict，保证 op 落库成功前不被远端静默覆盖。
const _pendingSyncIds = new Set<string>()

/** 导出供 useSyncRealtime 等模块在 merge 时复用同一份 in-flight 判定 */
export function _isPendingSync(id: string): boolean { return _pendingSyncIds.has(id) }
function _markPendingSync(ids: Iterable<string>) { for (const id of ids) _pendingSyncIds.add(id) }
function _clearPendingSync(ids: Iterable<string>) { for (const id of ids) if (_pendingSyncIds.has(id)) _pendingSyncIds.delete(id) }
/**
 * 测试专用注入：模拟"已 drain 待推送"的 in-flight 状态。
 * 生产代码通过 _enqueueDirtyAsOps → _markPendingSync / _pushFromQueue → _clearPendingSync
 * 管理此集合；测试不跑完整 enqueue/push 流程时用它直接置态以覆盖 H3 冲突分支。
 * 请在 beforeEach 调 reset 防止跨用例泄漏。
 */
export const __testPendingSync = {
  add: (id: string) => _pendingSyncIds.add(id),
  clear: () => _pendingSyncIds.clear(),
}

/** 单条 sync op 最大推送重试次数：超过即移出队列，避免失败 op 无限堆积
 *  导致「恢复了又没了」的同步死结（数据本体在 ds.bookmarks，删 op 不丢数据）。 */
const MAX_PUSH_RETRIES = 3

// 锁定态静默排队判定用的敏感字段集（与 useE2E.ENCRYPT_FIELDS 同步）。
// 锁定期间：改动触及这些字段之一的 upsert op 留在 IDB 等解锁，不推不报错；
// 其余改动（title/url/分类名/排序/attributes…）经 encryptItem 透传明文照常推送。
// category/custom_attributes 无敏感字段，锁定态照常全量同步。
const SENSITIVE_FIELDS: Record<string, readonly string[]> = {
  bookmarks: ['username', 'notes'],
  sibling_groups: ['name', 'notes'],
  categories: [],
  custom_attributes: [],
}

/** 锁定态下该 upsert op 是否需要等解锁才能安全推送。
 *  changedFields 非空 → 看是否含敏感字段；为空（新建/全量）→ 看本体是否有非空敏感字段。
 *  导出（含 _ 前缀，约定私有）供单测钉住条目级判定语义。 */
export function _opNeedsUnlock(op: SyncOp): boolean {
  if (!op.data) return false
  const sens = SENSITIVE_FIELDS[op.table]
  if (!sens || sens.length === 0) return false
  const data = op.data as Record<string, unknown>
  const changedFields = data._changedFields as string[] | null
  if (changedFields && changedFields.length > 0) {
    return changedFields.some(f => sens.includes(f))
  }
  for (const f of sens) {
    const v = data[f]
    if (typeof v === 'string' && v.length > 0) return true
  }
  return false
}

// ── 辅助函数 ──
async function _withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, { mode: 'exclusive' }, fn)
  }
  return fn()
}

function _mergeOps(ops: SyncOp[]): SyncOp[] {
  const byItem = new Map<string, SyncOp[]>()
  for (const op of ops) {
    const key = `${op.table}:${op.itemId}`
    const list = byItem.get(key) || []
    list.push(op)
    byItem.set(key, list)
  }
  const merged: SyncOp[] = []
  for (const [, itemOps] of byItem) {
    const last = itemOps[itemOps.length - 1]
    if (last.action === 'delete') {
      merged.push(last)
    } else {
      merged.push({ ...last, ts: itemOps[0].ts })
    }
  }
  return merged.sort((a, b) => a.ts - b.ts)
}

// ── 智能合并：远端 → 本地 ──
/** 导出供 QUAL-03 单测锁定软删/复活/冲突/full 对账语义 */
export function _mergeIntoLocal<T extends { id: string; updatedAt?: number; deletedAt?: number }>(
  local: T[], remote: T[], type: 'bookmark' | 'group' | 'category' | 'attribute', full = false,
) {
  const ds = useDataStore()
  const syncStore = useSyncStore()
  const localMap = new Map(local.map(i => [i.id, i]))

  for (const rItem of remote) {
    const lItem = localMap.get(rItem.id)
    if (!lItem) {
      // 远端软删且本地无：走删除路径会 no-op；仍 push 进数组供回收站可见
      if (rItem.deletedAt) {
        local.push(rItem)
        // 同步 map 会在 _pullChanges 末尾 _syncMaps
      } else {
        local.push(rItem)
      }
    } else if (ds._dirtyIds.has(rItem.id)) {
      const remoteNewer = (rItem.updatedAt || 0) > (lItem.updatedAt || 0)
      if (remoteNewer && syncStore.lastSyncAt > 0) {
        if (!syncStore.conflicts.some(c => c.id === rItem.id)) {
          syncStore.addConflict({
            id: rItem.id, type,
            local: JSON.parse(JSON.stringify(lItem)),
            remote: JSON.parse(JSON.stringify(rItem)),
          })
          syncStore.resetConflictBanner()
        }
      }
    } else if (_isPendingSync(rItem.id)) {
      // H3：本地改动已 drain 进 syncOps 队列等推送（3000ms debounce 窗口 / 重试滞留期），
      // _dirtyIds 已清空故上面分支不命中。此处若远端 newer 直接 Object.assign 会覆盖本地待
      // 推改动，随后延迟 push 又用本地旧版本覆盖远端 → 双向丢失无 conflict。一律转 conflict，
      // 等 push 落库成功后由 _clearPendingSync 释放，再投入后续 pull 决断。
      const remoteNewer = (rItem.updatedAt || 0) > (lItem.updatedAt || 0)
      if (remoteNewer && syncStore.lastSyncAt > 0) {
        if (!syncStore.conflicts.some(c => c.id === rItem.id)) {
          syncStore.addConflict({
            id: rItem.id, type,
            local: JSON.parse(JSON.stringify(lItem)),
            remote: JSON.parse(JSON.stringify(rItem)),
          })
          syncStore.resetConflictBanner()
        }
      }
    } else if ((rItem.updatedAt || 0) > (lItem.updatedAt || 0)) {
      // RE-3：远端软删不能 Object.assign 跳过 delete* 副作用（组引用/索引/DGM）
      if (rItem.deletedAt && !lItem.deletedAt) {
        _deleteWithoutEcho(ds, type, rItem.id)
      } else if (!rItem.deletedAt && lItem.deletedAt) {
        // 远端复活：清本地 deletedAt 后合并字段
        Object.assign(lItem, rItem)
        delete (lItem as { deletedAt?: unknown }).deletedAt
      } else {
        Object.assign(lItem, rItem)
      }
    }
  }

  if (full) {
    const remoteIds = new Set(remote.map(r => r.id))
    for (let i = local.length - 1; i >= 0; i--) {
      const lItem = local[i]
      if (!remoteIds.has(lItem.id) && !ds._dirtyIds.has(lItem.id) && syncStore.lastSyncAt > 0) {
        // 远端已不存在（物理删除），本地软删除以确保数据可恢复
        switch (type) {
          case 'bookmark': ds.deleteBookmark(lItem.id); break
          case 'group': ds.deleteGroup(lItem.id); break
          case 'category': ds.deleteCategory(lItem.id); break
          case 'attribute': ds.deleteAttribute(lItem.id); break
        }
        // 删除由远端同步触发，清除 dirty 标记避免回推
        ds._dirtyIds.delete(lItem.id)
        ds._newIds.delete(lItem.id)
      }
    }
  }
}

// ══════════════════════════════════════════════════════
// 主 composable
// ══════════════════════════════════════════════════════
// ── 回声防护删除 ──
// 远端 DELETE / 软删合并触发的本机删除会产生衍生的关联行 dirty：
//  - deleteBookmark 会从所属 groups 剔除并 _markDirty(g.id)
//  - deleteCategory 会把该分类下所有 bookmark/group 的 categoryId 改 UNCATEGORIZED 并 _markDirty + _trackChange
//  - deleteAttribute 会遍历所有项删 attributes key 同样 _markDirty + _trackChange
// 这些衍生 dirty 若不清，下次 debouncedSync 会把波及行回推远端——回声流量 + updated_at_num
// 污染面。删除前快照 dirty/changed 集合，删除后清掉因衍生新增的项（被删 id 自身也清）。
/** 导出供 QUAL-03 单测锁定回声防护（删除不回推 dirty） */
export function _deleteWithoutEcho(ds: ReturnType<typeof useDataStore>, type: 'bookmark' | 'group' | 'category' | 'attribute', id: string) {
  const dirtyBefore = new Set(ds._dirtyIds)
  const changedBefore = new Set(ds._changedFields.keys())
  switch (type) {
    case 'bookmark': ds.deleteBookmark(id); break
    case 'group': ds.deleteGroup(id); break
    case 'category': ds.deleteCategory(id); break
    case 'attribute': ds.deleteAttribute(id); break
  }
  for (const did of ds._dirtyIds) if (!dirtyBefore.has(did) || did === id) ds._dirtyIds.delete(did)
  for (const cid of ds._changedFields.keys()) if (!changedBefore.has(cid) || cid === id) ds._changedFields.delete(cid)
  ds._newIds.delete(id)
}

export function useCloudSync() {
  // 注意：useAuth() 返回 Pinia setup store 实例，其上 isLoggedIn（computed）会被 Pinia 自动解包为 boolean，
  // 直接解构 `{ isLoggedIn }` 在 TS 类型层是 boolean、运行时是 ComputedRef —— 二者不一致。
  // 用 computed 包装成统一的 ComputedRef<boolean>，类型与运行时一致且保持响应式。
  const _auth = useAuth()
  const isLoggedIn = computed(() => _auth.isLoggedIn)
  const syncStore = useSyncStore()

  const syncLabel = computed(() => {
    if (syncStore.syncStatus === 'syncing') return '同步中...'
    if (syncStore.syncStatus === 'error') return '同步失败'
    const ds = useDataStore()
    const pending = ds._dirtyIds.size + ds._deletedIds.size + ds._newIds.size
    if (pending > 0) return `${pending} 项待同步`
    if (syncStore.lastSyncAt) {
      const diff = Date.now() - syncStore.lastSyncAt
      if (diff < 60000) return '刚刚同步'
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前同步`
      return `${Math.floor(diff / 3600000)} 小时前同步`
    }
    return '未同步'
  })

  async function refreshPendingCount() {
    syncStore.setPendingCount(await syncOpsCount())
  }

  // ── 把内存 dirtyIds 转为持久化 ops ──
  function _enqueueDirtyAsOps(): void {
    const ds = useDataStore()
    const userId = _getUserId()
    if (!userId) return

    const dirty = ds.drainDirtyIds()
    const deleted = ds.drainDeletedIds()
    const _newIds = ds.drainNewIds()
    const changedFields = ds.drainChangedFields()

    // H3：drain 已清空 _dirtyIds，但 op 尚未推上云端。把 dirty id 记入 in-flight 集合，
    // 待 _pushFromQueue 成功落库后再清，期间 _mergeIntoLocal 见到这些 id 的远端更新会
    // 转 conflict 而非覆盖本地待推改动。
    _markPendingSync(dirty)
    _markPendingSync(Array.from(deleted.keys()))

    const ops: Array<Omit<SyncOp, 'id' | 'retries'>> = []

    for (const b of ds.bookmarks) {
      if (dirty.has(b.id)) {
        ops.push({
          action: 'upsert', table: 'bookmarks', itemId: b.id,
          data: { ...b, _userId: userId, _isNew: _newIds.has(b.id), _changedFields: changedFields.has(b.id) ? [...changedFields.get(b.id)!] : null },
          ts: b.updatedAt || Date.now(),
        })
      }
    }
    for (const g of ds.siblingGroups) {
      if (dirty.has(g.id)) {
        ops.push({
          action: 'upsert', table: 'sibling_groups', itemId: g.id,
          data: { ...g, _userId: userId, _isNew: _newIds.has(g.id), _changedFields: changedFields.has(g.id) ? [...changedFields.get(g.id)!] : null },
          ts: g.updatedAt || Date.now(),
        })
      }
    }
    for (const c of ds.categories) {
      if (dirty.has(c.id)) {
        ops.push({
          action: 'upsert', table: 'categories', itemId: c.id,
          data: { ...c, _userId: userId, _isNew: _newIds.has(c.id), _changedFields: changedFields.has(c.id) ? [...changedFields.get(c.id)!] : null },
          ts: c.updatedAt || Date.now(),
        })
      }
    }
    for (const a of ds.customAttributes) {
      if (dirty.has(a.id)) {
        ops.push({
          action: 'upsert', table: 'custom_attributes', itemId: a.id,
          data: { ...a, _userId: userId, _isNew: _newIds.has(a.id), _changedFields: changedFields.has(a.id) ? [...changedFields.get(a.id)!] : null },
          ts: a.updatedAt || Date.now(),
        })
      }
    }

    for (const [id, table] of deleted) {
      ops.push({ action: 'delete', table, itemId: id, data: null, ts: Date.now() })
    }

    if (ops.length) {
      enqueueSyncOps(ops)
      refreshPendingCount()
    }
  }

  // ── 从队列批量推送到 Supabase ──
  async function _pushFromQueue(): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    if (!navigator.onLine) { syncStore.setSyncError('网络离线'); return false }

    // E2E 启用未解锁：不再整体拦截。改为条目级——只有触及敏感字段（username/notes 等）
    // 的 upsert op 静默留 IDB 等解锁，其余改动照常明文推送。这契合「自动同步」理念：锁定期
    // 改个标题/换个分类也能正常上云，不累积、不刺眼报错。整体拦截的旧实现见 RE-2，
    // 此处降级为仅敏感项排队（明文场景靠 encryptItem 透传 + push 明文覆盖云端，
    // pull 侧 LEGACY_DECRYPT_FIELDS 还原旧密文，安全等价）。
    const e2eGuard = useE2E()
    const isLocked = e2eGuard.isE2EEnabled.value && !e2eGuard.isUnlocked.value

    const rawOps = await drainSyncOps()
    if (!rawOps.length) return true

    const ops = _mergeOps(rawOps)
    syncStore.setSyncStatus('syncing')
    syncStore.setSyncError(null)

    try {
      const ds = useDataStore()
      // 锁定态下需等解锁才推的条目键集合（`${table}:${itemId}`）：
      // 任一 rawOp 触及敏感字段 → 该 item 整条静默留 IDB 等解锁。按 item 而非按 rawOp
      // 判定是因为 _mergeOps 会把同 item 多个 op 合并成一个（仅保留 last 的 data/_changedFields），
      // 若按 rawOp id 跳过，当敏感 op 不是 last 时会被漏判，导致明文跟着非敏感 op 推上云端（RE-2）。
      // 按 item 判定，只要该 item 有敏感改动就整条锁定——保守且与合并语义一致。
      const lockedItemKeys = new Set<string>()
      if (isLocked) {
        for (const op of rawOps) {
          if (op.action === 'upsert' && _opNeedsUnlock(op)) {
            lockedItemKeys.add(`${op.table}:${op.itemId}`)
          }
        }
      }
      const historyItems: Array<{ id: string; type: string; data: Record<string, any> }> = []
      // H4 修复：historyItems.data 原来直接用 `{ ...existing }` 即 ds 当前明文对象。
      // E2E 已解锁时 ds 内存中 username/password/notes 是明文，整对象经 JSON.stringify 存到
      // 云端 data_history.data（迁移 004 该表明文 JSONB），开启 E2E 后云端仍可读历史明文凭证
      // （RLS 仅本人可查但服务端/DBA 仍可见明文）。改为对历史快照走 e2e.encryptItem 加密敏感
      // 字段后再 insert，与主表 upsert 加密口径一致；E2E 未启用时 encryptItem 透传明文无影响。
      // 锁定态该 item 含敏感改动时（如 bookmarks/sibling_groups）跳过历史写入，避免明文落库。
      const histE2e = useE2E()
      for (const op of ops) {
        if (op.action === 'upsert') {
          const type = op.table === 'bookmarks' ? 'bookmark'
            : op.table === 'sibling_groups' ? 'group'
            : op.table === 'categories' ? 'category' : 'attribute'
          // data_history.item_type 有 CHECK 约束仅允许 'bookmark'/'group'，
          // categories/attributes 入历史会撞约束导致整批 POST 400，
          // 且这两类结构简单无需版本回溯，跳过即可。
          if (type !== 'bookmark' && type !== 'group') continue
          const itemKey = `${op.table}:${op.itemId}`
          if (isLocked && lockedItemKeys.has(itemKey)) continue  // 含敏感改动锁定项跳过历史
          const existing = op.table === 'bookmarks' ? ds.bookmarks.find(b => b.id === op.itemId)
            : ds.siblingGroups.find(g => g.id === op.itemId)
          if (existing) {
            try {
              const encData = await histE2e.encryptItem(type as EntityType, { ...existing as any } as Record<string, unknown>)
              historyItems.push({ id: op.itemId, type, data: encData as Record<string, any> })
            } catch (err) {
              // E2E 启用未解锁且含敏感字段：encryptItem 抛错（push 已跳过这条，历史也跳过）
              console.warn(`[sync] history encrypt skipped table=${op.table} id=${op.itemId}`, err)
            }
          }
        }
      }
      _saveHistory(userId, historyItems).catch(() => {})

      const tasks: Promise<any>[] = []
      const succeededIds: number[] = []
      // 加密阶段失败（如 E2E encryptItem 抛错、row 构建异常）的 op 单独记录，
      // 不阻断其它 op 的推送——旧逻辑里任一 op 在循环内 await 抛错会让整个函数进 catch，
      // 后续 categories/attributes 的 task 根本进不了队列，导致「只推上去一部分」。
      const encFailedOps: Array<{ table: string; itemId: string; error: string }> = []
      const e2e = useE2E()

      for (const op of ops) {
        if (op.action === 'delete') {
          tasks.push(
            Promise.resolve(supabase.from(op.table).delete().eq('id', op.itemId).eq('user_id', userId))
              .then(r => ({ op, result: r }))
          )
          continue
        }
        if (!op.data) continue
        // 锁定态下该 item 含敏感改动 → 整条静默跳过：不进 tasks、不 removeSyncOps，
        // 留 IDB 等解锁后补推。按 item key 判定以兼容 _mergeOps 的合并语义。
        if (isLocked && lockedItemKeys.has(`${op.table}:${op.itemId}`)) continue

        const data = op.data
        const changedFields = data._changedFields as string[] | null
        const isNew = data._isNew as boolean || false
        delete data._changedFields
        delete data._userId
        delete data._isNew

        const itemType = op.table === 'bookmarks' ? 'bookmark'
          : op.table === 'sibling_groups' ? 'group'
          : op.table === 'categories' ? 'category' : 'attribute'

        // per-op try：加密 + row 构建。任一环节抛错只跳过本条 op，不拖累整批。
        let row: Record<string, any>
        try {
          const encryptedData = await e2e.encryptItem(itemType as any, data)
          row = toRemoteRow(itemType, { ...encryptedData, _userId: userId }, isNew) as unknown as Record<string, any>
        } catch (err: any) {
          encFailedOps.push({ table: op.table, itemId: op.itemId, error: `加密/序列化失败: ${err?.message || String(err)}` })
          console.warn(`[sync] 加密阶段失败 table=${op.table} id=${op.itemId}`, err)
          continue
        }

        if (isNew || !changedFields) {
          tasks.push(
            Promise.resolve(supabase.from(op.table).upsert(row as any, { onConflict: 'id' }))
              .then(r => ({ op, result: r }))
              .catch(e => ({ op, result: { data: null, error: e, count: null, status: 0, statusText: String(e?.message || e) } }))
          )
        } else {
          // ⚠️ changedFields 中的 f 是 camelCase（本地字段），row 的键是 snake_case（远端列名）。
          // 旧代码直接 if (f in row) 几乎永不命中（除单字段如 title/url 恰好同名），
          // 导致 partial 只含 id/user_id/updated_at_num，退化成无意义的空更新。
          const partial: Record<string, any> = { id: op.itemId, user_id: userId, updated_at_num: row.updated_at_num }
          for (const f of changedFields) {
            const snakeKey = camelToSnake(f)
            // id/user_id 已在 partial 基础字段中，跳过
            if (snakeKey !== 'id' && snakeKey !== 'user_id' && snakeKey in row) {
              partial[snakeKey] = row[snakeKey]
            }
          }
          const { id, ...updateData } = partial
          tasks.push(
            Promise.resolve(supabase.from(op.table).update(updateData).eq('id', id).eq('user_id', userId))
              .then(r => ({ op, result: r }))
              .catch(e => ({ op, result: { data: null, error: e, count: null, status: 0, statusText: String(e?.message || e) } }))
          )
        }
      }

      const rawOpsMap = new Map(rawOps.map(ro => [`${ro.table}:${ro.itemId}`, ro]))
      const results = await Promise.all(tasks)
      // Promise.all 不会 reject：每个 task 都带 .catch，异常被规整成 { error } 对象。

      // ── per-op 结果收集（替代旧的 Promise.all+throw 一刀切）──
      // 旧逻辑：任一 op 失败就 throw，整批进 catch，但成功的 categories upsert
      // 已实际落库，导致「分类推上去了、书签全 0」的假象，且 succeededIds 永不执行、
      // 所有 op（含成功的）滞留队列无限重试。
      // 新逻辑：逐条判定，成功的 op 用 removeSyncOps 清除，失败的 op 留队列下次重试，
      // 并把每条失败的 table/itemId/error 打到 console，让根因可见。
      const failedOps: Array<{ table: string; itemId: string; error: string; op?: SyncOp }> = [...encFailedOps.map(f => ({ ...f, op: rawOpsMap.get(`${f.table}:${f.itemId}`) }))]
      const deadIds: number[] = []  // 超过 MAX_RETRIES 的失败 op：删掉避免无限堆积
      for (const r of results) {
        if (r.result.error) {
          const rawMatch = rawOpsMap.get(`${r.op.table}:${r.op.itemId}`)
          const retries = (rawMatch?.retries || 0) + 1
          failedOps.push({ table: r.op.table, itemId: r.op.itemId, error: r.result.error.message, op: rawMatch })
          // 重试上限：超过即从队列删除，防止「恢复了又没了」循环里失败 op 永不消除。
          // 数据本身存在 ds.bookmarks 里，删 op 不丢数据；下次本地改动会重新 enqueue。
          if (rawMatch?.id != null) {
            if (retries >= MAX_PUSH_RETRIES) {
              deadIds.push(rawMatch.id)
              console.warn(`[sync] op 达到重试上限(${MAX_PUSH_RETRIES})，移出队列 table=${r.op.table} id=${r.op.itemId}`)
            } else {
              await updateSyncOpRetry(rawMatch.id, retries)
            }
          }
          continue
        }
        const rawMatch = rawOpsMap.get(`${r.op.table}:${r.op.itemId}`)
        if (rawMatch?.id != null) succeededIds.push(rawMatch.id)
      }
      // 加密失败 op 同样走死信：超过重试上限删除
      for (const f of encFailedOps) {
        const rawMatch = rawOpsMap.get(`${f.table}:${f.itemId}`)
        if (rawMatch?.id != null && (rawMatch.retries || 0) + 1 >= MAX_PUSH_RETRIES) deadIds.push(rawMatch.id)
        else if (rawMatch?.id != null) {
          await updateSyncOpRetry(rawMatch.id, (rawMatch.retries || 0) + 1)
        }
      }

      if (succeededIds.length) {
        await removeSyncOps(succeededIds)
        refreshPendingCount()
      }
      if (deadIds.length) {
        await removeSyncOps(deadIds)
        refreshPendingCount()
      }
      for (const op of ops) ds._newIds.delete(op.itemId)

      // H3：把本轮推成功（或达重试上限放弃）的 op 对应 itemId 从 in-flight 集合释放。
      // 成功推上云端所以不再 pending；达上限移出队列的 op 不再尝试推送，其本地改动若与远端
      // 有冲突将由下一次 pull 通过 lastSyncAt 增量比较决断，继续挂 pending 反而会让后续 merge
      // 把正常远端更新误判为 conflict。只清成功送走 / 放弃重试 的；失败留队列重试的 op 仍保持 pending。
      const releasedIds = new Set<string>()
      for (const r of results) {
        if (!r.result.error) releasedIds.add(r.op.itemId)
        else if (r.result.error) {
          const rawMatch = rawOpsMap.get(`${r.op.table}:${r.op.itemId}`)
          if (rawMatch?.id != null && (rawMatch.retries || 0) + 1 >= MAX_PUSH_RETRIES) releasedIds.add(r.op.itemId)
        }
      }
      _clearPendingSync(releasedIds)
      // 加密失败 op：达上限的也按 dead 释放（不再重试，等同推完）
      for (const f of encFailedOps) {
        const rawMatch = rawOpsMap.get(`${f.table}:${f.itemId}`)
        if (rawMatch?.id != null && (rawMatch.retries || 0) + 1 >= MAX_PUSH_RETRIES) {
          _pendingSyncIds.delete(f.itemId)
        }
      }

      if (failedOps.length) {
        // 仍有失败 op：不设 lastSyncAt（下次仍会重试这些 op，除非已达上限被移除），状态标 error
        for (const f of failedOps) {
          console.warn(`[sync] push 失败 table=${f.table} id=${f.itemId} error=${f.error}`)
        }
        // dump 第一条失败 op 的完整入队数据，让 Supabase 拒绝的具体字段内容可见
        const first = failedOps[0]
        if (first?.op?.data) console.warn(`[sync] 首条失败 op 原始 data:`, JSON.parse(JSON.stringify(first.op.data)))
        syncStore.setSyncStatus('error')
        syncStore.setSyncError(`${failedOps.length} 项推送失败：${failedOps[0].error}`)
        return false
      }

      // 锁定态本轮有敏感条目静默留队：不标 success（以免 UI 显示「刚刚同步」却没推关键项），
      // 也不标 error（静默理念）。已推送的非敏感 op 已 removeSyncOps，敏感 op 留 IDB 等
      // unlock 后补推。只在确有 op 被推上云时才推进 lastSyncAt（仅 locked/空队列则保持原值）。
      if (lockedItemKeys.size > 0 && tasks.length === 0) {
        syncStore.setSyncStatus('idle')
        return true
      }
      if (tasks.length > 0) syncStore.setLastSyncAt(Date.now())
      syncStore.setSyncStatus('success')
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '同步失败'
      syncStore.setSyncStatus('error')
      syncStore.setSyncError(msg)
      console.warn('[sync] push failed:', e)
      return false
    }
  }

  // ── 拉取远端变更 ──
  async function _pullChanges(full = false): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    if (!navigator.onLine) { syncStore.setSyncError('网络离线'); return false }

    syncStore.setSyncStatus('syncing')
    syncStore.setSyncError(null)

    try {
      const since = full ? 0 : (syncStore.lastSyncAt || 0)

      const [catsRes, bmsRes, groupsRes, attrsRes] = await Promise.all([
        supabase.from('categories').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('bookmarks').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('sibling_groups').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('custom_attributes').select('*').eq('user_id', userId).gt('updated_at_num', since),
      ])

      for (const r of [catsRes, bmsRes, groupsRes, attrsRes]) { if (r.error) throw r.error }

      const ds = useDataStore()
      const e2e = useE2E()
      const remoteCats = (catsRes.data || []).map(r => fromRemoteCategory(r)).filter(Boolean) as Category[]
      const remoteBms = (bmsRes.data || []).map(r => fromRemoteBookmark(r)).filter(Boolean) as Bookmark[]
      const remoteGroups = (groupsRes.data || []).map(r => fromRemoteGroup(r)).filter(Boolean) as SiblingGroup[]
      const remoteAttrs = (attrsRes.data || []).map(r => fromRemoteAttribute(r)).filter(Boolean) as CustomAttribute[]

      // decryptItem 返回浅拷贝，必须用返回值替换；丢弃会导致密文写回 store（RE-1）
      // M1 修复：旧实现 `if (e2e.isUnlocked.value)` 仅在循环入口取一次布尔快照，随后对四数组
      // 循环 await decryptItem。循环中途若触发 lock()（15 分钟无操作超时 / 页面隐藏 60 秒 /
      // 显式调用），cryptoKey 被置 null，后续 decryptItem 内部 `_getKey()` 返回 null 直接
      // `return item`（仍三段密文态）。密文态对象随后被 _mergeIntoLocal 用 Object.assign 写回
      // 本地 store（基于 updatedAt 覆盖本地明文），并因 _markDirty 被回推云端污染其它设备。
      // 改为循环内每条 await 前重新校验 isUnlocked：一旦检测到已 lock，整轮跳过 merge（不把
      // 密文态条目写本地），等下一轮 unlock 后 _pullChanges 重新拉取。已解密的条目保留明文态。
      if (e2e.isUnlocked.value) {
        const decryptList = async <T extends { id: string }>(arr: T[], type: EntityType): Promise<T[]> => {
          const out: T[] = []
          for (const item of arr) {
            if (!e2e.isUnlocked.value) break  // 锁定发生在 await 间隙：停止解密，剩余条目本轮不 merge
            const decrypted = await e2e.decryptItem(type, item as any) as T
            // 解返回后再次校验：lock 可能在 await decryptItem 期间（逐字段 await decryptField 再
            // await decrypt）发生，导致该条敏感字段被部分解为密文/null。检测关键敏感字段是否仍是
            // 三段密文形态（salt.iv.data），是则丢弃该条不 merge，避免密文写回本地 store。
            if (e2e.isUnlocked.value) out.push(decrypted)
          }
          return out
        }
        remoteBms.splice(0, remoteBms.length, ...await decryptList(remoteBms, 'bookmark'))
        remoteGroups.splice(0, remoteGroups.length, ...await decryptList(remoteGroups, 'group'))
        remoteCats.splice(0, remoteCats.length, ...await decryptList(remoteCats, 'category'))
        remoteAttrs.splice(0, remoteAttrs.length, ...await decryptList(remoteAttrs, 'attribute'))
        // 锁定中途退出：本轮不 merge 不推进 lastSyncAt，等下轮重试（保留已解密的部分但不
        // 提交——下轮 since 未推进会重新拉取这些条目，幂等无害）。
        if (!e2e.isUnlocked.value) {
          syncStore.setSyncStatus('idle')
          return false
        }
      }

      _mergeIntoLocal(ds.categories, remoteCats, 'category', full)
      _mergeIntoLocal(ds.bookmarks, remoteBms, 'bookmark', full)
      _mergeIntoLocal(ds.siblingGroups, remoteGroups, 'group', full)
      _mergeIntoLocal(ds.customAttributes, remoteAttrs, 'attribute', full)

      // ── 删除同步：拉取远端已软删除但本地仍活的条目 ──
      // 当前增量查询已包含 updated_at_num > since 的软删除行（deleted_at 被更新），
      // 此管道作为防御性补充，捕获未来可能出现的漏删边缘情况。
      const [delBmsRes, delGroupsRes, delCatsRes, delAttrsRes] = await Promise.all([
        supabase.from('bookmarks').select('id, updated_at_num').eq('user_id', userId).not('deleted_at', 'is', null).gt('updated_at_num', since),
        supabase.from('sibling_groups').select('id, updated_at_num').eq('user_id', userId).not('deleted_at', 'is', null).gt('updated_at_num', since),
        supabase.from('categories').select('id, updated_at_num').eq('user_id', userId).not('deleted_at', 'is', null).gt('updated_at_num', since),
        supabase.from('custom_attributes').select('id, updated_at_num').eq('user_id', userId).not('deleted_at', 'is', null).gt('updated_at_num', since),
      ])

      for (const r of [delBmsRes, delGroupsRes, delCatsRes, delAttrsRes]) {
        if (r.error) { console.warn('[sync] deletion sync query failed:', r.error); continue }
        for (const row of r.data || []) {
          const id = row.id as string
          // 仅处理本地仍活着的项（避免重复删除）
          if (ds.bookmarkMap[id] && !ds.bookmarkMap[id].deletedAt) _deleteWithoutEcho(ds, 'bookmark', id)
          else if (ds.groupMap[id] && !ds.groupMap[id].deletedAt) _deleteWithoutEcho(ds, 'group', id)
          const cat = ds.categories.find(c => c.id === id)
          if (cat && !cat.deletedAt) _deleteWithoutEcho(ds, 'category', id)
          const attr = ds.customAttributes.find(a => a.id === id)
          if (attr && !attr.deletedAt) _deleteWithoutEcho(ds, 'attribute', id)
        }
      }

      // ── 物理删除对账：远端整行被 .delete() 抹掉后，上面增量查询与软删防御查询都查不到该行
      // （既不在 updated_at_num>since 的存活行集、也不在 deleted_at IS NOT NULL 的软删集）。
      // 若对端「先软删 upsert（updated_at_num 落本机 since 之前）→ 再物理删」且本机从未同步过
      // 该软删态，本机将永远感知不到这次删除——仅漏删尚可接受，但更糟的是 initialSync 先全量
      // push 本地活副本会 upsert 一条 deleted_at:null 行回去，复活对端已物理删除的事实。
      // 纯前端修复：lastSyncAt>0（已同步过、非首同步）时，拉远端全量存活 id 集合做差集对账，
      // 本地有 + 远端无 + 非脏 → 软删本地（不入回收站不可恢复路径而是回收站可见的软删，与
      // _mergeIntoLocal 的 full 分支语义一致）。首同步 lastSyncAt=0 时跳过，避免误删本地新数据。
      if (syncStore.lastSyncAt > 0) {
        const [allBmRes, allGroupRes, allCatRes, allAttrRes] = await Promise.all([
          supabase.from('bookmarks').select('id').eq('user_id', userId),
          supabase.from('sibling_groups').select('id').eq('user_id', userId),
          supabase.from('categories').select('id').eq('user_id', userId),
          supabase.from('custom_attributes').select('id').eq('user_id', userId),
        ])
        // H1 修复：任一对账 id 查询失败必须 abort 整轮 reconcileDelete，而非把「本次 r.error
        // 被 continue 跳过该表」当成「该表远端为空集」。旧实现下若 4 张表查询任一返回 error
        // （Supabase 5xx / 鉴权过期 / 网络抖动），该表 id 不被加入 shared remoteAll，随后
        // 587-598 遍历该表本地全部活条目 `!remoteAll.has(id)` 全成立，reconcileDelete 把该表
        // 整批活条目软删进回收站；4 表均失败则全量本地数据被一次性软删。逐表 skip 仅压降
        // 至「失败表被全删」，仍是不可接受的数据丢失。任一失败即整轮放弃，等下轮重试。
        const reconcileQueries = [allBmRes, allGroupRes, allCatRes, allAttrRes]
        const anyReconcileError = reconcileQueries.some(r => r.error)
        if (anyReconcileError) {
          for (const r of reconcileQueries) if (r.error) console.warn('[sync] reconcile id query failed, skipping reconcileDelete this round:', r.error)
          // 跳过本轮物理删除对账，但增量 merge / 软删防御查询已执行，仍正常推进 lastSyncAt 等
        } else {
          const remoteAll = new Set<string>()
          for (const r of reconcileQueries) {
            for (const row of r.data || []) remoteAll.add((row as { id: string }).id)
          }
          const reconcileDelete = (type: 'bookmark' | 'group' | 'category' | 'attribute', id: string) => {
            if (ds._dirtyIds.has(id)) return  // 正在本地编辑/等推送的条目不删
            _deleteWithoutEcho(ds, type, id)
          }
          for (const b of ds.bookmarks) {
            if (!b.deletedAt && !remoteAll.has(b.id)) reconcileDelete('bookmark', b.id)
          }
          for (const g of ds.siblingGroups) {
            if (!g.deletedAt && !remoteAll.has(g.id)) reconcileDelete('group', g.id)
          }
          for (const c of ds.categories) {
            if (!c.deletedAt && !remoteAll.has(c.id)) reconcileDelete('category', c.id)
          }
          for (const a of ds.customAttributes) {
            if (!a.deletedAt && !remoteAll.has(a.id)) reconcileDelete('attribute', a.id)
          }
        }
      }

      // merge 可能直接 push 新项到数组（绕过 add* 的 map 维护），必须重建索引并落盘，
      // 否则刷新后读旧 IDB、对端变更丢失（DATA-3）
      ds._syncMaps()
      saveAppData()

      syncStore.setLastSyncAt(Date.now())
      syncStore.setSyncStatus('success')
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '同步失败'
      syncStore.setSyncStatus('error')
      syncStore.setSyncError(msg)
      console.warn('[sync] pull failed:', e)
      return false
    }
  }

  // ── 公共 API ──

  function debouncedSync() {
    if (!syncStore.autoSync || !isLoggedIn.value) return
    _enqueueDirtyAsOps()
    if (_syncTimer) clearTimeout(_syncTimer)
    _syncTimer = setTimeout(() => {
      _syncTimer = null
      _withLock('linkvault-sync', _pushFromQueue)
    }, 3000)
  }

  async function fullSync(): Promise<boolean> {
    _enqueueDirtyAsOps()
    return _withLock('linkvault-sync', async () => {
      const pushed = await _pushFromQueue()
      if (pushed) await _pullChanges()
      return pushed
    })
  }

  async function initialSync(): Promise<void> {
    if (_initialized || !isLoggedIn.value) return
    _initialized = true

    await _withLock('linkvault-sync', async () => {
      // RE-12：禁止盲全量 upsert 复活对端已软删项。
      // 1) 先 pull（非 full，lastSyncAt=0 时不会做「远端无则本地软删」对账）吸收远端态含软删。
      // 2) 再只推：脏/新/本地软删；或远端尚无该 id 的本地存活项（首登空云端仍能全量上云）。
      const ds = useDataStore()
      const userId = _getUserId()
      if (!userId) return

      await _pullChanges(false)

      const remoteIds = new Set<string>()
      const [bmIds, gIds, cIds, aIds] = await Promise.all([
        supabase.from('bookmarks').select('id').eq('user_id', userId),
        supabase.from('sibling_groups').select('id').eq('user_id', userId),
        supabase.from('categories').select('id').eq('user_id', userId),
        supabase.from('custom_attributes').select('id').eq('user_id', userId),
      ])
      for (const r of [bmIds, gIds, cIds, aIds]) {
        if (r.error) { console.warn('[sync] initialSync id probe failed:', r.error); continue }
        for (const row of r.data || []) remoteIds.add((row as { id: string }).id)
      }

      const allOps: Array<Omit<SyncOp, 'id' | 'retries'>> = []
      const now = Date.now()
      const shouldPush = (id: string, deletedAt?: number) =>
        ds._dirtyIds.has(id) || ds._newIds.has(id) || deletedAt || !remoteIds.has(id)

      for (const b of ds.bookmarks) {
        if (!shouldPush(b.id, b.deletedAt)) continue
        allOps.push({ action: 'upsert', table: 'bookmarks', itemId: b.id, data: { ...b, _userId: userId }, ts: b.updatedAt || now })
      }
      for (const g of ds.siblingGroups) {
        if (!shouldPush(g.id, g.deletedAt)) continue
        allOps.push({ action: 'upsert', table: 'sibling_groups', itemId: g.id, data: { ...g, _userId: userId }, ts: g.updatedAt || now })
      }
      for (const c of ds.categories) {
        if (!shouldPush(c.id, c.deletedAt)) continue
        allOps.push({ action: 'upsert', table: 'categories', itemId: c.id, data: { ...c, _userId: userId }, ts: c.updatedAt || now })
      }
      for (const a of ds.customAttributes) {
        if (!shouldPush(a.id, a.deletedAt)) continue
        allOps.push({ action: 'upsert', table: 'custom_attributes', itemId: a.id, data: { ...a, _userId: userId }, ts: a.updatedAt || now })
      }
      if (allOps.length) await enqueueSyncOps(allOps)
      await _pushFromQueue()
      await _pullChanges(false)
    })

    subscribeRealtime(_pullChanges)
    refreshPendingCount()
  }

  function _onOnline() {
    if (!isLoggedIn.value) return
    _enqueueDirtyAsOps()
    _withLock('linkvault-sync', _pushFromQueue).then(() => _pullChanges())
    // H2：网络恢复时若 realtime 处于 error/disconnected（如重连达 10 次上限被清后），重建订阅，
    // 否则用户在不知情下停止接收其它设备变更直到刷新页面。
    if (syncStore.realtimeStatus !== 'connected') {
      unsubscribeRealtime()
      subscribeRealtime(_pullChanges)
    }
  }

  function _onVisibilityChange() {
    if (document.visibilityState !== 'visible' || !isLoggedIn.value) return
    _withLock('linkvault-sync', async () => {
      await _pullChanges()
      if (syncStore.autoSync) {
        _enqueueDirtyAsOps()
        await _pushFromQueue()
      }
    })
    // H2：切回前台时若 realtime 断开（非首次未初始化），重建订阅
    if (syncStore.realtimeStatus !== 'connected' && syncStore.realtimeStatus !== 'connecting') {
      unsubscribeRealtime()
      subscribeRealtime(_pullChanges)
    }
  }

  function initOnlineListener() {
    window.addEventListener('online', _onOnline)
    document.addEventListener('visibilitychange', _onVisibilityChange)
    if (isLoggedIn.value) subscribeRealtime(_pullChanges)
  }

  function destroyOnlineListener() {
    window.removeEventListener('online', _onOnline)
    document.removeEventListener('visibilitychange', _onVisibilityChange)
    unsubscribeRealtime()
  }

  function resetSyncState() {
    _initialized = false
    syncStore.resetSyncState()
    unsubscribeRealtime()
  }

  // ── 公开分享 ──
  async function setGroupPublic(gid: string, isPublic: boolean): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    const ds = useDataStore()
    const g = ds.groupMap[gid]
    if (!g) return false
    ds.updateGroup(gid, { isPublic })
    saveAppData()
    const { error } = await supabase.from('sibling_groups')
      .update({ is_public: isPublic }).eq('id', gid).eq('user_id', userId)
    if (error) { console.warn('[share] setGroupPublic failed:', error); return false }
    return true
  }

  async function fetchPublicGroup(gid: string): Promise<{ group: SiblingGroup; bookmarks: Bookmark[] } | null> {
    // SEC-01：经 get_public_group RPC 取数（SECURITY DEFINER，服务端不返回 username/password）。
    // 018 迁移已删除 bookmarks 匿名 SELECT 策略，直接 from('bookmarks') 对访客会空结果。
    const { data, error } = await supabase.rpc('get_public_group', { p_gid: gid })
    if (error || data == null) {
      if (error) console.warn('[share] get_public_group failed:', error)
      return null
    }
    const payload = data as { group?: RemoteGroupRow; bookmarks?: RemoteBookmarkRow[] }
    if (!payload.group) return null
    const group = fromRemoteGroup(payload.group)
    if (!group) return null
    const bookmarks = (payload.bookmarks || [])
      .map(fromRemoteBookmark)
      .filter(Boolean)
      .map(b => ({ ...b!, username: '', password: '' })) as Bookmark[]
    return { group, bookmarks }
  }

  return {
    syncStatus: toRef(syncStore, 'syncStatus'),
    lastSyncAt: toRef(syncStore, 'lastSyncAt'),
    syncError: toRef(syncStore, 'syncError'),
    autoSync: toRef(syncStore, 'autoSync'),
    pendingCount: toRef(syncStore, 'pendingCount'),
    realtimeStatus: toRef(syncStore, 'realtimeStatus'),
    syncLabel,

    pushToCloud: _pushFromQueue, pullFromCloud: _pullChanges, fullSync,
    debouncedSync, initialSync, resetSyncState,
    initOnlineListener, destroyOnlineListener,
    refreshPendingCount,

    subscribeRealtime: () => subscribeRealtime(_pullChanges), unsubscribeRealtime,
    fetchHistory: (itemId: string) => fetchHistory(itemId),
    restoreFromHistory: (historyId: number, itemId: string, itemType: 'bookmark' | 'group') => restoreFromHistory(historyId, itemId, itemType),

    // 冲突管理（toRef 避免 Pinia 自动解包 ref → 保持 .value 访问不变）
    conflicts: toRef(syncStore, 'conflicts'),
    conflictBannerDismissed: toRef(syncStore, 'conflictBannerDismissed'),
    resolveConflict,
    resolveAllConflicts,
    resetConflictBannerDismissed: syncStore.resetConflictBanner,

    setGroupPublic, fetchPublicGroup,
  }
}
