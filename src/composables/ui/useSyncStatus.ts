/**
 * useSyncStatus — 共享同步状态指示器
 *
 * useSyncDotClass: 旧版四态 CSS 类（保留向后兼容）
 * useSyncState: 统一状态模型，合并 syncStatus + realtimeStatus +
 *   pendingCount + conflicts + 在线状态，供 AppHeader / SettingsPanel 复用
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

export function useSyncDotClass() {
  const sync = useCloudSync()
  return computed(() => {
    if (sync.syncStatus.value === 'syncing') return 'dot-syncing'
    if (sync.syncStatus.value === 'error') return 'dot-error'
    if (sync.pendingCount.value > 0) return 'dot-pending'
    return 'dot-ok'
  })
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
    if (_isOffline(sync) && pending > 0) {
      return { level: 'offline', dotClass: 'dot-offline', label: `离线 · ${pending} 项待同步`, count: pending, showBadge: true }
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
