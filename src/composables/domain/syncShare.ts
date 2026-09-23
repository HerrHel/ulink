/**
 * syncShare — 公开分享远端 IO（与队列同步解耦）
 *
 * setGroupPublic / fetchPublicGroup / upsertPublicCategoryShare / fetchPublicCategory
 * 不经 SyncRemotePort，直接 supabase。
 */
import { supabase } from '../../lib/supabase.js'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'
import { SHARE_RPC_TIMEOUT_MS } from '../../config/constants.js'
import type { Bookmark, Category, SiblingGroup } from '../../types.js'
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
  // D2：RPC 调用加 fetch 超时，避免后端挂起时一直转圈。该版本 supabase-js 的 rpc 便捷方法
  // 不在类型/运行时转发 AbortSignal，故用 Promise.race：超时即 reject 明确错误，由外层
  // ShareView 捕获并提示「重试」；底层请求会被丢弃、不阻塞界面（无 as any）。
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('请求超时，请稍后重试')), SHARE_RPC_TIMEOUT_MS)
  })
  try {
    const result = await Promise.race([
      (async () => {
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
      })(),
      timeout,
    ])
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ── 分类级公开分享（025：public_category_shares 表 + RPC）──

export interface PublicCategoryData {
  category: Category
  groups: SiblingGroup[]
  bookmarks: Bookmark[]
}

/** 分享 id 路由前缀（detectShareRoute 编码用）：`cat:<share_id>` → 分类分享 */
export const CATEGORY_SHARE_PREFIX = 'cat:'

/** 分类分享链接路径段前缀：/s/c/<share_id>（SSR 函数 functions/s/c/[sid].ts） */
export const CATEGORY_SHARE_PATH = 'c'

/**
 * 幂等创建/复用分类分享记录，返回 /s/c/<share_id> 的 share_id。
 * 未登录（无 user）返回 null，由调用方提示登录。分享是「引用」——后续该分类下
 * 书签/组的变化会自动反映到分享页（热更新），无需重新分享。
 */
export async function upsertPublicCategoryShare(categoryId: string): Promise<string | null> {
  const userId = _getUserId()
  if (!userId || !categoryId) return null
  const { data, error } = await supabase.rpc('upsert_public_category_share', { p_category_id: categoryId })
  if (error) { console.warn('[share] upsert_public_category_share failed:', error); return null }
  return (typeof data === 'string' && data) ? data : null
}

/** 拉取分类分享数据（实时读库 → 热更新；RPC 已列级隔离剔除 username/password/user_id） */
export async function fetchPublicCategory(shareId: string): Promise<PublicCategoryData | null> {
  if (!shareId || !isValidShareGroupId(shareId)) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('请求超时，请稍后重试')), SHARE_RPC_TIMEOUT_MS)
  })
  try {
    const result = await Promise.race([
      (async () => {
        const { data, error } = await supabase.rpc('get_public_category', { p_share_id: shareId })
        if (error || data == null) {
          if (error) console.warn('[share] get_public_category failed:', error)
          return null
        }
        const payload = data as {
          category?: { id: string; name: string; icon?: string; color?: string }
          groups?: RemoteGroupRow[]
          bookmarks?: RemoteBookmarkRow[]
        }
        if (!payload.category) return null
        const category: Category = {
          id: payload.category.id,
          name: payload.category.name,
          icon: payload.category.icon || '',
          color: payload.category.color || '',
          order: 0,
        }
        const groups = (payload.groups || [])
          .map(fromRemoteGroup)
          .filter((g): g is SiblingGroup => !!g)
        const bookmarks = (payload.bookmarks || [])
          .map(fromRemoteBookmark)
          .filter((b): b is Bookmark => !!b)
        return { category, groups, bookmarks }
      })(),
      timeout,
    ])
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 查询当前用户某分类的公开 share_id（未登录或未公开返回 null） */
export async function getCategoryShareId(categoryId: string): Promise<string | null> {
  const userId = _getUserId()
  if (!userId || !categoryId) return null
  try {
    const { data, error } = await supabase
      .from('public_category_shares')
      .select('id')
      .eq('category_id', categoryId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return null
    return (data as { id: string }).id || null
  } catch (err) {
    console.warn('[share] getCategoryShareId error:', err)
    return null
  }
}

/** 取消分类公开分享：从 public_category_shares 表中删除当前用户的对应记录 */
export async function deletePublicCategoryShare(categoryId: string): Promise<boolean> {
  const userId = _getUserId()
  if (!userId || !categoryId) return false
  try {
    const { error } = await supabase
      .from('public_category_shares')
      .delete()
      .eq('category_id', categoryId)
      .eq('user_id', userId)
    if (error) {
      console.warn('[share] deletePublicCategoryShare failed:', error)
      return false
    }
    return true
  } catch (err) {
    console.warn('[share] deletePublicCategoryShare error:', err)
    return false
  }
}

/** 拉取当前登录用户所有公开分享的分类记录 */
export async function fetchUserCategoryShares(): Promise<Array<{ id: string; category_id: string }>> {
  const userId = _getUserId()
  if (!userId) return []
  try {
    const { data, error } = await supabase
      .from('public_category_shares')
      .select('id, category_id')
      .eq('user_id', userId)
    if (error || !data) return []
    return data as Array<{ id: string; category_id: string }>
  } catch (err) {
    console.warn('[share] fetchUserCategoryShares error:', err)
    return []
  }
}

/** 删除当前登录用户名下的所有分类分享记录 */
export async function deleteAllPublicCategoryShares(): Promise<boolean> {
  const userId = _getUserId()
  if (!userId) return false
  try {
    const { error } = await supabase
      .from('public_category_shares')
      .delete()
      .eq('user_id', userId)
    if (error) {
      console.warn('[share] deleteAllPublicCategoryShares failed:', error)
      return false
    }
    return true
  } catch (err) {
    console.warn('[share] deleteAllPublicCategoryShares error:', err)
    return false
  }
}

/** 一键停止当前用户所有公开分享（包括所有公开组与公开分类） */
export async function stopAllUserShares(): Promise<boolean> {
  const ds = useDataStore()
  // 1. 关闭所有公开组
  const publicGroups = ds.siblingGroups.filter(g => g.isPublic && !g.deletedAt)
  for (const g of publicGroups) {
    await setGroupPublic(g.id, false)
  }
  // 2. 清空所有公开分类
  await deleteAllPublicCategoryShares()
  return true
}
