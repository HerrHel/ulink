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

  // ── 锁定期积压计数 ──
  // E2E 启用但锁定时，带敏感字段的 upsert op 需 key 加密才能安全推云，无 key 只能
  // 静默跳过、等解锁重推。这些 op 留在 syncOps 队列里被 pendingCount 计入，徽章若只显
  // 「N 项待同步」会让用户误以为同步坏了。本计数单独标记「其中因锁定被跳过、待解锁重推」
  // 的数量，供 useSyncStatus 展示成「N 项等待解锁后同步」，明确归因。解锁后 pushFromQueue
  // 重推清空队列，本计数随之归零。
  const pendingLockedCount = ref(0)

  // ── Realtime 连接状态 ──
  const realtimeStatus = ref<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')

  // ── 冲突状态 ──
  const conflicts = ref<SyncConflict[]>([])
  const conflictBannerDismissed = ref(false)

  // ── 重加密进行中标志 ──
  // changeMasterPassword 全量重加密+push 云端期间置 true，useSyncRealtime 据此
  // 短路远端变更（本标签页 push 的回声一律 skip，结束后 pullChanges 对账）。
  const isReencrypting = ref(false)

  // ── Actions ──

  function setSyncStatus(v: typeof syncStatus.value) { syncStatus.value = v }
  function setSyncError(v: string | null) { syncError.value = v }
  function setLastSyncAt(v: number) { lastSyncAt.value = v }
  // L16：setAutoSync/clearConflicts/dismissConflictBanner 供设置页与测试；
  // autoSync 默认 true，UI 暂无开关时仍保留 API 以便后续 Settings 接线与单测。
  function setAutoSync(v: boolean) { autoSync.value = v }
  function setPendingCount(v: number) { pendingCount.value = v }
  // 置 0 之外的正值仅由 pushFromQueue 在锁定态跳过 op 时写入（见 syncPush.ts）。
  function setPendingLockedCount(v: number) { pendingLockedCount.value = v }
  function setRealtimeStatus(v: typeof realtimeStatus.value) { realtimeStatus.value = v }
  function setReencrypting(v: boolean) { isReencrypting.value = v }

  function resetSyncState() {
    lastSyncAt.value = 0
    syncStatus.value = 'idle'
    syncError.value = null
    conflicts.value = []
    conflictBannerDismissed.value = false
    pendingLockedCount.value = 0
  }

  // 冲突管理
  function addConflict(c: SyncConflict) {
    conflicts.value.push(c)
  }

  function removeConflict(id: string) {
    const list = conflicts.value
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list.splice(i, 1)
        return
      }
    }
  }

  function getConflict(id: string): SyncConflict | undefined {
    return conflicts.value.find(c => c.id === id)
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
    pendingLockedCount: readonly(pendingLockedCount),
    realtimeStatus: readonly(realtimeStatus),
    conflicts: readonly(conflicts),
    // conflictBannerDismissed 需要在模板中直接赋值（SyncConflictBanner .value = true），不设 readonly
    conflictBannerDismissed,
    isReencrypting: readonly(isReencrypting),

    // 可写 actions
    setSyncStatus, setSyncError, setLastSyncAt, setAutoSync,
    setPendingCount, setPendingLockedCount, setRealtimeStatus, setReencrypting,
    resetSyncState,
    addConflict, removeConflict, getConflict, clearConflicts,
    dismissConflictBanner, resetConflictBanner,
  }
})
