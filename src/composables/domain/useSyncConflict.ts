/**
 * useSyncConflict — 同步冲突检测与解决
 *
 * 响应式状态已迁移至 stores/sync.ts (useSyncStore)。
 * 此处仅保留冲突解决逻辑函数。
 */
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { saveAppData } from '../../stores/app.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

/** 远端快照缓存（非响应式，用于去重判断） */
export const _remoteSnapshots = new Map<string, unknown>()

export function resolveConflict(id: string, keepLocal: boolean) {
  const store = useSyncStore()
  const conflict = store.conflicts.find(c => c.id === id)
  if (!conflict) return
  if (!keepLocal) {
    const remoteData = conflict.remote as Record<string, unknown>
    const ds = useDataStore()
    if (conflict.type === 'bookmark') ds.updateBookmark(id, remoteData as Partial<Bookmark>)
    else if (conflict.type === 'group') ds.updateGroup(id, remoteData as Partial<SiblingGroup>)
    else if (conflict.type === 'category') { const cat = ds.categories.find(c => c.id === id); if (cat) Object.assign(cat, remoteData) }
    else if (conflict.type === 'attribute') { const attr = ds.customAttributes.find(a => a.id === id); if (attr) Object.assign(attr, remoteData) }
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
