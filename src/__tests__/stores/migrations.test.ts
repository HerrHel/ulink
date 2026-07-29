import { describe, it, expect } from 'vitest'
import {
  runMigrations,
  _readSchemaVersion,
  CURRENT_SCHEMA_VERSION
} from '../../stores/migrations.js'
import { DEFAULTS, CAT_ALL, CAT_UNCATEGORIZED, ATTR_IS_GROUP } from '../../config/constants.js'
import type { AppData, Bookmark, SiblingGroup, CustomAttribute } from '../../types.js'

// D1-30：runMigrations 旧格式迁移核护栏（P1#2）。
// migrations.ts 是高危模块（迁移/数据格式），但本 chunk 守则——纯加测试零逻辑改动，
// 仅给 _readSchemaVersion 增 `export` 关键字供直测版本门控四分支，runMigrations 早 export。
// 不碰任何迁移逻辑：锁定 runMigrations 对 result 的副作用契约 + needsPersist 返回值，
// 为后续迁移边界优化铺路。

// freshResult 形态对齐 persist.loadFromLocalStorage：从 d 浅拷 categories/bookmarks/...
// runMigrations mutate result，属性 id 重写（步骤2）mutate 源 d.bookmarks/d.siblingGroups。
// 对 attributes 保持源语义（生产 persist 同频引用 d 元素，未 {} 化），使「group/bookmark
// attributes 缺失 → 补默认」分支可达；其余字段原样浅拷。
function freshResult(d: Partial<AppData>): AppData {
  return {
    categories: (d.categories || DEFAULTS.categories.slice()).map(c => ({ ...c })),
    bookmarks: (d.bookmarks || []).map(b => ({ ...b })),
    customAttributes: (d.customAttributes || []).map(a => ({ ...a })),
    siblingGroups: (d.siblingGroups || []).map(g => ({ ...g }))
  } as AppData
}

function bm(partial: Partial<Bookmark> & { id: string }): Bookmark {
  return {
    id: partial.id,
    title: partial.title ?? 'T',
    url: partial.url ?? 'https://x.com',
    icon: partial.icon ?? '',
    categoryId: partial.categoryId ?? CAT_UNCATEGORIZED,
    parentId: partial.parentId ?? null,
    order: partial.order ?? 0,
    useCount: partial.useCount ?? 0,
    attributes: partial.attributes ?? {},
    isExpanded: partial.isExpanded ?? false,
    createdAt: partial.createdAt ?? 1000,
    updatedAt: partial.updatedAt ?? 1000
  } as Bookmark
}

function group(partial: Partial<SiblingGroup> & { id: string }): SiblingGroup {
  return {
    id: partial.id,
    name: partial.name ?? 'G',
    categoryId: partial.categoryId ?? CAT_UNCATEGORIZED,
    icon: partial.icon ?? '',
    order: partial.order ?? 0,
    isExpanded: partial.isExpanded ?? false,
    attributes: partial.attributes ?? { [ATTR_IS_GROUP]: true },
    bookmarkIds: partial.bookmarkIds ?? [],
    notes: partial.notes ?? '',
    updatedAt: partial.updatedAt ?? 0,
    useCount: partial.useCount ?? 0
  } as unknown as SiblingGroup
}

describe('_readSchemaVersion / 版本门控四分支', () => {
  it('_schemaVersion 为合法 number → 透传', () => {
    expect(_readSchemaVersion({ _schemaVersion: 2 })).toBe(2)
    expect(_readSchemaVersion({ _schemaVersion: 0 })).toBe(0)
  })
  it('_schemaVersion 非有限 number（undefined/字符串/NaN/Infinity）→ 退到 legacy 判定', () => {
    // undefined → 去看 legacy
    expect(_readSchemaVersion({ _dataVersion: 1 })).toBe(1)
    // 字符串不算 number，NaN/Infinity 非有限 → 落 legacy/0
    expect(_readSchemaVersion({ _schemaVersion: '2' as unknown as number })).toBe(0)
    expect(_readSchemaVersion({ _schemaVersion: Number.NaN })).toBe(0)
    expect(_readSchemaVersion({ _schemaVersion: Number.POSITIVE_INFINITY })).toBe(0)
  })
  it('legacy _dataVersion 真小整数（>0 且 <= CURRENT）→ 信任', () => {
    expect(_readSchemaVersion({ _dataVersion: 1 })).toBe(1)
    expect(_readSchemaVersion({ _dataVersion: CURRENT_SCHEMA_VERSION })).toBe(CURRENT_SCHEMA_VERSION)
  })
  it('legacy _dataVersion 为 writeSeq 污染大值或 0/负 → 强制再迁移返 0', () => {
    // 旧 saveData 把进程计数写进 _dataVersion，远大于 CURRENT
    expect(_readSchemaVersion({ _dataVersion: 99999 })).toBe(0)
    expect(_readSchemaVersion({ _dataVersion: 0 })).toBe(0)
    expect(_readSchemaVersion({ _dataVersion: -5 })).toBe(0)
  })
  it('两字段都缺失 → 0', () => {
    expect(_readSchemaVersion({})).toBe(0)
  })
})

