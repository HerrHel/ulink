/**
 * D1-55：BookmarkSchema / AppDataSchema catch/coerce 软降级语义护栏——续 dig d1-54
 * pointer #2 "schemas.ts 声明层破枯竭真新面"。schemaPasswordTolerance 间接测 BookmarkSchema
 * password union catch（5 it）+ schemasCategoryCatch 测 order coerce / attributes strip（2 it），
 * 仅覆盖 BookmarkSchema 3 字段；AppDataSchema 经 schemaPasswordTolerance _masterCanary union + schemasCategoryCatch
 * 坏 categories 不拖垮（2 组）间接测。BookmarkSchema 其余 9 字段 catch 兜底 + id/title/url 硬拒路径
 * 全零纯 safeParse 直测；AppDataSchema 4 必填数组硬拒 / array 元素级硬拒冒泡 / 顶层 5 个 optional 缺失行为全零直测。
 *
 * 生产消费方：useDataIO.ts:238 _mergeBookmarks BookmarkSchema.safeParse（parsed.success 决定 imported++ vs skipped++，
 * 用户导入书签时歪斜行软降级保留 vs 整行 skip——「导入后书签不见了」用户可见承载）；useSyncMapping.ts:228
 * fromRemoteBookmark 经 _validateWith(BookmarkSchema, ...)（仅校验不消费 parsed.data，**catch 默默吞坏字段令
 * success=true 决定远端坏数据采纳 vs 跳过**——username/notes/icon/categoryId/useCount 等字段的 catch 兜底
 * 在「远端坏数据被默默采纳入 store」这类场景里生效而非仅 password union）；app.ts:160 + persist.ts:176/217 +
 * useDataIO.ts:525 AppDataSchema.safeParse（整库导入校验，4 必填数组硬拒与 element 级冒泡决定整库是否被采）。
 *
 * BookmarkSchema.safeParse 与 AppDataSchema.safeParse 均纯读路径（Zod 校验返 parsed 对象），非
 * crypto/migrations/sync 写路径/序列化/数据格式改动需 needs-user-review 范畴（同 D1-30 migrations 高危 +
 * D1-54 SiblingGroupSchema 纯加测试先例，schemas 危险度更低因纯校验非迁移核）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BookmarkSchema, AppDataSchema } from '../schemas.js'

const FIXED_NOW = 1_700_000_000_000 // 钉死 createdAt/updatedAt 动态 now 兜底确定性

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

/** 合法基线 Bookmark（仅含必填 id/title/url，其余走 catch/coerce 兜底） */
const validBm = {
  id: 'b1',
  title: '测试',
  url: 'https://x.com',
}

