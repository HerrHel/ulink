/**
 * useSyncRealtime — Supabase Realtime 订阅管理
 * 依赖：通过 onPullChanges 回调与主同步模块解耦
 */
import { ref } from 'vue'
import { supabase } from '../../lib/supabase.js'
import { useDataStore } from '../../stores/data.js'
import { useE2E } from './useE2E.js'
import { _getUserId } from './useSyncHistory.js'
import { fromRemoteBookmark, fromRemoteGroup, fromRemoteCategory, fromRemoteAttribute } from './useSyncMapping.js'

export const realtimeStatus = ref<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')

let _channel: ReturnType<typeof supabase.channel> | null = null
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10
const BASE_RECONNECT_DELAY = 1000

/** 带锁执行 */
async function _withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, { mode: 'exclusive' }, fn)
  }
  return fn()
}

/** 处理 Realtime 变更事件 */
async function _handleRealtimeChange(payload: any, type: 'bookmark' | 'group' | 'category' | 'attribute') {
  const { eventType, new: newRow, old: oldRow } = payload
  const ds = useDataStore()

  if (eventType === 'DELETE') {
    const id = oldRow?.id
    if (!id || ds._dirtyIds.has(id)) return
    if (type === 'bookmark') { const idx = ds.bookmarks.findIndex(b => b.id === id); if (idx >= 0) ds.bookmarks.splice(idx, 1) }
    else if (type === 'group') { const idx = ds.siblingGroups.findIndex(g => g.id === id); if (idx >= 0) ds.siblingGroups.splice(idx, 1) }
    else if (type === 'category') { const idx = ds.categories.findIndex(c => c.id === id); if (idx >= 0) ds.categories.splice(idx, 1) }
    else { const idx = ds.customAttributes.findIndex(a => a.id === id); if (idx >= 0) ds.customAttributes.splice(idx, 1) }
    return
  }

  const row = newRow
  if (!row || ds._dirtyIds.has(row.id)) return

  const e2e = useE2E()

  const HANDLERS = {
    bookmark: { from: fromRemoteBookmark, list: () => ds.bookmarks },
    group: { from: fromRemoteGroup, list: () => ds.siblingGroups },
    category: { from: fromRemoteCategory, list: () => ds.categories },
    attribute: { from: fromRemoteAttribute, list: () => ds.customAttributes },
  } as const

  const h = HANDLERS[type]
  const mapped = h.from(row)
  if (e2e.isUnlocked.value) await e2e.decryptItem(type, mapped as any)
  const list = h.list()
  const idx = list.findIndex((item: any) => item.id === mapped.id)
  if (idx >= 0) Object.assign(list[idx], mapped)
  else list.push(mapped)
}

function _scheduleReconnect(onPullChanges: () => Promise<boolean>) {
  if (_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn('[realtime] max reconnect attempts reached')
    realtimeStatus.value = 'error'
    return
  }
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, _reconnectAttempts), 30000)
  _reconnectAttempts++
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null
    unsubscribeRealtime()
    subscribeRealtime(onPullChanges)
  }, delay)
}

export function subscribeRealtime(onPullChanges: () => Promise<boolean>) {
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
        realtimeStatus.value = 'connected'
        _reconnectAttempts = 0
        if (onPullChanges) {
          _withLock('linkvault-sync', onPullChanges).catch(() => {})
        }
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        realtimeStatus.value = 'error'
        _scheduleReconnect(onPullChanges)
      }
      if (status === 'CLOSED') {
        realtimeStatus.value = 'disconnected'
        _scheduleReconnect(onPullChanges)
      }
    })
}

export function unsubscribeRealtime() {
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
  _reconnectAttempts = 0
  realtimeStatus.value = 'disconnected'
  if (_channel) {
    supabase.removeChannel(_channel)
    _channel = null
  }
}