describe('runMigrations / 已是当前 schema 分支', () => {
  it('from >= CURRENT 且 _schemaVersion 已对 → 不迁移返 false', () => {
    const d = { _schemaVersion: CURRENT_SCHEMA_VERSION } as Partial<AppData>
    const result = freshResult({})
    const needs = runMigrations(d, result)
    expect(needs).toBe(false)
  })
  it('from >= CURRENT 但 d 缺 _schemaVersion（仅靠 legacy _dataVersion=2 达到 from≥CURRENT）→ 仅回写 schema 字段返 true（一次回写）', () => {
    // _readSchemaVersion({ _dataVersion: 2 }) → legacy 2（>0 且 ≤CURRENT）→ from=2。
    // d 无 _schemaVersion 字段 → d._schemaVersion !== CURRENT 为真 → 回写 result 并返 true。
    // （仅回写 schema 字段，跳过全部旧盘迁移步骤）
    const d = { _dataVersion: CURRENT_SCHEMA_VERSION } as Partial<AppData>
    const result = {} as AppData
    const needs = runMigrations(d, result)
    expect(needs).toBe(true)
    expect((result as { _schemaVersion?: number })._schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    // 旧盘迁移步骤未执行：DEFAULTS 未注入、result 字段维持（{} 未初始化 categories）
    expect(result.categories).toBeUndefined()
  })
})

describe('runMigrations / 旧盘分支（from < CURRENT）核心迁移步骤副作用', () => {
  it('步骤1：DEFAULTS 缺失的默认分类被补回（如移除某默认 id）', () => {
    const d = {
      _dataVersion: 1, // 触发旧盘迁移
      categories: [{ id: 'uncategorized', name: '未分类', icon: 'bm', color: '#000', order: 0 }], // 残缺
      bookmarks: [],
      customAttributes: [],
      siblingGroups: []
    } as Partial<AppData>
    const result = freshResult(d)
    runMigrations(d, result)
    // 残缺分类 + 全部 DEFAULTS.categories 中的 id 都应在 result.categories 中
    const ids = result.categories.map(c => c.id)
    DEFAULTS.categories.forEach(dc => {
      expect(ids).toContain(dc.id)
    })
    // 用户原有的 uncategorized 不被重复推（find 命中短路）
    expect(result.categories.filter(c => c.id === 'uncategorized').length).toBe(1)
  })

  it('步骤2 R6 对称：attr 同名去重，bookmark 与 siblingGroup 的旧 attr id 对称重写', () => {
    // 两个 attr 同名 '需要登录'，旧 id=old-rl 与新声明 id(newer-rl)，平均场景见 R6
    const oldAttr: CustomAttribute = { id: 'old-rl', name: '需要登录', type: 'boolean' }
    const newAttr: CustomAttribute = { id: 'newer-rl', name: '需要登录', type: 'boolean' }
    const b = bm({ id: 'b1', attributes: { 'old-rl': true } })
    const g = group({ id: 'g1', attributes: { 'old-rl': true } })
    const d = {
      _dataVersion: 1,
      categories: DEFAULTS.categories.slice(),
      customAttributes: [newAttr, oldAttr], // newAttr 先声明成为 keep
      bookmarks: [b],
      siblingGroups: [g]
    } as Partial<AppData>
    const result = freshResult(d)
    const needs = runMigrations(d, result)
    expect(needs).toBe(true) // 去重触发 persist
    // customAttributes 去重只剩 keep
    expect(result.customAttributes.map(a => a.id)).toEqual(['newer-rl'])
    // bookmark 旧 id 重写到 keep.id，旧 id 删除（mutate 的是源 d.bookmarks，result 拷贝了 attributes 副本但未同步——锁定真实行为：result.bookmarks[0].attributes 未被改，源 d.bookmarks[0].attributes 被改）
    // 注意：步骤2 重写入口使用 d.bookmarks / d.siblingGroups（源），不是 result.bookmarks
    expect(b.attributes).toEqual({ 'newer-rl': true })
    expect(g.attributes).toEqual({ 'newer-rl': true })
  })

  it('步骤2：无重复 attr（deduped.length === attrs.length）→ needsPersist 仍 true（旧盘分支末尾恒返 true）', () => {
    const d = {
      _dataVersion: 1,
      categories: DEFAULTS.categories.slice(),
      customAttributes: [{ id: 'ai', name: 'Ai', type: 'boolean' }],
      bookmarks: [],
      siblingGroups: []
    } as Partial<AppData>
    const result = freshResult(d)
    const needs = runMigrations(d, result)
    expect(needs).toBe(true)
    expect(result.customAttributes.map(a => a.id)).toEqual(['ai'])
  })

  it('步骤3：bookmark 与 group categoryId=CAT_ALL → CAT_UNCATEGORIZED', () => {
    const d = {
      _dataVersion: 1,
      categories: DEFAULTS.categories.slice(),
      bookmarks: [bm({ id: 'b1', categoryId: CAT_ALL })],
      siblingGroups: [group({ id: 'g1', categoryId: CAT_ALL })]
    } as Partial<AppData>
    const result = freshResult(d)
    runMigrations(d, result)
    expect(result.bookmarks[0].categoryId).toBe(CAT_UNCATEGORIZED)
    expect(result.siblingGroups[0].categoryId).toBe(CAT_UNCATEGORIZED)
  })

  it('步骤3：group attributes 缺失 → 补 { [ATTR_IS_GROUP]: true }', () => {
    // 直接构造 result 形态（attributes 字段真缺失为 undefined），不借 groups helper 的默认补全，
    // 以便直测「!g.attributes → 补 ATTR_IS_GROUP」分支（freshResult 浅拷保留 undefined 语义）。
    const g = { id: 'g1', name: 'G', categoryId: CAT_UNCATEGORIZED, icon: '', order: 0, isExpanded: false, bookmarkIds: [], notes: '', updatedAt: 0, useCount: 0 } as unknown as SiblingGroup
    const d = {
      _dataVersion: 1,
      categories: DEFAULTS.categories.slice(),
      bookmarks: [],
      customAttributes: [],
      siblingGroups: [g]
    } as Partial<AppData>
    const result = freshResult(d)
    runMigrations(d, result)
    expect(result.siblingGroups[0].attributes).toEqual({ [ATTR_IS_GROUP]: true })
  })

  it('步骤3 D2-003：category 缺 icon/color → 补空串 needsPersist', () => {
    const d = {
      _dataVersion: 1,
      categories: [{ id: 'custom', name: '自定义', order: 0 } as unknown as { id: string; name: string; icon: string; color: string; order: number }],
      bookmarks: [],
      customAttributes: [],
      siblingGroups: []
    } as Partial<AppData>
    const result = freshResult(d)
    const categoryEntry = result.categories.find(c => c.id === 'custom')!
    runMigrations(d, result)
    expect(categoryEntry.icon).toBe('')
    expect(categoryEntry.color).toBe('')
  })

  it('步骤4：纯文本笔记（不含 <标签>）→ 迁成 HTML 内联卡片', () => {
    const target = bm({ id: 'b1', title: 'GitHub' })
    const g = group({ id: 'g1', notes: 'See [GitHub](b1) here' })
    const d = {
      _dataVersion: 1,
      categories: DEFAULTS.categories.slice(),
      bookmarks: [target],
      customAttributes: [],
      siblingGroups: [g]
    } as Partial<AppData>
    const result = freshResult(d)
    runMigrations(d, result)
    // 笔记被转成含内联卡 HTML（group-inline-card class 是 useInlineCard 产物标记）
    expect(result.siblingGroups[0].notes).toContain('group-inline-card')
    expect(result.siblingGroups[0].notes).not.toBe('See [GitHub](b1) here')
  })

  it('步骤4：已是 HTML 的笔记（含 <标签>）→ 不重复迁移（保持原样）', () => {
    const htmlNotes = '<p>existing html</p>'
    const g = group({ id: 'g1', notes: htmlNotes })
    const d = {
      _dataVersion: 1,
      categories: DEFAULTS.categories.slice(),
      bookmarks: [],
      customAttributes: [],
      siblingGroups: [g]
    } as Partial<AppData>
    const result = freshResult(d)
    runMigrations(d, result)
    expect(result.siblingGroups[0].notes).toBe(htmlNotes)
  })

  it('步骤5：localStorage lv_expandStates 记录 → 书签/组 isExpanded 置 true，之后 removeItem', () => {
    localStorage.setItem('lv_expandStates', JSON.stringify({ 'b1': 1, 'g1': 1 }))
    const b = bm({ id: 'b1', isExpanded: false })
    const g = group({ id: 'g1', isExpanded: false })
    const d = {
      _dataVersion: 1,
      categories: DEFAULTS.categories.slice(),
      bookmarks: [b],
      customAttributes: [],
      siblingGroups: [g]
    } as Partial<AppData>
    const result = freshResult(d)
    runMigrations(d, result)
    expect(result.bookmarks[0].isExpanded).toBe(true)
    expect(result.siblingGroups[0].isExpanded).toBe(true)
    // 迁移后清理旧 localStorage 键
    expect(localStorage.getItem('lv_expandStates')).toBeNull()
  })

  it('步骤6：group 缺 updatedAt → 补 Date.now()；缺 useCount → 补 0', () => {
    const g = group({ id: 'g1', updatedAt: undefined as unknown as number, useCount: undefined as unknown as number })
    const d = {
      _dataVersion: 1,
      categories: DEFAULTS.categories.slice(),
      bookmarks: [],
      customAttributes: [],
      siblingGroups: [g]
    } as Partial<AppData>
    const result = freshResult(d)
    const before = Date.now()
    runMigrations(d, result)
    const after = Date.now()
    expect(result.siblingGroups[0].updatedAt).toBeGreaterThanOrEqual(before)
    expect(result.siblingGroups[0].updatedAt).toBeLessThanOrEqual(after)
    expect(result.siblingGroups[0].useCount).toBe(0)
  })

  it('步骤7：bookmark 缺 updatedAt → 补 createdAt（无则 Date.now()）', () => {
    // inline 构造 bookmark 字面量（不借 bm helper 的 updatedAt 默认补全），updatedAt 字段真缺失
    // 以便直测「!b.updatedAt → 补」分支。createdAt 提供则在补 createdAt。
    const b1 = {
      id: 'b1', title: 'T', url: 'https://x.com', icon: '', categoryId: CAT_UNCATEGORIZED,
      parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 5555
    } as unknown as Bookmark
    const d1 = {
      _dataVersion: 1, categories: DEFAULTS.categories.slice(),
      bookmarks: [b1], customAttributes: [], siblingGroups: []
    } as Partial<AppData>
    const r1 = freshResult(d1)
    runMigrations(d1, r1)
    expect(r1.bookmarks[0].updatedAt).toBe(5555)

    // 无 createdAt 时补 Date.now()
    const b2 = {
      id: 'b2', title: 'T', url: 'https://x.com', icon: '', categoryId: CAT_UNCATEGORIZED,
      parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false
      // createdAt / updatedAt 均 undefined（字段真缺失）
    } as unknown as Bookmark
    const d2 = { ...d1, bookmarks: [b2] } as Partial<AppData>
    const r2 = freshResult(d2)
    const before = Date.now()
    runMigrations(d2, r2)
    const after = Date.now()
    expect(r2.bookmarks[0].updatedAt).toBeGreaterThanOrEqual(before)
    expect(r2.bookmarks[0].updatedAt).toBeLessThanOrEqual(after)
  })

  it('步骤6：group.notes 含 2+ 连续零宽字符 → cleanZeroWidth 压缩成单个零宽', () => {
    // cleanZeroWidth 仅压缩「≥2 连续」零宽字符成单个（utils.ts: ​{2,} → ​），单个零宽保留。
    // notes 含 HTML <p> → 步骤4 跳过文本→HTML 迁移（不被改动后再 cleanZeroWidth）。
    const twoZwch = '​​'
    const g = group({ id: 'g1', notes: `<p>has${twoZwch}zwch</p>` })
    const d = {
      _dataVersion: 1,
      categories: DEFAULTS.categories.slice(),
      bookmarks: [],
      customAttributes: [],
      siblingGroups: [g]
    } as Partial<AppData>
    const result = freshResult(d)
    runMigrations(d, result)
    // 2 个连续零宽压缩成 1 个
    expect(result.siblingGroups[0].notes).toBe('<p>has​zwch</p>')
    // 仍含单个零宽（未彻底删除，锁定「压缩而非清除」真实行为）
    expect(result.siblingGroups[0].notes).toContain('​')
    // 不再含连续 2 个零宽
    expect(result.siblingGroups[0].notes).not.toContain(twoZwch)
  })

  it('末尾恒钉 result._schemaVersion = CURRENT_SCHEMA_VERSION（旧盘迁移后落版本字段）', () => {
    const d = { _dataVersion: 1 } as Partial<AppData>
    const result = freshResult(d)
    runMigrations(d, result)
    expect((result as { _schemaVersion?: number })._schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('旧盘分支恒返回 needsPersist = true（含上述清理触发）', () => {
    const d = { _dataVersion: 1 } as Partial<AppData>
    const result = freshResult(d)
    expect(runMigrations(d, result)).toBe(true)
  })
})
