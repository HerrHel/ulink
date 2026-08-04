/**
 * D1-117(stores区·本轮 r9 第 3 chunk)：app.ts `_fingerprint` 持久化指纹护盾护栏
 *
 * `_fingerprint(data: AppData): string` 是 PERF-3 写盘去重的轻量指纹——save() 调它
 * 与上次成功指纹 `_lastSavedFp[space]` 比较，相同则跳过 Zod 校验 + 双写 localStorage/IDB
 * 早退。指纹串格式：`${bms.length}|${grps.length}|${cats.length}|${attrs.length}|${maxUp}|${_schemaVersion}`。
 *
 * **审计 H1 核心契约**：纯 rename category/attribute 只改自身 name+updatedAt，四数组 length
 * 不变、bookmarks/siblingGroups 的 maxUp 也不顶高——若指纹漏纳 cats/attrs 的 max updatedAt，
 * rename 后 fp 不变命中 `fp===_lastSavedFp` 早退，rename 不落盘（用户改名后刷新还原）。
 * H1 修复把 cats/attrs max updatedAt 纳入指纹，本 chunk 直锁此契约防回归。
 *
 * 此前零直接单测（grep `src/__tests__/` 0 命中），仅经 save() 用 fake timers 间接验证
 * "rename 两次都落盘"——但指纹串本身（四个数组 length + 跨实体 maxUp + `_schemaVersion`
 * 六段 join）从未直接锁定。一旦有人回归成只取 bookmarks/siblingGroups 的 maxUp，
 * 间接测可能因其他落盘路径旁路而漏报。本 chunk 直锁指纹串契约为可回归断言。
 *
 * **纯函数提升**：原 `_fingerprint` 在 `defineStore('app', () => {...})` setup 闭包内，
 * 抽到模块顶层 `export function _fingerprint` 供测试 import——纯函数零依赖任何闭包变量，
 * setup 内 L156 `const fp = _fingerprint(data)` 调用不变，零行为变化（同 D1-14/15/16
 * 「数据核硬约束但不借优化之名改 vs 纯加测试锁契约」口径，仅是函数位置移动 + export）。
 */
import { describe, it, expect } from 'vitest'
import { _fingerprint } from '../../stores/app.js'
import type { AppData, Bookmark, SiblingGroup, Category, CustomAttribute } from '../../types.js'

// ── 工厂辅助 ──
function mkBm(p: Partial<Pick<Bookmark, 'id' | 'updatedAt'>>): Bookmark {
  return {
    id: p.id ?? 'b1',
    title: '', url: '', username: '', password: '', notes: '', icon: '',
    categoryId: 'c', parentId: null, order: 0, useCount: 0, attributes: {},
    isExpanded: false, createdAt: 0, updatedAt: p.updatedAt ?? 0,
  } as Bookmark
}
function mkGrp(p: Partial<Pick<SiblingGroup, 'id' | 'updatedAt'>>): SiblingGroup {
  return {
    id: p.id ?? 'g1', name: '', categoryId: 'c', icon: '', order: 0, isExpanded: false,
    attributes: {}, bookmarkIds: [], notes: '', updatedAt: p.updatedAt ?? 0, useCount: 0,
  } as SiblingGroup
}
function mkCat(p: Partial<Pick<Category, 'id' | 'updatedAt'>>): Category {
  return { id: p.id ?? 'cat1', name: '', icon: '', color: '', order: 0 } as Category
}
function mkAttr(p: Partial<Pick<CustomAttribute, 'id' | 'name'>>): CustomAttribute {
  return { id: p.id ?? 'a1', name: p.name ?? 'attr', type: 'boolean' } as CustomAttribute
}
function data(p: Partial<AppData> & { _schemaVersion?: number } = {}): AppData {
  return {
    bookmarks: p.bookmarks ?? [],
    siblingGroups: p.siblingGroups ?? [],
    categories: p.categories ?? [],
    customAttributes: p.customAttributes ?? [],
    _schemaVersion: p._schemaVersion,
  } as AppData
}

