/**
 * syncPull — selectSince + decrypt + merge + soft-delete + reconcile
 */
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { saveAppData } from '../../stores/app.js'
import { useE2E } from './useE2E.js'
import type { EntityType } from '../../types.js'
import { FROM_REMOTE } from './useSyncMapping.js'
import { entityTypeToTable } from './syncMappingTables.js'
import { _getUserId } from './useSyncHistory.js'
import { getSyncRemotePort } from './syncRemotePort.js'
import { _mergeIntoLocal, _deleteWithoutEcho } from './syncLocalMerge.js'
import { _isPendingSync } from './syncPending.js'

/** pull/merge 顺序：分类先于书签/组（无硬依赖，保持历史顺序） */
const SYNC_ENTITY_ORDER: EntityType[] = ['category', 'bookmark', 'group', 'attribute']

/** 拉取远端变更（full=true 时 since=0 且启用 full-absent 对账） */
export async function pullChanges(full = false): Promise<boolean> {
  const syncStore = useSyncStore()
  const userId = _getUserId()
  if (!userId) return false
  if (!navigator.onLine) { syncStore.setSyncError('网络离线'); return false }

  syncStore.setSyncStatus('syncing')
  syncStore.setSyncError(null)

  try {
    const since = full ? 0 : (syncStore.lastSyncAt || 0)
    const port = getSyncRemotePort()

    const sinceResults = await Promise.all(
      SYNC_ENTITY_ORDER.map(type => port.selectSince(entityTypeToTable[type], userId, since)),
    )
    for (const r of sinceResults) {
      if (r.error) throw new Error(r.error.message)
    }

    const ds = useDataStore()
    const e2e = useE2E()

    type RemoteRow = { id: string; updatedAt?: number; deletedAt?: number }
    const remotes: Record<EntityType, RemoteRow[]> = {
      category: [], bookmark: [], group: [], attribute: [],
    }
    for (let i = 0; i < SYNC_ENTITY_ORDER.length; i++) {
      const type = SYNC_ENTITY_ORDER[i]
      const rows = sinceResults[i].data || []
      remotes[type] = rows.map(r => FROM_REMOTE[type](r as any)).filter(Boolean) as RemoteRow[]
    }

    if (e2e.isUnlocked.value) {
      const decryptList = async <T extends { id: string }>(arr: T[], type: EntityType): Promise<T[]> => {
        const out: T[] = []
        for (const item of arr) {
          if (!e2e.isUnlocked.value) break
          const decrypted = await e2e.decryptItem(type, item as any) as T
          if (e2e.isUnlocked.value) out.push(decrypted)
        }
        return out
      }
      for (const type of SYNC_ENTITY_ORDER) {
        const list = remotes[type]
        remotes[type] = await decryptList(list, type)
      }
      if (!e2e.isUnlocked.value) {
        syncStore.setSyncStatus('idle')
        return false
      }
    }

    const localByType: Record<EntityType, RemoteRow[]> = {
      category: ds.categories,
      bookmark: ds.bookmarks,
      group: ds.siblingGroups,
      attribute: ds.customAttributes,
    }
    for (const type of SYNC_ENTITY_ORDER) {
      _mergeIntoLocal(localByType[type], remotes[type], type, full)
    }

    const softDelResults = await Promise.all(
      SYNC_ENTITY_ORDER.map(type => port.selectSoftDeleted(entityTypeToTable[type], userId, since)),
    )

    const isLocalAlive: Record<EntityType, (id: string) => boolean> = {
      bookmark: (id) => !!ds.bookmarkMap[id] && !ds.bookmarkMap[id].deletedAt,
      group: (id) => !!ds.groupMap[id] && !ds.groupMap[id].deletedAt,
      category: (id) => {
        const cat = ds.categoryMap[id]
        return !!cat && !cat.deletedAt
      },
      attribute: (id) => {
        const attr = ds.attributeMap[id]
        return !!attr && !attr.deletedAt
      },
    }
    for (let i = 0; i < SYNC_ENTITY_ORDER.length; i++) {
      const type = SYNC_ENTITY_ORDER[i]
      const res = softDelResults[i]
      if (res.error) { console.warn('[sync] deletion sync query failed:', res.error); continue }
      for (const row of res.data || []) {
        const id = (row as { id: string }).id
        if (id && isLocalAlive[type](id)) _deleteWithoutEcho(ds, type, id)
      }
    }

    if (syncStore.lastSyncAt > 0) {
      const reconcileQueries = await Promise.all(
        SYNC_ENTITY_ORDER.map(type => port.selectAllIds(entityTypeToTable[type], userId)),
      )
      const anyReconcileError = reconcileQueries.some(r => r.error)
      if (anyReconcileError) {
        for (const r of reconcileQueries) {
          if (r.error) console.warn('[sync] reconcile id query failed, skipping reconcileDelete this round:', r.error)
        }
      } else {
        const remoteAll = new Set<string>()
        for (const r of reconcileQueries) {
          for (const row of r.data || []) remoteAll.add((row as { id: string }).id)
        }
        const reconcileDelete = (type: EntityType, id: string) => {
          if (ds._dirtyIds.has(id) || _isPendingSync(id)) return
          _deleteWithoutEcho(ds, type, id)
        }
        const localLists: Array<{ type: EntityType; items: Array<{ id: string; deletedAt?: number }> }> = [
          { type: 'bookmark', items: ds.bookmarks },
          { type: 'group', items: ds.siblingGroups },
          { type: 'category', items: ds.categories },
          { type: 'attribute', items: ds.customAttributes },
        ]
        for (const { type, items } of localLists) {
          for (const item of items) {
            if (!item.deletedAt && !remoteAll.has(item.id)) reconcileDelete(type, item.id)
          }
        }
      }
    }

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
