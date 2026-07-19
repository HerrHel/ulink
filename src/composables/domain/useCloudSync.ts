/**
 * useCloudSync — 同步编排 facade
 *
 * 职责：debounced / full / initial + 生命周期 + 分享 API
 * 实现拆分：
 * - syncMergeCore / syncLocalMerge — decision + store 副作用
 * - syncPush / syncPull — 队列推送 / 远端拉取
 * - syncRemotePort — IO
 * - useSyncRealtime / Conflict / History / Mapping
 */
import { computed, toRef } from 'vue'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from './useAuth.js'
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { saveAppData } from '../../stores/app.js'
import {
  enqueueSyncOps, syncOpsCount, type SyncOp,
} from '../../stores/storage.js'
import type { Bookmark, SiblingGroup } from '../../types.js'
import {
  fromRemoteBookmark, fromRemoteGroup,
  type RemoteBookmarkRow, type RemoteGroupRow,
} from './useSyncMapping.js'
import {
  resolveConflict, resolveAllConflicts,
} from './useSyncConflict.js'
import {
  fetchHistory, restoreFromHistory, _getUserId,
} from './useSyncHistory.js'
import {
  subscribeRealtime, unsubscribeRealtime,
} from './useSyncRealtime.js'
import { getSyncRemotePort } from './syncRemotePort.js'
import { isValidShareGroupId } from '../../utils.js'
import { enqueueDirtyAsOps, pushFromQueue } from './syncPush.js'
import { pullChanges } from './syncPull.js'

export { decideRemoteApply } from './syncMergeCore.js'
export { setSyncRemotePort, createMemorySyncPort, getSyncRemotePort } from './syncRemotePort.js'
export { _isPendingSync, __testPendingSync } from './syncPending.js'
export { _mergeIntoLocal, _deleteWithoutEcho } from './syncLocalMerge.js'
export { _opNeedsUnlock } from './syncPush.js'

let _initialized = false
let _syncTimer: ReturnType<typeof setTimeout> | null = null

async function _withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, { mode: 'exclusive' }, fn)
  }
  return fn()
}

export function useCloudSync() {
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

  function debouncedSync() {
    if (!syncStore.autoSync || !isLoggedIn.value) return
    enqueueDirtyAsOps()
    if (_syncTimer) clearTimeout(_syncTimer)
    _syncTimer = setTimeout(() => {
      _syncTimer = null
      void _withLock('linkvault-sync', pushFromQueue)
    }, 3000)
  }

  async function fullSync(): Promise<boolean> {
    enqueueDirtyAsOps()
    return _withLock('linkvault-sync', async () => {
      const pushed = await pushFromQueue()
      if (pushed) await pullChanges()
      return pushed
    })
  }

  async function initialSync(): Promise<void> {
    if (_initialized || !isLoggedIn.value) return
    _initialized = true

    await _withLock('linkvault-sync', async () => {
      const ds = useDataStore()
      const userId = _getUserId()
      if (!userId) return

      await pullChanges(false)

      const remoteIds = new Set<string>()
      const port = getSyncRemotePort()
      const [bmIds, gIds, cIds, aIds] = await Promise.all([
        port.selectAllIds('bookmarks', userId),
        port.selectAllIds('sibling_groups', userId),
        port.selectAllIds('categories', userId),
        port.selectAllIds('custom_attributes', userId),
      ])
      for (const r of [bmIds, gIds, cIds, aIds]) {
        if (r.error) { console.warn('[sync] initialSync id probe failed:', r.error); continue }
        for (const row of r.data || []) remoteIds.add((row as { id: string }).id)
      }

      const allOps: Array<Omit<SyncOp, 'id' | 'retries'>> = []
      const now = Date.now()
      const shouldPush = (id: string, deletedAt?: number) =>
        ds._dirtyIds.has(id) || ds._newIds.has(id) || deletedAt || !remoteIds.has(id)

      const pushIf = <T extends { id: string; updatedAt?: number; deletedAt?: number }>(
        items: T[], table: SyncOp['table'],
      ) => {
        for (const item of items) {
          if (!shouldPush(item.id, item.deletedAt)) continue
          allOps.push({
            action: 'upsert', table, itemId: item.id,
            data: { ...item, _userId: userId },
            ts: item.updatedAt || now,
          })
        }
      }
      pushIf(ds.bookmarks, 'bookmarks')
      pushIf(ds.siblingGroups, 'sibling_groups')
      pushIf(ds.categories, 'categories')
      pushIf(ds.customAttributes, 'custom_attributes')
      if (allOps.length) await enqueueSyncOps(allOps)
      await pushFromQueue()
      await pullChanges(false)
    })

    subscribeRealtime(pullChanges)
    void refreshPendingCount()
  }

  function _onOnline() {
    if (!isLoggedIn.value) return
    enqueueDirtyAsOps()
    void _withLock('linkvault-sync', pushFromQueue).then(() => pullChanges())
    if (syncStore.realtimeStatus !== 'connected') {
      unsubscribeRealtime()
      subscribeRealtime(pullChanges)
    }
  }

  function _onVisibilityChange() {
    if (document.visibilityState !== 'visible' || !isLoggedIn.value) return
    void _withLock('linkvault-sync', async () => {
      await pullChanges()
      if (syncStore.autoSync) {
        enqueueDirtyAsOps()
        await pushFromQueue()
      }
    })
    if (syncStore.realtimeStatus !== 'connected' && syncStore.realtimeStatus !== 'connecting') {
      unsubscribeRealtime()
      subscribeRealtime(pullChanges)
    }
  }

  function initOnlineListener() {
    window.addEventListener('online', _onOnline)
    document.addEventListener('visibilitychange', _onVisibilityChange)
    if (isLoggedIn.value) subscribeRealtime(pullChanges)
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
    if (!isValidShareGroupId(gid)) return null
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

    pushToCloud: pushFromQueue, pullFromCloud: pullChanges, fullSync,
    debouncedSync, initialSync, resetSyncState,
    initOnlineListener, destroyOnlineListener,
    refreshPendingCount,

    subscribeRealtime: () => subscribeRealtime(pullChanges), unsubscribeRealtime,
    fetchHistory: (itemId: string) => fetchHistory(itemId),
    restoreFromHistory: (historyId: number, itemId: string, itemType: 'bookmark' | 'group') =>
      restoreFromHistory(historyId, itemId, itemType),

    conflicts: toRef(syncStore, 'conflicts'),
    conflictBannerDismissed: toRef(syncStore, 'conflictBannerDismissed'),
    resolveConflict,
    resolveAllConflicts,
    resetConflictBannerDismissed: syncStore.resetConflictBanner,

    setGroupPublic, fetchPublicGroup,
  }
}
