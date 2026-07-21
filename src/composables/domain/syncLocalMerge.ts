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

/** 远端 DELETE/软删合并触发的本机删除：清衍生 dirty，避免回声推送 */
export function _deleteWithoutEcho(
  ds: ReturnType<typeof useDataStore>,
  type: 'bookmark' | 'group' | 'category' | 'attribute',
  id: string,
) {
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

/** 智能合并：远端 → 本地（decision → store 副作用） */
export function _mergeIntoLocal<T extends { id: string; updatedAt?: number; deletedAt?: number }>(
  local: T[], remote: T[], type: 'bookmark' | 'group' | 'category' | 'attribute', full = false,
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
      switch (type) {
        case 'bookmark': ds.deleteBookmark(lItem.id); break
        case 'group': ds.deleteGroup(lItem.id); break
        case 'category': ds.deleteCategory(lItem.id); break
        case 'attribute': ds.deleteAttribute(lItem.id); break
      }
      ds._dirtyIds.delete(lItem.id)
      ds._newIds.delete(lItem.id)
    }
  }
}
