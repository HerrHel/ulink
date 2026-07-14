import { z } from 'zod'

export const EncryptedPasswordSchema = z.object({
  encrypted: z.literal(true),
  data: z.string(),
  iv: z.string(),
  salt: z.string(),
})

export const BookmarkSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  username: z.string(),
  password: z.union([z.string(), EncryptedPasswordSchema]).catch(''),
  notes: z.string(),
  icon: z.string(),
  categoryId: z.string(),
  parentId: z.string().nullable(),
  order: z.number(),
  useCount: z.number(),
  attributes: z.record(z.string(), z.boolean()),
  isExpanded: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
})

export const SiblingGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string(),
  icon: z.string(),
  order: z.number(),
  isExpanded: z.boolean(),
  attributes: z.record(z.string(), z.boolean()),
  bookmarkIds: z.array(z.string()),
  notes: z.string(),
  updatedAt: z.number(),
  useCount: z.number(),
  isPublic: z.boolean().optional(),
  deletedAt: z.number().optional(),
})

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  order: z.number().optional(),
  updatedAt: z.number().optional(),
  deletedAt: z.number().optional(),
})

export const CustomAttributeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal('boolean'),
  updatedAt: z.number().optional(),
  deletedAt: z.number().optional(),
})

export const AppDataSchema = z.object({
  bookmarks: z.array(BookmarkSchema),
  siblingGroups: z.array(SiblingGroupSchema),
  categories: z.array(CategorySchema),
  customAttributes: z.array(CustomAttributeSchema),
  _masterCanary: z.union([z.string(), EncryptedPasswordSchema]).catch('').optional(),
  /** @deprecated 兼容旧盘；迁移门控请用 _schemaVersion，写入序号用 _writeSeq */
  _dataVersion: z.number().optional(),
  _schemaVersion: z.number().optional(),
  _writeSeq: z.number().optional(),
  _savedAt: z.number().optional(),
})
