/**
 * syncShare — 公开分享远端 IO（与队列同步解耦）
 *
 * setGroupPublic / fetchPublicGroup 不经 SyncRemotePort，直接 supabase。
 */
import { supabase } from '../../lib/supabase.js'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'
import type { Bookmark, SiblingGroup } from '../../types.js'
import {
  fromRemoteBookmark, fromRemoteGroup,
  type RemoteBookmarkRow, type RemoteGroupRow,
} from './useSyncMapping.js'
import { _getUserId } from './useSyncHistory.js'
import { isValidShareGroupId } from '../../utils.js'

export async function setGroupPublic(gid: string, isPublic: boolean): Promise<boolean> {
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

export async function fetchPublicGroup(
  gid: string,
): Promise<{ group: SiblingGroup; bookmarks: Bookmark[] } | null> {
  if (!isValidShareGroupId(gid)) return null
  const { data, error } = await supabase.rpc('get_public_group', { p_gid: gid })
  if (error || data == null) {
    if (error) console.warn('[share] get_public_group failed:', error)
    return null
  }
  const payload = data as { group?: RemoteGroupRow; bookmarks?: RemoteBookmarkRow[] }
  if (!payload.group) return null
  const group = fromRemoteGroup(payload.group)
  if (!group) return null
  const bookmarks = (payload.bookmarks || [])
    .map(fromRemoteBookmark)
    .filter(Boolean)
    .map(b => ({ ...b!, username: '', password: '' })) as Bookmark[]
  return { group, bookmarks }
}
