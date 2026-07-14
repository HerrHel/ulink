/**
 * useSyncRealtime — Supabase Realtime 订阅管理
 * 依赖：通过 onPullChanges 回调与主同步模块解耦
 */
import { supabase } from '../../lib/supabase.js'
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { debouncedSaveAppData } from '../../stores/app.js'
import { useE2E } from './useE2E.js'
import { _getUserId } from './useSyncHistory.js'
import { fromRemoteBookmark, fromRemoteGroup, fromRemoteCategory, fromRemoteAttribute } from './useSyncMapping.js'
import type { EntityType } from '../../types.js'

let _channel: ReturnType<typeof supabase.channel> | null = null
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _reconnectAttempts = 0
// 连接代际：每次 subscribeRealtime 自增。旧 channel 异步 removeChannel 期间
// 仍可能派发状态回调，若不区代，旧 cb 的 CHANNEL_ERROR/CLOSED 会误调度重连，
// 调 unsubscribeRealtime 时移除的却是当前 _channel（已可能是新代），把刚建的
// 新 channel 误移除——形成重连风暴 + 多 channel 订阅同表收重复事件。
// cb 闭包捕获 myGen，与 _gen 不符即视为旧代状态，直接忽略。
let _gen = 0
const MAX_RECONNECT_ATTEMPTS = 10
const BASE_RECONNECT_DELAY = 1000

/** 带锁执行 */
async function _withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, { mode: 'exclusive' }, fn)
  }
  return fn()
}

/** 处理 Realtime 变更事件。S13：收到事件后再按 user_id 校验（纵深防护——即使
 *  channel filter 因配置错误/策略变更被绕过，也不处理他人数据）。
 *  导出含 _ 前缀（约定私有），供单测覆盖 S13 纵深防护逻辑。 */
export async function _handleRealtimeChange(payload: any, type: EntityType) {
  const { eventType, new: newRow, old: oldRow } = payload
  const ds = useDataStore()
  const userId = _getUserId()
  if (!userId) return
  // 新行与旧行的 user_id 均须匹配当前用户（任一不匹配即跳过）
  const rowUserId = newRow?.user_id || oldRow?.user_id
  if (rowUserId && rowUserId !== userId) return

  if (eventType === 'DELETE') {
    const id = oldRow?.id
    if (!id || ds._dirtyIds.has(id)) return
    // 使用 dataStore 软删除动作（而非直接 splice），确保：
    // - 数据进入回收站可恢复
    // - 组引用关系正确清理
    // 然后清除 dirty 标记，避免下次同步把已删除数据重新 upsert 回 Supabase
    //
    // 回声防护：deleteBookmark 会把「该 bookmark 所属的 groups」从 bookmarkIds 剔除并
    // _markDirty(g.id)（波及关联行）。远端 DELETE 引发的本机衍生清理不该被当作本地
    // 改动回推远端——否则这些 group 会被 partial/full upsert 推回，造成回声流量 +
    // updated_at_num 污染面（与上方 upsert 分支第 143 行 _changedFields.delete 同理，
    // 但旧实现漏了删除分支的波及行清理）。删除前快照 dirty 集，删除后清掉新增的波及项。
    if (type === 'bookmark') {
      const dirtyBefore = new Set(ds._dirtyIds)
      const changedBefore = new Set(ds._changedFields.keys())
      ds.deleteBookmark(id)
      for (const did of ds._dirtyIds) if (!dirtyBefore.has(did) && did !== id) ds._dirtyIds.delete(did)
      for (const cid of ds._changedFields.keys()) if (!changedBefore.has(cid) && cid !== id) ds._changedFields.delete(cid)
    } else if (type === 'group') {
      ds.deleteGroup(id)
    } else if (type === 'category') {
      ds.deleteCategory(id)
    } else if (type === 'attribute') {
      ds.deleteAttribute(id)
    }
    ds._dirtyIds.delete(id)
    return
  }

  const row = newRow
  if (!row || ds._dirtyIds.has(row.id)) return

  const e2e = useE2E()

  const HANDLERS: Record<EntityType, { from: (row: any) => any; upsert: (m: any) => void }> = {
    bookmark: {
      from: fromRemoteBookmark,
      upsert: (m: any) => {
        if (ds.bookmarkMap[m.id]) {
          const oldParentId = ds.bookmarks.find(b => b.id === m.id)?.parentId
          const remoteUpdatedAt = m.updatedAt
          ds.updateBookmark(m.id, m)
          // 恢复远端 updatedAt，避免被 Date.now() 覆盖
          const idx = ds.bookmarks.findIndex(b => b.id === m.id)
          if (idx >= 0) ds.bookmarks[idx].updatedAt = remoteUpdatedAt
          ds._bmMap[m.id] = ds.bookmarks[idx]
          // parentId 变更时更新 _childrenIdx
          if (oldParentId !== m.parentId) {
            if (oldParentId) {
              const sib = ds._childrenIdx[oldParentId]
              if (sib) { const ci = sib.indexOf(m.id); if (ci >= 0) sib.splice(ci, 1) }
            }
            if (m.parentId) {
              if (!ds._childrenIdx[m.parentId]) ds._childrenIdx[m.parentId] = []
              if (ds._childrenIdx[m.parentId].indexOf(m.id) === -1) ds._childrenIdx[m.parentId].push(m.id)
            }
          }
        } else {
          ds.addBookmark(m)
        }
        // Realtime 变更来自远端，不清除会在下次 sync 重新推送回 Supabase
        ds._dirtyIds.delete(m.id); ds._newIds.delete(m.id)
      },
    },
    group: {
      from: fromRemoteGroup,
      upsert: (m: any) => {
        if (ds.groupMap[m.id]) {
          const remoteUpdatedAt = m.updatedAt
          ds.updateGroup(m.id, m)
          const idx = ds.siblingGroups.findIndex(g => g.id === m.id)
          if (idx >= 0) ds.siblingGroups[idx].updatedAt = remoteUpdatedAt
          ds._grpMap[m.id] = ds.siblingGroups[idx]
        } else {
          ds.addGroup(m)
        }
        ds._dirtyIds.delete(m.id); ds._newIds.delete(m.id)
      },
    },
    category: {
      from: fromRemoteCategory,
      upsert: (m: any) => {
        const i = ds.categories.findIndex(c => c.id === m.id)
        if (i >= 0) ds.categories[i] = { ...ds.categories[i], ...m, updatedAt: m.updatedAt }
        else ds.categories = [...ds.categories, m]
        // category/attribute 没有完整 update action，直接重建索引
        ds._catMap[m.id] = ds.categories.find(c => c.id === m.id)!
      },
    },
    attribute: {
      from: fromRemoteAttribute,
      upsert: (m: any) => {
        const i = ds.customAttributes.findIndex(a => a.id === m.id)
        if (i >= 0) ds.customAttributes[i] = { ...ds.customAttributes[i], ...m, updatedAt: m.updatedAt }
        else ds.customAttributes = [...ds.customAttributes, m]
        ds._attrMap[m.id] = ds.customAttributes.find(a => a.id === m.id)!
      },
    },
  }

  const h = HANDLERS[type]
  const mapped = h.from(row)
  if (!mapped) return  // Zod 校验失败的远端条目跳过
  // decryptItem 返回浅拷贝，必须使用返回值，否则 upsert 仍是密文（RE-1）
  const plain = e2e.isUnlocked.value
    ? await e2e.decryptItem(type, mapped as any)
    : mapped
  h.upsert(plain)
  // 清除本次 merge 产生的 _changedFields：updateBookmark/updateGroup 内部会
  // 对传入的所有字段 _trackChange，把这些远端来的字段累积进 _changedFields。
  // 若不清，下次本地真改动触发 debouncedSync 时，drainChangedFields() 会把
  // 这些远端字段当本地改动一并 partial update 推回远端——回声推送，
  // 不仅浪费配额，还会反复 bump updated_at_num 污染基于时间戳的冲突判定，
  // 多设备订阅时甚至级联回声。走到此处的 id 必不携带本地未推的 changedFields
  //（上面第 54 行 _dirtyIds.has(row.id) 已挡住本地正在编辑的条目），故直接
  // 清空该 id 的 _changedFields 安全，不影响真实本地改动。
  ds._changedFields.delete(plain.id)
  // Realtime 合并后落盘，避免刷新丢失对端变更（DATA-3）
  debouncedSaveAppData()
}

