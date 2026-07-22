/**
 * LinkVault CLI 类型定义
 * 复用前端 types.ts，但适配 PostgreSQL 字段命名（下划线）
 */

/** 加密密码对象 */
export interface EncryptedPassword {
  encrypted: true
  data: string
  iv: string
  salt: string
}

/** 书签 */
export interface Bookmark {
  id: string
  title: string
  url: string
  username: string
  password: string | EncryptedPassword
  notes: string
  icon: string
  category_id: string
  parent_id: string | null
  order: number
  use_count: number
  attributes: Record<string, boolean>
  is_expanded: boolean
  created_at_num: number
  updated_at_num: number
  deleted_at_num?: number
}

/** 兄弟组 */
export interface SiblingGroup {
  id: string
  name: string
  category_id: string
  icon: string
  order: number
  is_expanded: boolean
  attributes: Record<string, boolean>
  bookmark_ids: string[]
  notes: string
  use_count: number
  is_public: boolean
  updated_at_num: number
  deleted_at_num?: number
}

/** 分类 */
export interface Category {
  id: string
  name: string
  icon: string
  color: string
  order: number
  updated_at?: string
  deleted_at?: string
}

/** 自定义属性 */
export interface CustomAttribute {
  id: string
  name: string
  type: 'boolean'
  updated_at?: string
  deleted_at?: string
}

/** CLI 配置 */
export interface CliConfig {
  supabaseUrl?: string
  supabaseKey?: string
  accessToken?: string
  refreshToken?: string
}

/** 输出格式 */
export type OutputFormat = 'table' | 'json'

/** 排序模式 */
export type SortMode = 'alpha' | 'use' | 'date' | 'order'
