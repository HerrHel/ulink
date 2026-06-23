/**
 * useCloudSync.ts — Queue-based Cloud Sync with Realtime
 *
 * P0 改进：
 * - 操作队列持久化到 IndexedDB（页面崩溃不丢失）
 * - navigator.locks 替代 _syncing 布尔值（避免竞态丢弃）
 * - Supabase Realtime 订阅替代 60s 轮询（秒级同步）
 * - 增量拉取（updated_at_num > lastSyncAt）
 * P2 改进：
 * - 推送前加密敏感字段（E2E AES-256-GCM）
 * - 拉取后解密敏感字段
 * P4 改进：
 * - Realtime 断线自动重连（指数退避）
 * - 重连后 backfill 补全离线期间数据
 * - 连接状态可视化
 */
import { ref, computed } from 'vue'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from './useAuth.js'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'
import { useE2E } from './useE2E.js'
import {
  enqueueSyncOps, drainSyncOps, removeSyncOps, syncOpsCount,
  type SyncOp, type OpTable,
} from '../../stores/storage.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../../types.js'

// ── 状态 ──
const syncStatus = ref<'idle' | 'syncing' | 'success' | 'error'>('idle')
const lastSyncAt = ref<number>(0)
const syncError = ref<string | null>(null)
const autoSync = ref(true)
const realtimeStatus = ref<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')

// ── 冲突检测 ──
export interface SyncConflict {
  id: string
  type: 'bookmark' | 'group' | 'category' | 'attribute'
  local: unknown
  remote: unknown
}
const conflicts = ref<SyncConflict[]>([])
const _remoteSnapshots = new Map<string, unknown>()

// ── Realtime ──
let _channel: ReturnType<typeof supabase.channel> | null = null
let _initialized = false
let _syncTimer: ReturnType<typeof setTimeout> | null = null
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10
const BASE_RECONNECT_DELAY = 1000

// ── 辅助函数 ──
function _parsePassword(raw: unknown): string {
  return typeof raw === 'string' ? raw : ''
}

function _parseTimestamp(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') { const t = Date.parse(raw); return isNaN(t) ? 0 : t }
  return 0
}

function _getUserId(): string | null {
  const { user } = useAuth()
  return user.value?.id ?? null
}

function _snapshotLocal() {
  const ds = useDataStore()
  return {
    bookmarks: ds.bookmarks.map(b => ({ ...b, attributes: { ...b.attributes } })),
    siblingGroups: ds.siblingGroups.map(g => ({ ...g, attributes: { ...g.attributes }, bookmarkIds: [...g.bookmarkIds] })),
    categories: ds.categories.map(c => ({ ...c })),
    customAttributes: ds.customAttributes.map(a => ({ ...a })),
  }
}

// ── navigator.locks 封装 ──
async function _withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, { mode: 'exclusive' }, fn)
  }
  return fn()
}

// ── 表名映射 ──
const _tableMap: Record<string, OpTable> = {
  bookmark: 'bookmarks',
  group: 'sibling_groups',
  category: 'categories',
  attribute: 'custom_attributes',
}

// ── 字段名映射（本地 camelCase → 远端 snake_case）──
function _toRemoteRow(type: string, item: Record<string, any>, isNew: boolean): Record<string, any> {
  const now = Date.now()
  if (type === 'bookmark') {
    const row: Record<string, any> = {
      id: item.id, user_id: item._userId,
      title: item.title, url: item.url,
      username: item.username, password: JSON.stringify(item.password),
      notes: item.notes, icon: item.icon,
      category_id: item.categoryId, parent_id: item.parentId,
      order: item.order, use_count: item.useCount,
      attributes: item.attributes, is_expanded: item.isExpanded,
      created_at_num: item.createdAt, updated_at_num: item.updatedAt || now,
      deleted_at: item.deletedAt ? new Date(item.deletedAt).toISOString() : null,
    }
    return row
  }
  if (type === 'group') {
    return {
      id: item.id, user_id: item._userId,
      name: item.name, category_id: item.categoryId,
      icon: item.icon, order: item.order, is_expanded: item.isExpanded,
      attributes: item.attributes, bookmark_ids: item.bookmarkIds,
      notes: item.notes, use_count: item.useCount,
      is_public: item.isPublic || false,
      updated_at_num: item.updatedAt || now,
      deleted_at: item.deletedAt ? new Date(item.deletedAt).toISOString() : null,
    }
  }
  if (type === 'category') {
    return {
      id: item.id, user_id: item._userId,
      name: item.name, icon: item.icon, color: item.color,
      updated_at_num: item.updatedAt || now,
      deleted_at: item.deletedAt ? new Date(item.deletedAt).toISOString() : null,
    }
  }
  // attribute
  return {
    id: item.id, user_id: item._userId,
    name: item.name, type: item.type,
    updated_at_num: item.updatedAt || now,
    deleted_at: item.deletedAt ? new Date(item.deletedAt).toISOString() : null,
  }
}

