/**
 * LinkVault 类型定义
 * 所有数据模型由 Zod schema 推导，确保运行时校验与编译时类型一致。
 */
import type { z } from 'zod'
import {
  EncryptedPasswordSchema,
  BookmarkSchema,
  SiblingGroupSchema,
  CategorySchema,
  CustomAttributeSchema,
  AppDataSchema,
} from './schemas.js'

export type EncryptedPassword = z.infer<typeof EncryptedPasswordSchema>
export type Bookmark = z.infer<typeof BookmarkSchema>
export type SiblingGroup = z.infer<typeof SiblingGroupSchema>
export type Category = z.infer<typeof CategorySchema>
export type CustomAttribute = z.infer<typeof CustomAttributeSchema>
export type AppData = z.infer<typeof AppDataSchema>

/** 卡片列表项 — 联合类型，用于 CardGrid 等组件 */
export type CardItem =
  | { type: 'group'; data: SiblingGroup }
  | { type: 'bm'; data: Bookmark }

/** 实体类型 — 用于 Realtime/同步/加密等模块 */
export type EntityType = 'bookmark' | 'group' | 'category' | 'attribute'

/** Supabase 表名 */
export type TableName = 'bookmarks' | 'sibling_groups' | 'categories' | 'custom_attributes'
