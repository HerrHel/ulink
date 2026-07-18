/**
 * useSyncMapping — 本地 <-> 远端数据映射
 * 从 useCloudSync 提取，纯数据转换函数
 */
import type { Bookmark, SiblingGroup, Category, CustomAttribute, EntityType, EncryptedPassword } from '../../types.js'
import { BookmarkSchema, SiblingGroupSchema, CategorySchema, CustomAttributeSchema } from '../../schemas.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import { isThreePartCipher } from '../../crypto.js'

// ── 辅助函数 ──

export function parsePassword(raw: unknown): string {
  return typeof raw === 'string' ? raw : ''
}

/**
 * 判断字符串是否为合格的 salt.iv.data 三段加密格式（AES-256-GCM）。
 * 统一走 crypto.isThreePartCipher（L15）。
 */
function _isThreePartCipher(s: string): boolean {
  return isThreePartCipher(s)
}

/**
 * 把远端 password 字符串还原为本地形态（string | EncryptedPassword 对象）。
 * 按优先级分层识别，最高优先级是「自救历史损坏数据」：
 * 1. JSON 文本 {"encrypted":true,...}（旧版 toRemoteRow 用 JSON.stringify 把
 *    EncryptedPassword 对象降级成的损坏形态）→ JSON.parse 还原为对象
 * 2. salt.iv.data 三段加密串 → 拆回 EncryptedPassword 对象
 * 3. 旧版 base64 字符串 → 保留 string（由 autoMigratePassword 走 string 分支解码）
 * 4. 空 / 其它 → ''
 *
 * 还原成对象而非三段串，是为了与本地 E2E 保存路径（useBookmark.saveBm 存对象）
 * 保持类型一致——否则 autoMigratePassword 会因 typeof !== 'object' 误走 string 分支。
 * 还原出的对象会经 BookmarkSchema 的 z.union([z.string(), EncryptedPasswordSchema])
 * 校验，坏数据不会污染本地。
 */
function _parseRemotePassword(raw: unknown): string | EncryptedPassword {
  if (!raw) return ''
  if (typeof raw !== 'string') return ''
  const s = raw
  if (!s) return ''

  // 1. 历史损坏数据：JSON 文本（旧 toRemoteRow 的 JSON.stringify 产物）
  if (s.startsWith('{') && s.endsWith('}')) {
    try {
      const obj = JSON.parse(s)
      if (obj && typeof obj === 'object' && obj.encrypted === true && obj.salt && obj.iv && obj.data) {
        return { encrypted: true, salt: obj.salt, iv: obj.iv, data: obj.data }
      }
    } catch { /* 非合法 JSON，落到下方分支 */ }
  }

  // 2. 三段加密串 → 还原为对象
  if (_isThreePartCipher(s)) {
    const [salt, iv, data] = s.split('.')
    return { encrypted: true, salt, iv, data }
  }

  // 3. 旧版 base64 字符串或纯文本 → 保留 string
  return s
}

/**
 * 把本地 password 字段规整为远端可存形态。
 * - EncryptedPassword 对象 → 还原为 "salt.iv.data" 三段串（decrypt 可识别）
 * - 已是三段串/string → 原样透传
 * - 其它 → ''
 * 删除旧版 JSON.stringify(item.password)——它会把 EncryptedPassword 对象降级为
 * JSON 文本字符串，回程被 parsePassword 当 string 原样存回本地，再被
 * autoMigratePassword 当 base64 解码成乱码，造成密码永久损坏。
 */
function _serializePassword(p: unknown): string {
  if (!p) return ''
  if (typeof p === 'string') return p
  // EncryptedPassword 对象：重组为三段串，与 encrypt() 输出格式一致
  if (typeof p === 'object' && p !== null && (p as EncryptedPassword).encrypted === true) {
    const ep = p as EncryptedPassword
    if (ep.salt && ep.iv && ep.data) return `${ep.salt}.${ep.iv}.${ep.data}`
    return ''
  }
  return ''
}

export function parseTimestamp(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') { const t = Date.parse(raw); return isNaN(t) ? 0 : t }
  return 0
}

/**
 * 通用 camelCase → snake_case 转换。
 * 已知特殊映射表覆盖了与 Supabase 列名不一致的字段。
 */
