import { describe, it, expect, vi, beforeEach } from 'vitest'
import { _mergeBookmarks, _mergeGroups } from '../composables/domain/useDataIO.js'
import { parseRaindropJSON } from '../lib/importParse.js'
import { getSmartPrefill } from '../lib/ai/smartPrefill.js'
import { enrichBookmarkMetadata } from '../lib/ai/bookmarkEnrich.js'
import { addNewCategory } from '../utils.js'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { setActivePinia, createPinia } from 'pinia'
import * as toastMod from '../lib/toast.js'

describe('Audit Fixes Batch 9', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  describe('useDataIO: group remapping and child parentId reconciliation', () => {
    it('_mergeGroups re-maps bookmarkIds using idMap so deduplicated bookmarks retain group membership', () => {
      const ds = useDataStore()
      // Local bookmark with ID 'local-1'
      ds.bookmarks = [
        {
          id: 'local-1',
          title: 'Google',
          url: 'https://google.com',
          categoryId: 'cat-1',
          parentId: null,
          order: 0,
          useCount: 0,
          attributes: {},
        } as any,
      ]
      ds._syncMaps()

      // Imported bookmark had id 'imp-1' which deduplicated to 'local-1'
      const idMap = new Map<string, string>()
      idMap.set('imp-1', 'local-1')

      // Imported group contains 'imp-1' and non-existent 'imp-missing'
      const groupsToMerge = [
        {
          id: 'grp-import',
          name: 'Imported Group',
          categoryId: 'cat-1',
          bookmarkIds: ['imp-1', 'imp-missing'],
        } as any,
      ]

      const stats = _mergeGroups(ds, groupsToMerge, idMap)
      expect(stats.imported).toBe(1)
      const merged = ds.siblingGroups.find(g => g.id === 'grp-import')
      expect(merged).toBeDefined()
      // 'imp-1' mapped to 'local-1'; 'imp-missing' filtered out
      expect(merged!.bookmarkIds).toEqual(['local-1'])
    })

    it('_mergeBookmarks updates child parentId if parent was remapped during deduplication', () => {
      const ds = useDataStore()
      // Local parent bookmark
      ds.bookmarks = [
        {
          id: 'local-parent',
          title: 'Parent',
          url: 'https://parent.com',
          categoryId: 'cat-1',
          parentId: null,
          order: 0,
          useCount: 0,
          attributes: {},
        } as any,
      ]
      ds._syncMaps()

      const idMap = new Map<string, string>()
      // Import child first, then import parent that dedups to local-parent
      const incomingBookmarks = [
        {
          id: 'imp-child',
          title: 'Child',
          url: 'https://child.com',
          categoryId: 'cat-1',
          parentId: 'imp-parent', // references incoming parent ID
          order: 1,
        } as any,
        {
          id: 'imp-parent',
          title: 'Parent',
          url: 'https://parent.com', // same URL as local-parent -> deduped!
          categoryId: 'cat-1',
          parentId: null,
          order: 0,
        } as any,
      ]

      _mergeBookmarks(ds, incomingBookmarks, idMap)

      expect(idMap.get('imp-parent')).toBe('local-parent')
      const mergedChild = ds.bookmarks.find(b => b.id === 'imp-child')
      expect(mergedChild).toBeDefined()
      // ParentId was reconciled to local-parent
      expect(mergedChild!.parentId).toBe('local-parent')
    })
  })

  describe('importParse: invalid date strings in Raindrop JSON', () => {
    it('falls back to now instead of NaN for invalid created / lastUpdate dates', () => {
      const raindropData = [
        {
          title: 'Test',
          link: 'https://example.com',
          created: 'not-a-valid-date-string',
          lastUpdate: 'invalid-date',
          tags: ['tech'],
        },
      ]

      const before = Date.now()
      const parsed = parseRaindropJSON(raindropData)
      const after = Date.now()

      expect(parsed).toHaveLength(1)
      expect(Number.isFinite(parsed[0].createdAt)).toBe(true)
      expect(Number.isFinite(parsed[0].updatedAt)).toBe(true)
      expect(parsed[0].createdAt).toBeGreaterThanOrEqual(before)
      expect(parsed[0].createdAt).toBeLessThanOrEqual(after)
    })
  })

  describe('smartPrefill: does not harvest ciphertexts', () => {
    it('skips E2E encrypted usernames when building auto-fill frequency candidates', () => {
      const mockCiphertext = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
      const bookmarks = [
        {
          id: 'b1',
          title: 'Site 1',
          url: 'https://example.com/login',
          categoryId: 'cat-1',
          username: mockCiphertext,
        } as any,
        {
          id: 'b2',
          title: 'Site 2',
          url: 'https://example.com/admin',
          categoryId: 'cat-1',
          username: 'valid_user',
        } as any,
      ]

      const categories = [{ id: 'cat-1', name: 'Work' } as any]
      const prefill = getSmartPrefill('https://example.com/dashboard', bookmarks, categories, [])

      expect(prefill.candidateUsernames).toContain('valid_user')
      expect(prefill.candidateUsernames).not.toContain(mockCiphertext)
    })
  })

  describe('bookmarkEnrich: strips ciphertexts with displayText', () => {
    it('masks encrypted title and notes before returning enrich diff', async () => {
      const mockCiphertext = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
      const bm = {
        id: 'bm-enc',
        title: mockCiphertext,
        notes: mockCiphertext,
        url: 'https://private.local', // triggers early return via isPrivateUrl
        categoryId: 'cat-1',
      } as any

      const diff = await enrichBookmarkMetadata(bm, [], [])
      expect(diff.currentTitle).toBe('')
      expect(diff.currentNotes).toBe('')
    })
  })

  describe('Group deletion closes group edit modal and saveGroupEdit fallback', () => {
    it('deleteGroup closes group edit modal if the group being deleted is currently being edited', () => {
      const ds = useDataStore()
      const ui = useUIStore()

      ds.siblingGroups = [
        { id: 'g1', name: 'Group 1', categoryId: 'cat-1', bookmarkIds: [], attributes: {} } as any,
      ]
      ds._syncMaps()

      ui.editingGeId = 'g1'
      ui.modals.groupEdit = true

      ds.deleteGroup('g1')

      expect(ui.editingGeId).toBeNull()
      expect(ui.modals.groupEdit).toBe(false)
    })
  })

  describe('dataActionsCore: emptyTrash search invalidation', () => {
    it('sets _searchIndexDirty and bumps _searchVersion on emptyTrash', () => {
      const ds = useDataStore()
      ds.bookmarks = [
        { id: 'b-del', title: 'Deleted', url: 'https://del.com', deletedAt: Date.now() } as any,
      ]
      ds._syncMaps()
      ds._searchIndexDirty = false
      const vBefore = ds._searchVersion

      ds.emptyTrash()

      expect(ds._searchIndexDirty).toBe(true)
      expect(ds._searchVersion).toBeGreaterThan(vBefore)
    })
  })

  describe('dataActionsCategories & dataActionsAttributes search version debounce', () => {
    it('addCategory and renameCategory bump search version', async () => {
      const ds = useDataStore()
      const v0 = ds._searchVersion

      ds.addCategory({ id: 'c-new', name: 'New Cat', icon: '', color: '', order: 0 })
      expect(ds._searchIndexDirty).toBe(true)

      // Wait for debounced bump
      await new Promise(r => setTimeout(r, 60))
      expect(ds._searchVersion).toBeGreaterThan(v0)

      const v1 = ds._searchVersion
      ds.renameCategory('c-new', 'Renamed Cat')
      await new Promise(r => setTimeout(r, 60))
      expect(ds._searchVersion).toBeGreaterThan(v1)
    })

    it('addAttribute, renameAttribute, deleteAttribute, restoreAttribute bump search version', async () => {
      const ds = useDataStore()
      const v0 = ds._searchVersion

      ds.addAttribute({ id: 'attr-1', name: 'Attr 1', type: 'boolean' })
      expect(ds._searchIndexDirty).toBe(true)
      await new Promise(r => setTimeout(r, 60))
      expect(ds._searchVersion).toBeGreaterThan(v0)

      const v1 = ds._searchVersion
      ds.renameAttribute('attr-1', 'Renamed Attr')
      await new Promise(r => setTimeout(r, 60))
      expect(ds._searchVersion).toBeGreaterThan(v1)

      const v2 = ds._searchVersion
      ds.deleteAttribute('attr-1')
      await new Promise(r => setTimeout(r, 60))
      expect(ds._searchVersion).toBeGreaterThan(v2)

      const v3 = ds._searchVersion
      ds.restoreAttribute('attr-1')
      await new Promise(r => setTimeout(r, 60))
      expect(ds._searchVersion).toBeGreaterThan(v3)
    })
  })

  describe('utils: addNewCategory rejects reserved category names', () => {
    it('rejects "all", "全部", "uncategorized", "未分类" case-insensitively', () => {
      const toastSpy = vi.spyOn(toastMod, 'toast').mockImplementation(() => {})
      const storeMock: any = {
        categories: [],
        addCategory: vi.fn(),
        save: vi.fn(),
      }

      expect(addNewCategory('all', storeMock)).toBeNull()
      expect(addNewCategory('ALL', storeMock)).toBeNull()
      expect(addNewCategory('全部', storeMock)).toBeNull()
      expect(addNewCategory('uncategorized', storeMock)).toBeNull()
      expect(addNewCategory('Uncategorized', storeMock)).toBeNull()
      expect(addNewCategory('未分类', storeMock)).toBeNull()

      expect(storeMock.addCategory).not.toHaveBeenCalled()
      expect(toastSpy).toHaveBeenCalled()
    })
  })
})
