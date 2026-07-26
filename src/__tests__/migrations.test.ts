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
})
