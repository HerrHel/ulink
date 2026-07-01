/**
 * sync.ts — 云同步状态 Store
 *
 * 集中管理所有同步相关的响应式状态。
 * 此前分散在 useCloudSync / useSyncRealtime / useSyncConflict 的模块级 ref，
 * 统一归入此 Store，消除 singleton composable 模式带来的测试状态泄漏。
 */
import { ref, readonly } from 'vue'
import { defineStore } from 'pinia'

export interface SyncConflict {
  id: string
  type: 'bookmark' | 'group' | 'category' | 'attribute'
  local: unknown
  remote: unknown
}

export const useSyncStore = defineStore('sync', () => {
  // ── 主同步状态 ──
  const syncStatus = ref<'idle' | 'syncing' | 'success' | 'error'>('idle')
  const lastSyncAt = ref(0)
  const syncError = ref<string | null>(null)
  const autoSync = ref(true)
  const pendingCount = ref(0)

  // ── Realtime 连接状态 ──
  const realtimeStatus = ref<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')

  // ── 冲突状态 ──
  const conflicts = ref<SyncConflict[]>([])
  const conflictBannerDismissed = ref(false)

  // ── Actions ──

  function setSyncStatus(v: typeof syncStatus.value) { syncStatus.value = v }
  function setSyncError(v: string | null) { syncError.value = v }
  function setLastSyncAt(v: number) { lastSyncAt.value = v }
  function setAutoSync(v: boolean) { autoSync.value = v }
  function setPendingCount(v: number) { pendingCount.value = v }
  function setRealtimeStatus(v: typeof realtimeStatus.value) { realtimeStatus.value = v }

  function resetSyncState() {
    lastSyncAt.value = 0
    syncStatus.value = 'idle'
    syncError.value = null
    conflicts.value = []
    conflictBannerDismissed.value = false
  }

  // 冲突管理
  function addConflict(c: SyncConflict) {
    conflicts.value.push(c)
  }

  function removeConflict(id: string) {
    const idx = conflicts.value.findIndex(c => c.id === id)
    if (idx >= 0) conflicts.value.splice(idx, 1)
  }

  function clearConflicts() {
    conflicts.value = []
  }

  function dismissConflictBanner() {
    conflictBannerDismissed.value = true
  }

  function resetConflictBanner() {
    conflictBannerDismissed.value = false
  }

  return {
    // 只读状态
    syncStatus: readonly(syncStatus),
    lastSyncAt: readonly(lastSyncAt),
    syncError: readonly(syncError),
    autoSync: readonly(autoSync),
    pendingCount: readonly(pendingCount),
    realtimeStatus: readonly(realtimeStatus),
    conflicts: readonly(conflicts),
    conflictBannerDismissed: readonly(conflictBannerDismissed),

    // 可写 actions
    setSyncStatus, setSyncError, setLastSyncAt, setAutoSync,
    setPendingCount, setRealtimeStatus,
    resetSyncState,
    addConflict, removeConflict, clearConflicts,
    dismissConflictBanner, resetConflictBanner,
  }
})
