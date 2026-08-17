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
    // 跟踪本次 pull 是否实际产生本地变更（insert/assign/revive/soft-delete/reconcileDelete）。
    // 末尾据此决定是否 saveAppData：空 pull（远端无新变更、本地无对账删除）跳过 IDB 写入，
    // 避免每次 realtime/visible 触发的增量 pull 都无效落盘。lastSyncAt/syncStatus 不受邀约。
    let localChanged = false
    for (const type of SYNC_ENTITY_ORDER) {
      _mergeIntoLocal(localByType[type], remotes[type], type, full, () => { localChanged = true })
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
    if (full) {
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
          localChanged = true
        }
        const localByEntity: Record<EntityType, Array<{ id: string; deletedAt?: number }>> = {
          category: ds.categories,
          bookmark: ds.bookmarks,
          group: ds.siblingGroups,
          attribute: ds.customAttributes,
        }
        for (const type of SYNC_ENTITY_ORDER) {
          for (const item of localByEntity[type]) {
            if (item.deletedAt || remoteAll.has(item.id)) continue
            // 虚拟分类（全部/未分类）是本地常量：未重排过分类的用户云端 categories
            // 表从未有它们的记录，对账不得当「远端已删」软删，否则侧栏两项消失。
            if (type === 'category' && (item.id === CAT_ALL || item.id === CAT_UNCATEGORIZED)) continue
            reconcileDelete(type, item.id)
          }
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
