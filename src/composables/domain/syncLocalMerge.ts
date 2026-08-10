/**
 * syncLocalMerge — 远端 → 本地 store 副作用（decision 执行层）
 *
 * 决策纯函数见 syncMergeCore；Realtime 与 pull 共用。
 */
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import { decideRemoteApply } from './syncMergeCore.js'
import { _isPendingSync } from './syncPending.js'
import { cloneDeep } from '../../lib/clone.js'
import type { EntityType } from '../../types.js'

// UI-only 字段：不参与云端同步（展开/收起、聚焦、编辑态等纯本地状态）
const NON_SYNC_FIELDS = new Set(['isExpanded'])

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

/**
 * 远端 carry 一个父书签的 DELETE（=远端永久删，软删走 upsert 不发 DELETE）时，本机须把
 * 其存活后代解孤儿（parentId 置空让其顶层可见），与远端 permanentDeleteBookmark 的 RC-1
 * 策略一致——远端永久删父会把后代 parentId 置 null 变顶层可见，但**不会**为后代推 DELETE op
 * （仅推父 DELETE + 后代 parentId=null 的 upsert）。若本机此时未收到后代 upsert（非 full
 * 同步漏收 / race window），后代 parentId 仍指向已删父 → `filteredBookmarks` 的 `!parentId`
 * 过滤排除 → 网格静默丢失（仍可被搜索找到，父恢复后重接，故非永久丢失）。
 * 这里在软删父之前先收集后代（childrenMap 排除软删），软删父后用 updateBookmark 正规解
 * 孤儿（维护 _childrenIdx + dirty），并通过外层回声清洗让这些更改不回推远端（远端已先行置
 * null，本机只是补齐漏收 race）。
 */
function _collectLiveDescendants(ds: DataStore, rootId: string): string[] {
  const children = ds.childrenMap[rootId]
  if (!children?.length) return []
  const ids: string[] = []
  const stack = children.map(c => c.id)
  while (stack.length) {
    const cid = stack.pop()!
    ids.push(cid)
    const grands = ds.childrenMap[cid]
    if (grands?.length) stack.push(...grands.map(g => g.id))
  }
  return ids
}

/** 远端 DELETE/软删合并触发的本机删除：清衍生 dirty，避免回声推送 */
export function _deleteWithoutEcho(
  ds: DataStore,
  type: EntityType,
  id: string,
) {
  // bookmark 父被删前先记录存活后代，软删父后将后代解孤儿（与远端 permanentDelete 对齐）
  const descendantIds = type === 'bookmark' ? _collectLiveDescendants(ds, id) : []
  const affectedIds = new Set([id, ...descendantIds])
  const dirtyBefore = new Set(ds._dirtyIds)
  const changedBefore = new Set(ds._changedFields.keys())
  _deleteEntity(ds, type, id)
  // 解孤儿：软删父后存活后代 parentId 置 null 变顶层可见，updateBookmark 维护 _childrenIdx。
  // 绕过 updateBookmark 会留脏 _childrenIdx（父仍驻留数组或后续恢复时索引错位）。
  for (const cid of descendantIds) {
    const cbm = ds._bmMap[cid]
    if (cbm && !cbm.deletedAt) ds.updateBookmark(cid, { parentId: null })
  }
  // 回声清理：删后新增的衍生 dirty（如子项从所属组 bookmarkIds 剔除触发的 group dirty、
  // 解孤儿 updateBookmark 自身的 dirty）、或属于受影响集自身的项，一律不回推远端。
  for (const did of ds._dirtyIds) if (!dirtyBefore.has(did) || affectedIds.has(did)) ds._dirtyIds.delete(did)
  for (const cid of ds._changedFields.keys()) if (!changedBefore.has(cid) || affectedIds.has(cid)) ds._changedFields.delete(cid)
  for (const did of affectedIds) ds._newIds.delete(did)
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
        if (lItem && !syncStore.getConflict(rItem.id)) {
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
          const l = lItem as Record<string, unknown>
          const r = rItem as Record<string, unknown>
          for (const k of Object.keys(r)) if (!NON_SYNC_FIELDS.has(k)) l[k] = r[k]
          delete (l as { deletedAt?: unknown }).deletedAt
        }
        break
      case 'assign':
        if (lItem) {
          const l = lItem as Record<string, unknown>
          const r = rItem as Record<string, unknown>
          for (const k of Object.keys(r)) if (!NON_SYNC_FIELDS.has(k)) l[k] = r[k]
        }
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
      // 虚拟分类（全部/未分类）是本地常量，云端 categories 表可能从未有过它们的
      // 记录（未重排过分类的用户从不推送）——全量对账不得把它们当「远端已删」软删。
      if (type === 'category' && (lItem.id === CAT_ALL || lItem.id === CAT_UNCATEGORIZED)) continue
      const decision = decideRemoteApply({
        localItem: lItem,
        remoteItem: null,
        isDirty: ds._dirtyIds.has(lItem.id),
        isPending: _isPendingSync(lItem.id),
        lastSyncAt: syncStore.lastSyncAt,
        full: true,
      })
      if (decision.action !== 'full-absent-delete') continue
      // 复用 _deleteWithoutEcho：bookmark 父被删时一并解孤儿后代 + 统一回声清理，
      // 替代旧 _deleteEntity 单删后只能手动清单体 dirty 的口径。
      _deleteWithoutEcho(ds, type, lItem.id)
    }
  }
}
