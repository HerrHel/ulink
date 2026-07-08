/**
 * useDataShare — 分享组与 Fork
 * 从 useDataIO 拆分，A4: 公开分享链接，A5: Fork 公开组
 */
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'
import { toast } from '../../lib/toast.js'
import { incrementStat } from '../../lib/stats.js'
import { copyToClipboard } from '../../utils.js'
import { useCloudSync } from './useCloudSync.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

// ── 分享组（A4: 公开分享链接，升级为数据库持久化 + URL 路由）──

export async function shareGroup(gid: string) {
  const ds = useDataStore()
  const sg = ds.groupMap[gid]
  if (!sg) { toast('组不存在', false); return }

  const sync = useCloudSync()

  // 尝试设置为公开
  if (!sg.isPublic) {
    const ok = await sync.setGroupPublic(gid, true)
    if (!ok) {
      toast('分享需要登录云同步，请先登录', false)
      return
    }
  }

  const url = location.origin + location.pathname + '#share/' + gid
  copyToClipboard(url, '分享链接')
  incrementStat('share_group')
}

// ── 从 URL 导入分享数据（C3: 仅支持 #share/<id> 格式，废弃 base64）──

export function detectShareRoute(): string | null {
  const hash = location.hash
  if (!hash) return null
  // #share/<id>
  const match = hash.match(/^#share\/([a-zA-Z0-9_-]+)$/)
  if (match) return match[1]
  return null
}

// ── Fork 公开组到自己库（A5）──

export async function forkPublicGroup(group: SiblingGroup, bookmarks: Bookmark[]) {
  const ds = useDataStore()
  const sync = useCloudSync()
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

  // 写入本地（addBookmark / addGroup 自动标记 dirty，走标准同步管道）
  for (const b of newBookmarks) {
    if (!ds.bookmarks.some(e => e.url?.toLowerCase() === b.url?.toLowerCase())) {
      ds.addBookmark(b)
    }
  }
  ds.addGroup(newGroup)
  saveAppData()

  // 触发云端同步（由标准 push 管道处理加密/队列/冲突检测）
  try { sync.fullSync().catch(() => {}) } catch { /* 静默 */ }

  toast(`已复制「${group.name}」到你的库（${newBookmarks.length} 个书签）`)
}
