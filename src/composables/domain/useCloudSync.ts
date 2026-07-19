/**
 * useCloudSync — 同步编排 facade
 *
 * 职责：debounced / full / initial + 生命周期
 * 实现拆分：
 * - syncMergeCore / syncLocalMerge — decision + store 副作用
 * - syncPush / syncPull — 队列推送 / 远端拉取
 * - syncRemotePort — IO
 * - syncShare — 公开分享（re-export 保兼容）
 * - useSyncRealtime / Conflict / History / Mapping
 */
import { computed, toRef } from 'vue'
import { useAuth } from './useAuth.js'
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import {
  enqueueSyncOps, syncOpsCount, type SyncOp,
} from '../../stores/storage.js'
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
import { enqueueDirtyAsOps, pushFromQueue } from './syncPush.js'
import { pullChanges } from './syncPull.js'
import { setGroupPublic, fetchPublicGroup } from './syncShare.js'

export { decideRemoteApply } from './syncMergeCore.js'
export { setSyncRemotePort, createMemorySyncPort, getSyncRemotePort } from './syncRemotePort.js'
export { _isPendingSync, __testPendingSync } from './syncPending.js'
export { _mergeIntoLocal, _deleteWithoutEcho } from './syncLocalMerge.js'
export { _opNeedsUnlock } from './syncPush.js'
export { setGroupPublic, fetchPublicGroup } from './syncShare.js'

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

    // 分享 API 实现见 syncShare；保留 facade 字段兼容旧调用方
    setGroupPublic, fetchPublicGroup,
  }
}
