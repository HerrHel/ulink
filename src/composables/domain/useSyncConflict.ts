/**
 * useSyncConflict — 同步冲突检测与解决
 *
 * 响应式状态已迁移至 stores/sync.ts (useSyncStore)。
 * 此处仅保留冲突解决逻辑函数。
 */
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { saveAppData } from '../../stores/app.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute, EntityType } from '../../types.js'

/** 远端快照缓存（非响应式，用于去重判断） */
export const _remoteSnapshots = new Map<string, unknown>()

/** 按实体类型把远端字段写回 data store（走 update* 保证 dirty/track/map） */
function _applyRemoteToLocal(type: EntityType, id: string, remote: Record<string, unknown>) {
  const ds = useDataStore()
  const apply: Record<EntityType, () => void> = {
    bookmark: () => ds.updateBookmark(id, remote as Partial<Bookmark>),
    group: () => ds.updateGroup(id, remote as Partial<SiblingGroup>),
    category: () => ds.updateCategory(id, remote as Partial<Category>),
    attribute: () => ds.updateAttribute(id, remote as Partial<CustomAttribute>),
  }
  apply[type]?.()
}

export function resolveConflict(id: string, keepLocal: boolean) {
  const store = useSyncStore()
  const conflict = store.getConflict(id)
  if (!conflict) return
  if (!keepLocal) {
    _applyRemoteToLocal(conflict.type, id, conflict.remote as Record<string, unknown>)
    saveAppData()
  }
  _remoteSnapshots.delete(`${conflict.type}:${id}`)
  store.removeConflict(id)
}

export function resolveAllConflicts(keepLocal: boolean) {
  const store = useSyncStore()
  for (const c of store.conflicts.slice()) {
    resolveConflict(c.id, keepLocal)
  }
}
