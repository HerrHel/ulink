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

function _parsePassword(raw: unknown): string | EncryptedPassword {
  if (typeof raw === 'string') {
    if (raw.startsWith('{')) { try { return JSON.parse(raw) as EncryptedPassword } catch { /* ignore */ } }
    return raw
  }
  if (raw && typeof raw === 'object') return raw as EncryptedPassword
  return ''
}

function _parseTimestamp(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') { const t = Date.parse(raw); return isNaN(t) ? 0 : t }
  return 0
}

function _snapshotLocal() {
  const ds = useDataStore()
  return {
    bookmarks: ds.bookmarks.map(b => ({ ...b, attributes: { ...b.attributes } })),
    siblingGroups: ds.siblingGroups.map(g => ({ ...g, attributes: { ...g.attributes }, bookmarkIds: [...g.bookmarkIds] })),
    categories: ds.categories.map(c => ({ ...c })),
    customAttributes: ds.customAttributes.map(a => ({ ...a })),
    _masterCanary: ds._masterCanary,
  }
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

  // ── 推送本地数据到云端（增量）──
  async function pushToCloud(dirtyIds?: Set<string>): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    if (!navigator.onLine) { syncError.value = '网络离线'; return false }
    syncStatus.value = 'syncing'
    syncError.value = null

    const ds = useDataStore()
    const passedIn = !!dirtyIds
    const ids = dirtyIds || ds.drainDirtyIds()

    try {
      const now = Date.now()

      const catRows = ds.categories.filter(c => ids.has(c.id)).map(c => ({
        id: c.id, user_id: userId, name: c.name, icon: c.icon, color: c.color,
      }))
      const bmRows = ds.bookmarks.filter(b => ids.has(b.id)).map(b => ({
        id: b.id, user_id: userId, title: b.title, url: b.url,
        username: b.username,
        password: typeof b.password === 'object' ? JSON.stringify(b.password) : b.password,
        notes: b.notes, icon: b.icon, category_id: b.categoryId,
        parent_id: b.parentId, "order": b.order, use_count: b.useCount,
        attributes: b.attributes, is_expanded: b.isExpanded,
        created_at_num: b.createdAt, updated_at_num: b.updatedAt || now,
      }))
      const groupRows = ds.siblingGroups.filter(g => ids.has(g.id)).map(g => ({
        id: g.id, user_id: userId, name: g.name, category_id: g.categoryId,
        icon: g.icon, "order": g.order, is_expanded: g.isExpanded,
        attributes: g.attributes, bookmark_ids: g.bookmarkIds,
        notes: g.notes, use_count: g.useCount, updated_at_num: g.updatedAt || now,
      }))
      const attrRows = ds.customAttributes.filter(a => ids.has(a.id)).map(a => ({
        id: a.id, user_id: userId, name: a.name, type: a.type,
      }))

      const tasks = []
      if (catRows.length) tasks.push(supabase.from('categories').upsert(catRows, { onConflict: 'id' }))
      if (bmRows.length) tasks.push(supabase.from('bookmarks').upsert(bmRows, { onConflict: 'id' }))
      if (groupRows.length) tasks.push(supabase.from('sibling_groups').upsert(groupRows, { onConflict: 'id' }))
      if (attrRows.length) tasks.push(supabase.from('custom_attributes').upsert(attrRows, { onConflict: 'id' }))

      if (tasks.length) {
        const results = await Promise.all(tasks)
        for (const r of results) { if (r.error) throw r.error }
      }

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
      if (!passedIn) {
        const ds = useDataStore()
        for (const id of ids) ds._dirtyIds.add(id)
      }
      return false
    }
  }

  // ── 从云端拉取数据（智能合并）──
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
      const dirtyIds = ds._dirtyIds
      const lastSync = lastSyncAt.value

      // 构建远端 Map
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
        updatedAt: _parseTimestamp(r.updated_at) || r.updated_at_num || r.created_at_num || 0,
      }))
      const remoteGroups: SiblingGroup[] = (groupsRes.data || []).map(r => ({
        id: r.id, name: r.name,
        categoryId: r.category_id || 'uncategorized',
        icon: r.icon || '', order: r.order || 0,
        isExpanded: r.is_expanded || false,
        attributes: (r.attributes as Record<string, boolean>) || {},
        bookmarkIds: (r.bookmark_ids as string[]) || [],
        notes: r.notes || '', useCount: r.use_count || 0,
        updatedAt: _parseTimestamp(r.updated_at) || r.updated_at_num || 0,
      }))
      const remoteAttrs: CustomAttribute[] = (attrsRes.data || []).map(r => ({
        id: r.id, name: r.name, type: (r.type as 'boolean') || 'boolean',
      }))

      const remoteCatIds = new Set(remoteCats.map(c => c.id))
      const remoteBmIds = new Set(remoteBms.map(b => b.id))
      const remoteGroupIds = new Set(remoteGroups.map(g => g.id))
      const remoteAttrIds = new Set(remoteAttrs.map(a => a.id))

      // 智能合并：远端更新的覆盖本地，本地有未推送修改的保留本地
      function _merge<T extends { id: string }>(
        local: T[], remote: T[], remoteIds: Set<string>,
        getRemoteTs?: (item: T) => number, getLocalTs?: (item: T) => number,
      ): T[] {
        const localMap = new Map(local.map(i => [i.id, i]))
        const result: T[] = []

        for (const rItem of remote) {
          const lItem = localMap.get(rItem.id)
          if (!lItem) {
            result.push(rItem)
          } else if (dirtyIds.has(rItem.id)) {
            result.push(lItem)
          } else if (getRemoteTs && getLocalTs && getRemoteTs(rItem) > getLocalTs(lItem)) {
            result.push(rItem)
          } else {
            result.push(lItem)
          }
        }

        for (const [id, lItem] of localMap) {
          if (!remoteIds.has(id)) {
            if (dirtyIds.has(id)) {
              result.push(lItem)
            } else if (lastSync > 0) {
              // 之前同步过但远端已删除 → 本地也删除
            } else {
              result.push(lItem)
            }
          }
        }

        return result
      }

      ds.categories = _merge(ds.categories, remoteCats, remoteCatIds)
      ds.bookmarks = _merge(
        ds.bookmarks, remoteBms, remoteBmIds,
        (b: Bookmark) => b.updatedAt, (b: Bookmark) => b.updatedAt,
      )
      ds.siblingGroups = _merge(
        ds.siblingGroups, remoteGroups, remoteGroupIds,
        (g: SiblingGroup) => g.updatedAt, (g: SiblingGroup) => g.updatedAt,
      )
      ds.customAttributes = _merge(ds.customAttributes, remoteAttrs, remoteAttrIds)

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

  // ── 双向同步（手动触发，失败回滚）──
  async function fullSync(): Promise<boolean> {
    if (_syncing) return false
    _syncing = true
    const backup = _snapshotLocal()
    try {
      await pullFromCloud()
      const ds = useDataStore()
      const allDirty = ds.drainDirtyIds()
      if (allDirty.size > 0) {
        const ok = await pushToCloud(allDirty)
        if (!ok) {
          const d = useDataStore()
          d.bookmarks = backup.bookmarks as Bookmark[]
          d.siblingGroups = backup.siblingGroups as SiblingGroup[]
          d.categories = backup.categories as Category[]
          d.customAttributes = backup.customAttributes as CustomAttribute[]
          d._masterCanary = backup._masterCanary
          return false
        }
      }
      return true
    } finally {
      _syncing = false
    }
  }

  // ── 首次登录后全量同步 ──
  async function initialSync(): Promise<void> {
    if (_initialized || _syncing || !isLoggedIn.value) return
    _initialized = true
    _syncing = true
    try {
      await pullFromCloud()
      const ds = useDataStore()
      const allDirty = ds.drainDirtyIds()
      if (allDirty.size > 0) {
        await pushToCloud(allDirty)
      } else {
        await pushToCloud(new Set([
          ...ds.bookmarks.map(b => b.id),
          ...ds.siblingGroups.map(g => g.id),
          ...ds.categories.map(c => c.id),
          ...ds.customAttributes.map(a => a.id),
        ]))
      }
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

  // ── 切回标签页时拉取最新 ──
  function _onVisibilityChange() {
    if (document.visibilityState === 'visible' && isLoggedIn.value && autoSync.value && !_syncing) {
      pullFromCloud().catch(() => {})
    }
  }

  function initOnlineListener() {
    window.addEventListener('online', _onOnline)
    document.addEventListener('visibilitychange', _onVisibilityChange)
  }
  function destroyOnlineListener() {
    window.removeEventListener('online', _onOnline)
    document.removeEventListener('visibilitychange', _onVisibilityChange)
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
