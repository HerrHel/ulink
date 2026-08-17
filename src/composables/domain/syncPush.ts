/**
 * syncPush — 队列 drain → port upsert/update/delete
 *
 * 含 _mergeOps、RE-2 锁定敏感字段、per-op 成败、死信 MAX_PUSH_RETRIES。
 */
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { useE2E } from './useE2E.js'
import {
  enqueueSyncOps, drainSyncOps, removeSyncOps, updateSyncOpRetry, syncOpsCount,
  type SyncOp,
} from '../../stores/storage.js'
import type { EntityType } from '../../types.js'
import { toRemoteRow, camelToSnake } from './useSyncMapping.js'
// EntityType used by _opNeedsUnlock callers / ENCRYPT_FIELDS path
import { _saveHistory, _getUserId } from './useSyncHistory.js'
import { getSyncRemotePort, type SyncPortResult } from './syncRemotePort.js'
import { _markPendingSync, _clearPendingSync } from './syncPending.js'

/** 单条 sync op 最大推送重试次数 */
export const MAX_PUSH_RETRIES = 3

/**
 * 锁定态判定所用的敏感字段表,复用 useE2E 的 ENCRYPT_FIELDS 单一来源,
 * 通过 tableToEntityType 把表名映射到 EntityType 查表。避免两份硬编码漂移
 * (一处新增敏感字段另一处漏加 → 锁定态把仍加密的旧密文/明文敏感内容误推云)。
 */
import { ENCRYPT_FIELDS } from './useE2E.js'
import { tableToEntityType, entityTypeToTable, SYNC_ENTITY_ORDER, type TableName } from './syncMappingTables.js'

/** 锁定态下该 upsert op 是否需要等解锁才能安全推送 */
export function _opNeedsUnlock(op: SyncOp): boolean {
  if (!op.data) return false
  const type = tableToEntityType[op.table as TableName]
  const sens: readonly string[] | undefined = type ? ENCRYPT_FIELDS[type] : undefined
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

/** 脱敏 op.data 用于日志输出：复用 ENCRYPT_FIELDS 单一来源确定每类型敏感字段，
 *  值替换为 '[redacted]'，避免 push 失败 warn 把 password/username/notes 等明文
 *  打到控制台（本地调试无碍，但 devtools 共享/错误上报场景是隐私面）。
 *
 *  注意：脱敏集合 ≠ 加密集合。ENCRYPT_FIELDS 刻意把 password 排除（它走
 *  EncryptedPassword 独立链路），但**日志脱敏**必须也盖住 password——E2E 关闭时
 *  op.data.password 就是纯明文字符串，是本系统最敏感的单字段，绝不能漏进 warn。
 *  所以运行时在 ENCRYPT_FIELDS 基础上再补 password（仅日志面，不触碰加密语义）。
 *  不能模块顶层就把两表拼好：useE2E↔syncPush 循环依赖，顶层求值时 useE2E 的
 *  ENCRYPT_FIELDS 可能尚未初始化（undefined），必须推迟到函数调用时才读。 */
const REDACT_EXTRA_FIELDS: Partial<Record<EntityType, readonly string[]>> = {
  bookmark: ['password', 'notes'] as const,
  group: ['notes'] as const,
}

export function _redactOpData(op: SyncOp): Record<string, unknown> | null {
  if (!op.data) return null
  const type = tableToEntityType[op.table as TableName]
  const sens: readonly string[] | undefined = type ? [...ENCRYPT_FIELDS[type], ...(REDACT_EXTRA_FIELDS[type] || [])] : undefined
  const copy = { ...(op.data as Record<string, unknown>) }
  if (sens && sens.length > 0) {
    for (const f of sens) {
      if (f in copy && copy[f] != null && copy[f] !== '') copy[f] = '[redacted]'
    }
  }
  return copy
}

export function _mergeOps(ops: SyncOp[]): SyncOp[] {
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
      // R30：保留历史最大 retries，避免新编辑（retries=0）覆盖旧失败 op 的重试计数，
      // 导致死信阈值被绕过（持续编辑的坏 op 永不进死信，持续重试+错误态长期误导）。
      // 用 for 循环而非 Math.max(...spread)：同 table:itemId 在极端长跑/自动测试场景
      // 可能堆积超长 raw ops 数组，spread 到 apply 会爆调用栈（V8 ~6.5万~12.5万参数门槛）。
      let maxRetries = 0
      for (const o of itemOps) { const r = o.retries || 0; if (r > maxRetries) maxRetries = r }
      merged.push({ ...last, ts: itemOps[0].ts, retries: maxRetries })
    }
  }
  return merged.sort((a, b) => a.ts - b.ts)
}

