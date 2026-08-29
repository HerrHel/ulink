/**
 * useDataShare — 分享组 / 分享分类 / Fork
 * 从 useDataIO 拆分，A4: 公开分享链接，A5: Fork 公开组，C4: 分类级分享与 Fork
 */
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'
import { toast } from '../../lib/toast.js'

import { copyToClipboard, isValidShareGroupId } from '../../utils.js'
import { isThreePartCipher } from '../../crypto.js'
import { useCloudSync } from './useCloudSync.js'
import { setGroupPublic, fetchPublicGroup, upsertPublicCategoryShare, fetchPublicCategory, CATEGORY_SHARE_PATH, CATEGORY_SHARE_PREFIX, type PublicCategoryData } from './syncShare.js'
import { SHARE_BASE } from '../../config/urls.js'
import { newId as genId } from '../../lib/newId.js'
import { t, tN } from '../../i18n/index.js'
import type { Bookmark, Category, SiblingGroup } from '../../types.js'

export { isValidShareGroupId, setGroupPublic, fetchPublicGroup, upsertPublicCategoryShare, fetchPublicCategory }
export type { PublicCategoryData }

/**
 * M15：fork 复制的书签把 E2E 历史密文置空 —— 分享 RPC 返回的云端数据可能含旧版
 * 密文（title/url/notes），本地无 key 时照搬进 store 会显示乱码（还污染 URL 去重）。
 */
function stripCipherBookmark(b: Bookmark): Bookmark {
  return {
    ...b,
    title: isThreePartCipher(b.title) ? '' : b.title,
    url: isThreePartCipher(b.url) ? '' : b.url,
    notes: isThreePartCipher(b.notes) ? '' : b.notes,
  }
}

// ── 分享组（A4: 公开分享链接，升级为数据库持久化 + URL 路由）──

export async function shareGroup(gid: string) {
  const ds = useDataStore()
  const sg = ds.groupMap[gid]
  if (!sg) { toast(t('msg.groupNotExist'), false); return }

  // 尝试设置为公开
  if (!sg.isPublic) {
    const ok = await setGroupPublic(gid, true)
    if (!ok) {
      toast(t('msg.shareLoginRequired'), false)
      return
    }
  }

  // 分享链接指向同域 SSR 路径（https://ulink.ren/s/<gid>）：Cloudflare Pages Function
  // 在服务端渲染完整 HTML，爬虫与人类拿到同一份预渲染页，社交预览 / 搜索引擎可读 og:*。
  // 旧链接（supabase 函数域 / #share/<gid> SPA 路由）由各端保留作向后兼容兜底。
  const url = `${SHARE_BASE}/${gid}`
  copyToClipboard(url, t('msg.shareLinkLabel'))
}

// ── 分享分类（C4: 分享该分类及其全部书签与组，不含敏感内容，实时读库热更新）──

/**
 * 分享「一个分类及其全部书签与组」。
 *
 * - 链接：https://ulink.ren/s/c/<share_id>（/s/c/ 前缀区分组分享 /s/<gid>）
 * - 数据：数据库分享记录（public_category_shares）+ RPC get_public_category 实时拉取，
 *   分享后分类下书签/组的增删改自动反映到分享页（热更新），无需重新分享。
 * - 安全：RPC 列级隔离，绝不返回 username/password；私密空间内不提供分享入口
 *   （菜单已按 curSpace 隐藏）。
 */
export async function shareCategory(catId: string) {
  const ds = useDataStore()
  const cat = ds.categoryMap[catId]
  if (!cat || cat.deletedAt) { toast(t('msg.categoryNotExist'), false); return }

  const shareId = await upsertPublicCategoryShare(catId)
  if (!shareId) {
    toast(t('msg.shareLoginRequired'), false)
    return
  }
  const url = `${SHARE_BASE}/${CATEGORY_SHARE_PATH}/${shareId}`
  copyToClipboard(url, t('msg.shareLinkLabel'))
}

