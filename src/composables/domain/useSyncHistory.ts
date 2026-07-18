/**
 * useSyncHistory — 版本历史管理（本地 + 云端合并）
 * C2：本地用户也支持历史版本，本地用 IndexedDB 留底，云端登录用户合并去重。
 */
import { supabase } from '../../lib/supabase.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { saveAppData } from '../../stores/app.js'
import { useAuth } from './useAuth.js'
import { useE2E } from './useE2E.js'
import { fetchLocalHistory, getLocalHistoryVersion, type LocalHistoryVersion } from '../../stores/storage.js'
import { EditorManager } from '../../lib/editor.js'
import type { EntityType } from '../../types.js'

export function _getUserId(): string | null {
  const auth = useAuth()
  return auth.user?.id ?? null
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

  // HIST-1：未登录时跳过云端查询。旧实现未检查登录状态，_getUserId() 返回 null
  // 导致 supabase query eq('user_id', null) 查询其他未登录用户的历史记录。
  // 虽然 RLS 大概率阻止匿名 SELECT，但不应依赖 RLS 作为唯一防线。
  const userId = _getUserId()
  let remote: HistoryVersion[] = []
  if (userId) {
    const { data } = await supabase.from('data_history')
      .select('id, data, created_at').eq('user_id', userId).eq('item_id', itemId)
      .order('created_at', { ascending: false }).limit(max)
    remote = (data as HistoryVersion[]) || []
  }

  // H4：云端 data_history 已对 E2E 启用项的敏感字段加密（见 useCloudSync._pushFromQueue
  // historyItems 构造处）。HistoryPanel 的 diffVersions 会渲染 data 的 username/notes，
  // 若不解密历史面板会显示密文乱码、diff 无意义。E2E 启用且解锁时按 itemId 类型揭密
  // 云端版本 data；本地历史本就明文存，无需解密。失败则保留原密文态（不阻断列出版本）。
  if (remote.length) {
    const e2e = useE2E()
    if (e2e.isE2EEnabled.value && e2e.isUnlocked.value) {
      const ds = useDataStore()
      const type: EntityType = ds.groupMap[itemId] ? 'group' : 'bookmark'
      for (const v of remote) {
        if (v.data && typeof v.data === 'object') {
          try { v.data = await e2e.decryptItem(type, v.data as Record<string, unknown>) }
          catch { /* 保留原密文态 */ }
        }
      }
    }
  }

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

  // H4：历史快照在 E2E 启用时已对敏感字段加密（见 useCloudSync._pushFromQueue 构造
  // historyItems 处），restore 读出的 histData.username/notes 等可能是三段密文。直接赋值
  // 会让 store 写入密文态、UI 显示乱码。E2E 启用且已解锁时先 decryptItem 揭密再赋值；
  // 未解锁/未启用时 decryptItem 透传原文（明文历史无密文字段），无影响。
  const e2e = useE2E()
  const e2eType: EntityType = itemType  // 'bookmark' | 'group' 同 EntityType 子集
  const plain = (e2e.isE2EEnabled.value && e2e.isUnlocked.value)
    ? (await e2e.decryptItem(e2eType, histData as Record<string, unknown>).catch(() => histData) as Record<string, unknown>)
    : histData

  // 已软删的条目不能直接 restore——updateGroup/updateBookmark 只改字段不清 deletedAt，
  // return true 误报成功但用户看不到恢复结果（组/书签仍在回收站）。
  // 场景：编辑组 → _saveLocalHistory 防抖 500ms → 用户在 500ms 内删组 → timer fire
  // 仍写历史 → HistoryPanel 列出已删组的历史 → 点 restore → 误报。
  if (itemType === 'group') {
    const g = ds.groupMap[itemId]
    if (!g || g.deletedAt) return false
  } else {
    const b = ds.bookmarkMap[itemId]
    if (!b || b.deletedAt) return false
  }

  if (itemType === 'bookmark') {
    ds.updateBookmark(itemId, {
      title: plain.title as string, url: plain.url as string,
      username: plain.username as string, password: plain.password as string,
      notes: plain.notes as string, icon: plain.icon as string,
      categoryId: plain.categoryId as string, parentId: plain.parentId as string | null,
      order: plain.order as number, useCount: plain.useCount as number,
      attributes: plain.attributes as Record<string, boolean>,
      isExpanded: plain.isExpanded as boolean,
    })
  } else {
    // bookmarkIds 过滤掉已删书签——历史快照里的 bookmarkIds 引用了之后被删除的书签 id。
    // 原样保留会让组引用悬空 id（bookmarkMap 查不到 → 组内空卡位 + 推云后远端也悬空）。
    // 对齐 useUndo.restoreSnapshot 的过滤策略。
    const filteredIds = (plain.bookmarkIds as string[] || []).filter(bid => ds.bookmarkMap[bid])
    ds.updateGroup(itemId, {
      name: plain.name as string, categoryId: plain.categoryId as string,
      icon: plain.icon as string, order: plain.order as number,
      isExpanded: plain.isExpanded as boolean,
      attributes: plain.attributes as Record<string, boolean>,
      bookmarkIds: filteredIds,
      notes: plain.notes as string, useCount: plain.useCount as number,
    })
    // 同步 TipTap 编辑器内容（若该组编辑器仍挂载）：
    // GroupEditor 只在 onMounted 时读一次 group.notes，之后无 watch → setContent 逻辑，
    // 不显式 setContent 的话编辑器仍显示 restore 前的旧内容，随后用户敲字触发
    // syncToStore 用「旧内容 + 新字符」覆盖刚 restore 的 notes → restore 被静默抹掉。
    // 对齐 useUndo.restoreSnapshot 的 EditorManager.setContent 策略。
    // onUpdate 会触发 pushUndo 推快照（restore 前的状态，用户可 undo 回去）+ syncToStore
    // 用相同 notes 覆盖（无害），不需要 _restoring 标志。
    const ed = EditorManager.get(itemId)
    if (ed) ed.commands.setContent(plain.notes as string || '')
  }
  saveAppData()
  return true
}

// 兼容 storage 层类型导出
export type { LocalHistoryVersion }
