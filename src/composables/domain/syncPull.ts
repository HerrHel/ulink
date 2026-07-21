/**
 * syncPull — selectSince + decrypt + merge + soft-delete + reconcile
 */
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { saveAppData } from '../../stores/app.js'
import { useE2E } from './useE2E.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute, EntityType } from '../../types.js'
import { FROM_REMOTE } from './useSyncMapping.js'
import { _getUserId } from './useSyncHistory.js'
import { getSyncRemotePort } from './syncRemotePort.js'
import { _mergeIntoLocal, _deleteWithoutEcho } from './syncLocalMerge.js'
import { _isPendingSync } from './syncPending.js'

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

    const [catsRes, bmsRes, groupsRes, attrsRes] = await Promise.all([
      port.selectSince('categories', userId, since),
      port.selectSince('bookmarks', userId, since),
      port.selectSince('sibling_groups', userId, since),
      port.selectSince('custom_attributes', userId, since),
    ])

    for (const r of [catsRes, bmsRes, groupsRes, attrsRes]) {
      if (r.error) throw new Error(r.error.message)
    }

    const ds = useDataStore()
    const e2e = useE2E()
    const remoteCats = (catsRes.data || []).map(r => FROM_REMOTE.category(r as any)).filter(Boolean) as Category[]
    const remoteBms = (bmsRes.data || []).map(r => FROM_REMOTE.bookmark(r as any)).filter(Boolean) as Bookmark[]
    const remoteGroups = (groupsRes.data || []).map(r => FROM_REMOTE.group(r as any)).filter(Boolean) as SiblingGroup[]
    const remoteAttrs = (attrsRes.data || []).map(r => FROM_REMOTE.attribute(r as any)).filter(Boolean) as CustomAttribute[]

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
      remoteBms.splice(0, remoteBms.length, ...await decryptList(remoteBms, 'bookmark'))
      remoteGroups.splice(0, remoteGroups.length, ...await decryptList(remoteGroups, 'group'))
      remoteCats.splice(0, remoteCats.length, ...await decryptList(remoteCats, 'category'))
      remoteAttrs.splice(0, remoteAttrs.length, ...await decryptList(remoteAttrs, 'attribute'))
      if (!e2e.isUnlocked.value) {
        syncStore.setSyncStatus('idle')
        return false
      }
    }

    _mergeIntoLocal(ds.categories, remoteCats, 'category', full)
    _mergeIntoLocal(ds.bookmarks, remoteBms, 'bookmark', full)
    _mergeIntoLocal(ds.siblingGroups, remoteGroups, 'group', full)
    _mergeIntoLocal(ds.customAttributes, remoteAttrs, 'attribute', full)

    const [delBmsRes, delGroupsRes, delCatsRes, delAttrsRes] = await Promise.all([
      port.selectSoftDeleted('bookmarks', userId, since),
      port.selectSoftDeleted('sibling_groups', userId, since),
      port.selectSoftDeleted('categories', userId, since),
      port.selectSoftDeleted('custom_attributes', userId, since),
    ])

    // 各表查询结果与 EntityType 成对，避免对每行做四路猜测
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
    const softDelBatches: Array<{ type: EntityType; res: typeof delBmsRes }> = [
      { type: 'bookmark', res: delBmsRes },
      { type: 'group', res: delGroupsRes },
      { type: 'category', res: delCatsRes },
      { type: 'attribute', res: delAttrsRes },
    ]
    for (const { type, res } of softDelBatches) {
      if (res.error) { console.warn('[sync] deletion sync query failed:', res.error); continue }
      for (const row of res.data || []) {
        const id = (row as { id: string }).id
        if (id && isLocalAlive[type](id)) _deleteWithoutEcho(ds, type, id)
      }
    }

    if (syncStore.lastSyncAt > 0) {
      const [allBmRes, allGroupRes, allCatRes, allAttrRes] = await Promise.all([
        port.selectAllIds('bookmarks', userId),
        port.selectAllIds('sibling_groups', userId),
        port.selectAllIds('categories', userId),
        port.selectAllIds('custom_attributes', userId),
      ])
      const reconcileQueries = [allBmRes, allGroupRes, allCatRes, allAttrRes]
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