// ── 从远端行映射回本地类型 ──
function _fromRemoteBookmark(r: any): Bookmark {
  return {
    id: r.id, title: r.title, url: r.url,
    username: r.username || '', password: _parsePassword(r.password),
    notes: r.notes || '', icon: r.icon || '',
    categoryId: r.category_id || 'uncategorized',
    parentId: r.parent_id || null,
    order: r.order || 0, useCount: r.use_count || 0,
    attributes: (r.attributes as Record<string, boolean>) || {},
    isExpanded: r.is_expanded || false,
    createdAt: r.created_at_num || 0,
    updatedAt: _parseTimestamp(r.updated_at) || r.updated_at_num || r.created_at_num || 0,
    deletedAt: r.deleted_at ? _parseTimestamp(r.deleted_at) : undefined,
  }
}

function _fromRemoteGroup(r: any): SiblingGroup {
  return {
    id: r.id, name: r.name,
    categoryId: r.category_id || 'uncategorized',
    icon: r.icon || '', order: r.order || 0,
    isExpanded: r.is_expanded || false,
    attributes: (r.attributes as Record<string, boolean>) || {},
    bookmarkIds: (r.bookmark_ids as string[]) || [],
    notes: r.notes || '', useCount: r.use_count || 0,
    updatedAt: _parseTimestamp(r.updated_at) || r.updated_at_num || 0,
    isPublic: r.is_public || false,
    deletedAt: r.deleted_at ? _parseTimestamp(r.deleted_at) : undefined,
  }
}

function _fromRemoteCategory(r: any): Category {
  return {
    id: r.id, name: r.name, icon: r.icon, color: r.color,
    updatedAt: r.updated_at_num || 0,
    deletedAt: r.deleted_at ? _parseTimestamp(r.deleted_at) : undefined,
  }
}

function _fromRemoteAttribute(r: any): CustomAttribute {
  return {
    id: r.id, name: r.name, type: (r.type as 'boolean') || 'boolean',
    updatedAt: r.updated_at_num || 0,
    deletedAt: r.deleted_at ? _parseTimestamp(r.deleted_at) : undefined,
  }
}

// ── 合并 ops：同 item 的多次操作合并为最终状态 ──
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
      // upsert：取最后一次的 data，但保留最早的 ts
      merged.push({ ...last, ts: itemOps[0].ts })
    }
  }
  return merged.sort((a, b) => a.ts - b.ts)
}

