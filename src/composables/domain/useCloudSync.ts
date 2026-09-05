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
        // R-RESURRECT：pullChanges(full) 的墓碑重申可能已入队（云端存活但早于本地
        // 墓碑的分叉残留），补一轮 push 让重申即刻上云；队列为空时是无副作用 no-op。
        const retried = await pushFromQueue()
        if (pushErr && !retried) {
          syncStore.setSyncStatus('error')
          syncStore.setSyncError(pushErr)
        }
        return pushed
      }
      await pullChanges(true)
      // R-RESURRECT：同上，墓碑重申补推（空队列 no-op）。
      await pushFromQueue()
      return pushed
    })
  }

  /**
   * 探测云端已有 id，把本地「云端缺失 / 本地脏 / 新建 / 软删」的项补入推送队列。
   * 返回入队条数。
   *
   * initialSync（首次登录建基线）与 resyncAllToCloud（死信恢复）共用同一套补推判据，
   * 避免两处语义漂移。
   *
   * 判据说明：
   * - `!remoteIds.has(id)`：云端没有 → 必须补推（首次登录、或此前推送失败未上云）。
   * - `_dirtyIds / _newIds`：本地改过/新建 → 即使云端已有也要推（覆盖远端旧值）。
   * - `deletedAt`：软删项以 upsert 携带 deleted_at 的形式同步（不走 delete action），
   *   故软删项同样要入队，否则回收站状态无法同步到云端。
   * - 墓园（032 graveyard）：任意端已彻底删除的条目永不当「云端缺失」补推——
   *   存活快照重推会被服务端 032 触发器静默拦截，反复入队只是制造死 op；
   *   本地残墓由 fullSync 的 full-absent-delete 对账清理。
   */
  async function _enqueueMissingToCloud(userId: string): Promise<number> {
    const ds = useDataStore()
    const port = getSyncRemotePort()
    const [bmIds, gIds, cIds, aIds, graveyard] = await Promise.all([
      port.selectAllIds('bookmarks', userId),
      port.selectAllIds('sibling_groups', userId),
      port.selectAllIds('categories', userId),
      port.selectAllIds('custom_attributes', userId),
      port.selectGraveyardIds(userId),
    ])

    // id 探测 fail-closed：探测失败的表跳过补推。旧行为把探测失败当「该表云端为空」，
    // 整表本地项按「云端缺失」入队——他端刚删除的墓碑会被旧存活快照整批复活
    // （push 是无条件 upsert 覆盖）。fail-closed 代价仅是该表本轮不补推，下轮重试。
    const probeFailed = new Set<SyncOp['table']>()
    const remoteIds = new Set<string>()
    const probes: Array<[SyncOp['table'], typeof bmIds]> = [
      ['bookmarks', bmIds],
      ['sibling_groups', gIds],
      ['categories', cIds],
      ['custom_attributes', aIds],
    ]
    for (const [table, r] of probes) {
      if (r.error) {
        console.warn(`[sync] id probe failed, skip ${table} backfill this round:`, r.error)
        probeFailed.add(table)
        continue
      }
      for (const row of r.data || []) remoteIds.add((row as { id: string }).id)
    }

    // 墓园 id 集（table:id）。探测失败 fail-open：服务端 032 触发器仍会拦截存活重推。
    const graveyardKeys = new Set<string>()
    if (graveyard.error) {
      console.warn('[sync] graveyard probe failed (server guard remains as backstop):', graveyard.error)
    } else {
      for (const row of graveyard.data || []) graveyardKeys.add(`${row.table_name}:${row.item_id}`)
    }

    const allOps: Array<Omit<SyncOp, 'id' | 'retries'>> = []
    const now = Date.now()
    const shouldPush = (table: SyncOp['table'], id: string, deletedAt?: number) => {
      if (graveyardKeys.has(`${table}:${id}`)) return false
      return ds._dirtyIds.has(id) || ds._newIds.has(id) || !!deletedAt
        || (!probeFailed.has(table) && !remoteIds.has(id))
    }

    const pushIf = <T extends { id: string; updatedAt?: number; deletedAt?: number }>(
      items: T[], table: SyncOp['table'],
    ) => {
      for (const item of items) {
        if (!shouldPush(table, item.id, item.deletedAt)) continue
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
    return allOps.length
  }

  /**
   * 强制全量重传：清空推送队列后，按「云端缺失」重新入队本地数据并推送。
   *
   * 存在意义 —— 修复「op 进死信后本地数据永久无法上云」：
   * pushFromQueue 的 op 失败重试到 MAX_PUSH_RETRIES 即被 removeSyncOps 永久移除，
   * 而 fullSync 只推**队列里剩下**的 op，不会重新入队本地数据。于是某批数据一旦
   * 连续推送失败，就再没有第二次机会上云——用户看到的现象是「同步一直失败，
   * 但重试也没用」。
   *
   * 触发该场景的典型 bug（已修）：新账户首次全量推送时，首装种子数据的全局固定 id
   * （b1~b5/sb1/sb2、all/uncategorized/email/...、requires-login 等共 15 项）撞上
   * 别的用户已占的行 → ON CONFLICT DO UPDATE → UPDATE 策略 USING (auth.uid()=user_id)
   * 为假 → `new row violates row-level security policy (USING expression)`。
   * 根因修复见迁移 027（主键 id → (user_id, id)）与 syncRemotePort 不再写死 onConflict；
   * 本函数则负责让**已受损**账户重新拿到上云机会，无需手动重新编辑每条数据。
   *
   * 安全：入队前清空队列（坏 op 不再占用重试次数，新 op retries 从 0 开始）；
   * 入队按云端 id 探测，已在云端且本地未改的项不重复推，幂等且省流量。
   */
  async function resyncAllToCloud(): Promise<boolean> {
    if (!isLoggedIn.value) return false
    const userId = _getUserId()
    if (!userId) return false
    return withLock('linkvault-sync', async () => {
      await clearAllSyncOps()
      await _enqueueMissingToCloud(userId)
      // 与 initialSync 一致：首轮失败退避 1s 重试一轮，给瞬时故障留恢复窗口
      let pushed = await pushFromQueue()
      if (!pushed && (await syncOpsCount())) {
        await new Promise(r => setTimeout(r, 1000))
        pushed = await pushFromQueue()
      }
      await pullChanges(false)
      void refreshPendingCount()
      return pushed
    })
  }

  async function initialSync(): Promise<void> {
    if (_initialized || !isLoggedIn.value) return
    _initialized = true

    await withLock('linkvault-sync', async () => {
      const userId = _getUserId()
      if (!userId) return

      const pulled = await pullChanges(false)
      // R-RESURRECT：pull 失败（离线/限流/解密中断）时本地视图可能落后云端——此刻
      // 按「云端缺失」补推会把 A 端已删除的条目以旧存活快照推回云端（复活）。故
      // pull 成功才补推；失败侧的本地脏数据由 _onOnline/_onVisibilityChange 的
      // 常规增量链路补上，不因跳过本轮补推而丢失。
      if (pulled) await _enqueueMissingToCloud(userId)

      // 首轮基线上传失败退避重试：首次登录/注册的用户要把本机长期积累的成百上千条
      // 数据一次性上云，瞬时故障（限流、握手、冷启动）概率远高于日常增量。
      // pushFromQueue 内部按 MAX_PUSH_RETRIES 累计重试计数，3 次即进死信永久出队——
      // 若首轮全军覆没，这些数据就再没机会上云，而云端空库又会触发对账删除的误判链
      // （见 syncPull 守卫）。故在编排层补两轮退避重试，给瞬时故障留恢复窗口。
      // 仅补 1 轮退避重试，不再多补：pushFromQueue 每次失败都会给 op 累加 retries，
      // 达到 MAX_PUSH_RETRIES 即进死信永久出队。补 2 轮会让首轮故障一次性吃满 3 次
      // 机会、op 直接死信（本地数据再无上云机会，且队列清空会让对账的「队列未清空」
      // 守卫失效）。留一轮给后续常规同步，兼顾瞬时故障恢复与死信语义。
      let pushed = await pushFromQueue()
      if (!pushed && (await syncOpsCount())) {
        await new Promise(r => setTimeout(r, 1000))
        pushed = await pushFromQueue()
      }
      await pullChanges(false)
    })

    subscribeRealtime(pullChanges)
    void refreshPendingCount()
  }

  function _onOnline() {
    if (!isLoggedIn.value) return
    enqueueDirtyAsOps()
    if (syncStore.realtimeStatus !== 'connected') {
      // 断线重连：subscribeRealtime 不传回调，避免 SUBSCRIBED 再触发一次 pullChanges。
      // 显式 pullChanges 已做全面拉取，重连后靠 Realtime 增量事件即可。
      unsubscribeRealtime()
      subscribeRealtime()
    }
    // R-RESURRECT：先 pull 后 push。旧顺序先推后拉——离线期间积压的 op（op.data 是
    // 入队时刻的存活快照）会把远端刚写入的软删墓碑盖掉（删除复活；且复活行携带旧
    // updated_at_num，删除端的增量 pull 走 gt 过滤永远看不到，分叉无法自愈）。先
    // pull 让 dirty/pending 项经 decideRemoteApply 转 conflict/soft-delete，再推剩余
    // op；服务端 032 触发器对残留的旧快照复活做最终兜底。
    void withLock('linkvault-sync', async () => {
      await pullChanges()
      await pushFromQueue()
    })
  }

  function _onVisibilityChange() {
    if (document.visibilityState !== 'visible' || !isLoggedIn.value) return
    if (syncStore.realtimeStatus !== 'connected' && syncStore.realtimeStatus !== 'connecting') {
      unsubscribeRealtime()
      subscribeRealtime()
      void withLock('linkvault-sync', async () => {
        await pullChanges()
        if (syncStore.autoSync) {
          enqueueDirtyAsOps()
          await pushFromQueue()
        }
      })
      return
    }
    void withLock('linkvault-sync', async () => {
      await pullChanges()
      if (syncStore.autoSync) {
        enqueueDirtyAsOps()
        await pushFromQueue()
      }
    })
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
    debouncedSync, initialSync, resetSyncState, resyncAllToCloud,
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
