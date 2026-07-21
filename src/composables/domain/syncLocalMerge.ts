/**
 * syncLocalMerge — 远端 → 本地 store 副作用（decision 执行层）
 *
 * 决策纯函数见 syncMergeCore；Realtime 与 pull 共用。
 */
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { decideRemoteApply } from './syncMergeCore.js'
import { _isPendingSync } from './syncPending.js'
import { cloneDeep } from '../../lib/clone.js'
import type { EntityType } from '../../types.js'

type DataStore = ReturnType<typeof useDataStore>

/** EntityType → data store 软删入口（单一查表，避免两处 switch 漂移） */
const _deleteHandlers: Record<EntityType, (ds: DataStore, id: string) => void> = {
  bookmark: (ds, id) => ds.deleteBookmark(id),
  group: (ds, id) => ds.deleteGroup(id),
  category: (ds, id) => ds.deleteCategory(id),
  attribute: (ds, id) => ds.deleteAttribute(id),
}

function _deleteEntity(ds: DataStore, type: EntityType, id: string) {
  _deleteHandlers[type]?.(ds, id)
}

/** 远端 DELETE/软删合并触发的本机删除：清衍生 dirty，避免回声推送 */
export function _deleteWithoutEcho(
  ds: DataStore,
  type: EntityType,
  id: string,
) {
  const dirtyBefore = new Set(ds._dirtyIds)
  const changedBefore = new Set(ds._changedFields.keys())
  _deleteEntity(ds, type, id)
  for (const did of ds._dirtyIds) if (!dirtyBefore.has(did) || did === id) ds._dirtyIds.delete(did)
  for (const cid of ds._changedFields.keys()) if (!changedBefore.has(cid) || cid === id) ds._changedFields.delete(cid)
  ds._newIds.delete(id)
}

/** 智能合并：远端 → 本地（decision → store 副作用） */
export function _mergeIntoLocal<T extends { id: string; updatedAt?: number; deletedAt?: number }>(
  local: T[], remote: T[], type: EntityType, full = false,
) {
  const ds = useDataStore()
  const syncStore = useSyncStore()
  const localMap = new Map(local.map(i => [i.id, i]))

  for (const rItem of remote) {
    const lItem = localMap.get(rItem.id) ?? null
    const decision = decideRemoteApply({
      localItem: lItem,
      remoteItem: rItem,
      isDirty: ds._dirtyIds.has(rItem.id),
      isPending: _isPendingSync(rItem.id),
      lastSyncAt: syncStore.lastSyncAt,
      full,
    })

    switch (decision.action) {
      case 'insert':
        local.push(rItem)
        break
      case 'conflict':
        if (lItem && !syncStore.conflicts.some(c => c.id === rItem.id)) {
          syncStore.addConflict({
            id: rItem.id, type,
            local: cloneDeep(lItem),
            remote: cloneDeep(rItem),
          })
          syncStore.resetConflictBanner()
        }
        break
      case 'soft-delete':
        _deleteWithoutEcho(ds, type, rItem.id)
        break
      case 'revive-assign':
        if (lItem) {
          Object.assign(lItem, rItem)
          delete (lItem as { deletedAt?: unknown }).deletedAt
        }
        break
      case 'assign':
        if (lItem) Object.assign(lItem, rItem)
        break
      case 'skip':
      case 'full-absent-delete':
        break
    }
  }

  if (full) {
    const remoteIds = new Set(remote.map(r => r.id))
    for (let i = local.length - 1; i >= 0; i--) {
      const lItem = local[i]
      if (remoteIds.has(lItem.id)) continue
      const decision = decideRemoteApply({
        localItem: lItem,
        remoteItem: null,
        isDirty: ds._dirtyIds.has(lItem.id),
        isPending: _isPendingSync(lItem.id),
        lastSyncAt: syncStore.lastSyncAt,
        full: true,
      })
      if (decision.action !== 'full-absent-delete') continue
      _deleteEntity(ds, type, lItem.id)
      ds._dirtyIds.delete(lItem.id)
      ds._newIds.delete(lItem.id)
    }
  }
}