async function refreshPendingCount() {
  useSyncStore().setPendingCount(await syncOpsCount())
}

/** 把内存 dirtyIds 转为持久化 ops（H3 标记 pending） */
export function enqueueDirtyAsOps(): void {
  const ds = useDataStore()
  const userId = _getUserId()
  if (!userId) return

  const dirty = ds.drainDirtyIds()
  const deleted = ds.drainDeletedIds()
  const _newIds = ds.drainNewIds()
  const changedFields = ds.drainChangedFields()

  _markPendingSync(dirty)
  _markPendingSync(Array.from(deleted.keys()))

  const ops: Array<Omit<SyncOp, 'id' | 'retries'>> = []

  const localByType: Record<EntityType, Array<{ id: string; updatedAt?: number }>> = {
    category: ds.categories,
    bookmark: ds.bookmarks,
    group: ds.siblingGroups,
    attribute: ds.customAttributes,
  }
  for (const type of SYNC_ENTITY_ORDER) {
    const table = entityTypeToTable[type]
    for (const item of localByType[type]) {
      if (!dirty.has(item.id)) continue
      ops.push({
        action: 'upsert', table, itemId: item.id,
        data: {
          ...item, _userId: userId, _isNew: _newIds.has(item.id),
          _changedFields: changedFields.has(item.id) ? [...changedFields.get(item.id)!] : null,
        },
        ts: item.updatedAt || Date.now(),
      })
    }
  }

  for (const [id, table] of deleted) {
    ops.push({ action: 'delete', table, itemId: id, data: null, ts: Date.now() })
  }

  if (ops.length) {
    // 与历史行为一致：不等待 IDB 写完即返回；refresh 异步更新 badge
    void enqueueSyncOps(ops)
    void refreshPendingCount()
  }
}

