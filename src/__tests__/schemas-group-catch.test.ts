/**
 * D1-54：SiblingGroupSchema / CustomAttributeSchema / EncryptedPasswordSchema 三 schema
 * catch/coerce 软降级语义护栏——既 schemasCategoryCatch（CategorySchema.focus）、
 * schemaPasswordTolerance（BookmarkSchema/AppDataSchema 间接）之外的零纯 safeParse 直测三 schema。
 *
 * 生产消费方：useDataIO.ts:274 SiblingGroupSchema.safeParse 决定 imported++ vs skipped++
 * （用户导入组数据时歪斜行软降级保留 vs 整行 skip，即「导入后组不见了」用户可见承载）；
 * useDataIO.ts:219 CustomAttributeSchema.safeParse 同形；EncryptedPasswordSchema 是密码对象类型锚
 * （schemaPasswordTolerance 经 BookmarkSchema.password union 间接但 EncryptedPassword 本体未直测）。
 * SiblingGroupSchema.safeParse 是纯读路径（Zod 校验返 parsed 对象），非 crypto/migrations/sync
 * 写路径/序列化/数据格式改动需 needs-user-review 范畴（同 D1-30 migrations 高危但纯加测试先例，
 * schemas 比 migrations 危险度更低因纯校验非迁移核）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SiblingGroupSchema,
  CustomAttributeSchema,
  EncryptedPasswordSchema,
} from '../schemas.js'

const FIXED_NOW = 1_700_000_000_000 // 钉死 updatedAt 动态 now 兜底确定性

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

/** 合法基线 SiblingGroup（仅含必填 id/name，其余走 catch/coerce 兜底） */
const validGroup = { id: 'g1', name: '开发组' }

describe('D1-54 SiblingGroupSchema catch/coerce 软降级', () => {
  // ① id/name 缺失 → 硬拒路径
  it('id 缺失 success===false 硬拒（不软降级，无 catch）', () => {
    const r = SiblingGroupSchema.safeParse({ name: 'g' })
    expect(r.success).toBe(false)
  })
  it('name 缺失 success===false 硬拒（不软降级，无 catch）', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1' })
    expect(r.success).toBe(false)
  })
  it('id/name 全齐 success===true（合法基线路径）', () => {
    const r = SiblingGroupSchema.safeParse(validGroup)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.id).toBe('g1')
      expect(r.data.name).toBe('开发组')
    }
  })

  // ② bookmarkIds 非数组 → catch([]) 收敛为空数组（组存活不丢）
  it('bookmarkIds 缺失 → catch 收敛为空数组（组存活不丢）', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.bookmarkIds).toEqual([])
  })
  it('bookmarkIds 非数组（字符串）→ catch 收敛为空数组', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', bookmarkIds: 'b1' as unknown as string[] })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.bookmarkIds).toEqual([])
  })

  // ③ attributes 含非 boolean 键 → attributesSchema strip 仅保留 boolean 键；整表非法 → {}
  it('attributes 含 boolean 与非 boolean 混合 → strip 非 boolean 键仅留 boolean', () => {
    const r = SiblingGroupSchema.safeParse({
      id: 'g1', name: 'g',
      attributes: { keep: true, drop: 'str', alsoDrop: 1, keep2: false },
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.attributes).toEqual({ keep: true, keep2: false })
  })
  it('attributes 为非对象（字符串）→ 整表非法 {} 兜底', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', attributes: 'bad' as unknown as Record<string, boolean> })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.attributes).toEqual({})
  })
  it('attributes 为 null → 整表非法 {} 兜底', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', attributes: null })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.attributes).toEqual({})
  })
  it('attributes 为数组 → 整表非法 {} 兜底', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', attributes: [true, false] as unknown as Record<string, boolean> })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.attributes).toEqual({})
  })

  // ④ notes 缺失/非 string → catch('')
  it('notes 缺失 → catch 收敛为空串', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.notes).toBe('')
  })
  it('notes 非 string（number） → catch 收敛为空串', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', notes: 123 as unknown as string })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.notes).toBe('')
  })

  // ⑤ icon null/缺失 → catch('')
  it('icon 缺失 → catch 收敛为空串', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.icon).toBe('')
  })
  it('icon 为 null → catch 收敛为空串', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', icon: null })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.icon).toBe('')
  })

  // ⑥ categoryId 缺失 → catch('uncategorized')
  it('categoryId 缺失 → catch 收敛为 uncategorized', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.categoryId).toBe('uncategorized')
  })
  it('categoryId 为 null → catch 收敛为 uncategorized（非保留 null）', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', categoryId: null })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.categoryId).toBe('uncategorized')
  })

  // ⑦ order: '10' → 10（coerceNum 字符串 coerce）+ 非法 → 0
  it('order 字符串数字 → coerceNum coerce 成 number 10', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', order: '10' as unknown as number })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.order).toBe(10)
  })
  it('order 非法字符串 abc → coerceNum catch 兜底 0', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', order: 'abc' as unknown as number })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.order).toBe(0)
  })
  it('order 缺失 → coerceNum catch 兜底 0', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.order).toBe(0)
  })
  it('order 为 0 合法 number 保留不误兜底（0 是合法值非 falsy 触发 catch）', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', order: 0 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.order).toBe(0)
  })

  // ⑧ useCount: '5' → 5 + 'abc' → 0
  it('useCount 字符串数字 → coerceNum coerce 成 5', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', useCount: '5' as unknown as number })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.useCount).toBe(5)
  })
  it('useCount 非法字符串 → coerceNum catch 兜底 0', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', useCount: 'abc' as unknown as number })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.useCount).toBe(0)
  })

  // ⑨ isExpanded 非 boolean → catch(false)
  it('isExpanded 非 boolean（字符串 "true"）→ catch 收敛为 false', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', isExpanded: 'true' as unknown as boolean })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.isExpanded).toBe(false)
  })
  it('isExpanded 缺失 → catch 收敛为 false', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.isExpanded).toBe(false)
  })
  it('isExpanded=true 合法保留', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', isExpanded: true })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.isExpanded).toBe(true)
  })

  // ⑩ isPublic optional：缺失 → undefined；present 非 boolean 边界
  it('isPublic 缺失 → optional 返回 undefined（不强制兜底）', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.isPublic).toBeUndefined()
  })
  it('isPublic=true present 保留', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', isPublic: true })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.isPublic).toBe(true)
  })

  // ⑪ updatedAt 缺失 → coerceNum 动态 Date.now() 兜底（用 fakeTimers 钉死）
  it('updatedAt 缺失 → coerceNum 动态 now 兜底（fakeTimers 钉死 FIXED_NOW）', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.updatedAt).toBe(FIXED_NOW)
  })
  it('updatedAt 字符串数字 → coerceNum coerce 成 number', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', updatedAt: '1700000000000' as unknown as number })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.updatedAt).toBe(1700000000000)
  })

  // ⑫ deletedAt/pinnedAt optional
  it('deletedAt 缺失 → optional undefined', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.deletedAt).toBeUndefined()
  })
  it('pinnedAt present number 保留', () => {
    const r = SiblingGroupSchema.safeParse({ id: 'g1', name: 'g', pinnedAt: 123456 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.pinnedAt).toBe(123456)
  })
})