describe('_fingerprint', () => {
  // ─── 基本格式 ───
  it('六段格式：length×4 | maxUp | _schemaVersion，分隔符 |', () => {
    const d = data({
      bookmarks: [mkBm({ id: 'b1', updatedAt: 100 })],
      siblingGroups: [mkGrp({ id: 'g1', updatedAt: 200 })],
      categories: [mkCat({ id: 'c1' })],
      customAttributes: [mkAttr({ id: 'a1' })],
      _schemaVersion: 2,
    } as Partial<AppData>)
    expect(_fingerprint(d)).toBe('1|1|1|1|200|2')
  })

  it('空 AppData（四数组全空、无 schemaVersion）→ 0|0|0|0|0|', () => {
    expect(_fingerprint(data())).toBe('0|0|0|0|0|')
  })

  // ─── 四数组兜底 || [] ───
  it('四数组 undefined/null 各走 ||[]，length 段全 0', () => {
    const d = { bookmarks: undefined, siblingGroups: null, categories: undefined, customAttributes: null } as unknown as AppData
    expect(_fingerprint(d)).toBe('0|0|0|0|0|')
  })

  it('四数组各自长度独立计入（多元素）', () => {
    const d = data({
      bookmarks: [mkBm({}), mkBm({ id: 'b2' }), mkBm({ id: 'b3' })],
      siblingGroups: [mkGrp({}), mkGrp({ id: 'g2' })],
      categories: [mkCat({})],
      customAttributes: [mkAttr({}), mkAttr({ id: 'a2' }), mkAttr({ id: 'a3' }), mkAttr({ id: 'a4' })],
    })
    expect(_fingerprint(d)).toBe('3|2|1|4|0|')
  })

  // ─── maxUp：跨四数组取最大 ───
  it('maxUp 取四数组所有实体 updatedAt 的最大值', () => {
    const d = data({
      bookmarks: [mkBm({ updatedAt: 100 }), mkBm({ id: 'b2', updatedAt: 500 })],
      siblingGroups: [mkGrp({ updatedAt: 300 })],
      categories: [mkCat({ id: 'c1' })], // Category 无 updatedAt 字段（类型不要求）
      customAttributes: [mkAttr({ id: 'a1' })],
    })
    // bookmark updatedAt 500 > 300/0/0 → maxUp=500
    expect(_fingerprint(d)).toBe('2|1|1|1|500|')
  })

  it('updatedAt 缺失实体走 ||0，不影响 maxUp', () => {
    const b = mkBm({ updatedAt: 100 })
    delete (b as Partial<Bookmark>).updatedAt
    const d = data({ bookmarks: [b, mkBm({ id: 'b2', updatedAt: 100 })] })
    // 缺失 updatedAt 视 0，另一实体 100 → maxUp=100
    expect(_fingerprint(d)).toBe('2|0|0|0|100|')
  })

  it('updatedAt=0 是合法值（0 || 0 = 0，不被替换）', () => {
    const d = data({
      bookmarks: [mkBm({ updatedAt: 0 })],
    })
    // 0 是合法 updatedAt 不顶 maxUp（0 > 0 false），故 maxUp=0
    expect(_fingerprint(d)).toBe('1|0|0|0|0|')
  })

  // ─── 审计 H1 核心契约：cats/attrs 的 max updatedAt 纳入指纹 ───
  it('H1：纯改 category updatedAt 顶高 maxUp（防 rename 不落盘早退）', () => {
    // 模拟：原数据所有 bookmarks/groups updatedAt=100,categories 仅 [c1]=100
    const before = data({
      bookmarks: [mkBm({ updatedAt: 100 })],
      categories: [mkCat({ id: 'c1' }) as Category & { updatedAt?: number } as unknown as Category], // 无 updatedAt
    }) as AppData
    // 给 c1 加 updatedAt=200（模拟 rename 触发 updatedAt 更新）
    const catAfter = mkCat({ id: 'c1' }) as Category & { updatedAt?: number }
    ;(catAfter as { updatedAt?: number }).updatedAt = 200
    const after = data({
      bookmarks: [mkBm({ updatedAt: 100 })],
      categories: [catAfter],
    }) as AppData
    const fpBefore = _fingerprint(before)
    const fpAfter = _fingerprint(after)
    // 核心契约：categories 单独 updatedAt 升高也顶高 maxUp，指纹变化
    expect(fpBefore).not.toBe(fpAfter)
    expect(fpAfter).toBe('1|0|1|0|200|') // maxUp 100→200
  })

  it('H1：纯改 attribute updatedAt 顶高 maxUp（同上 attribute 维度）', () => {
    // 模拟 before：bookmarks updatedAt=100，attribute 无 updatedAt
    const before = data({
      bookmarks: [mkBm({ updatedAt: 100 })],
      customAttributes: [mkAttr({ id: 'a1' })],
    }) as AppData
    // 模拟 after：attribute 加 updatedAt=300（更高的 maxUp）
    const attrAfter = mkAttr({ id: 'a1' }) as CustomAttribute & { updatedAt?: number }
    ;(attrAfter as { updatedAt?: number }).updatedAt = 300
    const after = data({
      bookmarks: [mkBm({ updatedAt: 100 })],
      customAttributes: [attrAfter],
    }) as AppData
    expect(_fingerprint(before)).not.toBe(_fingerprint(after))
    expect(_fingerprint(after)).toBe('1|0|0|1|300|')
  })

  it('H1 反证：若指纹漏纳 cats/attrs maxUp 则 rename 前后指纹相同（锁现有正确行为不为回归）', () => {
    // 此用例锁"正确"行为：category updatedAt 升高应让指纹变化。
    // 若有人误回归成只取 bookmarks/groups maxUp，本断言失败抓到。
    const before = data({
      bookmarks: [mkBm({ updatedAt: 100 })],
      categories: [mkCat({ id: 'c1' }) as Category & { updatedAt?: number } as unknown as Category],
    }) as AppData
    const catBumped = mkCat({ id: 'c1' }) as Category & { updatedAt?: number }
    ;(catBumped as { updatedAt?: number }).updatedAt = 999
    const after = data({
      bookmarks: [mkBm({ updatedAt: 100 })],
      categories: [catBumped],
    }) as AppData
    // before 的 c1 无 updatedAt → maxUp=100（来自 bookmark）
    expect(_fingerprint(before)).toBe('1|0|1|0|100|')
    // after 的 c1 updatedAt=999 → maxUp 应升到 999（H1 修复保留）
    expect(_fingerprint(after)).toBe('1|0|1|0|999|')
    expect(_fingerprint(after)).not.toBe(_fingerprint(before))
  })

  // ─── _schemaVersion ?? '' 边界 ───
  it('_schemaVersion 缺失走 ?? → 末段空串', () => {
    const d = data({ bookmarks: [mkBm({ updatedAt: 5 })] }) as AppData // 无 _schemaVersion
    expect(_fingerprint(d)).toBe('1|0|0|0|5|')
  })

  it('_schemaVersion=0 保留为字面 0（非 nullish 不走 ??）', () => {
    const d = data({ bookmarks: [mkBm({})] }) as AppData & { _schemaVersion?: number }
    ;(d as { _schemaVersion?: number })._schemaVersion = 0
    expect(_fingerprint(d)).toBe('1|0|0|0|0|0')
  })

  it('_schemaVersion=2 保留为字面 2', () => {
    const d = data({}) as AppData & { _schemaVersion?: number }
    ;(d as { _schemaVersion?: number })._schemaVersion = 2
    expect(_fingerprint(d)).toBe('0|0|0|0|0|2')
  })

  // ─── 各 updatedAt 0/negative 边界 ───
  it('所有实体 updatedAt 都 0 → maxUp=0', () => {
    const d = data({
      bookmarks: [mkBm({ updatedAt: 0 }), mkBm({ id: 'b2', updatedAt: 0 })],
      siblingGroups: [mkGrp({ updatedAt: 0 })],
    })
    expect(_fingerprint(d)).toBe('2|1|0|0|0|')
  })

  it('取最大正 updatedAt（不取首个）', () => {
    const d = data({
      bookmarks: [mkBm({ updatedAt: 10 }), mkBm({ id: 'b2', updatedAt: 5 }), mkBm({ id: 'b3', updatedAt: 999 })],
      siblingGroups: [mkGrp({ updatedAt: 100 })],
    })
    expect(_fingerprint(d)).toBe('3|1|0|0|999|')
  })

  // ─── 纯函数幂等性 ───
  it('纯函数幂等：同输入同输出，多次调用不变', () => {
    const d = data({
      bookmarks: [mkBm({ updatedAt: 42 })],
      categories: [mkCat({ id: 'c1' })],
    })
    const a = _fingerprint(d)
    const b = _fingerprint(d)
    expect(a).toBe(b)
    expect(a).toBe('1|0|1|0|42|')
  })
})
