/**
 * useSyncConflict — 同步冲突检测与解决
 */
import { ref } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

export interface SyncConflict {
  id: string
  type: 'bookmark' | 'group' | 'category' | 'attribute'
  local: unknown
  remote: unknown
}

export const conflicts = ref<SyncConflict[]>([])
export const _remoteSnapshots = new Map<string, unknown>()

/** 横幅是否被用户关闭（模块级，供 popover 重现） */
export const conflictBannerDismissed = ref(false)

/** 重置 dismissed 以重新展示横幅（popover"查看冲突"调用） */
export function resetConflictBannerDismissed() {
  conflictBannerDismissed.value = false
}

export function resolveConflict(id: string, keepLocal: boolean) {
  const idx = conflicts.value.findIndex(c => c.id === id)
  if (idx < 0) return
  const conflict = conflicts.value[idx]
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
  conflicts.value.splice(idx, 1)
}

export function resolveAllConflicts(keepLocal: boolean) {
  for (let i = conflicts.value.length - 1; i >= 0; i--) {
    resolveConflict(conflicts.value[i].id, keepLocal)
  }
}
