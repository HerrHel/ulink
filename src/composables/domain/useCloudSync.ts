import { ref, computed } from 'vue'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from './useAuth.js'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../../types.js'

const syncStatus = ref<'idle' | 'syncing' | 'success' | 'error'>('idle')
const lastSyncAt = ref<number>(0)
const syncError = ref<string | null>(null)
const autoSync = ref(true)

let _syncTimer: ReturnType<typeof setTimeout> | null = null
let _pollTimer: ReturnType<typeof setInterval> | null = null
let _initialized = false
let _syncing = false

// ── 冲突检测状态 ──
export interface SyncConflict {
  id: string
  type: 'bookmark' | 'group' | 'category' | 'attribute'
  local: unknown
  remote: unknown
}
const conflicts = ref<SyncConflict[]>([])
const _remoteSnapshots = new Map<string, unknown>()

function _parsePassword(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') return ''
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
  }
}

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

  function _getUserId(): string | null {
    const { user } = useAuth()
    return user.value?.id ?? null
  }

  // ── 推送本地数据到云端（增量：新增全量 upsert，更新仅传变更字段）──
  async function pushToCloud(dirtyIds?: Set<string>): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    if (!navigator.onLine) { syncError.value = '网络离线'; return false }
    syncStatus.value = 'syncing'
    syncError.value = null

    const ds = useDataStore()
    const passedIn = !!dirtyIds
    const ids = dirtyIds || ds.drainDirtyIds()
    const deletedIds = ds.drainDeletedIds()
    const newIds = ds.drainNewIds()
    const changedFields = ds.drainChangedFields()

    try {
      const now = Date.now()

      // ── 版本历史：更新前保存旧状态 ──
      const historyRows: Array<{ user_id: string; item_id: string; item_type: string; data: unknown }> = []
      for (const b of ds.bookmarks) {
        if (ids.has(b.id) && !newIds.has(b.id)) {
          historyRows.push({ user_id: userId, item_id: b.id, item_type: 'bookmark', data: { title: b.title, url: b.url, username: b.username, password: typeof b.password === 'string' ? b.password : JSON.stringify(b.password), notes: b.notes, icon: b.icon, categoryId: b.categoryId, parentId: b.parentId, order: b.order, useCount: b.useCount, attributes: b.attributes, isExpanded: b.isExpanded, deletedAt: b.deletedAt } })
        }
      }
      for (const g of ds.siblingGroups) {
        if (ids.has(g.id) && !newIds.has(g.id)) {
          historyRows.push({ user_id: userId, item_id: g.id, item_type: 'group', data: { name: g.name, categoryId: g.categoryId, icon: g.icon, order: g.order, isExpanded: g.isExpanded, attributes: g.attributes, bookmarkIds: g.bookmarkIds, notes: g.notes, useCount: g.useCount, deletedAt: g.deletedAt } })
        }
      }
      if (historyRows.length) {
        supabase.from('data_history').insert(historyRows).then(() => {
          // 异步清理旧历史：每 item 保留最近 10 条
          const itemIds = [...new Set(historyRows.map(r => r.item_id))]
          for (const itemId of itemIds) {
            supabase.from('data_history').select('id').eq('user_id', userId).eq('item_id', itemId).order('created_at', { ascending: false }).range(10, 1000).then(({ data }) => {
              if (data && data.length) supabase.from('data_history').delete().in('id', data.map(r => r.id))
            })
          }
        })
      }

      // ── 分类 ──
      const catNew = ds.categories.filter(c => ids.has(c.id) && newIds.has(c.id))
      const catUpdate = ds.categories.filter(c => ids.has(c.id) && !newIds.has(c.id))
      const catFullRows = catNew.map(c => ({
        id: c.id, user_id: userId, name: c.name, icon: c.icon, color: c.color,
        updated_at_num: c.updatedAt || now,
        deleted_at: c.deletedAt ? new Date(c.deletedAt).toISOString() : null,
      }))
      const catPartialRows = catUpdate.map(c => {
        const fields = changedFields.get(c.id) || new Set(Object.keys(c))
        const row: Record<string, unknown> = { id: c.id, user_id: userId, updated_at_num: c.updatedAt || now }
        if (fields.has('name')) row.name = c.name
        if (fields.has('icon')) row.icon = c.icon
        if (fields.has('color')) row.color = c.color
        if (fields.has('deletedAt')) row.deleted_at = c.deletedAt ? new Date(c.deletedAt).toISOString() : null
        return row
      })

      // ── 书签 ──
      const bmNew = ds.bookmarks.filter(b => ids.has(b.id) && newIds.has(b.id))
      const bmUpdate = ds.bookmarks.filter(b => ids.has(b.id) && !newIds.has(b.id))
      const bmFullRows = bmNew.map(b => ({
        id: b.id, user_id: userId, title: b.title, url: b.url,
        username: b.username, password: JSON.stringify(b.password),
        notes: b.notes, icon: b.icon, category_id: b.categoryId,
        parent_id: b.parentId, "order": b.order, use_count: b.useCount,
        attributes: b.attributes, is_expanded: b.isExpanded,
        created_at_num: b.createdAt, updated_at_num: b.updatedAt || now,
        deleted_at: b.deletedAt ? new Date(b.deletedAt).toISOString() : null,
      }))
      const bmPartialRows = bmUpdate.map(b => {
        const fields = changedFields.get(b.id) || new Set(Object.keys(b))
        const row: Record<string, unknown> = { id: b.id, user_id: userId, updated_at_num: b.updatedAt || now }
        for (const f of fields) {
          if (f === 'password') row.password = JSON.stringify(b.password)
          else if (f === 'categoryId') row.category_id = b.categoryId
          else if (f === 'parentId') row.parent_id = b.parentId
          else if (f === 'useCount') row.use_count = b.useCount
          else if (f === 'isExpanded') row.is_expanded = b.isExpanded
          else if (f === 'createdAt') row.created_at_num = b.createdAt
          else if (f === 'deletedAt') row.deleted_at = b.deletedAt ? new Date(b.deletedAt).toISOString() : null
          else if (f !== 'updatedAt') row[f] = (b as any)[f]
        }
        return row
      })

      // ── 组 ──
      const groupNew = ds.siblingGroups.filter(g => ids.has(g.id) && newIds.has(g.id))
      const groupUpdate = ds.siblingGroups.filter(g => ids.has(g.id) && !newIds.has(g.id))
      const groupFullRows = groupNew.map(g => ({
        id: g.id, user_id: userId, name: g.name, category_id: g.categoryId,
        icon: g.icon, "order": g.order, is_expanded: g.isExpanded,
        attributes: g.attributes, bookmark_ids: g.bookmarkIds,
        notes: g.notes, use_count: g.useCount, updated_at_num: g.updatedAt || now,
        is_public: g.isPublic || false,
        deleted_at: g.deletedAt ? new Date(g.deletedAt).toISOString() : null,
      }))
      const groupPartialRows = groupUpdate.map(g => {
        const fields = changedFields.get(g.id) || new Set(Object.keys(g))
        const row: Record<string, unknown> = { id: g.id, user_id: userId, updated_at_num: g.updatedAt || now }
        for (const f of fields) {
          if (f === 'categoryId') row.category_id = g.categoryId
          else if (f === 'useCount') row.use_count = g.useCount
          else if (f === 'isExpanded') row.is_expanded = g.isExpanded
          else if (f === 'bookmarkIds') row.bookmark_ids = g.bookmarkIds
          else if (f === 'isPublic') row.is_public = g.isPublic
          else if (f === 'deletedAt') row.deleted_at = g.deletedAt ? new Date(g.deletedAt).toISOString() : null
          else if (f !== 'updatedAt') row[f] = (g as any)[f]
        }
        return row
      })

      // ── 属性 ──
      const attrNew = ds.customAttributes.filter(a => ids.has(a.id) && newIds.has(a.id))
      const attrUpdate = ds.customAttributes.filter(a => ids.has(a.id) && !newIds.has(a.id))
      const attrFullRows = attrNew.map(a => ({
        id: a.id, user_id: userId, name: a.name, type: a.type,
        updated_at_num: a.updatedAt || now,
        deleted_at: a.deletedAt ? new Date(a.deletedAt).toISOString() : null,
      }))
      const attrPartialRows = attrUpdate.map(a => {
        const fields = changedFields.get(a.id) || new Set(Object.keys(a))
        const row: Record<string, unknown> = { id: a.id, user_id: userId, updated_at_num: a.updatedAt || now }
        if (fields.has('name')) row.name = a.name
        if (fields.has('type')) row.type = a.type
        if (fields.has('deletedAt')) row.deleted_at = a.deletedAt ? new Date(a.deletedAt).toISOString() : null
        return row
      })

      const tasks = []
      // 全量 upsert 新增项
      if (catFullRows.length) tasks.push(supabase.from('categories').upsert(catFullRows, { onConflict: 'id' }))
      if (bmFullRows.length) tasks.push(supabase.from('bookmarks').upsert(bmFullRows, { onConflict: 'id' }))
      if (groupFullRows.length) tasks.push(supabase.from('sibling_groups').upsert(groupFullRows, { onConflict: 'id' }))
      if (attrFullRows.length) tasks.push(supabase.from('custom_attributes').upsert(attrFullRows, { onConflict: 'id' }))
      // 增量 update 已有项（仅变更字段）
      for (const row of catPartialRows) { const { id, ...data } = row; tasks.push(supabase.from('categories').update(data).eq('id', id).eq('user_id', userId)) }
      for (const row of bmPartialRows) { const { id, ...data } = row; tasks.push(supabase.from('bookmarks').update(data).eq('id', id).eq('user_id', userId)) }
      for (const row of groupPartialRows) { const { id, ...data } = row; tasks.push(supabase.from('sibling_groups').update(data).eq('id', id).eq('user_id', userId)) }
      for (const row of attrPartialRows) { const { id, ...data } = row; tasks.push(supabase.from('custom_attributes').update(data).eq('id', id).eq('user_id', userId)) }

      // 推送删除操作
      for (const [delId, table] of deletedIds) {
        tasks.push(supabase.from(table).delete().eq('id', delId).eq('user_id', userId))
      }

      if (tasks.length) {
        const results = await Promise.all(tasks)
        for (const r of results) { if (r.error) throw r.error }
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
      // 恢复已删除/newIds/changedFields，下次重试
      const ds2 = useDataStore()
      for (const [id, table] of deletedIds) ds2._deletedIds.set(id, table)
      for (const id of newIds) ds2._newIds.add(id)
      for (const [id, fields] of changedFields) {
        let existing = ds2._changedFields.get(id)
        if (!existing) { existing = new Set(); ds2._changedFields.set(id, existing) }
        for (const f of fields) existing.add(f)
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
      const [catsRes, bmsRes, groupsRes, attrsRes] = await Promise.all([
        supabase.from('categories').select('*').eq('user_id', userId),
        supabase.from('bookmarks').select('*').eq('user_id', userId),
        supabase.from('sibling_groups').select('*').eq('user_id', userId),
        supabase.from('custom_attributes').select('*').eq('user_id', userId),
      ])

      for (const r of [catsRes, bmsRes, groupsRes, attrsRes]) { if (r.error) throw r.error }

      const ds = useDataStore()
      const dirtyIds = ds._dirtyIds
      const lastSync = lastSyncAt.value

      // 构建远端 Map
      const remoteCats: Category[] = (catsRes.data || []).map(r => ({
        id: r.id, name: r.name, icon: r.icon, color: r.color,
        updatedAt: r.updated_at_num || 0,
        deletedAt: r.deleted_at ? _parseTimestamp(r.deleted_at) : undefined,
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
        deletedAt: r.deleted_at ? _parseTimestamp(r.deleted_at) : undefined,
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
        isPublic: r.is_public || false,
        deletedAt: r.deleted_at ? _parseTimestamp(r.deleted_at) : undefined,
      }))
      const remoteAttrs: CustomAttribute[] = (attrsRes.data || []).map(r => ({
        id: r.id, name: r.name, type: (r.type as 'boolean') || 'boolean',
        updatedAt: r.updated_at_num || 0,
        deletedAt: r.deleted_at ? _parseTimestamp(r.deleted_at) : undefined,
      }))

      const remoteCatIds = new Set(remoteCats.map(c => c.id))
      const remoteBmIds = new Set(remoteBms.map(b => b.id))
      const remoteGroupIds = new Set(remoteGroups.map(g => g.id))
      const remoteAttrIds = new Set(remoteAttrs.map(a => a.id))

      // 智能合并：远端更新的覆盖本地，本地有未推送修改的保留本地
      // 当本地 dirty 且远端也有更新时，标记为冲突而非静默覆盖
      function _merge<T extends { id: string }>(
        local: T[], remote: T[], remoteIds: Set<string>,
        type: SyncConflict['type'],
        getRemoteTs?: (item: T) => number, getLocalTs?: (item: T) => number,
      ): T[] {
        const localMap = new Map(local.map(i => [i.id, i]))
        const result: T[] = []

        for (const rItem of remote) {
          const lItem = localMap.get(rItem.id)
          if (!lItem) {
            // 远端有、本地无 → 新增
            result.push(rItem)
          } else if (dirtyIds.has(rItem.id)) {
            // 本地有未推送修改
            const remoteNewer = getRemoteTs && getLocalTs && getRemoteTs(rItem) > getLocalTs(lItem)
            if (remoteNewer && lastSync > 0) {
              // 双向修改冲突：本地 dirty 且远端时间更新 → 标记冲突，保留本地
              const conflictId = `${type}:${rItem.id}`
              if (!_remoteSnapshots.has(conflictId)) {
                _remoteSnapshots.set(conflictId, JSON.parse(JSON.stringify(rItem)))
                conflicts.value.push({ id: rItem.id, type, local: JSON.parse(JSON.stringify(lItem)), remote: JSON.parse(JSON.stringify(rItem)) })
              }
            }
            result.push(lItem)
          } else if (getRemoteTs && getLocalTs && getRemoteTs(rItem) > getLocalTs(lItem)) {
            // 远端更新，本地未修改 → 采用远端
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

      ds.categories = _merge(
        ds.categories, remoteCats, remoteCatIds, 'category',
        (c: Category) => c.updatedAt ?? 0, (c: Category) => c.updatedAt ?? 0,
      )
      ds.bookmarks = _merge(
        ds.bookmarks, remoteBms, remoteBmIds, 'bookmark',
        (b: Bookmark) => b.updatedAt, (b: Bookmark) => b.updatedAt,
      )
      ds.siblingGroups = _merge(
        ds.siblingGroups, remoteGroups, remoteGroupIds, 'group',
        (g: SiblingGroup) => g.updatedAt, (g: SiblingGroup) => g.updatedAt,
      )
      ds.customAttributes = _merge(
        ds.customAttributes, remoteAttrs, remoteAttrIds, 'attribute',
        (a: CustomAttribute) => a.updatedAt ?? 0, (a: CustomAttribute) => a.updatedAt ?? 0,
      )

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

  // ── 内部：push→pull 顺序执行 ──
  async function _pushThenPull(): Promise<boolean> {
    const backup = _snapshotLocal()
    const ds = useDataStore()
    const dirty = ds.drainDirtyIds()
    const deleted = ds.drainDeletedIds()
    const newIdsBackup = ds.drainNewIds()
    const changedFieldsBackup = ds.drainChangedFields()
    const pushed = await pushToCloud(dirty.size > 0 ? dirty : undefined)
    if (!pushed) {
      const d = useDataStore()
      d.bookmarks = backup.bookmarks as Bookmark[]
      d.siblingGroups = backup.siblingGroups as SiblingGroup[]
      d.categories = backup.categories as Category[]
      d.customAttributes = backup.customAttributes as CustomAttribute[]
      for (const id of dirty) d._dirtyIds.add(id)
      for (const [id, table] of deleted) d._deletedIds.set(id, table)
      for (const id of newIdsBackup) d._newIds.add(id)
      for (const [id, fields] of changedFieldsBackup) {
        let existing = d._changedFields.get(id)
        if (!existing) { existing = new Set(); d._changedFields.set(id, existing) }
        for (const f of fields) existing.add(f)
      }
      return false
    }
    await pullFromCloud()
    return true
  }

  // ── 双向同步（手动触发：push-first，Notion 模式）──
  async function fullSync(): Promise<boolean> {
    if (_syncing) return false
    _syncing = true
    try {
      return await _pushThenPull()
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
      const ids = allDirty.size > 0
        ? allDirty
        : new Set([
            ...ds.bookmarks.map(b => b.id),
            ...ds.siblingGroups.map(g => g.id),
            ...ds.categories.map(c => c.id),
            ...ds.customAttributes.map(a => a.id),
          ])
      const ok = await pushToCloud(ids)
      if (!ok && allDirty.size === 0) {
        for (const id of ids) ds._dirtyIds.add(id)
      }
    } finally {
      _syncing = false
    }
  }

  // ── 离线恢复时 push→pull ──
  function _onOnline() {
    if (!isLoggedIn.value || _syncing) return
    _syncing = true
    _pushThenPull().catch(() => {}).finally(() => { _syncing = false })
  }

  // ── 切回标签页时自动拉取远端更新（A1: 不要求 autoSync，始终拉取以保持数据新鲜）──
  // 若 autoSync 开启且有本地变更，则额外推送
  function _onVisibilityChange() {
    if (document.visibilityState !== 'visible' || !isLoggedIn.value || _syncing) return
    _syncing = true
    pullFromCloud().then(() => {
      if (!autoSync.value) return
      const ds = useDataStore()
      const dirty = ds.drainDirtyIds()
      if (dirty.size > 0) return pushToCloud(dirty)
    }).catch(() => {}).finally(() => { _syncing = false })
  }

  // ── 后台轮询：每 60 秒静默拉取 ──
  function _startPolling() {
    if (_pollTimer) return
    _pollTimer = setInterval(() => {
      if (!isLoggedIn.value || !autoSync.value || _syncing || document.visibilityState !== 'visible') return
      _syncing = true
      pullFromCloud().catch(() => {}).finally(() => { _syncing = false })
    }, 60000)
  }
  function _stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null }
  }

  function initOnlineListener() {
    window.addEventListener('online', _onOnline)
    document.addEventListener('visibilitychange', _onVisibilityChange)
    _startPolling()
  }
  function destroyOnlineListener() {
    window.removeEventListener('online', _onOnline)
    document.removeEventListener('visibilitychange', _onVisibilityChange)
    _stopPolling()
  }

  function resetSyncState() {
    _initialized = false
    _syncing = false
    lastSyncAt.value = 0
    syncStatus.value = 'idle'
    syncError.value = null
    conflicts.value = []
    _remoteSnapshots.clear()
  }

  // ── 待同步计数 ──
  const pendingCount = computed(() => {
    const ds = useDataStore()
    return ds._dirtyIds.size + ds._deletedIds.size + ds._newIds.size
  })

  // ── 版本历史：查询某 item 的历史版本 ──
  async function fetchHistory(itemId: string): Promise<Array<{ id: number; data: unknown; created_at: string }>> {
    const userId = _getUserId()
    if (!userId) return []
    const { data, error } = await supabase.from('data_history')
      .select('id, data, created_at')
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) { console.warn('[history] fetch failed:', error); return [] }
    return data || []
  }

  // ── 版本历史：恢复到指定历史版本 ──
  async function restoreFromHistory(historyId: number, itemId: string, itemType: 'bookmark' | 'group'): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    const { data, error } = await supabase.from('data_history')
      .select('data')
      .eq('id', historyId)
      .eq('user_id', userId)
      .single()
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

  // ── 冲突解决 ──
  function resolveConflict(id: string, keepLocal: boolean) {
    const idx = conflicts.value.findIndex(c => c.id === id)
    if (idx < 0) return
    const conflict = conflicts.value[idx]
    if (!keepLocal) {
      // 采用远端版本
      const remoteData = conflict.remote as Record<string, unknown>
      const ds = useDataStore()
      if (conflict.type === 'bookmark') {
        ds.updateBookmark(id, remoteData as Partial<Bookmark>)
      } else if (conflict.type === 'group') {
        ds.updateGroup(id, remoteData as Partial<SiblingGroup>)
      } else if (conflict.type === 'category') {
        const cat = ds.categories.find(c => c.id === id)
        if (cat) Object.assign(cat, remoteData)
      } else if (conflict.type === 'attribute') {
        const attr = ds.customAttributes.find(a => a.id === id)
        if (attr) Object.assign(attr, remoteData)
      }
      ds.save()
    }
    // keepLocal=true → 本地已是当前值，无需额外操作，仅清除冲突标记
    _remoteSnapshots.delete(`${conflict.type}:${id}`)
    conflicts.value.splice(idx, 1)
  }

  function resolveAllConflicts(keepLocal: boolean) {
    // 逐个解决，从后往前避免索引偏移
    for (let i = conflicts.value.length - 1; i >= 0; i--) {
      resolveConflict(conflicts.value[i].id, keepLocal)
    }
  }

  // ── 公开分享：设置组公开状态（A4）──
  async function setGroupPublic(gid: string, isPublic: boolean): Promise<boolean> {
    const userId = _getUserId()
    if (!userId) return false
    const ds = useDataStore()
    const g = ds.groupMap[gid]
    if (!g) return false
    // 更新本地
    ds.updateGroup(gid, { isPublic })
    useAppStore().save()
    // 更新远端
    const { error } = await supabase.from('sibling_groups')
      .update({ is_public: isPublic })
      .eq('id', gid)
      .eq('user_id', userId)
    if (error) { console.warn('[share] setGroupPublic failed:', error); return false }
    return true
  }

  // ── 公开分享：从远端加载公开组（A4/A5）──
  async function fetchPublicGroup(gid: string): Promise<{ group: SiblingGroup; bookmarks: Bookmark[] } | null> {
    const { data: gData, error: gErr } = await supabase.from('sibling_groups')
      .select('*')
      .eq('id', gid)
      .eq('is_public', true)
      .maybeSingle()
    if (gErr || !gData) return null

    const group: SiblingGroup = {
      id: gData.id, name: gData.name,
      categoryId: gData.category_id || 'uncategorized',
      icon: gData.icon || '', order: gData.order || 0,
      isExpanded: gData.is_expanded || false,
      attributes: (gData.attributes as Record<string, boolean>) || {},
      bookmarkIds: (gData.bookmark_ids as string[]) || [],
      notes: gData.notes || '', useCount: gData.use_count || 0,
      updatedAt: _parseTimestamp(gData.updated_at) || gData.updated_at_num || 0,
      isPublic: true,
    }

    let bookmarks: Bookmark[] = []
    if (group.bookmarkIds.length) {
      const { data: bData } = await supabase.from('bookmarks')
        .select('*')
        .in('id', group.bookmarkIds)
      bookmarks = (bData || []).map(r => ({
        id: r.id, title: r.title, url: r.url,
        username: '', password: '',
        notes: r.notes || '', icon: r.icon || '',
        categoryId: r.category_id || 'uncategorized',
        parentId: r.parent_id || null,
        order: r.order || 0, useCount: r.use_count || 0,
        attributes: (r.attributes as Record<string, boolean>) || {},
        isExpanded: r.is_expanded || false,
        createdAt: r.created_at_num || 0,
        updatedAt: _parseTimestamp(r.updated_at) || r.updated_at_num || 0,
      }))
    }

    return { group, bookmarks }
  }

  return {
    syncStatus, lastSyncAt, syncError, autoSync, syncLabel, pendingCount,
    conflicts, resolveConflict, resolveAllConflicts,
    pushToCloud, pullFromCloud, fullSync,
    debouncedSync, initialSync, resetSyncState,
    initOnlineListener, destroyOnlineListener,
    fetchHistory, restoreFromHistory,
    setGroupPublic, fetchPublicGroup,
  }
}
