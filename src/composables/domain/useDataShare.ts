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

  // 分享链接升级为 path 风格 /s/<gid> 主入口，并带 hash 兜底 #share/<gid>：
  // - path 便于未来 SSR(Functions 可拦截)、URL 语义更清晰；
  // - hash 兜底保证即便直 path 直达 fallback 失败，客户端 detectShareRoute 仍能解析。
  // pathname.replace 去掉末段（首页空段或文件名），保留部署子路径前缀（如 /linkvault/）。
  const base = location.pathname.replace(/\/[^/]*$/, '/') || '/'
  const url = location.origin + base + 's/' + gid + '#share/' + gid
  copyToClipboard(url, '分享链接')
  incrementStat('share_group')
}

// ── 从 URL 导入分享数据（path 风格 /s/<id> 优先，hash #share/<id> 向后兼容）──

export function detectShareRoute(): string | null {
  // 1) path 风格：/s/<gid>（路由末段）
  const m = location.pathname.match(/\/s\/([a-zA-Z0-9_-]+)\/?$/)
  if (m) return m[1]
  // 2) hash 兜底：#share/<gid>（向后兼容旧链接 + 新链接里的 hash 兜底段）
  const hash = location.hash
  if (hash) {
    const match = hash.match(/^#share\/([a-zA-Z0-9_-]+)$/)
    if (match) return match[1]
  }
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

  // 实际入库：去重跳过本地已有同 URL 的。记录实际入库的 newId，
  // 供下方组 bookmarkIds 过滤——否则跳过的 newId 仍留在组里造成悬空引用
  //（bookmarkMap 查不到 → 组内空卡位），toast 也夸大计数。
  const addedIds = new Set<string>()
  const actualAdded = [] as Bookmark[]
  // B-10：建立「旧书签 id → 本地实际 id」映射，用于 fork 后保留父子关系。
  // 新入库的用新 id；被去重跳过的用本地已有同 URL 书签的 id。
  // 反向 map（新 id → 旧 id）一次构建，避免每条书签 O(n) 反向查找。
  const reverseIdMap = new Map<string, string>()
  for (const [oldId, newId] of idMap) reverseIdMap.set(newId, oldId)
  const oldToLocal = new Map<string, string>()
  for (const b of newBookmarks) {
    const oldId = reverseIdMap.get(b.id)
    if (!ds.bookmarks.some(e => e.url?.toLowerCase() === b.url?.toLowerCase())) {
      ds.addBookmark(b)
      addedIds.add(b.id)
      actualAdded.push(b)
      if (oldId) oldToLocal.set(oldId, b.id)
    } else {
      // 被去重跳过：找到本地已有的同 URL 书签，用它的 id 作为映射目标
      const existing = ds.bookmarks.find(e => e.url?.toLowerCase() === b.url?.toLowerCase())
      if (oldId && existing) oldToLocal.set(oldId, existing.id)
    }
  }

  // B-10 修复：用 oldToLocal 映射 parentId，保留父子关系。
  // 旧实现不映射 parentId → 子书签 parentId 指向原分享者旧 id（本地不存在）→ 孤儿不可见。
  for (const b of actualAdded) {
    if (b.parentId) {
      const newParentId = oldToLocal.get(b.parentId)
      if (newParentId && newParentId !== b.id) {
        ds.updateBookmark(b.id, { parentId: newParentId })
      } else {
        // 父书签不在本次 fork 范围内或映射失败 → 变为顶层书签（不悬挂）
        ds.updateBookmark(b.id, { parentId: null })
      }
    }
  }

  // 组 bookmarkIds 只保留「实际入库」的 newId：
  // - idMap 未映射（fetchPublicGroup 漏拉 / RLS 软删过滤 / Zod 失败）的 bid → 丢弃
  // - 被去重跳过的 newId → 丢弃（addedIds 不含）
  // 旧代码 newBookmarkIds = group.bookmarkIds.map(bid => idMap.get(bid) || bid)
  // 在两种漏拉场景都把「不存在的 id」塞进组，造成悬空。
  const newBookmarkIds = group.bookmarkIds
    .map(bid => idMap.get(bid))
    .filter((id): id is string => !!id && addedIds.has(id))

  const newGroup: SiblingGroup = {
    ...group,
    id: newGroupId,
    bookmarkIds: newBookmarkIds,
    isPublic: false,
    updatedAt: now,
    useCount: 0,
  }
  ds.addGroup(newGroup)
  saveAppData()

  // 触发云端同步（由标准 push 管道处理加密/队列/冲突检测）
  try { sync.fullSync().catch(() => {}) } catch { /* 静默 */ }

  // 报告实际入库条数（而非全部 bookmarks 数），避免跳过去重后仍夸大计数。
  const count = actualAdded.length
  toast(`已复制「${group.name}」到你的库（${count} 个书签）`)
}
