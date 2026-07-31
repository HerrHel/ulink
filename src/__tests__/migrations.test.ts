import { describe, it, expect } from 'vitest'
import { runMigrations, CURRENT_SCHEMA_VERSION } from '../stores/migrations.js'
import { DEFAULTS } from '../config/constants.js'

function makeResult(overrides: any = {}) {
  return {
    categories: overrides.categories || [{ id: 'all', name: '全部', icon: 'grid', color: '#122E8A' }],
    bookmarks: overrides.bookmarks || [],
    customAttributes: overrides.customAttributes || [],
    siblingGroups: overrides.siblingGroups || [],
  }
}

describe('runMigrations', () => {
  it('should add missing default categories', () => {
    const d = {}
    const result = makeResult()
    runMigrations(d, result)
    const ids = result.categories.map((c: any) => c.id)
    expect(ids).toContain('uncategorized')
    expect(ids).toContain('email')
    expect(ids).toContain('tools')
    expect(ids).toContain('ai')
  })

  it('should not duplicate existing default categories', () => {
    const d = {}
    const result = makeResult({
      categories: [
        { id: 'all', name: '全部', icon: 'grid', color: '#122E8A' },
        { id: 'tools', name: '工具', icon: 'tool', color: '#d97706' },
      ]
    })
    runMigrations(d, result)
    const toolsCats = result.categories.filter((c: any) => c.id === 'tools')
    expect(toolsCats).toHaveLength(1)
  })

  it('should migrate categoryId "all" to "uncategorized"', () => {
    const d = {}
    const result = makeResult({
      bookmarks: [{ id: 'b1', categoryId: 'all', attributes: {} }],
      siblingGroups: [{ id: 'g1', categoryId: 'all', bookmarkIds: [], attributes: {} }],
    })
    runMigrations(d, result)
    expect(result.bookmarks[0].categoryId).toBe('uncategorized')
    expect(result.siblingGroups[0].categoryId).toBe('uncategorized')
  })

  it('should deduplicate attributes with same name', () => {
    const d = {
      bookmarks: [
        { id: 'b1', attributes: { 'attr-dup': true } },
      ],
      customAttributes: [
        { id: 'attr-orig', name: 'test-attr', type: 'boolean' },
        { id: 'attr-dup', name: 'test-attr', type: 'boolean' },
      ]
    }
    const result = makeResult({
      bookmarks: d.bookmarks,
      customAttributes: [...d.customAttributes],
    } as any)
    const needsPersist = runMigrations(d as any, result as any)
    expect(result.customAttributes).toHaveLength(1)
    expect(result.customAttributes[0].id).toBe('attr-orig')
    // Bookmark attribute should be migrated to the kept attribute
    expect((d.bookmarks[0].attributes as any)['attr-orig']).toBe(true)
    expect((d.bookmarks[0].attributes as any)['attr-dup']).toBeUndefined()
    expect(needsPersist).toBe(true)
  })

  it('审计 R6：组级同名 attr id 也应重写（旧盘 group 引旧 id，dedup 后不丢失标签）', () => {
    const d = {
      bookmarks: [],
      siblingGroups: [
        { id: 'g1', categoryId: 'uncategorized', bookmarkIds: [], attributes: { 'attr-dup': true, 'is-group': true } },
      ],
      customAttributes: [
        { id: 'attr-orig', name: 'test-attr', type: 'boolean' },
        { id: 'attr-dup', name: 'test-attr', type: 'boolean' },
      ]
    }
    const result = makeResult({
      siblingGroups: d.siblingGroups,
      customAttributes: [...d.customAttributes],
    } as any)
    const needsPersist = runMigrations(d as any, result as any)
    expect(result.customAttributes).toHaveLength(1)
    expect(result.customAttributes[0].id).toBe('attr-orig')
    // 组的 attribute 旧 id 'attr-dup' 应回退到保留项 'attr-orig'，旧 id 失联
    const g = d.siblingGroups[0]
    expect((g.attributes as any)['attr-orig']).toBe(true)
    expect((g.attributes as any)['attr-dup']).toBeUndefined()
    // 'is-group' 不应被误删（与去重无关）
    expect((g.attributes as any)['is-group']).toBe(true)
    expect(needsPersist).toBe(true)
  })

  it('should add missing attributes to groups', () => {
    const d = {}
    const result = makeResult({
      siblingGroups: [{ id: 'g1', categoryId: 'uncategorized', bookmarkIds: [] }],
    })
    runMigrations(d, result)
    expect(result.siblingGroups[0].attributes).toEqual({ 'is-group': true })
  })

  it('should add missing updatedAt and useCount to groups', () => {
    const d = {}
    const result = makeResult({
      siblingGroups: [{ id: 'g1', categoryId: 'uncategorized', bookmarkIds: [], attributes: {} }],
    })
    runMigrations(d, result)
    expect(result.siblingGroups[0].updatedAt).toBeDefined()
    expect(result.siblingGroups[0].useCount).toBe(0)
  })

  it('should migrate text notes to HTML with inline cards', () => {
    const bm = { id: 'b1', title: 'GitHub', url: 'https://github.com', icon: '' }
    const d = {}
    const result = makeResult({
      bookmarks: [bm],
      siblingGroups: [{
        id: 'g1', categoryId: 'uncategorized', bookmarkIds: [],
        attributes: {}, notes: 'Check [GitHub](b1) for code'
      }],
    })
    runMigrations(d, result)
    expect(result.siblingGroups[0].notes).toContain('group-inline-card')
    expect(result.siblingGroups[0].notes).toContain('data-bm-id="b1"')
    expect(result.siblingGroups[0].bookmarkIds).toContain('b1')
  })

  it('should not migrate notes that already contain HTML', () => {
    const d = {}
    const result = makeResult({
      siblingGroups: [{
        id: 'g1', categoryId: 'uncategorized', bookmarkIds: [],
        attributes: {}, notes: '<p>Already HTML</p>'
      }],
    })
    runMigrations(d, result)
    expect(result.siblingGroups[0].notes).toBe('<p>Already HTML</p>')
  })

  it('schema 已是当前版本时跳过迁移', () => {
    const d = { _schemaVersion: 2 }
    const result = makeResult({
      bookmarks: [{ id: 'b1', categoryId: 'tools', attributes: {}, updatedAt: Date.now() }],
      siblingGroups: [{
        id: 'g1', categoryId: 'uncategorized', bookmarkIds: [],
        attributes: { 'is-group': true }, updatedAt: Date.now(), useCount: 0
      }],
    })
    const needsPersist = runMigrations(d as any, result)
    expect(needsPersist).toBe(false)
  })

  it('旧盘 _dataVersion 被 writeSeq 污染（> CURRENT）时仍跑迁移并落 _schemaVersion', () => {
    const d = { _dataVersion: 9999 }
    const result = makeResult({
      bookmarks: [{ id: 'b1', categoryId: 'tools', attributes: {}, updatedAt: Date.now() }],
      siblingGroups: [{
        id: 'g1', categoryId: 'uncategorized', bookmarkIds: [],
        attributes: { 'is-group': true }, updatedAt: Date.now(), useCount: 0
      }],
    })
    const needsPersist = runMigrations(d as any, result)
    expect(needsPersist).toBe(true)
    expect((result as any)._schemaVersion).toBe(2)
  })

  it('无版本字段时迁移后写入 _schemaVersion', () => {
    const d = {}
    const result = makeResult({
      bookmarks: [{ id: 'b1', categoryId: 'tools', attributes: {}, updatedAt: Date.now() }],
    })
    const needsPersist = runMigrations(d, result)
    expect(needsPersist).toBe(true)
    expect((result as any)._schemaVersion).toBe(2)
  })

  it('审计 R40：DEFAULTS._schemaVersion 与 CURRENT_SCHEMA_VERSION 不漂移（防新装实例误走迁移分支）', () => {
    // 两值独立硬编码（constants 不 import migrations 以避循环依赖），某次迁移把 CURRENT 提到 3
    // 而忘同步 DEFAULTS 时：新装首次 loadData 走 cloneDeep(DEFAULTS) 持久化 schemaVersion=2<3，
    // 下次加载重跑迁移补字段——虽靠幂等不丢数据但属易错设计。用断言固化两者相等，CI 即报漂移。
    expect(DEFAULTS._schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  describe('步骤5：lv_expandStates → isExpanded 迁移护栏', () => {
    it('旧盘 lv_expandStates 中命中的 bookmark/group id 迁移后 isExpanded=true', () => {
      // 模拟旧盘：localStorage 残留 lv_expandStates = { 'b1': true, 'g2': true, 'ghost': true }
      localStorage.setItem('lv_expandStates', JSON.stringify({ b1: true, g2: true, ghost: true }))
      const d = {}
      const result = makeResult({
        bookmarks: [
          { id: 'b1', categoryId: 'tools', attributes: {}, updatedAt: Date.now() },
          { id: 'b3', categoryId: 'tools', attributes: {}, updatedAt: Date.now() },
        ],
        siblingGroups: [
          { id: 'g2', categoryId: 'uncategorized', bookmarkIds: [], attributes: { 'is-group': true }, updatedAt: Date.now(), useCount: 0 },
          { id: 'g4', categoryId: 'uncategorized', bookmarkIds: [], attributes: { 'is-group': true }, updatedAt: Date.now(), useCount: 0 },
        ],
      })
      runMigrations(d, result)
      expect(result.bookmarks[0].isExpanded).toBe(true)
      expect(result.bookmarks[1].isExpanded).toBeUndefined()
      expect(result.siblingGroups[0].isExpanded).toBe(true)
      expect(result.siblingGroups[1].isExpanded).toBeUndefined()
    })

    it('迁移后 lv_expandStates 被 safeRemoveItem 清除（旧键不再残留在 localStorage）', () => {
      localStorage.setItem('lv_expandStates', JSON.stringify({ b1: true }))
      const d = {}
      const result = makeResult({
        bookmarks: [{ id: 'b1', categoryId: 'tools', attributes: {}, updatedAt: Date.now() }],
      })
      runMigrations(d, result)
      expect(localStorage.getItem('lv_expandStates')).toBeNull()
    })

    it('无 lv_expandStates 时步骤5走空对象分支，不误置任何 isExpanded', () => {
      // safeJsonParse 缺省返回 {}，forEach 不命中任何 id
      const d = {}
      const result = makeResult({
        bookmarks: [
          { id: 'b1', categoryId: 'tools', attributes: {}, updatedAt: Date.now() },
          { id: 'b2', categoryId: 'tools', attributes: {}, isExpanded: true, updatedAt: Date.now() } as any,
        ],
      })
      runMigrations(d, result)
      expect(result.bookmarks.find((b: any) => b.id === 'b1')!.isExpanded).toBeUndefined()
      expect(result.bookmarks.find((b: any) => b.id === 'b2')!.isExpanded).toBe(true) // 已展开项不被反向置回
      expect(localStorage.getItem('lv_expandStates')).toBeNull()
    })

    it('幂等：迁移后再次 runMigrations（from 已是 CURRENT）不再触发步骤5、不再调 removeItem', () => {
      // 首次迁移落 _schemaVersion，二次进入时 from>=CURRENT 直接 return，不读 lv_expandStates
      localStorage.setItem('lv_expandStates', JSON.stringify({ b1: true }))
      const d1 = {}
      const r1 = makeResult({
        bookmarks: [{ id: 'b1', categoryId: 'tools', attributes: {}, updatedAt: Date.now() }],
      })
      runMigrations(d1, r1)
      // 二次：模拟磁盘已被首次迁移写入 _schemaVersion=CURRENT，且 lv_expandStates 早已被首跑删掉
      // 这里手动还原一个 lv_expandStates 假装"未删"，验证 from>=CURRENT 分支不会再删它
      localStorage.setItem('lv_expandStates', JSON.stringify({ ghostkey: true }))
      const d2 = { _schemaVersion: 2 } as any
      const r2 = makeResult({
        bookmarks: [{ id: 'b2', categoryId: 'tools', attributes: {}, updatedAt: Date.now() }],
      })
      runMigrations(d2, r2)
      // from>=CURRENT 分支不跑步骤5，遗留键不会被删
      expect(localStorage.getItem('lv_expandStates')).toBe(JSON.stringify({ ghostkey: true }))
      // 且 b2 不因遗留键被置 isExpanded
      expect(r2.bookmarks.find((b: any) => b.id === 'b2')!.isExpanded).toBeUndefined()
    })
  })
})
