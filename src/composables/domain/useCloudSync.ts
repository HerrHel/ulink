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
  enqueueSyncOps, syncOpsCount, clearAllSyncOps, type SyncOp,
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
import { _clearAllPendingSync } from './syncPending.js'
import { setGroupPublic, fetchPublicGroup } from './syncShare.js'
import { withLock } from '../../lib/withLock.js'

export { setSyncRemotePort, createMemorySyncPort, getSyncRemotePort } from './syncRemotePort.js'
export { _isPendingSync, __testPendingSync } from './syncPending.js'
export { _mergeIntoLocal, _deleteWithoutEcho } from './syncLocalMerge.js'
export { _opNeedsUnlock } from './syncPush.js'
export { setGroupPublic, fetchPublicGroup } from './syncShare.js'

let _initialized = false
let _syncTimer: ReturnType<typeof setTimeout> | null = null

// 测试钩子：initialSync 的 _initialized 是模块级幂等守卫（首次拉取+回推后置 true，
// 之后切账号/重登需 resetSyncState 配合重置它）。单测编排需逐用例从干净态起步，
// 导出此无副作用钩子复位守卫（与 __testPendingSync/setSyncRemotePort 同属测试注入面）。
export function __resetInitialSync(): void {
  _initialized = false
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
      void withLock('linkvault-sync', pushFromQueue)
    }, 3000)
  }

  async function fullSync(): Promise<boolean> {
    enqueueDirtyAsOps()
    return withLock('linkvault-sync', async () => {
      const pushed = await pushFromQueue()
      // 审计 R12：pushed 单布尔守门 → 任一 op 失败 pushFromQueue 即返回 false，
      // 旧实现 `if (pushed) await pullChanges()` 使 1 条坏 op 整体跳过 pull，
      // 长期阻断多设备变更拉取（坏 op 进死信前 pull 一直不跑）。远端变更拉取应独立于
      // 推送成败：push 失败的 op 已留队列待重试/死信、syncStore 已记 error 状态，
      // 但 pullChanges 会先置 syncing 再置 success 覆盖 push 错误——故 pull 后若 push
      // 确有失败，恢复 error 状态让用户感知，不吞错。
      if (!pushed) {
        const pushErr = syncStore.syncError
        // full=true：手动全量同步才跑全量 ID 对账（selectAllIds × 4 + full-absent-delete +
        // reconcileDelete），兜底远端物理删除。freq 降频（81e926a3）把对账入口整个改成
        // `if(full)`，但生产无任何调用方传 true——不在此补上，对账就是不可达死代码。
        // 安全：_mergeIntoLocal 的 full-absent-delete 与 reconcileDelete 都各自要求
        // lastSyncAt>0 + 非 dirty + 非 pending，fresh(未首登)状态不会误删本地。
        await pullChanges(true)
        if (pushErr) {
          syncStore.setSyncStatus('error')
          syncStore.setSyncError(pushErr)
        }
        return pushed
      }
      await pullChanges(true)
      return pushed
    })
  }

  async function initialSync(): Promise<void> {
    if (_initialized || !isLoggedIn.value) return
    _initialized = true

    await withLock('linkvault-sync', async () => {
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
    void withLock('linkvault-sync', pushFromQueue).then(() => pullChanges())
    if (syncStore.realtimeStatus !== 'connected') {
      unsubscribeRealtime()
      subscribeRealtime(pullChanges)
    }
  }

  function _onVisibilityChange() {
    if (document.visibilityState !== 'visible' || !isLoggedIn.value) return
    void withLock('linkvault-sync', async () => {
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

  async function resetSyncState() {
    _initialized = false
    syncStore.resetSyncState()
    unsubscribeRealtime()
    // 审计 R1：登出不清 IDB syncOps 队列与模块级 _pendingSyncIds 致跨账号残留——A 登录断网
    // push 失败的 op 留在队列（storage.ts 的 db 是模块级单例跨账号共享），onLogout 调本函数
    // 不清，B 登录 initialSync→pushFromQueue→drainSyncOps 拉出 A 残留 op（op.data 含旧账号
    // 书签内容）用 B userId 推到 B 云端 → A 的书签出现在 B 云端。登出/切账号必须清队列与 pending。
    await clearAllSyncOps()
    _clearAllPendingSync()
  }

  return {
    syncStatus: toRef(syncStore, 'syncStatus'),
    lastSyncAt: toRef(syncStore, 'lastSyncAt'),
    syncError: toRef(syncStore, 'syncError'),
    autoSync: toRef(syncStore, 'autoSync'),
    pendingCount: toRef(syncStore, 'pendingCount'),
    pendingLockedCount: toRef(syncStore, 'pendingLockedCount'),
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
