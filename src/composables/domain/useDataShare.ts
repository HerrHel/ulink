/**
 * useDataShare — 分享组与 Fork
 * 从 useDataIO 拆分，A4: 公开分享链接，A5: Fork 公开组
 */
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { toast } from '../../lib/toast.js'
import { copyToClipboard } from '../../utils.js'
import { supabase } from '../../lib/supabase.js'
import { useCloudSync } from './useCloudSync.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

// ── 分享组（A4: 公开分享链接，升级为数据库持久化 + URL 路由）──

export async function shareGroup(gid: string) {
  const store = useAppStore()
  const sg = store.groupMap[gid]
  if (!sg) { toast('组不存在', false); return }

  const sync = useCloudSync()

  // 尝试设置为公开
  if (!sg.isPublic) {
    const ok = await sync.setGroupPublic(gid, true)
    if (!ok) {
      // 未登录或失败，降级为旧版 base64 方式
      _shareGroupLegacy(gid)
      return
    }
  }

  const url = location.origin + location.pathname + '#share/' + gid
  copyToClipboard(url, '分享链接')
}

function _shareGroupLegacy(gid: string) {
  const store = useAppStore()
  const sg = store.groupMap[gid]
  if (!sg) return
  const bms = sg.bookmarkIds.map(bid => store.bookmarkMap[bid]).filter(Boolean).map(b => {
    const { password: _, username: __, ...safe } = b; return safe
  })
  const payload = { v: 1, group: { ...sg }, bookmarks: bms }
  const json = JSON.stringify(payload)
  const b64 = btoa(unescape(encodeURIComponent(json)))
  if (b64.length > 30000) { toast('组内容过大，无法生成分享链接', false); return }
  const url = location.origin + location.pathname + '#share=' + b64
  copyToClipboard(url, '分享链接')
}

// ── 从 URL 导入分享数据（A4: 支持两种格式）──

export function detectShareRoute(): string | null {
  const hash = location.hash
  if (!hash) return null
  // 新格式：#share/<id>
  const match = hash.match(/^#share\/([a-zA-Z0-9_-]+)$/)
  if (match) return match[1]
  return null
}

export function importFromURL(): boolean {
  const store = useAppStore()
  const hash = location.hash
  if (!hash || !hash.startsWith('#share=')) return false
  try {
    const json = decodeURIComponent(escape(atob(hash.slice(7))))
    const payload = JSON.parse(json)
    if (!payload.group?.id) { toast('分享数据格式错误', false); return true }
    let imported = 0
    const existingUrls = new Set(store.bookmarks.map(b => b.url?.toLowerCase()).filter(Boolean))
    const bookmarks = Array.isArray(payload.bookmarks) ? payload.bookmarks : []
    for (const b of bookmarks) {
      if (!b.id || !b.url) continue
      if (store.bookmarkMap[b.id]) continue
      if (b.url && existingUrls.has(b.url.toLowerCase())) continue
      store.addBookmark({
        id: b.id,
        title: b.title || '',
        url: b.url,
        username: b.username || '',
        password: b.password || '',
        notes: b.notes || '',
        icon: b.icon || '',
        categoryId: b.categoryId || 'uncategorized',
        parentId: b.parentId || null,
        order: b.order || 0,
        useCount: b.useCount || 0,
        attributes: b.attributes || {},
        isExpanded: false,
        createdAt: b.createdAt || Date.now(),
        updatedAt: b.updatedAt || Date.now(),
      } as Bookmark)
      imported++
    }
    const existing = store.groupMap[payload.group.id]
    if (existing) {
      const newBookmarkIds = [...existing.bookmarkIds]
      for (const bid of payload.group.bookmarkIds) {
        if (!newBookmarkIds.includes(bid)) newBookmarkIds.push(bid)
      }
      const changes: Partial<SiblingGroup> = { bookmarkIds: newBookmarkIds }
      if (payload.group.notes && !existing.notes) changes.notes = payload.group.notes
      store.updateGroup(payload.group.id, changes)
      toast('已更新组「' + (existing.name || '未命名') + '」（新增 ' + imported + ' 个书签）')
    } else {
      store.addGroup(payload.group)
      toast('已导入组「' + (payload.group.name || '未命名') + '」（' + (payload.bookmarks || []).length + ' 个书签）')
    }
    store.save()
    history.replaceState(null, '', location.pathname + location.search)
    return true
  } catch (_) { toast('分享链接解析失败', false); return true }
}

// ── Fork 公开组到自己库（A5）──

export async function forkPublicGroup(group: SiblingGroup, bookmarks: Bookmark[]) {
  const store = useAppStore()
  const ds = useDataStore()
  const now = Date.now()

  // 为所有书签和组生成新 ID（复制模式）
  const idMap = new Map<string, string>()

  const newGroupId = 'g' + now.toString(36) + Math.random().toString(36).slice(2, 6)
  idMap.set(group.id, newGroupId)

  const newBookmarks: Bookmark[] = []
  for (const b of bookmarks) {
    const newId = 'b' + now.toString(36) + Math.random().toString(36).slice(2, 6) + newBookmarks.length
    idMap.set(b.id, newId)
    newBookmarks.push({
      ...b,
      id: newId,
      password: '',  // 不复制密码
      username: '',  // 不复制用户名
      createdAt: now,
      updatedAt: now,
    })
  }

  // 更新组内的 bookmarkIds
  const newBookmarkIds = group.bookmarkIds.map(bid => idMap.get(bid) || bid)

  const newGroup: SiblingGroup = {
    ...group,
    id: newGroupId,
    bookmarkIds: newBookmarkIds,
    isPublic: false,
    updatedAt: now,
    useCount: 0,
  }

  // 写入本地
  for (const b of newBookmarks) {
    if (!ds.bookmarks.some(e => e.url?.toLowerCase() === b.url?.toLowerCase())) {
      ds.addBookmark(b)
    }
  }
  ds.addGroup(newGroup)
  store.save()

  // 尝试写入远端
  try {
    const userId = (await supabase.auth.getSession()).data.session?.user?.id
    if (userId) {
      const bRows = newBookmarks.map(b => ({
        id: b.id, user_id: userId, title: b.title, url: b.url,
        username: b.username, password: '', notes: b.notes, icon: b.icon,
        category_id: b.categoryId, parent_id: b.parentId,
        "order": b.order, use_count: b.useCount,
        attributes: b.attributes, is_expanded: b.isExpanded,
        created_at_num: b.createdAt, updated_at_num: b.updatedAt,
      }))
      const gRow = {
        id: newGroup.id, user_id: userId, name: newGroup.name,
        category_id: newGroup.categoryId, icon: newGroup.icon,
        "order": newGroup.order, is_expanded: newGroup.isExpanded,
        attributes: newGroup.attributes, bookmark_ids: newGroup.bookmarkIds,
        notes: newGroup.notes, use_count: newGroup.useCount,
        updated_at_num: newGroup.updatedAt, is_public: false,
      }
      if (bRows.length) await supabase.from('bookmarks').upsert(bRows, { onConflict: 'id' })
      await supabase.from('sibling_groups').upsert(gRow, { onConflict: 'id' })
    }
  } catch (e) { console.warn('[fork] cloud sync failed:', e) }

  toast(`已复制「${group.name}」到你的库（${newBookmarks.length} 个书签）`)
}
