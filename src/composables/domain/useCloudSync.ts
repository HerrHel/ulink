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

import {
  enqueueSyncOps, drainSyncOps, removeSyncOps, syncOpsCount, updateSyncOpRetry,
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

/** 单条 sync op 最大推送重试次数：超过即移出队列，避免失败 op 无限堆积
 *  导致「恢复了又没了」的同步死结（数据本体在 ds.bookmarks，删 op 不丢数据）。 */
const MAX_PUSH_RETRIES = 3

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
// ── 回声防护删除 ──
// 远端 DELETE / 软删合并触发的本机删除会产生衍生的关联行 dirty：
//  - deleteBookmark 会从所属 groups 剔除并 _markDirty(g.id)
//  - deleteCategory 会把该分类下所有 bookmark/group 的 categoryId 改 UNCATEGORIZED 并 _markDirty + _trackChange
//  - deleteAttribute 会遍历所有项删 attributes key 同样 _markDirty + _trackChange
// 这些衍生 dirty 若不清，下次 debouncedSync 会把波及行回推远端——回声流量 + updated_at_num
// 污染面。删除前快照 dirty/changed 集合，删除后清掉因衍生新增的项（被删 id 自身也清）。
function _deleteWithoutEcho(ds: ReturnType<typeof useDataStore>, type: 'bookmark' | 'group' | 'category' | 'attribute', id: string) {
  const dirtyBefore = new Set(ds._dirtyIds)
  const changedBefore = new Set(ds._changedFields.keys())
  switch (type) {
    case 'bookmark': ds.deleteBookmark(id); break
    case 'group': ds.deleteGroup(id); break
    case 'category': ds.deleteCategory(id); break
    case 'attribute': ds.deleteAttribute(id); break
  }
  for (const did of ds._dirtyIds) if (!dirtyBefore.has(did) || did === id) ds._dirtyIds.delete(did)
  for (const cid of ds._changedFields.keys()) if (!changedBefore.has(cid) || cid === id) ds._changedFields.delete(cid)
  ds._newIds.delete(id)
}

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
          const type = op.table === 'bookmarks' ? 'bookmark'
            : op.table === 'sibling_groups' ? 'group'
            : op.table === 'categories' ? 'category' : 'attribute'
          // data_history.item_type 有 CHECK 约束仅允许 'bookmark'/'group'，
          // categories/attributes 入历史会撞约束导致整批 POST 400，
          // 且这两类结构简单无需版本回溯，跳过即可。
          if (type !== 'bookmark' && type !== 'group') continue
          const existing = op.table === 'bookmarks' ? ds.bookmarks.find(b => b.id === op.itemId)
            : ds.siblingGroups.find(g => g.id === op.itemId)
          if (existing) {
            historyItems.push({ id: op.itemId, type, data: { ...existing as any } })
          }
        }
      }
      _saveHistory(userId, historyItems).catch(() => {})

      const tasks: Promise<any>[] = []
      const succeededIds: number[] = []
      // 加密阶段失败（如 E2E encryptItem 抛错、row 构建异常）的 op 单独记录，
      // 不阻断其它 op 的推送——旧逻辑里任一 op 在循环内 await 抛错会让整个函数进 catch，
      // 后续 categories/attributes 的 task 根本进不了队列，导致「只推上去一部分」。
      const encFailedOps: Array<{ table: string; itemId: string; error: string }> = []
      const e2e = useE2E()

      for (const op of ops) {
        if (op.action === 'delete') {
          tasks.push(
            Promise.resolve(supabase.from(op.table).delete().eq('id', op.itemId).eq('user_id', userId))
              .then(r => ({ op, result: r }))
          )
          continue
        }
        if (!op.data) continue

        const data = op.data
        const changedFields = data._changedFields as string[] | null
        const isNew = data._isNew as boolean || false
        delete data._changedFields
        delete data._userId
        delete data._isNew

        const itemType = op.table === 'bookmarks' ? 'bookmark'
          : op.table === 'sibling_groups' ? 'group'
          : op.table === 'categories' ? 'category' : 'attribute'

        // per-op try：加密 + row 构建。任一环节抛错只跳过本条 op，不拖累整批。
        let row: Record<string, any>
        try {
          const encryptedData = await e2e.encryptItem(itemType as any, data)
          row = toRemoteRow(itemType, { ...encryptedData, _userId: userId }, isNew) as unknown as Record<string, any>
        } catch (err: any) {
          encFailedOps.push({ table: op.table, itemId: op.itemId, error: `加密/序列化失败: ${err?.message || String(err)}` })
          console.warn(`[sync] 加密阶段失败 table=${op.table} id=${op.itemId}`, err)
          continue
        }

        if (isNew || !changedFields) {
          tasks.push(
            Promise.resolve(supabase.from(op.table).upsert(row as any, { onConflict: 'id' }))
              .then(r => ({ op, result: r }))
              .catch(e => ({ op, result: { data: null, error: e, count: null, status: 0, statusText: String(e?.message || e) } }))
          )
        } else {
          // ⚠️ changedFields 中的 f 是 camelCase（本地字段），row 的键是 snake_case（远端列名）。
          // 旧代码直接 if (f in row) 几乎永不命中（除单字段如 title/url 恰好同名），
          // 导致 partial 只含 id/user_id/updated_at_num，退化成无意义的空更新。
          const partial: Record<string, any> = { id: op.itemId, user_id: userId, updated_at_num: row.updated_at_num }
          for (const f of changedFields) {
            const snakeKey = camelToSnake(f)
            // id/user_id 已在 partial 基础字段中，跳过
            if (snakeKey !== 'id' && snakeKey !== 'user_id' && snakeKey in row) {
              partial[snakeKey] = row[snakeKey]
            }
          }
          const { id, ...updateData } = partial
          tasks.push(
            Promise.resolve(supabase.from(op.table).update(updateData).eq('id', id).eq('user_id', userId))
              .then(r => ({ op, result: r }))
              .catch(e => ({ op, result: { data: null, error: e, count: null, status: 0, statusText: String(e?.message || e) } }))
          )
        }
      }

      const rawOpsMap = new Map(rawOps.map(ro => [`${ro.table}:${ro.itemId}`, ro]))
      const results = await Promise.all(tasks)
      // Promise.all 不会 reject：每个 task 都带 .catch，异常被规整成 { error } 对象。

      // ── per-op 结果收集（替代旧的 Promise.all+throw 一刀切）──
      // 旧逻辑：任一 op 失败就 throw，整批进 catch，但成功的 categories upsert
      // 已实际落库，导致「分类推上去了、书签全 0」的假象，且 succeededIds 永不执行、
      // 所有 op（含成功的）滞留队列无限重试。
      // 新逻辑：逐条判定，成功的 op 用 removeSyncOps 清除，失败的 op 留队列下次重试，
      // 并把每条失败的 table/itemId/error 打到 console，让根因可见。
      const failedOps: Array<{ table: string; itemId: string; error: string; op?: SyncOp }> = [...encFailedOps.map(f => ({ ...f, op: rawOpsMap.get(`${f.table}:${f.itemId}`) }))]
      const deadIds: number[] = []  // 超过 MAX_RETRIES 的失败 op：删掉避免无限堆积
      for (const r of results) {
        if (r.result.error) {
          const rawMatch = rawOpsMap.get(`${r.op.table}:${r.op.itemId}`)
          const retries = (rawMatch?.retries || 0) + 1
          failedOps.push({ table: r.op.table, itemId: r.op.itemId, error: r.result.error.message, op: rawMatch })
          // 重试上限：超过即从队列删除，防止「恢复了又没了」循环里失败 op 永不消除。
          // 数据本身存在 ds.bookmarks 里，删 op 不丢数据；下次本地改动会重新 enqueue。
          if (rawMatch?.id != null) {
            if (retries >= MAX_PUSH_RETRIES) {
              deadIds.push(rawMatch.id)
              console.warn(`[sync] op 达到重试上限(${MAX_PUSH_RETRIES})，移出队列 table=${r.op.table} id=${r.op.itemId}`)
            } else {
              await updateSyncOpRetry(rawMatch.id, retries)
            }
          }
          continue
        }
        const rawMatch = rawOpsMap.get(`${r.op.table}:${r.op.itemId}`)
        if (rawMatch?.id != null) succeededIds.push(rawMatch.id)
      }
      // 加密失败 op 同样走死信：超过重试上限删除
      for (const f of encFailedOps) {
        const rawMatch = rawOpsMap.get(`${f.table}:${f.itemId}`)
        if (rawMatch?.id != null && (rawMatch.retries || 0) + 1 >= MAX_PUSH_RETRIES) deadIds.push(rawMatch.id)
        else if (rawMatch?.id != null) {
          await updateSyncOpRetry(rawMatch.id, (rawMatch.retries || 0) + 1)
        }
      }

      if (succeededIds.length) {
        await removeSyncOps(succeededIds)
        refreshPendingCount()
      }
      if (deadIds.length) {
        await removeSyncOps(deadIds)
        refreshPendingCount()
      }
      for (const op of ops) ds._newIds.delete(op.itemId)

      if (failedOps.length) {
        // 仍有失败 op：不设 lastSyncAt（下次仍会重试这些 op，除非已达上限被移除），状态标 error
        for (const f of failedOps) {
          console.warn(`[sync] push 失败 table=${f.table} id=${f.itemId} error=${f.error}`)
        }
        // dump 第一条失败 op 的完整入队数据，让 Supabase 拒绝的具体字段内容可见
        const first = failedOps[0]
        if (first?.op?.data) console.warn(`[sync] 首条失败 op 原始 data:`, JSON.parse(JSON.stringify(first.op.data)))
        syncStore.setSyncStatus('error')
        syncStore.setSyncError(`${failedOps.length} 项推送失败：${failedOps[0].error}`)
        return false
      }

      syncStore.setLastSyncAt(Date.now())
      syncStore.setSyncStatus('success')
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '同步失败'
      syncStore.setSyncStatus('error')
      syncStore.setSyncError(msg)
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
          if (ds.bookmarkMap[id] && !ds.bookmarkMap[id].deletedAt) _deleteWithoutEcho(ds, 'bookmark', id)
          else if (ds.groupMap[id] && !ds.groupMap[id].deletedAt) _deleteWithoutEcho(ds, 'group', id)
          const cat = ds.categories.find(c => c.id === id)
          if (cat && !cat.deletedAt) _deleteWithoutEcho(ds, 'category', id)
          const attr = ds.customAttributes.find(a => a.id === id)
          if (attr && !attr.deletedAt) _deleteWithoutEcho(ds, 'attribute', id)
        }
      }

      // ── 物理删除对账：远端整行被 .delete() 抹掉后，上面增量查询与软删防御查询都查不到该行
      // （既不在 updated_at_num>since 的存活行集、也不在 deleted_at IS NOT NULL 的软删集）。
      // 若对端「先软删 upsert（updated_at_num 落本机 since 之前）→ 再物理删」且本机从未同步过
      // 该软删态，本机将永远感知不到这次删除——仅漏删尚可接受，但更糟的是 initialSync 先全量
      // push 本地活副本会 upsert 一条 deleted_at:null 行回去，复活对端已物理删除的事实。
      // 纯前端修复：lastSyncAt>0（已同步过、非首同步）时，拉远端全量存活 id 集合做差集对账，
      // 本地有 + 远端无 + 非脏 → 软删本地（不入回收站不可恢复路径而是回收站可见的软删，与
      // _mergeIntoLocal 的 full 分支语义一致）。首同步 lastSyncAt=0 时跳过，避免误删本地新数据。
      if (syncStore.lastSyncAt > 0) {
        const [allBmRes, allGroupRes, allCatRes, allAttrRes] = await Promise.all([
          supabase.from('bookmarks').select('id').eq('user_id', userId),
          supabase.from('sibling_groups').select('id').eq('user_id', userId),
          supabase.from('categories').select('id').eq('user_id', userId),
          supabase.from('custom_attributes').select('id').eq('user_id', userId),
        ])
        const remoteAll = new Set<string>()
        for (const r of [allBmRes, allGroupRes, allCatRes, allAttrRes]) {
          if (r.error) { console.warn('[sync] reconcile id query failed:', r.error); continue }
          for (const row of r.data || []) remoteAll.add((row as { id: string }).id)
        }
        const reconcileDelete = (type: 'bookmark' | 'group' | 'category' | 'attribute', id: string) => {
          if (ds._dirtyIds.has(id)) return  // 正在本地编辑/等推送的条目不删
          _deleteWithoutEcho(ds, type, id)
        }
        for (const b of ds.bookmarks) {
          if (!b.deletedAt && !remoteAll.has(b.id)) reconcileDelete('bookmark', b.id)
        }
        for (const g of ds.siblingGroups) {
          if (!g.deletedAt && !remoteAll.has(g.id)) reconcileDelete('group', g.id)
        }
        for (const c of ds.categories) {
          if (!c.deletedAt && !remoteAll.has(c.id)) reconcileDelete('category', c.id)
        }
        for (const a of ds.customAttributes) {
          if (!a.deletedAt && !remoteAll.has(a.id)) reconcileDelete('attribute', a.id)
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
      // 先推送本地数据到云端（upsert），再全量拉取合并。
      // 如果先拉再推：云端为空 + lastSyncAt > 0（被 realtime 提前设值）时，
      // _pullChanges 的 full 分支会把本地书签误删。
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

      // 增量拉取（非 full）：推成功后 lastSyncAt 已设，只拉增量；
      // 推失败则 lastSyncAt 仍为 0，拉全量但不做 full 分支的删除。
      await _pullChanges(false)
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
