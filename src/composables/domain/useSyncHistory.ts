/**
 * useSyncHistory — 版本历史管理
 */
import { supabase } from '../../lib/supabase.js'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'
import { useAuth } from './useAuth.js'

export function _getUserId(): string | null {
  const { user } = useAuth()
  return user.value?.id ?? null
}

/** 保存旧状态到版本历史（服务端触发器自动清理超过 10 条的旧版本） */
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

export async function fetchHistory(itemId: string): Promise<Array<{ id: number; data: unknown; created_at: string }>> {
  const userId = _getUserId()
  if (!userId) return []
  const { data } = await supabase.from('data_history')
    .select('id, data, created_at').eq('user_id', userId).eq('item_id', itemId)
    .order('created_at', { ascending: false }).limit(10)
  if (!data) return []
  return data as Array<{ id: number; data: unknown; created_at: string }>
}

export async function restoreFromHistory(historyId: number, itemId: string, itemType: 'bookmark' | 'group'): Promise<boolean> {
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
  saveAppData()
  return true
}
