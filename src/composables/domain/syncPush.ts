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
import { getSyncRemotePort } from './syncRemotePort.js'
import { _markPendingSync, _clearPendingSync } from './syncPending.js'
import { cloneDeep } from '../../lib/clone.js'

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
      merged.push({ ...last, ts: itemOps[0].ts })
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
    const historyItems: Array<{ id: string; type: string; data: Record<string, any> }> = []
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
            const encData = await histE2e.encryptItem(type as EntityType, { ...existing as any } as Record<string, unknown>)
            historyItems.push({ id: op.itemId, type, data: encData as Record<string, any> })
          } catch (err) {
            console.warn(`[sync] history encrypt skipped table=${op.table} id=${op.itemId}`, err)
          }
        }
      }
    }
    _saveHistory(userId, historyItems).catch(() => {})

    const tasks: Promise<any>[] = []
    const succeededIds: number[] = []
    const encFailedOps: Array<{ table: string; itemId: string; error: string }> = []
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

      let row: Record<string, any>
      try {
        const encryptedData = await e2e.encryptItem(itemType, data)
        row = toRemoteRow(itemType, { ...encryptedData, _userId: userId }, isNew) as unknown as Record<string, any>
      } catch (err: any) {
        encFailedOps.push({ table: op.table, itemId: op.itemId, error: `加密/序列化失败: ${err?.message || String(err)}` })
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
        const partial: Record<string, any> = { id: op.itemId, user_id: userId, updated_at_num: row.updated_at_num }
        for (const f of changedFields) {
          const snakeKey = camelToSnake(f)
          if (snakeKey !== 'id' && snakeKey !== 'user_id' && snakeKey in row) {
            partial[snakeKey] = row[snakeKey]
          }
        }
        const { id, ...updateData } = partial
        tasks.push(
          port.update(op.table, id, userId, updateData)
            .then(r => ({ op, result: r }))
            .catch(e => ({ op, result: { data: null, error: { message: String(e?.message || e) } } })),
        )
      }
    }

    const rawOpsMap = new Map(rawOps.map(ro => [`${ro.table}:${ro.itemId}`, ro]))
    const results = await Promise.all(tasks)

    const failedOps: Array<{ table: string; itemId: string; error: string; op?: SyncOp }> = [
      ...encFailedOps.map(f => ({ ...f, op: rawOpsMap.get(`${f.table}:${f.itemId}`) })),
    ]
    const deadIds: number[] = []
    for (const r of results) {
      if (r.result.error) {
        const rawMatch = rawOpsMap.get(`${r.op.table}:${r.op.itemId}`)
        const retries = (rawMatch?.retries || 0) + 1
        failedOps.push({ table: r.op.table, itemId: r.op.itemId, error: r.result.error.message, op: rawMatch })
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
    for (const f of encFailedOps) {
      const rawMatch = rawOpsMap.get(`${f.table}:${f.itemId}`)
      if (rawMatch?.id != null && (rawMatch.retries || 0) + 1 >= MAX_PUSH_RETRIES) deadIds.push(rawMatch.id)
      else if (rawMatch?.id != null) {
        await updateSyncOpRetry(rawMatch.id, (rawMatch.retries || 0) + 1)
      }
    }

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
      if (!r.result.error) releasedIds.add(r.op.itemId)
      else {
        const rawMatch = rawOpsMap.get(`${r.op.table}:${r.op.itemId}`)
        if (rawMatch?.id != null && (rawMatch.retries || 0) + 1 >= MAX_PUSH_RETRIES) releasedIds.add(r.op.itemId)
      }
    }
    _clearPendingSync(releasedIds)
    for (const f of encFailedOps) {
      const rawMatch = rawOpsMap.get(`${f.table}:${f.itemId}`)
      if (rawMatch?.id != null && (rawMatch.retries || 0) + 1 >= MAX_PUSH_RETRIES) {
        releasedIds.add(f.itemId)
        _clearPendingSync([f.itemId])
      }
    }

    if (failedOps.length) {
      for (const f of failedOps) {
        console.warn(`[sync] push 失败 table=${f.table} id=${f.itemId} error=${f.error}`)
      }
      const first = failedOps[0]
      if (first?.op?.data) console.warn(`[sync] 首条失败 op 原始 data:`, cloneDeep(first.op.data))
      syncStore.setSyncStatus('error')
      syncStore.setSyncError(`${failedOps.length} 项推送失败：${failedOps[0].error}`)
      return false
    }

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
