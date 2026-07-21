/**
 * useSyncStatus — 共享同步状态指示器
 *
 * useSyncState: 统一状态模型，合并 syncStatus + realtimeStatus +
 *   pendingCount + conflicts + 在线状态，供 AppHeader / SettingsPanel /
 *   SyncStatusPopover 复用。离线判定见 _isOffline。
 */
import { computed } from 'vue'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'

export type SyncLevel = 'ok' | 'syncing' | 'pending' | 'conflict' | 'offline' | 'error'

export interface SyncState {
  level: SyncLevel
  dotClass: string
  label: string
  count: number
  showBadge: boolean
}

/** 离线判定：断网 / Realtime 出错 / Realtime 未连且有积压 */
function _isOffline(sync: ReturnType<typeof useCloudSync>): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (sync.realtimeStatus.value === 'error') return true
  if (sync.realtimeStatus.value === 'disconnected' && sync.pendingCount.value > 0) return true
  return false
}

export function useSyncState() {
  const sync = useCloudSync()
  return computed<SyncState>(() => {
    const conflicts = sync.conflicts.value.length
    const pending = sync.pendingCount.value

    if (conflicts > 0) {
      return { level: 'conflict', dotClass: 'dot-conflict', label: `${conflicts} 项冲突`, count: conflicts, showBadge: true }
    }
    if (sync.syncStatus.value === 'error') {
      return { level: 'error', dotClass: 'dot-error', label: '同步失败', count: 0, showBadge: false }
    }
    if (_isOffline(sync)) {
      // 离线：无论有无积压均报 offline，避免断网无积压时落到 ok
      return pending > 0
        ? { level: 'offline', dotClass: 'dot-offline', label: `离线 · ${pending} 项待同步`, count: pending, showBadge: true }
        : { level: 'offline', dotClass: 'dot-offline', label: '离线', count: 0, showBadge: false }
    }
    if (pending > 0) {
      return { level: 'pending', dotClass: 'dot-pending', label: `${pending} 项待同步`, count: pending, showBadge: true }
    }
    if (sync.syncStatus.value === 'syncing') {
      return { level: 'syncing', dotClass: 'dot-syncing', label: '同步中...', count: 0, showBadge: false }
    }
    return { level: 'ok', dotClass: 'dot-ok', label: sync.syncLabel.value, count: 0, showBadge: false }
  })
}