const SPECIAL_SNAKE: Record<string, string> = {
  categoryId: 'category_id',
  parentId: 'parent_id',
  useCount: 'use_count',
  isExpanded: 'is_expanded',
  bookmarkIds: 'bookmark_ids',
  createdAt: 'created_at_num',
  updatedAt: 'updated_at_num',
  deletedAt: 'deleted_at',
  isPublic: 'is_public',
  groupIds: 'group_ids',
}

export function camelToSnake(key: string): string {
  if (SPECIAL_SNAKE[key]) return SPECIAL_SNAKE[key]
  return key.replace(/([A-Z])/g, '_$1').toLowerCase()
}

// ── 远端行类型定义 ──

export interface RemoteBookmarkRow {
  id: string
  /** 公开分享 select 可不含 user_id / 凭证列 */
  user_id?: string
  title: string
  url: string
  username?: string
  password?: string
  notes?: string
  icon?: string
  category_id: string
  parent_id?: string | null
  order?: number
  use_count?: number
  attributes?: Record<string, boolean>
  is_expanded?: boolean
  created_at_num?: number
  updated_at_num?: number
  deleted_at?: string | null
}
export interface RemoteGroupRow {
  id: string
  user_id?: string
  name: string
  category_id: string
  icon?: string
  order?: number
  is_expanded?: boolean
  attributes?: Record<string, boolean>
  bookmark_ids?: string[]
  notes?: string
  use_count?: number
  is_public?: boolean
  updated_at_num?: number
  deleted_at?: string | null
}
export interface RemoteCategoryRow {
  id: string; user_id: string; name: string; icon: string; color: string
  order: number; updated_at_num: number; deleted_at: string | null
}
export interface RemoteAttributeRow {
  id: string; user_id: string; name: string; type: string
  updated_at_num: number; deleted_at: string | null
}
export type RemoteRow = RemoteBookmarkRow | RemoteGroupRow | RemoteCategoryRow | RemoteAttributeRow

// ── 字段名映射（本地 camelCase → 远端 snake_case）──

/* eslint-disable no-redeclare */
export function toRemoteRow(type: 'bookmark', item: Record<string, unknown>, _isNew: boolean): RemoteBookmarkRow
export function toRemoteRow(type: 'group', item: Record<string, unknown>, _isNew: boolean): RemoteGroupRow
export function toRemoteRow(type: 'category', item: Record<string, unknown>, _isNew: boolean): RemoteCategoryRow
export function toRemoteRow(type: 'attribute', item: Record<string, unknown>, _isNew: boolean): RemoteAttributeRow
/** 联合实体类型：返回 RemoteRow 并集（调用方按需 narrow 或用索引访问） */
export function toRemoteRow(type: EntityType, item: Record<string, unknown>, _isNew: boolean): RemoteRow
export function toRemoteRow(type: string, item: Record<string, unknown>): RemoteRow {
  const now = Date.now()
  if (type === 'bookmark') {
    const row: RemoteBookmarkRow = {
      id: item.id as string, user_id: item._userId as string,
      title: item.title as string, url: item.url as string,
      username: (item.username as string) || '', password: _serializePassword(item.password),
      notes: (item.notes as string) || '', icon: (item.icon as string) || '',
      category_id: item.categoryId as string, parent_id: (item.parentId as string) || null,
      order: (item.order as number) || 0, use_count: (item.useCount as number) || 0,
      attributes: (item.attributes as Record<string, boolean>) || {},
      is_expanded: !!item.isExpanded,
      created_at_num: item.createdAt as number,
      updated_at_num: (item.updatedAt as number) || now,
      deleted_at: item.deletedAt ? new Date(item.deletedAt as number).toISOString() : null,
    }
    return row
  }
  if (type === 'group') {
    return {
      id: item.id as string, user_id: item._userId as string,
      name: item.name as string, category_id: item.categoryId as string,
      icon: (item.icon as string) || '', order: (item.order as number) || 0,
      is_expanded: !!item.isExpanded,
      attributes: (item.attributes as Record<string, boolean>) || {},
      bookmark_ids: (item.bookmarkIds as string[]) || [],
      notes: (item.notes as string) || '', use_count: (item.useCount as number) || 0,
      is_public: !!(item as { isPublic?: boolean }).isPublic,
      updated_at_num: (item.updatedAt as number) || now,
      deleted_at: item.deletedAt ? new Date(item.deletedAt as number).toISOString() : null,
    } satisfies RemoteGroupRow
  }
  if (type === 'category') {
    return {
      id: item.id as string, user_id: item._userId as string,
      name: item.name as string, icon: (item.icon as string) || '',
      color: (item.color as string) || '',
      order: (item.order as number) || 0,
      updated_at_num: (item.updatedAt as number) || now,
      deleted_at: item.deletedAt ? new Date(item.deletedAt as number).toISOString() : null,
    } satisfies RemoteCategoryRow
  }
  return {
    id: item.id as string, user_id: item._userId as string,
    name: item.name as string, type: (item.type as string) || 'boolean',
    updated_at_num: (item.updatedAt as number) || now,
    deleted_at: item.deletedAt ? new Date(item.deletedAt as number).toISOString() : null,
  } satisfies RemoteAttributeRow
}

