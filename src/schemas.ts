import { z } from 'zod'

export const EncryptedPasswordSchema = z.object({
  encrypted: z.literal(true),
  data: z.string(),
  iv: z.string(),
  salt: z.string(),
})

/** D2-004：数字语义字段——字符串可 coerce，非法再兜 0；动态默认用函数 catch */
function coerceNum(fallback: number | (() => number) = 0) {
  const catchDef = typeof fallback === 'function' ? fallback : () => fallback
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v),
    z.number(),
  ).catch(catchDef)
}

/** attributes：先 strip 非 boolean 键，整表非法再 {} */
const attributesSchema = z.preprocess((v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, boolean> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'boolean') out[k] = val
  }
  return out
}, z.record(z.string(), z.boolean())).catch({})

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
  // C2/D2-004：可降级语义字段；类型可修复时优先 coerce，避免整字段清空。
  order: coerceNum(0),
  useCount: coerceNum(0),
  attributes: attributesSchema,
  isExpanded: z.boolean().catch(false),
  createdAt: coerceNum(() => Date.now()),
  updatedAt: coerceNum(() => Date.now()),
  deletedAt: z.number().optional(),
})

export const SiblingGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string().catch('uncategorized'),
  icon: z.string().catch(''),
  order: coerceNum(0),
  isExpanded: z.boolean().catch(false),
  attributes: attributesSchema,
  bookmarkIds: z.array(z.string()).catch([]),
  notes: z.string().catch(''),
  updatedAt: coerceNum(() => Date.now()),
  useCount: coerceNum(0),
  isPublic: z.boolean().optional(),
  deletedAt: z.number().optional(),
})

// D2-003：icon/color 必须 .catch，单条坏分类不能拖垮 AppData → DEFAULTS
export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().catch(''),
  color: z.string().catch(''),
  order: coerceNum(0),
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
