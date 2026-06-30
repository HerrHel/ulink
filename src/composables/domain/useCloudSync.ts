/**
 * useCloudSync.ts — Queue-based Cloud Sync with Realtime
 *
 * 职责：同步编排（队列/推送/拉取/合并），注册 Realtime / 生命周期
 * 分解模块：
 * - useSyncMapping.ts  — 数据映射（本地 ⇄ 远端）
 * - useSyncRealtime.ts  — Realtime 订阅管理
 * - useSyncConflict.ts  — 冲突检测与解决
 * - useSyncHistory.ts   — 版本历史
 */
import { ref, computed } from 'vue'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from './useAuth.js'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'
import { useE2E } from './useE2E.js'
import {
  enqueueSyncOps, drainSyncOps, removeSyncOps, syncOpsCount,
  type SyncOp,
} from '../../stores/storage.js'
import type { Bookmark, SiblingGroup } from '../../types.js'
import {
  toRemoteRow, fromRemoteBookmark, fromRemoteGroup, fromRemoteCategory, fromRemoteAttribute,
} from './useSyncMapping.js'
import {
  conflicts, resolveConflict, resolveAllConflicts,
  conflictBannerDismissed, resetConflictBannerDismissed,
} from './useSyncConflict.js'
import {
  _saveHistory, fetchHistory, restoreFromHistory, _getUserId,
} from './useSyncHistory.js'
import {
  subscribeRealtime, unsubscribeRealtime, realtimeStatus,
} from './useSyncRealtime.js'

// ── 状态 ──
const syncStatus = ref<'idle' | 'syncing' | 'success' | 'error'>('idle')
const lastSyncAt = ref<number>(0)
const syncError = ref<string | null>(null)
const autoSync = ref(true)

let _initialized = false
let _syncTimer: ReturnType<typeof setTimeout> | null = null

// ── 辅助函数 ──
async function _withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, { mode: 'exclusive' }, fn)
  }
  return fn()
}

function _mergeOps(ops: SyncOp[]): SyncOp[] {
  const byItem = new Map<string, SyncOp[]>()
  for (const op of ops) {
    const key = `${op.table}:${op.itemId}`
    const list = byItem.get(key) || []
    list.push(op)
    byItem.set(key, list)
  }
  const merged: SyncOp[] = []
  for (const [, itemOps] of byItem) {
    const last = itemOps[itemOps.length - 1]
    if (last.action === 'delete') {
      merged.push(last)
    } else {
      merged.push({ ...last, ts: itemOps[0].ts })
    }
  }
  return merged.sort((a, b) => a.ts - b.ts)
}

// ── 智能合并：远端 → 本地 ──
function _mergeIntoLocal<T extends { id: string; updatedAt?: number; deletedAt?: number }>(
  local: T[], remote: T[], type: 'bookmark' | 'group' | 'category' | 'attribute', full = false,
) {
  const ds = useDataStore()
  const localMap = new Map(local.map(i => [i.id, i]))

  for (const rItem of remote) {
    const lItem = localMap.get(rItem.id)
    if (!lItem) {
      local.push(rItem)
    } else if (ds._dirtyIds.has(rItem.id)) {
      const remoteNewer = (rItem.updatedAt || 0) > (lItem.updatedAt || 0)
      if (remoteNewer && lastSyncAt.value > 0) {
        if (!conflicts.some(c => c.id === rItem.id)) {
          conflicts.value.push({
            id: rItem.id, type,
            local: JSON.parse(JSON.stringify(lItem)),
            remote: JSON.parse(JSON.stringify(rItem)),
          })
          conflictBannerDismissed.value = false
        }
      }
    } else if ((rItem.updatedAt || 0) > (lItem.updatedAt || 0)) {
      Object.assign(lItem, rItem)
    }
  }

  if (full) {
    const remoteIds = new Set(remote.map(r => r.id))
    for (let i = local.length - 1; i >= 0; i--) {
      const lItem = local[i]
      if (!remoteIds.has(lItem.id) && !ds._dirtyIds.has(lItem.id) && lastSyncAt.value > 0) {
        local.splice(i, 1)
      }
    }
  }
}

