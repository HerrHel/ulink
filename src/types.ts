/**
 * LinkVault 类型定义
 * 从 config/types.d.js 迁移
 */

export interface EncryptedPassword {
  encrypted: true
  data: string
  iv: string
  salt: string
}

export interface Bookmark {
  id: string
  title: string
  url: string
  username: string
  password: string | EncryptedPassword
  notes: string
  icon: string
  categoryId: string
  parentId: string | null
  order: number
  useCount: number
  attributes: Record<string, boolean>
  isExpanded: boolean
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface SiblingGroup {
  id: string
  name: string
  categoryId: string
  icon: string
  order: number
  isExpanded: boolean
  attributes: Record<string, boolean>
  bookmarkIds: string[]
  notes: string
  updatedAt: number
  useCount: number
  isPublic?: boolean
  deletedAt?: number
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  updatedAt?: number
  deletedAt?: number
}

export interface CustomAttribute {
  id: string
  name: string
  type: 'boolean'
  updatedAt?: number
  deletedAt?: number
}

/** 卡片列表项 — 联合类型，用于 CardGrid 等组件 */
export type CardItem =
  | { type: 'group'; data: SiblingGroup }
  | { type: 'bm'; data: Bookmark }

/** 实体类型 — 用于 Realtime/同步/加密等模块 */
export type EntityType = 'bookmark' | 'group' | 'category' | 'attribute'

/** Supabase 表名 */
export type TableName = 'bookmarks' | 'sibling_groups' | 'categories' | 'custom_attributes'

export interface AppData {
  bookmarks: Bookmark[]
  siblingGroups: SiblingGroup[]
  categories: Category[]
  customAttributes: CustomAttribute[]
  _masterCanary?: string | EncryptedPassword
  _savedAt?: number
}