// ── 版本历史：保存旧状态 ──
async function _saveHistory(userId: string, items: Array<{ id: string; type: string; data: Record<string, any> }>) {
  if (!items.length) return
  const rows = items.map(i => ({ user_id: userId, item_id: i.id, item_type: i.type, data: i.data }))
  try {
    await supabase.from('data_history').insert(rows)
    // 清理旧历史：每 item 保留最近 10 条
    const itemIds = [...new Set(rows.map(r => r.item_id))]
    for (const itemId of itemIds) {
      const { data } = await supabase.from('data_history')
        .select('id').eq('user_id', userId).eq('item_id', itemId)
        .order('created_at', { ascending: false }).range(10, 1000)
      if (data && data.length) {
        await supabase.from('data_history').delete().in('id', data.map(r => r.id))
      }
    }
  } catch (e) {
    console.warn('[sync] history save failed:', e)
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

  const pendingCount = computed(async () => {
    return syncOpsCount()
  })

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

    // 书签
    for (const b of ds.bookmarks) {
      if (dirty.has(b.id)) {
        ops.push({
          action: 'upsert', table: 'bookmarks', itemId: b.id,
          data: { ...b, _userId: userId, _isNew: _newIds.has(b.id), _changedFields: changedFields.has(b.id) ? [...changedFields.get(b.id)!] : null },
          ts: b.updatedAt || Date.now(),
        })
      }
    }
    // 组
    for (const g of ds.siblingGroups) {
      if (dirty.has(g.id)) {
        ops.push({
          action: 'upsert', table: 'sibling_groups', itemId: g.id,
          data: { ...g, _userId: userId, _isNew: _newIds.has(g.id), _changedFields: changedFields.has(g.id) ? [...changedFields.get(g.id)!] : null },
          ts: g.updatedAt || Date.now(),
        })
      }
    }
    // 分类
    for (const c of ds.categories) {
      if (dirty.has(c.id)) {
        ops.push({
          action: 'upsert', table: 'categories', itemId: c.id,
          data: { ...c, _userId: userId, _isNew: _newIds.has(c.id), _changedFields: changedFields.has(c.id) ? [...changedFields.get(c.id)!] : null },
          ts: c.updatedAt || Date.now(),
        })
      }
    }
    // 属性
    for (const a of ds.customAttributes) {
      if (dirty.has(a.id)) {
        ops.push({
          action: 'upsert', table: 'custom_attributes', itemId: a.id,
          data: { ...a, _userId: userId, _isNew: _newIds.has(a.id), _changedFields: changedFields.has(a.id) ? [...changedFields.get(a.id)!] : null },
          ts: a.updatedAt || Date.now(),
        })
      }
    }

    // 删除
    for (const [id, table] of deleted) {
      ops.push({ action: 'delete', table, itemId: id, data: null, ts: Date.now() })
    }

    if (ops.length) enqueueSyncOps(ops)
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
      // 版本历史：对更新项保存旧状态
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
      _saveHistory(userId, historyItems) // fire-and-forget

      // 构建批量请求
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

          // P2: 推送前加密敏感字段
          const e2e = useE2E()
          const itemType = op.table === 'bookmarks' ? 'bookmark'
            : op.table === 'sibling_groups' ? 'group'
            : op.table === 'categories' ? 'category' : 'attribute'
          const encryptedData = await e2e.encryptItem(itemType as any, data)

          const row = _toRemoteRow(
            itemType,
            { ...encryptedData, _userId: userId },
            isNew,
          )

          if (isNew || !changedFields) {
            // 全量 upsert
            tasks.push(
              Promise.resolve(supabase.from(op.table).upsert(row, { onConflict: 'id' }))
                .then(r => ({ op, result: r }))
            )
          } else {
            // 增量 update（仅变更字段）
            const partial: Record<string, any> = { id: op.itemId, user_id: userId, updated_at_num: row.updated_at_num }
            for (const f of changedFields) {
              if (f in row && f !== 'id' && f !== 'user_id') partial[f] = row[f]
              // camelCase → snake_case 映射
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

      const results = await Promise.all(tasks)
      for (const r of results) {
        if (r.result.error) throw r.result.error
        // 找到对应的 rawOp id
        const rawMatch = rawOps.find(ro => ro.itemId === r.op.itemId && ro.table === r.op.table)
        if (rawMatch?.id != null) succeededIds.push(rawMatch.id)
      }

      // 删除已成功的 ops
      if (succeededIds.length) await removeSyncOps(succeededIds)
      // 清理 newIds 标记
      for (const op of ops) ds._newIds.delete(op.itemId)

      lastSyncAt.value = Date.now()
      syncStatus.value = 'success'
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '同步失败'
      syncStatus.value = 'error'
      syncError.value = msg
      console.warn('[sync] push failed:', e)
      // ops 仍在队列中，下次重试
      return false
    }
  }

  // ── 增量拉取（backfill）──
  async function _pullChanges(): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    if (!navigator.onLine) { syncError.value = '网络离线'; return false }

    syncStatus.value = 'syncing'
    syncError.value = null

    try {
      const since = lastSyncAt.value || 0

      const [catsRes, bmsRes, groupsRes, attrsRes] = await Promise.all([
        supabase.from('categories').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('bookmarks').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('sibling_groups').select('*').eq('user_id', userId).gt('updated_at_num', since),
        supabase.from('custom_attributes').select('*').eq('user_id', userId).gt('updated_at_num', since),
      ])

      for (const r of [catsRes, bmsRes, groupsRes, attrsRes]) { if (r.error) throw r.error }

      const ds = useDataStore()

      // P2: 拉取后解密敏感字段
      const e2e = useE2E()
      const remoteCats = (catsRes.data || []).map(r => _fromRemoteCategory(r))
      const remoteBms = (bmsRes.data || []).map(r => _fromRemoteBookmark(r))
      const remoteGroups = (groupsRes.data || []).map(r => _fromRemoteGroup(r))
      const remoteAttrs = (attrsRes.data || []).map(r => _fromRemoteAttribute(r))

      // 异步解密（不阻塞合并）
      if (e2e.isUnlocked.value) {
        for (const b of remoteBms) await e2e.decryptItem('bookmark', b as any)
        for (const g of remoteGroups) await e2e.decryptItem('group', g as any)
        for (const c of remoteCats) await e2e.decryptItem('category', c as any)
        for (const a of remoteAttrs) await e2e.decryptItem('attribute', a as any)
      }

      // 智能合并
      _mergeIntoLocal(ds.categories, remoteCats, 'category')
      _mergeIntoLocal(ds.bookmarks, remoteBms, 'bookmark')
      _mergeIntoLocal(ds.siblingGroups, remoteGroups, 'group')
      _mergeIntoLocal(ds.customAttributes, remoteAttrs, 'attribute')

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

  // ── 智能合并：远端 → 本地 ──
  function _mergeIntoLocal<T extends { id: string; updatedAt?: number; deletedAt?: number }>(
    local: T[], remote: T[], type: SyncConflict['type'],
  ) {
    const ds = useDataStore()
    const localMap = new Map(local.map(i => [i.id, i]))

    for (const rItem of remote) {
      const lItem = localMap.get(rItem.id)
      if (!lItem) {
        // 远端有、本地无 → 新增
        local.push(rItem)
      } else if (ds._dirtyIds.has(rItem.id)) {
        // 本地有未推送修改
        const remoteNewer = (rItem.updatedAt || 0) > (lItem.updatedAt || 0)
        if (remoteNewer && lastSyncAt.value > 0) {
          // 双向修改冲突
          const conflictId = `${type}:${rItem.id}`
          if (!_remoteSnapshots.has(conflictId)) {
            _remoteSnapshots.set(conflictId, JSON.parse(JSON.stringify(rItem)))
            conflicts.value.push({
              id: rItem.id, type,
              local: JSON.parse(JSON.stringify(lItem)),
              remote: JSON.parse(JSON.stringify(rItem)),
            })
          }
        }
        // 保留本地
      } else if ((rItem.updatedAt || 0) > (lItem.updatedAt || 0)) {
        // 远端更新，本地未修改 → 采用远端
        Object.assign(lItem, rItem)
      }
    }

    // 远端已删除（本地未 dirty 的项）
    const remoteIds = new Set(remote.map(r => r.id))
    for (let i = local.length - 1; i >= 0; i--) {
      const lItem = local[i]
      if (!remoteIds.has(lItem.id) && !ds._dirtyIds.has(lItem.id) && lastSyncAt.value > 0) {
        local.splice(i, 1)
      }
    }
  }

  // ── Realtime 订阅 ──
  async function _handleRealtimeChange(payload: any, type: 'bookmark' | 'group' | 'category' | 'attribute') {
    const { eventType, new: newRow, old: oldRow } = payload
    const ds = useDataStore()

    if (eventType === 'DELETE') {
      const id = oldRow?.id
      if (!id || ds._dirtyIds.has(id)) return
      // 从本地移除
      if (type === 'bookmark') { const idx = ds.bookmarks.findIndex(b => b.id === id); if (idx >= 0) ds.bookmarks.splice(idx, 1) }
      else if (type === 'group') { const idx = ds.siblingGroups.findIndex(g => g.id === id); if (idx >= 0) ds.siblingGroups.splice(idx, 1) }
      else if (type === 'category') { const idx = ds.categories.findIndex(c => c.id === id); if (idx >= 0) ds.categories.splice(idx, 1) }
      else { const idx = ds.customAttributes.findIndex(a => a.id === id); if (idx >= 0) ds.customAttributes.splice(idx, 1) }
      return
    }

    // INSERT / UPDATE
    const row = newRow
    if (!row || ds._dirtyIds.has(row.id)) return

    // P2: 解密后再合并
    const e2e = useE2E()

    if (type === 'bookmark') {
      const mapped = _fromRemoteBookmark(row)
      if (e2e.isUnlocked.value) await e2e.decryptItem('bookmark', mapped as any)
      const idx = ds.bookmarks.findIndex(b => b.id === mapped.id)
      if (idx >= 0) Object.assign(ds.bookmarks[idx], mapped)
      else ds.bookmarks.push(mapped)
    } else if (type === 'group') {
      const mapped = _fromRemoteGroup(row)
      if (e2e.isUnlocked.value) await e2e.decryptItem('group', mapped as any)
      const idx = ds.siblingGroups.findIndex(g => g.id === mapped.id)
      if (idx >= 0) Object.assign(ds.siblingGroups[idx], mapped)
      else ds.siblingGroups.push(mapped)
    } else if (type === 'category') {
      const mapped = _fromRemoteCategory(row)
      if (e2e.isUnlocked.value) await e2e.decryptItem('category', mapped as any)
      const idx = ds.categories.findIndex(c => c.id === mapped.id)
      if (idx >= 0) Object.assign(ds.categories[idx], mapped)
      else ds.categories.push(mapped)
    } else {
      const mapped = _fromRemoteAttribute(row)
      if (e2e.isUnlocked.value) await e2e.decryptItem('attribute', mapped as any)
      const idx = ds.customAttributes.findIndex(a => a.id === mapped.id)
      if (idx >= 0) Object.assign(ds.customAttributes[idx], mapped)
      else ds.customAttributes.push(mapped)
    }
  }

  function _scheduleReconnect() {
    if (_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[realtime] max reconnect attempts reached')
      realtimeStatus.value = 'error'
      return
    }
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, _reconnectAttempts), 30000)
    _reconnectAttempts++
    console.log(`[realtime] reconnecting in ${delay}ms (attempt ${_reconnectAttempts})`)
    _reconnectTimer = setTimeout(() => {
      _reconnectTimer = null
      unsubscribeRealtime()
      subscribeRealtime()
    }, delay)
  }

  function subscribeRealtime() {
    const userId = _getUserId()
    if (!userId || _channel) return

    realtimeStatus.value = 'connecting'
    _channel = supabase.channel('db-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bookmarks', filter: `user_id=eq.${userId}` },
        (p) => _handleRealtimeChange(p, 'bookmark'))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'sibling_groups', filter: `user_id=eq.${userId}` },
        (p) => _handleRealtimeChange(p, 'group'))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'categories', filter: `user_id=eq.${userId}` },
        (p) => _handleRealtimeChange(p, 'category'))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'custom_attributes', filter: `user_id=eq.${userId}` },
        (p) => _handleRealtimeChange(p, 'attribute'))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[realtime] subscribed')
          realtimeStatus.value = 'connected'
          _reconnectAttempts = 0
          // 重连后 backfill 补全离线期间数据
          if (lastSyncAt.value > 0) {
            _withLock('linkvault-sync', _pullChanges).catch(() => {})
          }
        }
        if (status === 'CHANNEL_ERROR') {
          console.warn('[realtime] channel error')
          realtimeStatus.value = 'error'
          _scheduleReconnect()
        }
        if (status === 'TIMED_OUT') {
          console.warn('[realtime] timed out')
          realtimeStatus.value = 'error'
          _scheduleReconnect()
        }
        if (status === 'CLOSED') {
          realtimeStatus.value = 'disconnected'
          // 非主动关闭时自动重连
          if (isLoggedIn.value) _scheduleReconnect()
        }
      })
  }

  function unsubscribeRealtime() {
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
    _reconnectAttempts = 0
    realtimeStatus.value = 'disconnected'
    if (_channel) {
      supabase.removeChannel(_channel)
      _channel = null
    }
  }

  // ── 公共 API ──

  /** 防抖同步：save 时调用，把 dirtyIds → ops_queue → 3s 后 push */
  function debouncedSync() {
    if (!autoSync.value || !isLoggedIn.value) return
    _enqueueDirtyAsOps()
    if (_syncTimer) clearTimeout(_syncTimer)
    _syncTimer = setTimeout(() => {
      _syncTimer = null
      _withLock('linkvault-sync', _pushFromQueue)
    }, 3000)
  }

  /** 手动全量同步：push → pull */
  async function fullSync(): Promise<boolean> {
    _enqueueDirtyAsOps()
    return _withLock('linkvault-sync', async () => {
      const pushed = await _pushFromQueue()
      if (pushed) await _pullChanges()
      return pushed
    })
  }

  /** 首次登录后初始化同步 */
  async function initialSync(): Promise<void> {
    if (_initialized || !isLoggedIn.value) return
    _initialized = true

    await _withLock('linkvault-sync', async () => {
      // 先拉取远端数据
      await _pullChanges()
      // 把本地所有数据入队推送
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

    subscribeRealtime()
  }

  /** 离线恢复 */
  function _onOnline() {
    if (!isLoggedIn.value) return
    _enqueueDirtyAsOps()
    _withLock('linkvault-sync', _pushFromQueue).then(() => _pullChanges())
  }

  /** 切回标签页 */
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

  /** 初始化事件监听 */
  function initOnlineListener() {
    window.addEventListener('online', _onOnline)
    document.addEventListener('visibilitychange', _onVisibilityChange)
    if (isLoggedIn.value) subscribeRealtime()
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
    _remoteSnapshots.clear()
    unsubscribeRealtime()
  }

  // ── 冲突解决 ──
  function resolveConflict(id: string, keepLocal: boolean) {
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
      useAppStore().save()
    }
    _remoteSnapshots.delete(`${conflict.type}:${id}`)
    conflicts.value.splice(idx, 1)
  }

  function resolveAllConflicts(keepLocal: boolean) {
    for (let i = conflicts.value.length - 1; i >= 0; i--) {
      resolveConflict(conflicts.value[i].id, keepLocal)
    }
  }

  // ── 版本历史 ──
  async function fetchHistory(itemId: string): Promise<Array<{ id: number; data: unknown; created_at: string }>> {
    const userId = _getUserId()
    if (!userId) return []
    const { data, error } = await supabase.from('data_history')
      .select('id, data, created_at').eq('user_id', userId).eq('item_id', itemId)
      .order('created_at', { ascending: false }).limit(10)
    if (error) { console.warn('[history] fetch failed:', error); return [] }
    return data || []
  }

  async function restoreFromHistory(historyId: number, itemId: string, itemType: 'bookmark' | 'group'): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    const { data, error } = await supabase.from('data_history')
      .select('data').eq('id', historyId).eq('user_id', userId).single()
    if (error || !data) { console.warn('[history] fetch version failed:', error); return false }
    const ds = useDataStore()
    const histData = data.data as Record<string, unknown>
    if (itemType === 'bookmark') {
      ds.updateBookmark(itemId, {
        title: histData.title as string, url: histData.url as string,
        username: histData.username as string, password: histData.password as string,
        notes: histData.notes as string, icon: histData.icon as string,
        categoryId: histData.categoryId as string, parentId: histData.parentId as string | null,
        order: histData.order as number, useCount: histData.useCount as number,
        attributes: histData.attributes as Record<string, boolean>,
        isExpanded: histData.isExpanded as boolean,
      })
    } else {
      ds.updateGroup(itemId, {
        name: histData.name as string, categoryId: histData.categoryId as string,
        icon: histData.icon as string, order: histData.order as number,
        isExpanded: histData.isExpanded as boolean,
        attributes: histData.attributes as Record<string, boolean>,
        bookmarkIds: histData.bookmarkIds as string[],
        notes: histData.notes as string, useCount: histData.useCount as number,
      })
    }
    useAppStore().save()
    return true
  }

  // ── 公开分享 ──
  async function setGroupPublic(gid: string, isPublic: boolean): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    const ds = useDataStore()
    const g = ds.groupMap[gid]
    if (!g) return false
    ds.updateGroup(gid, { isPublic })
    useAppStore().save()
    const { error } = await supabase.from('sibling_groups')
      .update({ is_public: isPublic }).eq('id', gid).eq('user_id', userId)
    if (error) { console.warn('[share] setGroupPublic failed:', error); return false }
    return true
  }

  async function fetchPublicGroup(gid: string): Promise<{ group: SiblingGroup; bookmarks: Bookmark[] } | null> {
    const { data: gData, error: gErr } = await supabase.from('sibling_groups')
      .select('*').eq('id', gid).eq('is_public', true).maybeSingle()
    if (gErr || !gData) return null
    const group = _fromRemoteGroup(gData)
    let bookmarks: Bookmark[] = []
    if (group.bookmarkIds.length) {
      const { data: bData } = await supabase.from('bookmarks').select('*').in('id', group.bookmarkIds)
      bookmarks = (bData || []).map(_fromRemoteBookmark)
    }
    return { group, bookmarks }
  }

  return {
    syncStatus, lastSyncAt, syncError, autoSync, syncLabel, pendingCount,
    realtimeStatus,
    conflicts, resolveConflict, resolveAllConflicts,
    pushToCloud: _pushFromQueue, pullFromCloud: _pullChanges, fullSync,
    debouncedSync, initialSync, resetSyncState,
    initOnlineListener, destroyOnlineListener,
    subscribeRealtime, unsubscribeRealtime,
    fetchHistory, restoreFromHistory,
    setGroupPublic, fetchPublicGroup,
  }
}
