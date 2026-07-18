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
  username: z.string().catch(''),
  password: z.union([z.string(), EncryptedPasswordSchema]).catch(''),
  notes: z.string().catch(''),
  icon: z.string().catch(''),
  categoryId: z.string().catch('uncategorized'),
  parentId: z.string().nullable().catch(null),
  // C2：以下为可降级语义字段，旧版数据缺失时降级为合理默认而非让整条
  // AppDataSchema.safeParse 失败、把用户全部书签被 DEFAULTS 覆盖丢弃。
  // 身份字段（id/title/url/title）保持严格：缺了仍拒，避免接坏数据。
  order: z.number().catch(0),
  useCount: z.number().catch(0),
  attributes: z.record(z.string(), z.boolean()).catch({}),
  isExpanded: z.boolean().catch(false),
  createdAt: z.number().catch(() => Date.now()),
  updatedAt: z.number().catch(() => Date.now()),
  deletedAt: z.number().optional(),
})

export const SiblingGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string().catch('uncategorized'),
  icon: z.string().catch(''),
  order: z.number().catch(0),
  isExpanded: z.boolean().catch(false),
  attributes: z.record(z.string(), z.boolean()).catch({}),
  bookmarkIds: z.array(z.string()).catch([]),
  notes: z.string().catch(''),
  updatedAt: z.number().catch(() => Date.now()),
  useCount: z.number().catch(0),
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
