/**
 * stores/persist-stamp.test.ts — _stamp 写戳护栏（D1-26）
 *
 * _stamp 是持久化层在写盘（saveData / saveToLocalStorage / saveToIDB）前给 AppData
 * 打「写戳」的纯路由函数：
 *  - _writeSeq 进程内单调递增，可比多端/缓存新旧
 *  - 保留已有 number 类 _schemaVersion；非 number（缺失/null/字符串）回退 CURRENT_SCHEMA_VERSION
 *    —— 这是 migrations 门控（_schemaVersion >= CURRENT 才跳过迁移）的写侧入口
 *  - _dataVersion 镜像 _writeSeq（兼容旧读者）
 *  - _savedAt 取 Date.now()
 *
 * QUAL-01（persist.test.ts）间接覆盖了 schemaVersion=2 保留 + writeSeq 递增 + 镜像，
 * 但「非 number schemaVersion 回退 CURRENT_SCHEMA_VERSION」边界 / 不 mutate 输入业务字段 /
 * _savedAt 取 now 这些此前零直测。本护栏直锁这些易回归不变量，为后续若碰 persist 写戳
 * 优化铺护栏地基。
 *
 * 注意 _writeSeq 是 persist.ts 模块级 `let _writeSeq = 0` 可变状态、未 export，测试间累积，
 * 故用「同测试内连续两次 stamp 比较相对递增」+ 拿返回值的 _writeSeq 字段断言，
 * 不依赖跨测试绝对值（与 QUAL-01 同口径）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as persist from '../../stores/persist.js'
import { CURRENT_SCHEMA_VERSION } from '../../stores/migrations.js'
import type { AppData } from '../../types.js'

const mkData = (over: Partial<AppData> = {}): AppData => ({
  bookmarks: [],
  siblingGroups: [],
  categories: [],
  customAttributes: [],
  ...over,
})

describe('persist _stamp 写戳护栏', () => {
  beforeEach(() => {
    // 不重置 _writeSeq（模块级私有不可访问），用相对断言 + 返回字段
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('_writeSeq 连续 stamp 单调递增且返回字段等于内部序号', () => {
    const a = persist._stamp(mkData())
    const b = persist._stamp(mkData())
    expect(b._writeSeq).toBeGreaterThan(a._writeSeq)
    // _dataVersion 镜像 _writeSeq
    expect(a._dataVersion).toBe(a._writeSeq)
    expect(b._dataVersion).toBe(b._writeSeq)
    // _writeSeq 是 number
    expect(typeof a._writeSeq).toBe('number')
  })

  it('保留已有 number 类 _schemaVersion（不被 writeSeq 覆盖）', () => {
    const data = { ...mkData(), _schemaVersion: 2 } as AppData
    const stamped = persist._stamp(data)
    expect(stamped._schemaVersion).toBe(2)
  })

  it('0 是合法 number _schemaVersion → 保留 0（不误回退 CURRENT）', () => {
    // 边界：0 是 number 但 falsy，若有误改为 truthy 判定会回退，破坏旧数据 schemaVersion=0 的保留
    const data = { ...mkData(), _schemaVersion: 0 } as AppData
    const stamped = persist._stamp(data)
    expect(stamped._schemaVersion).toBe(0)
  })

  it('_schemaVersion 缺失（undefined）→ 回退 CURRENT_SCHEMA_VERSION', () => {
    const stamped = persist._stamp(mkData())
    expect(stamped._schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('_schemaVersion = null（非 number）→ 回退 CURRENT_SCHEMA_VERSION', () => {
    const data = { ...mkData(), _schemaVersion: null as unknown as number } as AppData
    const stamped = persist._stamp(data)
    expect(stamped._schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('_schemaVersion = 字符串 "2"（非 number）→ 回退 CURRENT_SCHEMA_VERSION', () => {
    // 真实易回归点：若 typeof === 'number' 被误改为 truthy 判定，"2" 会被保留触发 migration 门控错乱
    const data = { ...mkData(), _schemaVersion: '2' as unknown as number } as AppData
    const stamped = persist._stamp(data)
    expect(stamped._schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('_savedAt 取 Date.now()（fake timers 锁定非 flaky）', () => {
    vi.useFakeTimers()
    const FIXED = 1_700_000_000_000
    vi.setSystemTime(FIXED)
    const stamped = persist._stamp(mkData())
    expect(stamped._savedAt).toBe(FIXED)
  })

  it('不 mutate 输入业务字段：返回顶层新对象但业务数组保持同引用', () => {
    const data = mkData({
      bookmarks: [{ id: 'b1', title: 'x', url: 'u', username: '', password: '', notes: '', icon: '', categoryId: 'all', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any],
      categories: [{ id: 'c1', name: 'Cat', icon: 'star', color: '', order: 0 } as any],
    })
    const origBookmarksRef = data.bookmarks
    const origCategoriesRef = data.categories
    const stamped = persist._stamp(data)
    // 返回的对象是新引用（spread 拷贝顶层），不是输入同一对象
    expect(stamped).not.toBe(data)
    // 业务数组引用保留（spread 浅拷贝：数组成员对象复用引用）
    expect(stamped.bookmarks).toBe(origBookmarksRef)
    expect(stamped.categories).toBe(origCategoriesRef)
    // 业务内容不变
    expect(stamped.bookmarks.length).toBe(1)
    expect(stamped.bookmarks[0].id).toBe('b1')
    // 输入对象本身未被 mutate（原 data 不被注入 _writeSeq/_savedAt）
    expect((data as any)._writeSeq).toBeUndefined()
    expect((data as any)._savedAt).toBeUndefined()
  })

  it('stamp 只覆盖 _* 管理字段，保留 data 其余自定义字段不变', () => {
    // 输入带一些非 _ 前缀的额外字段应原样保留（spread 保留）
    const data = { ...mkData(), _extraNote: 'should-survive' } as unknown as AppData
    const stamped = persist._stamp(data)
    expect((stamped as any)._extraNote).toBe('should-survive')
    // 同时打上四个管理字段
    expect(typeof stamped._writeSeq).toBe('number')
    expect(typeof stamped._schemaVersion).toBe('number')
    expect(typeof stamped._dataVersion).toBe('number')
    expect(typeof stamped._savedAt).toBe('number')
  })
})
