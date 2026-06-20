/**
 * LinkVault 类型定义
 * 从 config/types.d.js 迁移
 */

export interface EncryptedPassword {
  iv: number[]
  data: number[]
  salt: number[]
  encrypted: true
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
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
}

export interface CustomAttribute {
  id: string
  name: string
  type: 'boolean'
}

export interface AppData {
  bookmarks: Bookmark[]
  siblingGroups: SiblingGroup[]
  categories: Category[]
  customAttributes: CustomAttribute[]
  _masterCanary?: EncryptedPassword | null
  _savedAt?: number
}