describe('D1-54 CustomAttributeSchema literal/optional', () => {
  // ⑬ CustomAttributeSchema.type 非 'boolean' literal → success===false
  it('type 非 boolean literal（"string"）→ success===false 硬拒', () => {
    const r = CustomAttributeSchema.safeParse({ id: 'a1', name: '标签一', type: 'string' })
    expect(r.success).toBe(false)
  })
  it('type 缺失 → success===false 硬拒（literal 必填）', () => {
    const r = CustomAttributeSchema.safeParse({ id: 'a1', name: '标签一' })
    expect(r.success).toBe(false)
  })
  it('id/name 缺失 → success===false 硬拒', () => {
    expect(CustomAttributeSchema.safeParse({ name: 'x', type: 'boolean' }).success).toBe(false)
    expect(CustomAttributeSchema.safeParse({ id: 'y', type: 'boolean' }).success).toBe(false)
  })
  it('合法 type=boolean → success=true（与生产 useDataIO.ts:219 入参一致）', () => {
    const r = CustomAttributeSchema.safeParse({ id: 'a1', name: '标签一', type: 'boolean', updatedAt: 1700000000000 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.id).toBe('a1')
      expect(r.data.name).toBe('标签一')
      expect(r.data.type).toBe('boolean')
      expect(r.data.updatedAt).toBe(1700000000000)
    }
  })
  // ⑭ CustomAttributeSchema.updatedAt/deletedAt optional
  it('updatedAt/deletedAt 缺失 → optional undefined', () => {
    const r = CustomAttributeSchema.safeParse({ id: 'a1', name: '标签一', type: 'boolean' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.updatedAt).toBeUndefined()
      expect(r.data.deletedAt).toBeUndefined()
    }
  })
})

describe('D1-54 EncryptedPasswordSchema literal(true)+必填', () => {
  // ⑮ EncryptedPasswordSchema encrypted 非 true / data/iv/salt 缺失 → success===false + 合法 success=true
  it('encrypted 非 true（false）→ success===false', () => {
    const r = EncryptedPasswordSchema.safeParse({ encrypted: false, data: 'd', iv: 'i', salt: 's' })
    expect(r.success).toBe(false)
  })
  it('encrypted 缺失 → success===false', () => {
    const r = EncryptedPasswordSchema.safeParse({ data: 'd', iv: 'i', salt: 's' })
    expect(r.success).toBe(false)
  })
  it('data 缺失 → success===false', () => {
    const r = EncryptedPasswordSchema.safeParse({ encrypted: true, iv: 'i', salt: 's' })
    expect(r.success).toBe(false)
  })
  it('iv 缺失 → success===false', () => {
    const r = EncryptedPasswordSchema.safeParse({ encrypted: true, data: 'd', salt: 's' })
    expect(r.success).toBe(false)
  })
  it('salt 缺失 → success===false', () => {
    const r = EncryptedPasswordSchema.safeParse({ encrypted: true, data: 'd', iv: 'i' })
    expect(r.success).toBe(false)
  })
  it('合法完整对象 → success=true（四字段全齐）', () => {
    const r = EncryptedPasswordSchema.safeParse({ encrypted: true, data: 'd', iv: 'i', salt: 's' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.encrypted).toBe(true)
      expect(r.data.data).toBe('d')
      expect(r.data.iv).toBe('i')
      expect(r.data.salt).toBe('s')
    }
  })
})