/** 从队列批量推送到远端 port */
export async function pushFromQueue(): Promise<boolean> {
  const syncStore = useSyncStore()
  const userId = _getUserId()
  if (!userId) return false
  if (!navigator.onLine) { syncStore.setSyncError('网络离线'); return false }

  const e2eGuard = useE2E()
  const isLocked = e2eGuard.isE2EEnabled.value && !e2eGuard.isUnlocked.value

  const rawOps = await drainSyncOps()
  if (!rawOps.length) return true

  const ops = _mergeOps(rawOps)
  syncStore.setSyncStatus('syncing')
  syncStore.setSyncError(null)

  try {
    const ds = useDataStore()
    const lockedItemKeys = new Set<string>()
    if (isLocked) {
      for (const op of rawOps) {
        if (op.action === 'upsert' && _opNeedsUnlock(op)) {
          lockedItemKeys.add(`${op.table}:${op.itemId}`)
        }
      }
    }
    const historyItems: Array<{ id: string; type: string; data: Record<string, unknown> }> = []
    const histE2e = useE2E()
    const existingByType: Record<'bookmark' | 'group', (id: string) => unknown> = {
      bookmark: (id) => ds.bookmarkMap[id],
      group: (id) => ds.groupMap[id],
    }
    for (const op of ops) {
      if (op.action === 'upsert') {
        const type = tableToEntityType[op.table as TableName]
        if (type !== 'bookmark' && type !== 'group') continue
        const itemKey = `${op.table}:${op.itemId}`
        if (isLocked && lockedItemKeys.has(itemKey)) continue
        const existing = existingByType[type](op.itemId)
        if (existing) {
          try {
            const encData = await histE2e.encryptItem(type as EntityType, { ...(existing as Record<string, unknown>) })
            historyItems.push({ id: op.itemId, type, data: encData })
          } catch (err) {
            console.warn(`[sync] history encrypt skipped table=${op.table} id=${op.itemId}`, err)
          }
        }
      }
    }
    _saveHistory(userId, historyItems).catch(() => {})

    const tasks: Promise<{ op: SyncOp; result: SyncPortResult }>[] = []
    const succeededIds: number[] = []
    // encFailedOps 保留对应 merged op 引用：retry 决策需用 merged.retries（即 _mergeOps 算的
    // maxRetries），而非末条 raw.retries（与 _mergeOps 不对称会致死信计数漂移，见 cleanup 段）。
    const encFailedOps: Array<{ table: string; itemId: string; error: string; op: SyncOp }> = []
    const e2e = useE2E()
    const port = getSyncRemotePort()

    for (const op of ops) {
      if (op.action === 'delete') {
        tasks.push(
          port.delete(op.table, op.itemId, userId)
            .then(r => ({ op, result: r }))
            .catch(e => ({ op, result: { data: null, error: { message: String(e?.message || e) } } })),
        )
        continue
      }
      if (!op.data) continue
      if (isLocked && lockedItemKeys.has(`${op.table}:${op.itemId}`)) continue

      const data = op.data
      const changedFields = data._changedFields as string[] | null
      const isNew = data._isNew as boolean || false
      delete data._changedFields
      delete data._userId
      delete data._isNew

      const itemType = tableToEntityType[op.table as TableName]
      if (!itemType) continue

      let row: Record<string, unknown>
      try {
        const encryptedData = await e2e.encryptItem(itemType, data)
        row = toRemoteRow(itemType, { ...encryptedData, _userId: userId }, isNew) as unknown as Record<string, unknown>
      } catch (err) {
        encFailedOps.push({ table: op.table, itemId: op.itemId, error: `加密/序列化失败: ${err instanceof Error ? err.message : String(err)}`, op })
        console.warn(`[sync] 加密阶段失败 table=${op.table} id=${op.itemId}`, err)
        continue
      }

      if (isNew || !changedFields) {
        tasks.push(
          port.upsert(op.table, row)
            .then(r => ({ op, result: r }))
            .catch(e => ({ op, result: { data: null, error: { message: String(e?.message || e) } } })),
        )
      } else {
        const partial: Record<string, unknown> = { id: op.itemId, user_id: userId, updated_at_num: row.updated_at_num }
        for (const f of changedFields) {
          const snakeKey = camelToSnake(f)
          if (snakeKey !== 'id' && snakeKey !== 'user_id' && snakeKey in row) {
            partial[snakeKey] = row[snakeKey]
          }
        }
        const { id, ...updateData } = partial
        tasks.push(
          port.update(op.table, id as string, userId, updateData)
            .then(r => ({ op, result: r }))
            .catch(e => ({ op, result: { data: null, error: { message: String(e?.message || e) } } })),
        )
      }
    }

    // 同 table:itemId 的全部 raw op（多值）——merge 把多条 raw 合并为 1 条 merged op
    // （_mergeOps: data=last, retries=max），cleanup 必须把同 key 的全部 raw 一并处理：
    // 成功则同 key 全部 raw 出队（否则其余成 orphan 留队无限重推 + badge 永驻「N 项待同步」），
    // 失败则同 key 全部 raw 同步 retry+1（用 merged.retries=max 而非末条 raw.retries，
    // 与 _mergeOps 死信判定对称，否则持续编辑的坏 op 多绕几轮才进死信）。
    const rawsByKey = new Map<string, SyncOp[]>()
    for (const ro of rawOps) {
      const k = `${ro.table}:${ro.itemId}`
      const arr = rawsByKey.get(k) || []
      arr.push(ro)
      rawsByKey.set(k, arr)
    }
    const rawsOf = (table: string, itemId: string) => rawsByKey.get(`${table}:${itemId}`) ?? []
    const results = await Promise.all(tasks)

    const failedOps: Array<{ table: string; itemId: string; error: string; op?: SyncOp }> = [
      ...encFailedOps.map(f => ({ ...f })),
    ]
    const deadIds: number[] = []
    // 收集 retry+1 后的 raw id 写回队列（非死信路径）
    const retryUpdateOps: Array<{ id: number; retries: number }> = []
    for (const r of results) {
      // 无匹配 update 视失败：Supabase update 不命中行时返 { data:null, error:null }，
      // 仅靠 error 会被误判成功而永久出队，丢本地变更。port 层透传 count：0=无匹配行。
      const noMatch = r.result.count === 0
      if (r.result.error || noMatch) {
        // r.op 是 _mergeOps 产出的 merged op（含 retries=max），用它做死信判定与下轮 retry 计数
        const nextRetry = (r.op.retries || 0) + 1
        const keyRaws = rawsOf(r.op.table, r.op.itemId)
        failedOps.push({
          table: r.op.table,
          itemId: r.op.itemId,
          error: noMatch ? 'update 未匹配远端行（行已删/不存在/RLS 拒绝）' : r.result.error!.message,
          op: r.op,
        })
        if (nextRetry >= MAX_PUSH_RETRIES) {
          console.warn(`[sync] op 达到重试上限(${MAX_PUSH_RETRIES})，移出队列 table=${r.op.table} id=${r.op.itemId}`)
          for (const rw of keyRaws) if (rw.id != null) deadIds.push(rw.id)
        } else {
          for (const rw of keyRaws) if (rw.id != null) retryUpdateOps.push({ id: rw.id, retries: nextRetry })
        }
        continue
      }
      const keyRaws = rawsOf(r.op.table, r.op.itemId)
      for (const rw of keyRaws) if (rw.id != null) succeededIds.push(rw.id)
    }
    for (const f of encFailedOps) {
      const nextRetry = (f.op.retries || 0) + 1
      const keyRaws = rawsOf(f.table, f.itemId)
      if (nextRetry >= MAX_PUSH_RETRIES) {
        for (const rw of keyRaws) if (rw.id != null) deadIds.push(rw.id)
      } else {
        for (const rw of keyRaws) if (rw.id != null) retryUpdateOps.push({ id: rw.id, retries: nextRetry })
      }
    }
    for (const { id, retries } of retryUpdateOps) await updateSyncOpRetry(id, retries)

    if (succeededIds.length) {
      await removeSyncOps(succeededIds)
      await refreshPendingCount()
    }
    if (deadIds.length) {
      await removeSyncOps(deadIds)
      await refreshPendingCount()
    }
    for (const op of ops) ds._newIds.delete(op.itemId)

    const releasedIds = new Set<string>()
    for (const r of results) {
      const noMatch = r.result.count === 0
      if (!r.result.error && !noMatch) releasedIds.add(r.op.itemId)
      else {
        const nextRetry = (r.op.retries || 0) + 1
        if (nextRetry >= MAX_PUSH_RETRIES) releasedIds.add(r.op.itemId)
      }
    }
    _clearPendingSync(releasedIds)
    for (const f of encFailedOps) {
      const nextRetry = (f.op.retries || 0) + 1
      if (nextRetry >= MAX_PUSH_RETRIES) {
        releasedIds.add(f.itemId)
        _clearPendingSync([f.itemId])
      }
    }

    if (failedOps.length) {
      for (const f of failedOps) {
        console.warn(`[sync] push 失败 table=${f.table} id=${f.itemId} error=${f.error}`)
      }
      const first = failedOps[0]
      if (first?.op?.data) console.warn(`[sync] 首条失败 op 原始 data:`, _redactOpData(first.op))
      syncStore.setSyncStatus('error')
      syncStore.setSyncError(`${failedOps.length} 项推送失败：${failedOps[0].error}`)
      return false
    }

    if (lockedItemKeys.size > 0 && tasks.length === 0) {
      // 全部 op 都因锁定被跳过、留队列待解锁重推。
      syncStore.setSyncStatus('idle')
      syncStore.setPendingLockedCount(lockedItemKeys.size)
      return true
    }
    // 部分跳过（isLocked 但有非敏感 op 仍成功推送）：跳过的那批留队列，计数如实反映。
    syncStore.setPendingLockedCount(lockedItemKeys.size)
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