// ── 从 URL 导入分享数据（path 风格 /s/<id> 优先，hash #share/<id> 向后兼容）──

/**
 * 解析当前 URL 中的分享路由：
 * - path `/s/<gid>` → 组分享 gid
 * - path `/s/c/<share_id>` → 分类分享，返回 `cat:<share_id>`（CATEGORY_SHARE_PREFIX）
 * - hash `#share/<gid>` / `#share/c/<share_id>` → 向后兼容兜底
 *
 * 返回值语义：ShareView/App 收到非 `cat:` 前缀即组分享，`cat:` 前缀即分类分享。
 */
export function detectShareRoute(): string | null {
  // 1) path 分类分享：/s/c/<share_id>（段前缀优先于组，避免 /s/c/x 被组正则吃掉）
  const cm = location.pathname.match(/\/s\/c\/([a-zA-Z0-9_-]+)\/?$/)
  if (cm) return isValidShareGroupId(cm[1]) ? CATEGORY_SHARE_PREFIX + cm[1] : null
  // 2) path 风格：/s/<gid>（路由末段）
  const m = location.pathname.match(/\/s\/([a-zA-Z0-9_-]+)\/?$/)
  if (m) return isValidShareGroupId(m[1]) ? m[1] : null
  // 3) hash 兜底：#share/c/<share_id> 与 #share/<gid>（向后兼容旧链接 + 新链接里的 hash 兜底段）
  const hash = location.hash
  if (hash) {
    const cmatch = hash.match(/^#share\/c\/([a-zA-Z0-9_-]+)$/)
    if (cmatch) return isValidShareGroupId(cmatch[1]) ? CATEGORY_SHARE_PREFIX + cmatch[1] : null
    const match = hash.match(/^#share\/([a-zA-Z0-9_-]+)$/)
    if (match) return isValidShareGroupId(match[1]) ? match[1] : null
  }
  return null
}

/** 解析 detectShareRoute 返回值：是分类分享则返回 share_id，否则 null */
export function parseCategoryShareRoute(route: string): string | null {
  if (route.startsWith(CATEGORY_SHARE_PREFIX)) {
    const id = route.slice(CATEGORY_SHARE_PREFIX.length)
    return isValidShareGroupId(id) ? id : null
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

  const newGroupId = genId('g')
  idMap.set(group.id, newGroupId)

  const newBookmarks: Bookmark[] = []
  for (const b of bookmarks) {
    const newId = genId('b', newBookmarks.length)
    idMap.set(b.id, newId)
    newBookmarks.push({
      ...stripCipherBookmark(b),
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
  // M17：预建 url→bookmark 索引，fork 时 O(1) 查重，避免每条 some+find 双重全表扫
  const urlToLocal = new Map<string, Bookmark>()
  for (const e of ds.bookmarks) {
    const key = e.url?.toLowerCase()
    if (key && !urlToLocal.has(key)) urlToLocal.set(key, e)
  }
  for (const b of newBookmarks) {
    const oldId = reverseIdMap.get(b.id)
    const urlKey = b.url?.toLowerCase() || ''
    const existing = urlKey ? urlToLocal.get(urlKey) : undefined
    if (!existing) {
      ds.addBookmark(b)
      addedIds.add(b.id)
      actualAdded.push(b)
      if (oldId) oldToLocal.set(oldId, b.id)
      if (urlKey) urlToLocal.set(urlKey, b)
    } else if (oldId) {
      oldToLocal.set(oldId, existing.id)
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
  toast(t('msg.forkedGroup', { name: group.name, count }))
}

// ── Fork 公开分类到自己库（C4：分类 + 其下全部书签与组）──

/**
 * 复制公开分类到本地库：
 * - 本地存在同名分类 → 归入该分类；否则新建（沿用分享的名称/图标/颜色）
 * - 书签按 URL 去重（同 URL 跳过，沿用本地已有项），不复制密码/用户名
 * - 组整体复制（bookmarkIds 映射到实际入库/本地已有书签 id，丢弃悬空引用）
 */
export async function forkPublicCategory(data: PublicCategoryData) {
  const ds = useDataStore()
  const sync = useCloudSync()
  const now = Date.now()
  const cat: Category = data.category

  // ── 1. 目标分类：同名复用，否则新建 ──
  let catId = cat.id
  const existingCat = ds.categories.find(c => !c.deletedAt && c.name === cat.name)
  if (existingCat) {
    catId = existingCat.id
  } else {
    catId = genId('cat')
    const order = ds.categories.reduce((m, c) => (c.order ?? 0) > m ? c.order : m, -1) + 1
    ds.addCategory({ id: catId, name: cat.name, icon: cat.icon || 'star', color: cat.color || '', order })
  }

  // ── 2. 书签：生成新 id + URL 去重入库 ──
  const idMap = new Map<string, string>()
  const newBookmarks: Bookmark[] = []
  for (const b of data.bookmarks) {
    const newId = genId('b', newBookmarks.length)
    idMap.set(b.id, newId)
    newBookmarks.push({
      ...stripCipherBookmark(b),
      id: newId,
      categoryId: catId,
      password: '',  // 不复制密码
      username: '',  // 不复制用户名
      createdAt: now,
      updatedAt: now,
    })
  }

  const addedIds = new Set<string>()
  const actualAdded = [] as Bookmark[]
  const reverseIdMap = new Map<string, string>()
  for (const [oldId, newId] of idMap) reverseIdMap.set(newId, oldId)
  const oldToLocal = new Map<string, string>()
  const urlToLocal = new Map<string, Bookmark>()
  for (const e of ds.bookmarks) {
    const key = e.url?.toLowerCase()
    if (key && !urlToLocal.has(key)) urlToLocal.set(key, e)
  }
  for (const b of newBookmarks) {
    const oldId = reverseIdMap.get(b.id)
    const urlKey = b.url?.toLowerCase() || ''
    const existing = urlKey ? urlToLocal.get(urlKey) : undefined
    if (!existing) {
      ds.addBookmark(b)
      addedIds.add(b.id)
      actualAdded.push(b)
      if (oldId) oldToLocal.set(oldId, b.id)
      if (urlKey) urlToLocal.set(urlKey, b)
    } else if (oldId) {
      oldToLocal.set(oldId, existing.id)
    }
  }

  // 父子关系映射（同 forkPublicGroup B-10 修复）
  for (const b of actualAdded) {
    if (b.parentId) {
      const newParentId = oldToLocal.get(b.parentId)
      if (newParentId && newParentId !== b.id) {
        ds.updateBookmark(b.id, { parentId: newParentId })
      } else {
        ds.updateBookmark(b.id, { parentId: null })
      }
    }
  }

  // ── 3. 组：整体复制，bookmarkIds 映射到实际 id，丢弃悬空 ──
  const newGroups: SiblingGroup[] = []
  for (const g of data.groups) {
    const newGid = genId('g', newGroups.length)
    idMap.set(g.id, newGid)
    const newBookmarkIds = (g.bookmarkIds || [])
      .map(bid => idMap.get(bid))
      .filter((id): id is string => !!id && addedIds.has(id))
    newGroups.push({
      ...g,
      id: newGid,
      categoryId: catId,
      bookmarkIds: newBookmarkIds,
      isPublic: false,
      updatedAt: now,
      useCount: 0,
    })
  }
  for (const g of newGroups) ds.addGroup(g)

  saveAppData()
  try { sync.fullSync().catch(() => {}) } catch { /* 静默 */ }

  const count = actualAdded.length
  const groupCount = newGroups.length
  toast(tN('msg.forkedCategory', count, { name: cat.name, groups: groupCount }))
}