// ══════════════════════════════════════════════════════
// 主 composable
// ══════════════════════════════════════════════════════
export function useCloudSync() {
  const { isLoggedIn } = useAuth()

  const syncLabel = computed(() => {
    if (syncStatus.value === 'syncing') return '同步中...'
    if (syncStatus.value === 'error') return '同步失败'
    const ds = useDataStore()
    const pending = ds._dirtyIds.size + ds._deletedIds.size + ds._newIds.size
    if (pending > 0) return `${pending} 项待同步`
    if (lastSyncAt.value) {
      const diff = Date.now() - lastSyncAt.value
      if (diff < 60000) return '刚刚同步'
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前同步`
      return `${Math.floor(diff / 3600000)} 小时前同步`
    }
    return '未同步'
  })

  const pendingCount = ref(0)
  async function refreshPendingCount() {
    pendingCount.value = await syncOpsCount()
  }

  // ── 把内存 dirtyIds 转为持久化 ops ──
  function _enqueueDirtyAsOps(): void {
    const ds = useDataStore()
    const userId = _getUserId()
    if (!userId) return

    const dirty = ds.drainDirtyIds()
    const deleted = ds.drainDeletedIds()
    const _newIds = ds.drainNewIds()
    const changedFields = ds.drainChangedFields()

    const ops: Array<Omit<SyncOp, 'id' | 'retries'>> = []

    for (const b of ds.bookmarks) {
      if (dirty.has(b.id)) {
        ops.push({
          action: 'upsert', table: 'bookmarks', itemId: b.id,
          data: { ...b, _userId: userId, _isNew: _newIds.has(b.id), _changedFields: changedFields.has(b.id) ? [...changedFields.get(b.id)!] : null },
          ts: b.updatedAt || Date.now(),
        })
      }
    }
    for (const g of ds.siblingGroups) {
      if (dirty.has(g.id)) {
        ops.push({
          action: 'upsert', table: 'sibling_groups', itemId: g.id,
          data: { ...g, _userId: userId, _isNew: _newIds.has(g.id), _changedFields: changedFields.has(g.id) ? [...changedFields.get(g.id)!] : null },
          ts: g.updatedAt || Date.now(),
        })
      }
    }
    for (const c of ds.categories) {
      if (dirty.has(c.id)) {
        ops.push({
          action: 'upsert', table: 'categories', itemId: c.id,
          data: { ...c, _userId: userId, _isNew: _newIds.has(c.id), _changedFields: changedFields.has(c.id) ? [...changedFields.get(c.id)!] : null },
          ts: c.updatedAt || Date.now(),
        })
      }
    }
    for (const a of ds.customAttributes) {
      if (dirty.has(a.id)) {
        ops.push({
          action: 'upsert', table: 'custom_attributes', itemId: a.id,
          data: { ...a, _userId: userId, _isNew: _newIds.has(a.id), _changedFields: changedFields.has(a.id) ? [...changedFields.get(a.id)!] : null },
          ts: a.updatedAt || Date.now(),
        })
      }
    }

    for (const [id, table] of deleted) {
      ops.push({ action: 'delete', table, itemId: id, data: null, ts: Date.now() })
    }

    if (ops.length) {
      enqueueSyncOps(ops)
      refreshPendingCount()
    }
  }

  // ── 从队列批量推送到 Supabase ──
  async function _pushFromQueue(): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    if (!navigator.onLine) { syncError.value = '网络离线'; return false }

    const rawOps = await drainSyncOps()
    if (!rawOps.length) return true

    const ops = _mergeOps(rawOps)
    syncStatus.value = 'syncing'
    syncError.value = null

    try {
      const ds = useDataStore()
      const historyItems: Array<{ id: string; type: string; data: Record<string, any> }> = []
      for (const op of ops) {
        if (op.action === 'upsert') {
          const existing = op.table === 'bookmarks' ? ds.bookmarks.find(b => b.id === op.itemId)
            : op.table === 'sibling_groups' ? ds.siblingGroups.find(g => g.id === op.itemId)
            : op.table === 'categories' ? ds.categories.find(c => c.id === op.itemId)
            : ds.customAttributes.find(a => a.id === op.itemId)
          if (existing) {
            const type = op.table === 'bookmarks' ? 'bookmark'
              : op.table === 'sibling_groups' ? 'group'
              : op.table === 'categories' ? 'category' : 'attribute'
            historyItems.push({ id: op.itemId, type, data: { ...existing as any } })
          }
        }
      }
      _saveHistory(userId, historyItems).catch(() => {})

      const tasks: Promise<any>[] = []
      const succeededIds: number[] = []

      for (const op of ops) {
        if (op.action === 'delete') {
          tasks.push(
            Promise.resolve(supabase.from(op.table).delete().eq('id', op.itemId).eq('user_id', userId))
              .then(r => ({ op, result: r }))
          )
        } else if (op.data) {
          const data = op.data
          const changedFields = data._changedFields as string[] | null
          const isNew = data._isNew as boolean || false
          delete data._changedFields
          delete data._userId
          delete data._isNew

          const e2e = useE2E()
          const itemType = op.table === 'bookmarks' ? 'bookmark'
            : op.table === 'sibling_groups' ? 'group'
            : op.table === 'categories' ? 'category' : 'attribute'
          const encryptedData = await e2e.encryptItem(itemType as any, data)

          const row = toRemoteRow(itemType, { ...encryptedData, _userId: userId }, isNew)

          if (isNew || !changedFields) {
            tasks.push(
              Promise.resolve(supabase.from(op.table).upsert(row, { onConflict: 'id' }))
                .then(r => ({ op, result: r }))
            )
          } else {
            const partial: Record<string, any> = { id: op.itemId, user_id: userId, updated_at_num: row.updated_at_num }
            for (const f of changedFields) {
              if (f in row && f !== 'id' && f !== 'user_id') partial[f] = row[f]
              if (f === 'categoryId') partial.category_id = row.category_id
              else if (f === 'parentId') partial.parent_id = row.parent_id
              else if (f === 'useCount') partial.use_count = row.use_count
              else if (f === 'isExpanded') partial.is_expanded = row.is_expanded
              else if (f === 'bookmarkIds') partial.bookmark_ids = row.bookmark_ids
              else if (f === 'isPublic') partial.is_public = row.is_public
              else if (f === 'createdAt') partial.created_at_num = row.created_at_num
              else if (f === 'deletedAt') partial.deleted_at = row.deleted_at
            }
            const { id, ...updateData } = partial
            tasks.push(
              Promise.resolve(supabase.from(op.table).update(updateData).eq('id', id).eq('user_id', userId))
                .then(r => ({ op, result: r }))
            )
          }
        }
      }

      const rawOpsMap = new Map(rawOps.map(ro => [`${ro.table}:${ro.itemId}`, ro]))
      const results = await Promise.all(tasks)
      for (const r of results) {
        if (r.result.error) throw r.result.error
        const rawMatch = rawOpsMap.get(`${r.op.table}:${r.op.itemId}`)
        if (rawMatch?.id != null) succeededIds.push(rawMatch.id)
      }

      if (succeededIds.length) {
        await removeSyncOps(succeededIds)
        refreshPendingCount()
      }
      for (const op of ops) ds._newIds.delete(op.itemId)

      lastSyncAt.value = Date.now()
      syncStatus.value = 'success'
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '同步失败'
      syncStatus.value = 'error'
      syncError.value = msg
      console.warn('[sync] push failed:', e)
      return false
    }
  }

  // ── 拉取远端变更 ──
  async function _pullChanges(full = false): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    if (!navigator.onLine) { syncError.value = '网络离线'; return false }

    syncStatus.value = 'syncing'
    syncError.value = null

    try {
      const since = full ? 0 : (lastSyncAt.value || 0)

      const [catsRes, bmsRes, groupsRes, attrsRes] = await Promise.all([
        supabase.from('categories').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('bookmarks').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('sibling_groups').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('custom_attributes').select('*').eq('user_id', userId).gt('updated_at_num', since),
      ])

      for (const r of [catsRes, bmsRes, groupsRes, attrsRes]) { if (r.error) throw r.error }

      const ds = useDataStore()
      const e2e = useE2E()
      const remoteCats = (catsRes.data || []).map(r => fromRemoteCategory(r))
      const remoteBms = (bmsRes.data || []).map(r => fromRemoteBookmark(r))
      const remoteGroups = (groupsRes.data || []).map(r => fromRemoteGroup(r))
      const remoteAttrs = (attrsRes.data || []).map(r => fromRemoteAttribute(r))

      if (e2e.isUnlocked.value) {
        for (const b of remoteBms) await e2e.decryptItem('bookmark', b as any)
        for (const g of remoteGroups) await e2e.decryptItem('group', g as any)
        for (const c of remoteCats) await e2e.decryptItem('category', c as any)
        for (const a of remoteAttrs) await e2e.decryptItem('attribute', a as any)
      }

      _mergeIntoLocal(ds.categories, remoteCats, 'category', full)
      _mergeIntoLocal(ds.bookmarks, remoteBms, 'bookmark', full)
      _mergeIntoLocal(ds.siblingGroups, remoteGroups, 'group', full)
      _mergeIntoLocal(ds.customAttributes, remoteAttrs, 'attribute', full)

      lastSyncAt.value = Date.now()
      syncStatus.value = 'success'
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '同步失败'
      syncStatus.value = 'error'
      syncError.value = msg
      console.warn('[sync] pull failed:', e)
      return false
    }
  }

  // ── 公共 API ──

  function debouncedSync() {
    if (!autoSync.value || !isLoggedIn.value) return
    _enqueueDirtyAsOps()
    if (_syncTimer) clearTimeout(_syncTimer)
    _syncTimer = setTimeout(() => {
      _syncTimer = null
      _withLock('linkvault-sync', _pushFromQueue)
    }, 3000)
  }

  async function fullSync(): Promise<boolean> {
    _enqueueDirtyAsOps()
    return _withLock('linkvault-sync', async () => {
      const pushed = await _pushFromQueue()
      if (pushed) await _pullChanges()
      return pushed
    })
  }

  async function initialSync(): Promise<void> {
    if (_initialized || !isLoggedIn.value) return
    _initialized = true

    await _withLock('linkvault-sync', async () => {
      await _pullChanges(true)
      const ds = useDataStore()
      const userId = _getUserId()
      if (!userId) return

      const allOps: Array<Omit<SyncOp, 'id' | 'retries'>> = []
      const now = Date.now()
      for (const b of ds.bookmarks) {
        allOps.push({ action: 'upsert', table: 'bookmarks', itemId: b.id, data: { ...b, _userId: userId }, ts: b.updatedAt || now })
      }
      for (const g of ds.siblingGroups) {
        allOps.push({ action: 'upsert', table: 'sibling_groups', itemId: g.id, data: { ...g, _userId: userId }, ts: g.updatedAt || now })
      }
      for (const c of ds.categories) {
        allOps.push({ action: 'upsert', table: 'categories', itemId: c.id, data: { ...c, _userId: userId }, ts: c.updatedAt || now })
      }
      for (const a of ds.customAttributes) {
        allOps.push({ action: 'upsert', table: 'custom_attributes', itemId: a.id, data: { ...a, _userId: userId }, ts: a.updatedAt || now })
      }
      if (allOps.length) await enqueueSyncOps(allOps)
      await _pushFromQueue()
    })

    subscribeRealtime(_pullChanges)
    refreshPendingCount()
  }

  function _onOnline() {
    if (!isLoggedIn.value) return
    _enqueueDirtyAsOps()
    _withLock('linkvault-sync', _pushFromQueue).then(() => _pullChanges())
  }

  function _onVisibilityChange() {
    if (document.visibilityState !== 'visible' || !isLoggedIn.value) return
    _withLock('linkvault-sync', async () => {
      await _pullChanges()
      if (autoSync.value) {
        _enqueueDirtyAsOps()
        await _pushFromQueue()
      }
    })
  }

  function initOnlineListener() {
    window.addEventListener('online', _onOnline)
    document.addEventListener('visibilitychange', _onVisibilityChange)
    if (isLoggedIn.value) subscribeRealtime(_pullChanges)
  }

  function destroyOnlineListener() {
    window.removeEventListener('online', _onOnline)
    document.removeEventListener('visibilitychange', _onVisibilityChange)
    unsubscribeRealtime()
  }

  function resetSyncState() {
    _initialized = false
    lastSyncAt.value = 0
    syncStatus.value = 'idle'
    syncError.value = null
    conflicts.value = []
    unsubscribeRealtime()
  }

  // ── 公开分享 ──
  async function setGroupPublic(gid: string, isPublic: boolean): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    const ds = useDataStore()
    const g = ds.groupMap[gid]
    if (!g) return false
    ds.updateGroup(gid, { isPublic })
    saveAppData()
    const { error } = await supabase.from('sibling_groups')
      .update({ is_public: isPublic }).eq('id', gid).eq('user_id', userId)
    if (error) { console.warn('[share] setGroupPublic failed:', error); return false }
    return true
  }

  async function fetchPublicGroup(gid: string): Promise<{ group: SiblingGroup; bookmarks: Bookmark[] } | null> {
    const { data: gData, error: gErr } = await supabase.from('sibling_groups')
      .select('*').eq('id', gid).eq('is_public', true).maybeSingle()
    if (gErr || !gData) return null
    const group = fromRemoteGroup(gData)
    let bookmarks: Bookmark[] = []
    if (group.bookmarkIds.length) {
      const { data: bData } = await supabase.from('bookmarks').select('*').in('id', group.bookmarkIds)
      bookmarks = (bData || []).map(fromRemoteBookmark)
    }
    return { group, bookmarks }
  }

  return {
    syncStatus, lastSyncAt, syncError, autoSync, syncLabel, pendingCount, refreshPendingCount,
    realtimeStatus,
    conflicts, resolveConflict, resolveAllConflicts,
    conflictBannerDismissed, resetConflictBannerDismissed,
    pushToCloud: _pushFromQueue, pullFromCloud: _pullChanges, fullSync,
    debouncedSync, initialSync, resetSyncState,
    initOnlineListener, destroyOnlineListener,
    subscribeRealtime: () => subscribeRealtime(_pullChanges), unsubscribeRealtime,
    fetchHistory: (itemId: string) => fetchHistory(itemId),
    restoreFromHistory: (historyId: number, itemId: string, itemType: 'bookmark' | 'group') => restoreFromHistory(historyId, itemId, itemType),
    setGroupPublic, fetchPublicGroup,
  }
}
