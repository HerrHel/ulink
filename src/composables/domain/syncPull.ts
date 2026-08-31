/**
 * syncPull — selectSince + decrypt + merge + soft-delete + reconcile
 */
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { saveAppData } from '../../stores/app.js'
import { useE2E } from './useE2E.js'
import type { EntityType } from '../../types.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import { FROM_REMOTE, type AnyRemoteRow } from './useSyncMapping.js'
import { entityTypeToTable, SYNC_ENTITY_ORDER } from './syncMappingTables.js'
import { _getUserId } from './useSyncHistory.js'
import { getSyncRemotePort } from './syncRemotePort.js'
import { syncOpsCount } from '../../stores/storage.js'
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

    // 三批查询并行发出。软删批次与（full 时的）全量 ID 对账必须在 _mergeIntoLocal
    // 之前拿到：对账守卫需要「云端该类型是否曾有过数据」的判据（allIds + softDeleted
    // 双路），否则首次注册用户（云端空库）的本地整库会被对账删光。
    const [sinceResults, softDelResults, reconcileQueries] = await Promise.all([
      Promise.all(SYNC_ENTITY_ORDER.map(type => port.selectSince(entityTypeToTable[type], userId, since))),
      Promise.all(SYNC_ENTITY_ORDER.map(type => port.selectSoftDeleted(entityTypeToTable[type], userId, since))),
      full
        ? Promise.all(SYNC_ENTITY_ORDER.map(type => port.selectAllIds(entityTypeToTable[type], userId)))
        : Promise.resolve(null),
    ])
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
      const rows = (sinceResults[i].data ?? []) as RemoteRow[]
      remotes[type] = rows.map(r => FROM_REMOTE[type](r as AnyRemoteRow)).filter(Boolean) as RemoteRow[]
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

    // ── 全量对账守卫（full=true 专属）──
    // 背景（真实事故）：本机长期使用后第一次注册登录 → initialSync 的全量 upsert 因
    // 网络/限流失败（云端仍是空库）→ 用户点「重试同步」触发 fullSync → 旧实现的对账
    // 把「远端 selectAllIds 查不到」一律判成「远端已删」，整库被软删进回收站。
    // 本系统删除走软删（deleted_at + selectSoftDeleted 同步），「某类型云端零行」
    // 只可能是「本地数据尚未上云」，不是「用户在别处把数据清空」。据此逐类关闭对账删除。
    const remoteAllIds: Record<EntityType, Set<string>> | null = full ? {
      category: new Set(), bookmark: new Set(), group: new Set(), attribute: new Set(),
    } : null
    if (full && reconcileQueries) {
      for (let i = 0; i < SYNC_ENTITY_ORDER.length; i++) {
        const type = SYNC_ENTITY_ORDER[i]
        const r = reconcileQueries[i]
        if (r.error) {
          console.warn('[sync] reconcile id query failed, skipping reconcileDelete this round:', r.error)
          continue
        }
        for (const row of r.data || []) remoteAllIds![type].add((row as { id: string }).id)
      }
    }

    // 队列未清空守卫：还有失败待重试的 op ⇒ 本地存在未成功上云的变更。此时对账删除
    // 会把「推送失败」误判成「远端已删」，整批灭掉用户数据。有积压就整轮不删除。
    let pendingOps = 0
    try { pendingOps = await syncOpsCount() } catch { pendingOps = 0 }
    const queueBackedUp = pendingOps > 0

    // 逐类判定是否允许对账删除（full-absent-delete + reconcileDelete 共用）
    const allowReconcile: Record<EntityType, boolean> = {
      category: true, bookmark: true, group: true, attribute: true,
    }
    if (full && remoteAllIds) {
      for (let i = 0; i < SYNC_ENTITY_ORDER.length; i++) {
        const type = SYNC_ENTITY_ORDER[i]
        if (remoteAllIds[type].size > 0) continue
        if ((softDelResults[i].data?.length ?? 0) > 0) continue
        // 云端该类型一行都没有（含软删行）：判定「本地数据尚未上云」，整类不删。
        // 仅当本地确实有存活项时才告警——多数账号根本没有 custom_attributes，
        // 无脑 warn 会让每次 fullSync 刷屏，掩盖真实异常。
        allowReconcile[type] = false
        const localAlive = localByType[type].some(i => !i.deletedAt)
        if (localAlive) {
          console.warn(
            `[sync] 云端 ${entityTypeToTable[type]} 为空且本地有存活数据，判定尚未上云，跳过对账删除`,
          )
        }
      }
    }
    if (full && queueBackedUp) {
      console.warn(`[sync] 仍有 ${pendingOps} 条待重试同步 op，跳过本轮对账删除，避免误删未上云数据`)
    }

    // 跟踪本次 pull 是否实际产生本地变更（insert/assign/revive/soft-delete/reconcileDelete）。
    // 末尾据此决定是否 saveAppData：空 pull（远端无新变更、本地无对账删除）跳过 IDB 写入，
    // 避免每次 realtime/visible 触发的增量 pull 都无效落盘。lastSyncAt/syncStatus 不受影响。
    let localChanged = false
    for (const type of SYNC_ENTITY_ORDER) {
      _mergeIntoLocal(
        localByType[type], remotes[type], type, full,
        () => { localChanged = true },
        full
          ? {
            allowFullAbsentDelete: allowReconcile[type] && !queueBackedUp,
            protectedIds: remoteAllIds?.[type],
          }
          : undefined,
      )
    }

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
        const id = row.id
        // 与 reconcileDelete(122)/merge(115)/Realtime(52) 一致守门：本地 dirty/pending
        // 的 in-flight 编辑项不被远端软删批次静默覆盖（其 upsert 推上去会 revive）
        if (id && isLocalAlive[type](id) && !ds._dirtyIds.has(id) && !_isPendingSync(id)) {
          _deleteWithoutEcho(ds, type, id)
          localChanged = true
        }
      }
    }

    // 全量 ID 对账（远端物理删除兜底）仅 full=true 时跑：本系统删除走软删
    //（deleted_at 列，上一段 selectSoftDeleted 已覆盖），远端物理删除是正常流程
    // 不该发生的边缘情形。旧实现每次常规 pull（lastSyncAt>0）都发 4 张表全量
    // selectAllIds，对长期使用、只增不减的账号 payload 维持高位，常规增量 pull
    // 本只需 selectSince + selectSoftDeleted（均为 since 增量）。降频到 fullSync：
    // 物理删除兜底延迟到下次 fullSync（vis 后即触发一次），实时性可接受，常规 pull
    // 流量显著降低。常规增量 pull 走软删 + 增量两查询已足够。
    if (full && remoteAllIds && reconcileQueries) {
      const reconcileDelete = (type: EntityType, id: string) => {
        if (ds._dirtyIds.has(id) || _isPendingSync(id)) return
        _deleteWithoutEcho(ds, type, id)
        localChanged = true
      }
      const localByEntity: Record<EntityType, Array<{ id: string; deletedAt?: number }>> = {
        category: ds.categories,
        bookmark: ds.bookmarks,
        group: ds.siblingGroups,
        attribute: ds.customAttributes,
      }
      // lastSyncAt>0：与 full-absent-delete 对称——从未同步过的账号（fresh）不做
      // 对账删除，否则「登录即清空」。旧实现此处缺该守门，是本事故的直接成因之一。
      const canReconcile = syncStore.lastSyncAt > 0
      for (const type of SYNC_ENTITY_ORDER) {
        if (!canReconcile || !allowReconcile[type] || queueBackedUp) continue
        for (const item of localByEntity[type]) {
          if (item.deletedAt || remoteAllIds[type].has(item.id)) continue
          // 虚拟分类（全部/未分类）是本地常量：未重排过分类的用户云端 categories
          // 表从未有它们的记录，对账不得当「远端已删」软删，否则侧栏两项消失。
          if (type === 'category' && (item.id === CAT_ALL || item.id === CAT_UNCATEGORIZED)) continue
          reconcileDelete(type, item.id)
        }
      }
    }

    // B-12+：pull 的 assign/insert 会把云端 order 就地覆盖进本地（含虚拟分类），
    // 云端存量可能是 B-12 修复前的毫秒戳（超界）——立即归一化为序号并 markDirty
    // 回推，避免乱序持续到下次 reload；AppNav 另有渲染层置顶兜底。
    ds._normalizeCategoryOrders()
    ds._syncMaps()
    // 仅本次 pull 实际改写本地时落盘：空 pull（远端无新变更、无对账删除）跳过 IDB 写，
    // 避免 realtime/visible 高频触发的增量 pull 每次都无效落盘。lastSyncAt 仍推进，
    // 标记本次对账点；本地数据未变则无需持久化。
    if (localChanged) saveAppData()

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