// ── 从远端行映射回本地类型 ──

/**
 * Zod 验证辅助：远端映射数据通过 schema 校验后才采用。
 * 校验失败时跳过该条目（远端坏数据不污染本地），并 console.warn 便于排查。
 */
function _validateWith<T>(schema: { safeParse: (data: unknown) => { success: boolean; error?: { issues: unknown[] } } }, item: T, label: string): T | null {
  const result = schema.safeParse(item)
  if (!result.success) {
    console.warn(`[sync] 远端 ${label} 数据校验失败，已跳过:`, result.error?.issues)
    return null
  }
  return item
}

export function fromRemoteBookmark(r: RemoteBookmarkRow): Bookmark | null {
  return _validateWith(BookmarkSchema, {
    id: r.id, title: r.title, url: r.url,
    username: r.username || '', password: _parseRemotePassword(r.password),
    notes: r.notes || '', icon: r.icon || '',
    categoryId: r.category_id || CAT_UNCATEGORIZED,
    parentId: r.parent_id || null,
    order: r.order || 0, useCount: r.use_count || 0,
    attributes: (r.attributes as Record<string, boolean>) || {},
    isExpanded: r.is_expanded || false,
    createdAt: r.created_at_num || 0,
    updatedAt: r.updated_at_num || r.created_at_num || 0,
    deletedAt: r.deleted_at ? parseTimestamp(r.deleted_at) : undefined,
  }, '书签')
}

export function fromRemoteGroup(r: RemoteGroupRow): SiblingGroup | null {
  return _validateWith(SiblingGroupSchema, {
    id: r.id, name: r.name,
    categoryId: r.category_id || CAT_UNCATEGORIZED,
    icon: r.icon || '', order: r.order || 0,
    isExpanded: r.is_expanded || false,
    attributes: (r.attributes as Record<string, boolean>) || {},
    bookmarkIds: (r.bookmark_ids as string[]) || [],
    notes: r.notes || '', useCount: r.use_count || 0,
    updatedAt: r.updated_at_num || 0,
    isPublic: r.is_public || false,
    deletedAt: r.deleted_at ? parseTimestamp(r.deleted_at) : undefined,
  }, '组')
}

export function fromRemoteCategory(r: RemoteCategoryRow): Category | null {
  return _validateWith(CategorySchema, {
    id: r.id, name: r.name, icon: r.icon, color: r.color,
    order: r.order ?? 0,
    updatedAt: r.updated_at_num || 0,
    deletedAt: r.deleted_at ? parseTimestamp(r.deleted_at) : undefined,
  }, '分类')
}

export function fromRemoteAttribute(r: RemoteAttributeRow): CustomAttribute | null {
  // M15：未知 type 不再整条丢弃——当前产品仅 boolean；非 boolean 强制兜底并 warn，保留 id/name 引用
  const rawType = r.type
  let type: 'boolean' = 'boolean'
  if (rawType && rawType !== 'boolean') {
    console.warn(`[sync] 属性 ${r.id} type=${JSON.stringify(rawType)} 非 boolean，已按 boolean 兜底导入（schema 演进时请扩展 CustomAttributeSchema）`)
  }
  return _validateWith(CustomAttributeSchema, {
    id: r.id, name: r.name, type,
    updatedAt: r.updated_at_num || 0,
    deletedAt: r.deleted_at ? parseTimestamp(r.deleted_at) : undefined,
  }, '属性')
}
