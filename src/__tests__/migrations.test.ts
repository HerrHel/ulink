import { describe, it, expect } from 'vitest'
import { runMigrations } from '../stores/migrations.js'

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

  it('should return false when no migration needed', () => {
    const d = {}
    const result = makeResult({
      bookmarks: [{ id: 'b1', categoryId: 'tools', attributes: {}, updatedAt: Date.now() }],
      siblingGroups: [{
        id: 'g1', categoryId: 'uncategorized', bookmarkIds: [],
        attributes: { 'is-group': true }, updatedAt: Date.now(), useCount: 0
      }],
    })
    const needsPersist = runMigrations(d, result)
    expect(needsPersist).toBe(false)
  })
})
