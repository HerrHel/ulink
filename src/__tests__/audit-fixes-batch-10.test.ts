import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { setActivePinia, createPinia } from 'pinia'
import { executeManageCategories, executeManageTags } from '../lib/ai/universalAgent.js'
import { createTopicWorkspace } from '../lib/ai/siteActions.js'
import { diffVersions } from '../lib/diffVersions.js'
import { CAT_UNCATEGORIZED, ATTR_IS_GROUP } from '../config/constants.js'
import * as toastMod from '../lib/toast.js'

describe('Audit Fixes Batch 10', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    vi.spyOn(toastMod, 'toast').mockImplementation(() => {})
  })

  describe('CRUD idempotency: duplicate ID prevention across stores', () => {
    it('addBookmark updates in-place when duplicate id is passed', () => {
      const ds = useDataStore()
      ds.bookmarks = [
        { id: 'b1', title: 'Old Title', url: 'https://example.com', categoryId: 'c1', parentId: null, order: 0, useCount: 0, attributes: {} } as any,
      ]
      ds._syncMaps()

      ds.addBookmark({
        id: 'b1',
        title: 'New Title',
        url: 'https://example.com/updated',
        categoryId: 'c1',
        parentId: null,
        order: 0,
        useCount: 0,
        attributes: {},
      } as any)

      expect(ds.bookmarks).toHaveLength(1)
      expect(ds.bookmarks[0].title).toBe('New Title')
      expect(ds.bookmarkMap['b1'].url).toBe('https://example.com/updated')
    })

    it('addGroup updates in-place when duplicate id is passed', () => {
      const ds = useDataStore()
      ds.siblingGroups = [
        { id: 'g1', name: 'Old Group', categoryId: 'c1', bookmarkIds: [], attributes: {} } as any,
      ]
      ds._syncMaps()

      ds.addGroup({
        id: 'g1',
        name: 'Updated Group',
        categoryId: 'c1',
        bookmarkIds: ['b1'],
        attributes: {},
      } as any)

      expect(ds.siblingGroups).toHaveLength(1)
      expect(ds.siblingGroups[0].name).toBe('Updated Group')
      expect(ds.groupMap['g1'].bookmarkIds).toEqual(['b1'])
    })

    it('addCategory updates in-place when duplicate id is passed', () => {
      const ds = useDataStore()
      ds.categories = [
        { id: 'c1', name: 'Old Cat', icon: '', color: '', order: 0 } as any,
      ]
      ds._syncMaps()

      ds.addCategory({
        id: 'c1',
        name: 'New Cat',
        icon: 'folder',
        color: '#ff0000',
        order: 1,
      } as any)

      expect(ds.categories).toHaveLength(1)
      expect(ds.categories[0].name).toBe('New Cat')
      expect(ds.categoryMap['c1'].color).toBe('#ff0000')
    })

    it('addAttribute updates in-place when duplicate id is passed', () => {
      const ds = useDataStore()
      ds.customAttributes = [
        { id: 'a1', name: 'Old Attr', type: 'boolean' } as any,
      ]
      ds._syncMaps()

      ds.addAttribute({
        id: 'a1',
        name: 'Updated Attr',
        type: 'boolean',
      } as any)

      expect(ds.customAttributes).toHaveLength(1)
      expect(ds.customAttributes[0].name).toBe('Updated Attr')
      expect(ds.attributeMap['a1'].name).toBe('Updated Attr')
    })
  })

  describe('universalAgent: category and tag safety guards', () => {
    it('executeManageCategories rejects creating reserved category names', async () => {
      const ds = useDataStore()
      const res = await executeManageCategories({ action: 'create', name: '全部' }, { ds } as any)
      expect(res.success).toBe(false)
      expect(res.message).toContain('系统保留名称')
    })

    it('executeManageCategories rejects renaming system categories or renaming to reserved names', async () => {
      const ds = useDataStore()
      ds.categories = [
        { id: 'all', name: '全部', icon: '', color: '', order: 0 } as any,
        { id: CAT_UNCATEGORIZED, name: '未分类', icon: '', color: '', order: 1 } as any,
        { id: 'c1', name: 'Work', icon: '', color: '', order: 2 } as any,
      ]
      ds._syncMaps()

      // Cannot rename 'all'
      const res1 = await executeManageCategories({ action: 'rename', categoryId: 'all', newName: 'Everything' }, { ds } as any)
      expect(res1.success).toBe(false)
      expect(res1.message).toContain('系统内置分类受保护')

      // Cannot rename to '未分类'
      const res2 = await executeManageCategories({ action: 'rename', categoryId: 'c1', newName: '未分类' }, { ds } as any)
      expect(res2.success).toBe(false)
      expect(res2.message).toContain('系统保留名称')
    })

    it('executeManageTags rejects renaming or deleting ATTR_IS_GROUP', async () => {
      const ds = useDataStore()
      ds.customAttributes = [
        { id: ATTR_IS_GROUP, name: '笔记', type: 'boolean' } as any,
      ]
      ds._syncMaps()

      const resDel = await executeManageTags({ action: 'delete', tagId: ATTR_IS_GROUP }, { ds } as any)
      expect(resDel.success).toBe(false)
      expect(resDel.message).toContain('受保护')

      const resRen = await executeManageTags({ action: 'rename', tagId: ATTR_IS_GROUP, newName: '自定义' }, { ds } as any)
      expect(resRen.success).toBe(false)
      expect(resRen.message).toContain('受保护')
    })
  })

  describe('siteActions: createTopicWorkspace deduplication', () => {
    it('avoids adding duplicate bookmark when candidate URL differs only by trailing slash', async () => {
      const ds = useDataStore()
      ds.bookmarks = [
        {
          id: 'b-gh',
          title: 'GitHub',
          url: 'https://github.com',
          categoryId: 'c1',
          parentId: null,
          order: 0,
          useCount: 0,
          attributes: {},
        } as any,
      ]
      ds._syncMaps()

      const candidates = [
        {
          title: 'GitHub Portal',
          url: 'https://github.com/', // Trailing slash difference
          notes: 'Code host',
        },
      ]

      const res = await createTopicWorkspace('Dev Tools', candidates, 'c1', { ds } as any)
      expect(res.success).toBe(true)
      // Existing bookmark is reused, not duplicated
      expect(res.createdBmIds).toHaveLength(0)
      expect(res.group?.bookmarkIds).toEqual(['b-gh'])
    })
  })

  describe('diffVersions: mask ciphertexts', () => {
    it('replaces 3-part cipher string with placeholder in history diff', () => {
      const validCipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
      const oldObj = { title: 'Old Title', notes: 'Old Notes' }
      const newObj = { title: validCipher, notes: 'New Notes' }

      const diffs = diffVersions(oldObj, newObj)
      const titleDiff = diffs.find(d => d.key === 'title')
      expect(titleDiff).toBeDefined()
      expect(titleDiff?.newValue).toBe('（加密数据）')
      expect(titleDiff?.newValue).not.toContain(validCipher)
    })
  })

  describe('switchSpace: transient UI states reset', () => {
    it('resets open modals and panels on switchSpace', async () => {
      const ds = useDataStore()
      const ui = useUIStore()

      // Mock storage
      vi.spyOn(ds, 'getSpaceSnapshot').mockResolvedValue(null)
      ds.categories = [
        { id: 'all', name: '全部', icon: '', color: '', order: 0 } as any,
        { id: CAT_UNCATEGORIZED, name: '未分类', icon: '', color: '', order: 1 } as any,
      ]
      ds._syncMaps()

      ui.curSpace = 'main'
      ui.modals.bookmark = true
      ui.modals.groupEdit = true
      ui.panels.detail = true
      ui.panels.history = true
      ui.panels.trash = true

      await ds.switchSpace('vault')

      expect(ui.modals.bookmark).toBe(false)
      expect(ui.modals.groupEdit).toBe(false)
      expect(ui.panels.detail).toBe(false)
      expect(ui.panels.history).toBe(false)
      expect(ui.panels.trash).toBe(false)
    })
  })
})
