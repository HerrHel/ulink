/**
 * sync.ts — 云同步状态 Store
 *
 * 集中管理所有同步相关的响应式状态。
 * 此前分散在 useCloudSync / useSyncRealtime / useSyncConflict 的模块级 ref，
 * 统一归入此 Store，消除 singleton composable 模式带来的测试状态泄漏。
 */
import { clearResolvedConflicts } from '../lib/syncResolvedConflicts.js'
import { ref, readonly } from 'vue'
import { defineStore } from 'pinia'
// 仅类型引入（运行时零依赖，不产生 store↔composable 循环）
import type { SyncErrorKind } from '../composables/domain/syncCircuit.js'

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
  // 错误归因（classifySyncError 产出）：quota 触顶时 UI 必须把「云端满了、本地
  // 数据安全」与泛「同步失败」区分开，否则用户会误以为本地丢数据。
  const syncErrorKind = ref<SyncErrorKind | null>(null)
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
  function setSyncErrorKind(v: SyncErrorKind | null) { syncErrorKind.value = v }
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
    syncErrorKind.value = null
    // 走 clearConflicts 而不是直接清数组：它同时清「已裁决冲突」记忆
    // （syncResolvedConflicts）。否则 A 账号裁掉过的 (type:id, 远端版本) 会残留到
    // B 账号，让同一 id 的冲突被静默抑制。
    clearConflicts()
    conflictBannerDismissed.value = false
    pendingLockedCount.value = 0
  }

  // 冲突管理
  // 复合键：不同实体表复用同一个 id 是允许且真实存在的（种子里分类 'ai' 与属性 'ai'）。
  // 旧实现只按裸 id 去重/查找：两表同时冲突会互相覆盖，解决时也只能删掉其中一条。
  // 仍接受裸 id 调用（向后兼容），但传入 type 或 'type:id' 时做精确匹配。
  function _matches(c: SyncConflict, idOrKey: string, type?: SyncConflict['type']): boolean {
    if (type) return c.type === type && c.id === idOrKey
    const sep = idOrKey.indexOf(':')
    if (sep > 0) return c.type === idOrKey.slice(0, sep) && c.id === idOrKey.slice(sep + 1)
    return c.id === idOrKey
  }

  function addConflict(c: SyncConflict) {
    const list = conflicts.value
    const idx = list.findIndex(item => item.id === c.id && item.type === c.type)
    if (idx >= 0) {
      list[idx] = c
    } else {
      list.push(c)
    }
    conflictBannerDismissed.value = false
  }

  function removeConflict(idOrKey: string, type?: SyncConflict['type']) {
    conflicts.value = conflicts.value.filter(c => !_matches(c, idOrKey, type))
  }

  function getConflict(idOrKey: string, type?: SyncConflict['type']): SyncConflict | undefined {
    return conflicts.value.find(c => _matches(c, idOrKey, type))
  }

  function clearConflicts() {
    conflicts.value = []
    // 裁决记忆随冲突一起清（换账号/退出登录时不能把上个账号的裁决带到新账号）
    clearResolvedConflicts()
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
    syncErrorKind: readonly(syncErrorKind),
    autoSync: readonly(autoSync),
    pendingCount: readonly(pendingCount),
    pendingLockedCount: readonly(pendingLockedCount),
    realtimeStatus: readonly(realtimeStatus),
    conflicts: readonly(conflicts),
    // conflictBannerDismissed 需要在模板中直接赋值（SyncConflictBanner .value = true），不设 readonly
    conflictBannerDismissed,
    isReencrypting: readonly(isReencrypting),

    // 可写 actions
    setSyncStatus, setSyncError, setSyncErrorKind, setLastSyncAt, setAutoSync,
    setPendingCount, setPendingLockedCount, setRealtimeStatus, setReencrypting,
    resetSyncState,
    addConflict, removeConflict, getConflict, clearConflicts,
    dismissConflictBanner, resetConflictBanner,
  }
})
