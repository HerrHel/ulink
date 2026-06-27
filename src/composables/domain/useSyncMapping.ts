/**
 * useSyncMapping — 本地 <-> 远端数据映射
 * 从 useCloudSync 提取，纯数据转换函数
 */
import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../../types.js'

// ── 辅助函数 ──

export function parsePassword(raw: unknown): string {
  return typeof raw === 'string' ? raw : ''
}

export function parseTimestamp(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') { const t = Date.parse(raw); return isNaN(t) ? 0 : t }
  return 0
}

// ── 远端行类型定义 ──

export interface RemoteBookmarkRow {
  id: string; user_id: string; title: string; url: string
  username: string; password: string; notes: string; icon: string
  category_id: string; parent_id: string | null
  order: number; use_count: number; attributes: Record<string, boolean>
  is_expanded: boolean; created_at_num: number; updated_at_num: number
  deleted_at: string | null
}
export interface RemoteGroupRow {
  id: string; user_id: string; name: string; category_id: string
  icon: string; order: number; is_expanded: boolean
  attributes: Record<string, boolean>; bookmark_ids: string[]
  notes: string; use_count: number; is_public: boolean
  updated_at_num: number; deleted_at: string | null
}
export interface RemoteCategoryRow {
  id: string; user_id: string; name: string; icon: string; color: string
  updated_at_num: number; deleted_at: string | null
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
export function toRemoteRow(type: string, item: Record<string, unknown>): RemoteRow {
  const now = Date.now()
  if (type === 'bookmark') {
    const row: RemoteBookmarkRow = {
      id: item.id as string, user_id: item._userId as string,
      title: item.title as string, url: item.url as string,
      username: (item.username as string) || '', password: JSON.stringify(item.password),
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

export function fromRemoteBookmark(r: RemoteBookmarkRow): Bookmark {
  return {
    id: r.id, title: r.title, url: r.url,
    username: r.username || '', password: parsePassword(r.password),
    notes: r.notes || '', icon: r.icon || '',
    categoryId: r.category_id || 'uncategorized',
    parentId: r.parent_id || null,
    order: r.order || 0, useCount: r.use_count || 0,
    attributes: (r.attributes as Record<string, boolean>) || {},
    isExpanded: r.is_expanded || false,
    createdAt: r.created_at_num || 0,
    updatedAt: r.updated_at_num || r.created_at_num || 0,
    deletedAt: r.deleted_at ? parseTimestamp(r.deleted_at) : undefined,
  }
}

export function fromRemoteGroup(r: RemoteGroupRow): SiblingGroup {
  return {
    id: r.id, name: r.name,
    categoryId: r.category_id || 'uncategorized',
    icon: r.icon || '', order: r.order || 0,
    isExpanded: r.is_expanded || false,
    attributes: (r.attributes as Record<string, boolean>) || {},
    bookmarkIds: (r.bookmark_ids as string[]) || [],
    notes: r.notes || '', useCount: r.use_count || 0,
    updatedAt: r.updated_at_num || 0,
    isPublic: r.is_public || false,
    deletedAt: r.deleted_at ? parseTimestamp(r.deleted_at) : undefined,
  }
}

export function fromRemoteCategory(r: RemoteCategoryRow): Category {
  return {
    id: r.id, name: r.name, icon: r.icon, color: r.color,
    updatedAt: r.updated_at_num || 0,
    deletedAt: r.deleted_at ? parseTimestamp(r.deleted_at) : undefined,
  }
}

export function fromRemoteAttribute(r: RemoteAttributeRow): CustomAttribute {
  return {
    id: r.id, name: r.name, type: (r.type as 'boolean') || 'boolean',
    updatedAt: r.updated_at_num || 0,
    deletedAt: r.deleted_at ? parseTimestamp(r.deleted_at) : undefined,
  }
}