describe('D1-55 BookmarkSchema catch/coerce 软降级', () => {
  // ① id/title/url 缺失 → 硬拒路径（z.string() 无 catch，与 SiblingGroupSchema.id/name 同款）
  it('id 缺失 success===false 硬拒（不软降级，无 catch）', () => {
    const r = BookmarkSchema.safeParse({ title: '测试', url: 'https://x.com' })
    expect(r.success).toBe(false)
  })
  it('title 缺失 success===false 硬拒（不软降级，无 catch）', () => {
    const r = BookmarkSchema.safeParse({ id: 'b1', url: 'https://x.com' })
    expect(r.success).toBe(false)
  })
  it('url 缺失 success===false 硬拒（不软降级，无 catch）', () => {
    const r = BookmarkSchema.safeParse({ id: 'b1', title: '测试' })
    expect(r.success).toBe(false)
  })

  // ② 软收敛 catch 字段
  it('username 缺失→catch(\'\')；number 收敛为空串而非 toString', () => {
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.username).toBe('')
    const r = BookmarkSchema.safeParse({ ...validBm, username: null })
    expect(r.success).toBe(true)
    expect(r.data!.username).toBe('')
  })
  it('notes 缺失→catch(\'\')；number 收敛为空串（不 toString 成 "123"）', () => {
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.notes).toBe('')
    const r = BookmarkSchema.safeParse({ ...validBm, notes: 123 })
    expect(r.success).toBe(true)
    expect(r.data!.notes).toBe('')
  })
  it('icon 缺失→catch(\'\')；null 收敛为空串', () => {
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.icon).toBe('')
    const r = BookmarkSchema.safeParse({ ...validBm, icon: null })
    expect(r.success).toBe(true)
    expect(r.data!.icon).toBe('')
  })
  it('categoryId 缺失→catch(\'uncategorized\')；null 收敛 uncategorized 不保留 null', () => {
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.categoryId).toBe('uncategorized')
    const r = BookmarkSchema.safeParse({ ...validBm, categoryId: null })
    expect(r.success).toBe(true)
    expect(r.data!.categoryId).toBe('uncategorized')
  })

  // ③ parentId .nullable().catch(null)
  it('parentId 缺失→catch(null)；合法 string 字符串保留', () => {
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.parentId).toBe(null)
  })
  it('parentId 合法 string 通过保留', () => {
    const r = BookmarkSchema.safeParse({ ...validBm, parentId: 'parent-id' })
    expect(r.success).toBe(true)
    expect(r.data!.parentId).toBe('parent-id')
  })
  it('parentId 显式 null 通过保留 null', () => {
    const r = BookmarkSchema.safeParse({ ...validBm, parentId: null })
    expect(r.success).toBe(true)
    expect(r.data!.parentId).toBe(null)
  })
  it('parentId 非 null 非 string（如 number）→catch(null) 不保留 number', () => {
    const r = BookmarkSchema.safeParse({ ...validBm, parentId: 123 })
    expect(r.success).toBe(true)
    expect(r.data!.parentId).toBe(null)
  })

  // ④ coerceNum 字段（同 d1-54 SiblingGroupSchema order/useCount 已锁的口径）
  it('order 字符串 \'10\'→10 coerceNum；\'abc\'→0 兜底；缺失→0', () => {
    expect(BookmarkSchema.safeParse({ ...validBm, order: '10' }).data!.order).toBe(10)
    expect(BookmarkSchema.safeParse({ ...validBm, order: 'abc' }).data!.order).toBe(0)
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.order).toBe(0)
  })
  it('order 0 合法保留不误 catch 兜底（coerceNum 对合法 0 不 catch）', () => {
    expect(BookmarkSchema.safeParse({ ...validBm, order: 0 }).data!.order).toBe(0)
  })
  it('useCount 字符串 \'5\'→5 coerceNum；\'abc\'→0；缺失→0', () => {
    expect(BookmarkSchema.safeParse({ ...validBm, useCount: '5' }).data!.useCount).toBe(5)
    expect(BookmarkSchema.safeParse({ ...validBm, useCount: 'abc' }).data!.useCount).toBe(0)
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.useCount).toBe(0)
  })

  // ⑤ createdAt/updatedAt 动态 now 兜底（fakeTimers 钉死确定性）
  it('createdAt 缺失→动态 Date.now() 兜底（fakeTimers 钉死 FIXED_NOW）', () => {
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.createdAt).toBe(FIXED_NOW)
  })
  it('updatedAt 缺失→动态 Date.now() 兜底（fakeTimers 钉死 FIXED_NOW）', () => {
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.updatedAt).toBe(FIXED_NOW)
  })
  it('createdAt 字符串数字 \'1700\'→1700 coerceNum', () => {
    expect(BookmarkSchema.safeParse({ ...validBm, createdAt: '1700' }).data!.createdAt).toBe(1700)
  })
  it('createdAt 非法字符串 \'abc\'→动态 now 兜底', () => {
    expect(BookmarkSchema.safeParse({ ...validBm, createdAt: 'abc' }).data!.createdAt).toBe(FIXED_NOW)
  })

  // ⑥ isExpanded 非布尔→catch(false) 收敛
  it('isExpanded 缺失→catch(false) 收敛；字符串 \'true\' 不当真布尔→catch(false)', () => {
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.isExpanded).toBe(false)
    const r = BookmarkSchema.safeParse({ ...validBm, isExpanded: 'true' })
    expect(r.success).toBe(true)
    expect(r.data!.isExpanded).toBe(false)
  })
  it('isExpanded 合法 true 保留不被误 catch', () => {
    expect(BookmarkSchema.safeParse({ ...validBm, isExpanded: true }).data!.isExpanded).toBe(true)
  })

  // ⑦ deletedAt/pinnedAt optional 缺失→undefined
  it('deletedAt 缺失→optional undefined', () => {
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.deletedAt).toBe(undefined)
  })
  it('pinnedAt 缺失→optional undefined；合法 number 保留', () => {
    expect(BookmarkSchema.safeParse({ ...validBm }).data!.pinnedAt).toBe(undefined)
    const r = BookmarkSchema.safeParse({ ...validBm, pinnedAt: FIXED_NOW })
    expect(r.success).toBe(true)
    expect(r.data!.pinnedAt).toBe(FIXED_NOW)
  })

  // ⑧ password union（schemaPasswordTolerance 已覆盖 5 分支，此处仅补「缺失 catch(\'\')」与「合法保留」契约 linkage）
  it('password 缺失→union.catch(\'\') 收敛为空串（schemaPasswordTolerance 末验，本次直锁缺失分支）', () => {
    const r = BookmarkSchema.safeParse({ ...validBm })
    expect(r.success).toBe(true)
    expect(r.data!.password).toBe('')
  })
})

