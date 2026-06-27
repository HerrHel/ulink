/**
 * useSyncStatus — 共享同步状态指示器
 * 提供 syncDotClass 计算属性，供 AppHeader 和 SettingsPanel 复用
 */
import { computed } from 'vue'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'

export function useSyncDotClass() {
  const sync = useCloudSync()
  return computed(() => {
    if (sync.syncStatus.value === 'syncing') return 'dot-syncing'
    if (sync.syncStatus.value === 'error') return 'dot-error'
    if (sync.pendingCount.value > 0) return 'dot-pending'
    return 'dot-ok'
  })
}
