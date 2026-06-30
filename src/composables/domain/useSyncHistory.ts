/**
 * useSyncHistory — 版本历史管理（本地 + 云端合并）
 * C2：本地用户也支持历史版本，本地用 IndexedDB 留底，云端登录用户合并去重。
 */
import { supabase } from '../../lib/supabase.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { saveAppData } from '../../stores/app.js'
import { useAuth } from './useAuth.js'
import { fetchLocalHistory, getLocalHistoryVersion, type LocalHistoryVersion } from '../../stores/storage.js'

export function _getUserId(): string | null {
  const { user } = useAuth()
  return user.value?.id ?? null
}

/** 保存旧状态到云端版本历史（服务端触发器自动清理超过 10 条的旧版本） */
export async function _saveHistory(userId: string, items: Array<{ id: string; type: string; data: Record<string, any> }>) {
  if (!items.length) return
  try {
    await supabase.from('data_history').insert(
      items.map(i => ({ user_id: userId, item_id: i.id, item_type: i.type, data: i.data }))
    )
  } catch (e) {
    console.warn('[sync] history save failed:', e)
  }
}

export interface HistoryVersion {
  id: number
  data: unknown
  created_at: string
}

/** 取历史版本：本地 + 云端合并，按 created_at 降序，相同时间戳去重（保留云端） */
export async function fetchHistory(itemId: string): Promise<HistoryVersion[]> {
  const ui = useUIStore()
  const max = ui.historyMax
  const local = fetchLocalHistory(itemId)

  const { data } = await supabase.from('data_history')
    .select('id, data, created_at').eq('user_id', _getUserId()).eq('item_id', itemId)
    .order('created_at', { ascending: false }).limit(max)
  const remote = (data as HistoryVersion[]) || []

  // 合并去重：相同 created_at 保留云端（云端时序权威）
  const seen = new Set<string>()
  const merged: HistoryVersion[] = []
  for (const v of remote) {
    seen.add(v.created_at)
    merged.push(v)
  }
  for (const v of local) {
    if (!seen.has(v.created_at)) merged.push(v)
  }
  merged.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return merged.slice(0, max)
}

/** 恢复到历史版本：先查本地，未命中再查云端 */
export async function restoreFromHistory(historyId: number, itemId: string, itemType: 'bookmark' | 'group'): Promise<boolean> {
  let histData: Record<string, unknown> | null = await getLocalHistoryVersion(itemId, historyId)

  if (!histData) {
    const userId = _getUserId()
    if (!userId) return false
    const { data, error } = await supabase.from('data_history')
      .select('data').eq('id', historyId).eq('user_id', userId).single()
    if (error || !data) { console.warn('[history] fetch version failed:', error); return false }
    histData = data.data as Record<string, unknown>
  }

  const ds = useDataStore()
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
  saveAppData()
  return true
}

// 兼容 storage 层类型导出
export type { LocalHistoryVersion }
