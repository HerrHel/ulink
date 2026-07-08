/**
 * useCloudSync.ts — Queue-based Cloud Sync with Realtime
 *
 * 职责：同步编排（队列/推送/拉取/合并），注册 Realtime / 生命周期
 * 分解模块：
 * - useSyncMapping.ts  — 数据映射（本地 ⇄ 远端）
 * - useSyncRealtime.ts  — Realtime 订阅管理
 * - useSyncConflict.ts  — 冲突检测与解决
 * - useSyncHistory.ts   — 版本历史
 *
 * 状态管理：所有响应式状态存放于 stores/sync.ts (useSyncStore)
 */
import { computed, toRef } from 'vue'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from './useAuth.js'
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { saveAppData } from '../../stores/app.js'
import { useE2E } from './useE2E.js'
import { trackMetric } from '../../lib/stats.js'
import {
  enqueueSyncOps, drainSyncOps, removeSyncOps, syncOpsCount,
  type SyncOp,
} from '../../stores/storage.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../../types.js'
import {
  toRemoteRow, fromRemoteBookmark, fromRemoteGroup, fromRemoteCategory, fromRemoteAttribute, camelToSnake,
} from './useSyncMapping.js'
import {
  resolveConflict, resolveAllConflicts, _remoteSnapshots,
} from './useSyncConflict.js'
import {
  _saveHistory, fetchHistory, restoreFromHistory, _getUserId,
} from './useSyncHistory.js'
import {
  subscribeRealtime, unsubscribeRealtime,
} from './useSyncRealtime.js'

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
  const syncStore = useSyncStore()
  const localMap = new Map(local.map(i => [i.id, i]))

  for (const rItem of remote) {
    const lItem = localMap.get(rItem.id)
    if (!lItem) {
      local.push(rItem)
    } else if (ds._dirtyIds.has(rItem.id)) {
      const remoteNewer = (rItem.updatedAt || 0) > (lItem.updatedAt || 0)
      if (remoteNewer && syncStore.lastSyncAt > 0) {
        if (!syncStore.conflicts.some(c => c.id === rItem.id)) {
          syncStore.addConflict({
            id: rItem.id, type,
            local: JSON.parse(JSON.stringify(lItem)),
            remote: JSON.parse(JSON.stringify(rItem)),
          })
          syncStore.resetConflictBanner()
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
      if (!remoteIds.has(lItem.id) && !ds._dirtyIds.has(lItem.id) && syncStore.lastSyncAt > 0) {
        // 远端已不存在（物理删除），本地软删除以确保数据可恢复
        switch (type) {
          case 'bookmark': ds.deleteBookmark(lItem.id); break
          case 'group': ds.deleteGroup(lItem.id); break
          case 'category': ds.deleteCategory(lItem.id); break
          case 'attribute': ds.deleteAttribute(lItem.id); break
        }
        // 删除由远端同步触发，清除 dirty 标记避免回推
        ds._dirtyIds.delete(lItem.id)
        ds._newIds.delete(lItem.id)
      }
    }
  }
}

// ══════════════════════════════════════════════════════
// 主 composable
// ══════════════════════════════════════════════════════
export function useCloudSync() {
  // 注意：useAuth() 返回 Pinia setup store 实例，其上 isLoggedIn（computed）会被 Pinia 自动解包为 boolean，
  // 直接解构 `{ isLoggedIn }` 在 TS 类型层是 boolean、运行时是 ComputedRef —— 二者不一致。
  // 用 computed 包装成统一的 ComputedRef<boolean>，类型与运行时一致且保持响应式。
  const _auth = useAuth()
  const isLoggedIn = computed(() => _auth.isLoggedIn)
  const syncStore = useSyncStore()

  const syncLabel = computed(() => {
    if (syncStore.syncStatus === 'syncing') return '同步中...'
    if (syncStore.syncStatus === 'error') return '同步失败'
    const ds = useDataStore()
    const pending = ds._dirtyIds.size + ds._deletedIds.size + ds._newIds.size
    if (pending > 0) return `${pending} 项待同步`
    if (syncStore.lastSyncAt) {
      const diff = Date.now() - syncStore.lastSyncAt
      if (diff < 60000) return '刚刚同步'
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前同步`
      return `${Math.floor(diff / 3600000)} 小时前同步`
    }
    return '未同步'
  })

  async function refreshPendingCount() {
    syncStore.setPendingCount(await syncOpsCount())
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
    if (!navigator.onLine) { syncStore.setSyncError('网络离线'); return false }

    const rawOps = await drainSyncOps()
    if (!rawOps.length) return true

    const ops = _mergeOps(rawOps)
    syncStore.setSyncStatus('syncing')
    syncStore.setSyncError(null)

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
              Promise.resolve(supabase.from(op.table).upsert(row as any, { onConflict: 'id' }))
                .then(r => ({ op, result: r }))
            )
          } else {
            const partial: Record<string, any> = { id: op.itemId, user_id: userId, updated_at_num: row.updated_at_num }
            for (const f of changedFields) {
              // TODO: f 为 camelCase（changedFields 源），row 为 snake_case 远端行；
              // `f in row` 几乎永不命中，部分更新分支实际只推 id/user_id/updated_at_num。
              // 运行逻辑修正需配合真实多字段增量同步的 E2E 验证，留待后续单独 PR。
              if (f in row && f !== 'id' && f !== 'user_id') partial[camelToSnake(f)] = (row as unknown as Record<string, unknown>)[f]
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

      syncStore.setLastSyncAt(Date.now())
      syncStore.setSyncStatus('success')
      trackMetric('sync_success', { duration: Date.now() - (rawOps[0]?.ts || Date.now()), count: ops.length })
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '同步失败'
      syncStore.setSyncStatus('error')
      syncStore.setSyncError(msg)
      trackMetric('sync_failure', { duration: Date.now() - (rawOps[0]?.ts || Date.now()), success: false })
      console.warn('[sync] push failed:', e)
      return false
    }
  }

  // ── 拉取远端变更 ──
  async function _pullChanges(full = false): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    if (!navigator.onLine) { syncStore.setSyncError('网络离线'); return false }

    syncStore.setSyncStatus('syncing')
    syncStore.setSyncError(null)

    try {
      const since = full ? 0 : (syncStore.lastSyncAt || 0)

      const [catsRes, bmsRes, groupsRes, attrsRes] = await Promise.all([
        supabase.from('categories').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('bookmarks').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('sibling_groups').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('custom_attributes').select('*').eq('user_id', userId).gt('updated_at_num', since),
      ])

      for (const r of [catsRes, bmsRes, groupsRes, attrsRes]) { if (r.error) throw r.error }

      const ds = useDataStore()
      const e2e = useE2E()
      const remoteCats = (catsRes.data || []).map(r => fromRemoteCategory(r)).filter(Boolean) as Category[]
      const remoteBms = (bmsRes.data || []).map(r => fromRemoteBookmark(r)).filter(Boolean) as Bookmark[]
      const remoteGroups = (groupsRes.data || []).map(r => fromRemoteGroup(r)).filter(Boolean) as SiblingGroup[]
      const remoteAttrs = (attrsRes.data || []).map(r => fromRemoteAttribute(r)).filter(Boolean) as CustomAttribute[]

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

      // ── 删除同步：拉取远端已软删除但本地仍活的条目 ──
      // 当前增量查询已包含 updated_at_num > since 的软删除行（deleted_at 被更新），
      // 此管道作为防御性补充，捕获未来可能出现的漏删边缘情况。
      const [delBmsRes, delGroupsRes, delCatsRes, delAttrsRes] = await Promise.all([
        supabase.from('bookmarks').select('id, updated_at_num').eq('user_id', userId).not('deleted_at', 'is', null).gt('updated_at_num', since),
        supabase.from('sibling_groups').select('id, updated_at_num').eq('user_id', userId).not('deleted_at', 'is', null).gt('updated_at_num', since),
        supabase.from('categories').select('id, updated_at_num').eq('user_id', userId).not('deleted_at', 'is', null).gt('updated_at_num', since),
        supabase.from('custom_attributes').select('id, updated_at_num').eq('user_id', userId).not('deleted_at', 'is', null).gt('updated_at_num', since),
      ])

      for (const r of [delBmsRes, delGroupsRes, delCatsRes, delAttrsRes]) {
        if (r.error) { console.warn('[sync] deletion sync query failed:', r.error); continue }
        for (const row of r.data || []) {
          const id = row.id as string
          // 仅处理本地仍活着的项（避免重复删除）
          if (ds.bookmarkMap[id] && !ds.bookmarkMap[id].deletedAt) {
            ds.deleteBookmark(id)
            ds._dirtyIds.delete(id)
            ds._newIds.delete(id)
          } else if (ds.groupMap[id] && !ds.groupMap[id].deletedAt) {
            ds.deleteGroup(id)
            ds._dirtyIds.delete(id)
            ds._newIds.delete(id)
          }
          const cat = ds.categories.find(c => c.id === id)
          if (cat && !cat.deletedAt) {
            ds.deleteCategory(id)
            ds._dirtyIds.delete(id)
            ds._newIds.delete(id)
          }
          const attr = ds.customAttributes.find(a => a.id === id)
          if (attr && !attr.deletedAt) {
            ds.deleteAttribute(id)
            ds._dirtyIds.delete(id)
            ds._newIds.delete(id)
          }
        }
      }

      syncStore.setLastSyncAt(Date.now())
      syncStore.setSyncStatus('success')
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '同步失败'
      syncStore.setSyncStatus('error')
      syncStore.setSyncError(msg)
      console.warn('[sync] pull failed:', e)
      return false
    }
  }

  // ── 公共 API ──

  function debouncedSync() {
    if (!syncStore.autoSync || !isLoggedIn.value) return
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
      if (syncStore.autoSync) {
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
    syncStore.resetSyncState()
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
    if (!group) return null
    let bookmarks: Bookmark[] = []
    if (group.bookmarkIds.length) {
      const { data: bData } = await supabase.from('bookmarks').select('*').in('id', group.bookmarkIds)
      bookmarks = (bData || []).map(fromRemoteBookmark).filter(Boolean) as Bookmark[]
    }
    return { group, bookmarks }
  }

  return {
    syncStatus: toRef(syncStore, 'syncStatus'),
    lastSyncAt: toRef(syncStore, 'lastSyncAt'),
    syncError: toRef(syncStore, 'syncError'),
    autoSync: toRef(syncStore, 'autoSync'),
    pendingCount: toRef(syncStore, 'pendingCount'),
    realtimeStatus: toRef(syncStore, 'realtimeStatus'),
    syncLabel,

    pushToCloud: _pushFromQueue, pullFromCloud: _pullChanges, fullSync,
    debouncedSync, initialSync, resetSyncState,
    initOnlineListener, destroyOnlineListener,
    refreshPendingCount,

    subscribeRealtime: () => subscribeRealtime(_pullChanges), unsubscribeRealtime,
    fetchHistory: (itemId: string) => fetchHistory(itemId),
    restoreFromHistory: (historyId: number, itemId: string, itemType: 'bookmark' | 'group') => restoreFromHistory(historyId, itemId, itemType),

    // 冲突管理（toRef 避免 Pinia 自动解包 ref → 保持 .value 访问不变）
    conflicts: toRef(syncStore, 'conflicts'),
    conflictBannerDismissed: toRef(syncStore, 'conflictBannerDismissed'),
    resolveConflict,
    resolveAllConflicts,
    resetConflictBannerDismissed: syncStore.resetConflictBanner,

    setGroupPublic, fetchPublicGroup,
  }
}