describe('D1-55 AppDataSchema 必填数组硬拒 + element 冒泡 + optional 顶层', () => {
  const validApp = {
    bookmarks: [],
    siblingGroups: [],
    categories: [],
    customAttributes: [],
  }

  // ① 4 必填数组任一缺失 → 硬拒（z.array 无 catch）
  it('bookmarks 缺失 success===false 硬拒（必填数组无 catch）', () => {
    const r = AppDataSchema.safeParse({ ...validApp, bookmarks: undefined })
    expect(r.success).toBe(false)
  })
  it('siblingGroups 缺失 success===false 硬拒', () => {
    const r = AppDataSchema.safeParse({ ...validApp, siblingGroups: undefined })
    expect(r.success).toBe(false)
  })
  it('categories 缺失 success===false 硬拒', () => {
    const r = AppDataSchema.safeParse({ ...validApp, categories: undefined })
    expect(r.success).toBe(false)
  })
  it('customAttributes 缺失 success===false 硬拒', () => {
    const r = AppDataSchema.safeParse({ ...validApp, customAttributes: undefined })
    expect(r.success).toBe(false)
  })

  // ② array 元素级硬拒冒泡：坏 BookmarkSchema 元素（如缺 url）令整库 success=false
  it('bookmarks 含坏元素（id 缺失）→整库 success===false，元素硬拒冒泡非 array 兜底', () => {
    const r = AppDataSchema.safeParse({
      ...validApp,
      bookmarks: [{ title: '无id书签', url: 'https://x.com' }],
    })
    expect(r.success).toBe(false)
  })
  it('bookmarks 含坏元素（url 缺失）→整库 success===false', () => {
    const r = AppDataSchema.safeParse({
      ...validApp,
      bookmarks: [{ id: 'b1', title: '无url书签' }],
    })
    expect(r.success).toBe(false)
  })
  it('bookmarks 合法元素 success===true，catch 字段软降级保留', () => {
    const r = AppDataSchema.safeParse({
      ...validApp,
      bookmarks: [{ id: 'b1', title: '合法', url: 'https://x.com' }],
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.bookmarks).toHaveLength(1)
      // catch 软降级在 array 元素内生效：username/notes 等 catch 兜底
      expect(r.data.bookmarks[0].username).toBe('')
      expect(r.data.bookmarks[0].categoryId).toBe('uncategorized')
    }
  })

  // ③ 顶层 5 个 optional 缺失→undefined
  it('_dataVersion/_schemaVersion/_writeSeq/_savedAt 缺失→optional undefined', () => {
    const r = AppDataSchema.safeParse(validApp)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data._dataVersion).toBe(undefined)
      expect(r.data._schemaVersion).toBe(undefined)
      expect(r.data._writeSeq).toBe(undefined)
      expect(r.data._savedAt).toBe(undefined)
    }
  })
  it('_masterCanary 缺失→optional undefined（非强制 union.catch(\'\') 兜底）', () => {
    const r = AppDataSchema.safeParse(validApp)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data._masterCanary).toBe(undefined)
    }
  })
  it('_masterCanary 坏值（number）→union.catch(\'\') 收敛空串后 optional 仍保留（present 则 catch 生效）', () => {
    const r = AppDataSchema.safeParse({ ...validApp, _masterCanary: 99999 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data._masterCanary).toBe('')
    }
  })

  // ④ 空 AppData（仅 4 空数组）合法 success===true
  it('仅 4 空数组合法 success===true（schemaPasswordTolerance 末验，本次直锁空 AppData 基线）', () => {
    const r = AppDataSchema.safeParse(validApp)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.bookmarks).toEqual([])
      expect(r.data.siblingGroups).toEqual([])
      expect(r.data.categories).toEqual([])
      expect(r.data.customAttributes).toEqual([])
    }
  })
})