function _scheduleReconnect(onPullChanges: () => Promise<boolean>) {
  if (_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn('[realtime] max reconnect attempts reached')
    useSyncStore().setRealtimeStatus('error')
    return
  }
  // 防止同一连接连发 CHANNEL_ERROR+CLOSED（或旧代残余状态）时各自 _scheduleReconnect
  // 覆盖 _reconnectTimer 引用、泄漏前一个 timer（孤儿 fire 导致重复重连/订阅）。
  if (_reconnectTimer) clearTimeout(_reconnectTimer)
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, _reconnectAttempts), 30000)
  _reconnectAttempts++
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null
    unsubscribeRealtime()
    subscribeRealtime(onPullChanges)
  }, delay)
}

export function subscribeRealtime(onPullChanges: () => Promise<boolean>) {
  const syncStore = useSyncStore()
  const userId = _getUserId()
  if (!userId || _channel) return

  _gen += 1
  const myGen = _gen

  syncStore.setRealtimeStatus('connecting')
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
      // 旧代 channel 的残余状态回调直接忽略——removeChannel 是异步的，旧 channel
      // 可能在被移除前/中仍派发 CHANNEL_ERROR/CLOSED，若不按代过滤会误调度重连并
      // 把当前 _channel（新代）误移除，导致重连风暴与多订阅。
      if (myGen !== _gen) return
      const s = useSyncStore()
      if (status === 'SUBSCRIBED') {
        s.setRealtimeStatus('connected')
        _reconnectAttempts = 0
        if (onPullChanges) {
          _withLock('linkvault-sync', onPullChanges).catch(() => {})
        }
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        s.setRealtimeStatus('error')
        _scheduleReconnect(onPullChanges)
      }
      if (status === 'CLOSED') {
        s.setRealtimeStatus('disconnected')
        _scheduleReconnect(onPullChanges)
      }
    })
}

export function unsubscribeRealtime() {
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
  _reconnectAttempts = 0
  useSyncStore().setRealtimeStatus('disconnected')
  if (_channel) {
    supabase.removeChannel(_channel)
    _channel = null
  }
}
