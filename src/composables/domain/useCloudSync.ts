import { ref, computed } from 'vue'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from './useAuth.js'
import { useDataStore } from '../../stores/data.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute, EncryptedPassword } from '../../types.js'

const syncStatus = ref<'idle' | 'syncing' | 'success' | 'error'>('idle')
const lastSyncAt = ref<number>(0)
const syncError = ref<string | null>(null)
const autoSync = ref(true)

let _syncTimer: ReturnType<typeof setTimeout> | null = null
let _initialized = false
let _syncing = false

// ── 辅助：解析 password 字段（修复 JSONB 双重编码）──
function _parsePassword(raw: unknown): string | EncryptedPassword {
  if (typeof raw === 'string') {
    if (raw.startsWith('{')) { try { return JSON.parse(raw) as EncryptedPassword } catch { /* ignore */ } }
    return raw
  }
  if (raw && typeof raw === 'object') return raw as EncryptedPassword
  return ''
}

export function useCloudSync() {
  const { isLoggedIn } = useAuth()

  const syncLabel = computed(() => {
    if (syncStatus.value === 'syncing') return '同步中...'
    if (syncStatus.value === 'error') return '同步失败'
    if (lastSyncAt.value) {
      const d = new Date(lastSyncAt.value)
      return `已同步 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    }
    return '未同步'
  })

  function _getUserId(): string | null {
    const { user } = useAuth()
    return user.value?.id ?? null
  }

  // ── 推送本地数据到云端 ──
  async function pushToCloud(): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    if (!navigator.onLine) { syncError.value = '网络离线'; return false }
    syncStatus.value = 'syncing'
    syncError.value = null

    try {
      const ds = useDataStore()

      const catRows = ds.categories.map(c => ({
        id: c.id, user_id: userId, name: c.name, icon: c.icon, color: c.color,
      }))
      const bmRows = ds.bookmarks.map(b => ({
        id: b.id, user_id: userId, title: b.title, url: b.url,
        username: b.username,
        password: typeof b.password === 'object' ? JSON.stringify(b.password) : b.password,
        notes: b.notes, icon: b.icon, category_id: b.categoryId,
        parent_id: b.parentId, "order": b.order, use_count: b.useCount,
        attributes: b.attributes, is_expanded: b.isExpanded,
        created_at_num: b.createdAt,
      }))
      const groupRows = ds.siblingGroups.map(g => ({
        id: g.id, user_id: userId, name: g.name, category_id: g.categoryId,
        icon: g.icon, "order": g.order, is_expanded: g.isExpanded,
        attributes: g.attributes, bookmark_ids: g.bookmarkIds,
        notes: g.notes, use_count: g.useCount, updated_at_num: g.updatedAt,
      }))
      const attrRows = ds.customAttributes.map(a => ({
        id: a.id, user_id: userId, name: a.name, type: a.type,
      }))

      const results = await Promise.all([
        supabase.from('categories').upsert(catRows, { onConflict: 'id' }),
        supabase.from('bookmarks').upsert(bmRows, { onConflict: 'id' }),
        supabase.from('sibling_groups').upsert(groupRows, { onConflict: 'id' }),
        supabase.from('custom_attributes').upsert(attrRows, { onConflict: 'id' }),
      ])

      for (const r of results) { if (r.error) throw r.error }

      if (ds._masterCanary) {
        await supabase.from('user_security').upsert({
          user_id: userId, master_canary: ds._masterCanary,
        }, { onConflict: 'user_id' })
      }

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

  // ── 从云端拉取数据 ──
  async function pullFromCloud(): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    if (!navigator.onLine) { syncError.value = '网络离线'; return false }
    syncStatus.value = 'syncing'
    syncError.value = null

    try {
      const [catsRes, bmsRes, groupsRes, attrsRes, secRes] = await Promise.all([
        supabase.from('categories').select('*').eq('user_id', userId),
        supabase.from('bookmarks').select('*').eq('user_id', userId),
        supabase.from('sibling_groups').select('*').eq('user_id', userId),
        supabase.from('custom_attributes').select('*').eq('user_id', userId),
        supabase.from('user_security').select('*').eq('user_id', userId).maybeSingle(),
      ])

      for (const r of [catsRes, bmsRes, groupsRes, attrsRes]) { if (r.error) throw r.error }

      const ds = useDataStore()

      const remoteCats: Category[] = (catsRes.data || []).map(r => ({
        id: r.id, name: r.name, icon: r.icon, color: r.color,
      }))
      const remoteBms: Bookmark[] = (bmsRes.data || []).map(r => ({
        id: r.id, title: r.title, url: r.url,
        username: r.username || '',
        password: _parsePassword(r.password),
        notes: r.notes || '', icon: r.icon || '',
        categoryId: r.category_id || 'uncategorized',
        parentId: r.parent_id || null,
        order: r.order || 0, useCount: r.use_count || 0,
        attributes: (r.attributes as Record<string, boolean>) || {},
        isExpanded: r.is_expanded || false,
        createdAt: r.created_at_num || 0,
      }))
      const remoteGroups: SiblingGroup[] = (groupsRes.data || []).map(r => ({
        id: r.id, name: r.name,
        categoryId: r.category_id || 'uncategorized',
        icon: r.icon || '', order: r.order || 0,
        isExpanded: r.is_expanded || false,
        attributes: (r.attributes as Record<string, boolean>) || {},
        bookmarkIds: (r.bookmark_ids as string[]) || [],
        notes: r.notes || '', useCount: r.use_count || 0,
        updatedAt: r.updated_at_num || 0,
      }))
      const remoteAttrs: CustomAttribute[] = (attrsRes.data || []).map(r => ({
        id: r.id, name: r.name, type: (r.type as 'boolean') || 'boolean',
      }))

      // 云端为权威源，无条件覆盖（删除也能正确传播）
      ds.categories = remoteCats
      ds.bookmarks = remoteBms
      ds.siblingGroups = remoteGroups
      ds.customAttributes = remoteAttrs

      if (secRes.data?.master_canary) {
        ds._masterCanary = secRes.data.master_canary as EncryptedPassword
      }

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

  // ── 防抖同步（save 时调用）──
  function debouncedSync() {
    if (!autoSync.value || !isLoggedIn.value) return
    if (_syncTimer) clearTimeout(_syncTimer)
    _syncTimer = setTimeout(() => {
      _syncTimer = null
      pushToCloud()
    }, 3000)
  }

  // ── 双向同步（手动触发）──
  async function fullSync(): Promise<boolean> {
    if (_syncing) return false
    _syncing = true
    try {
      await pullFromCloud()
      await pushToCloud()
      return true
    } finally {
      _syncing = false
    }
  }

  // ── 首次登录后全量同步（防并发）──
  async function initialSync(): Promise<void> {
    if (_initialized || _syncing || !isLoggedIn.value) return
    _initialized = true
    _syncing = true
    try {
      await pullFromCloud()
      await pushToCloud()
    } finally {
      _syncing = false
    }
  }

  // ── 离线恢复时自动重试 ──
  function _onOnline() {
    if (isLoggedIn.value && syncStatus.value === 'error') {
      pushToCloud()
    }
  }

  function initOnlineListener() {
    window.addEventListener('online', _onOnline)
  }
  function destroyOnlineListener() {
    window.removeEventListener('online', _onOnline)
  }

  function resetSyncState() {
    _initialized = false
    _syncing = false
    lastSyncAt.value = 0
    syncStatus.value = 'idle'
    syncError.value = null
  }

  return {
    syncStatus, lastSyncAt, syncError, autoSync, syncLabel,
    pushToCloud, pullFromCloud, fullSync,
    debouncedSync, initialSync, resetSyncState,
    initOnlineListener, destroyOnlineListener,
  }
}
