import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'

describe('DataStore', () => {
  let store: ReturnType<typeof useDataStore>
  let uiStore: ReturnType<typeof useUIStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDataStore()
    uiStore = useUIStore()
  })

  describe('CRUD 操作', () => {
    it('addBookmark - 应该添加书签到列表', () => {
      const bm = { id: 'b1', title: 'Test', url: 'https://example.com' } as any
      store.addBookmark(bm)
      expect(store.bookmarks).toHaveLength(1)
      expect(store.bookmarks[0]).toStrictEqual(bm)
    })

    it('updateBookmark - 应该更新书签属性', () => {
      store.bookmarks = [{ id: 'b1', title: 'Old', url: 'https://example.com' }] as any
      store.updateBookmark('b1', { title: 'New' })
      expect(store.bookmarkMap['b1'].title).toBe('New')
    })

    it('updateBookmark - 不存在的 ID 应该静默失败', () => {
      store.updateBookmark('nonexistent', { title: 'New' })
      expect(store.bookmarks).toHaveLength(0)
    })

    it('deleteBookmark - 应该软删除书签', () => {
      store.bookmarks = [{ id: 'b1' }, { id: 'b2' }] as any
      store.deleteBookmark('b1')
      expect(store.bookmarks).toHaveLength(2)
      expect(store.bookmarks[0].deletedAt).toBeDefined()
      expect(store.bookmarks[1].deletedAt).toBeUndefined()
    })

    it('deleteBookmark - 应该从组中移除书签引用', () => {
      store.bookmarks = [{ id: 'b1' }] as any
      store.siblingGroups = [{ id: 'g1', bookmarkIds: ['b1', 'b2'] }] as any
      store.deleteBookmark('b1')
      expect(store.siblingGroups[0].bookmarkIds).toEqual(['b2'])
    })
  })

  describe('分组操作', () => {
    it('addGroup - 应该添加分组', () => {
      const group = { id: 'g1', name: 'Test Group', bookmarkIds: [] } as any
      store.addGroup(group)
      expect(store.siblingGroups).toHaveLength(1)
    })

    it('updateGroup - 应该更新分组属性', () => {
      store.siblingGroups = [{ id: 'g1', name: 'Old' }] as any
      store.updateGroup('g1', { name: 'New' })
      expect(store.groupMap['g1'].name).toBe('New')
    })

    it('deleteGroup - 应该软删除分组', () => {
      store.siblingGroups = [{ id: 'g1' }, { id: 'g2' }] as any
      store.deleteGroup('g1')
      expect(store.siblingGroups).toHaveLength(2)
      expect(store.siblingGroups[0].deletedAt).toBeDefined()
      expect(store.siblingGroups[1].deletedAt).toBeUndefined()
    })
  })

  describe('分类操作', () => {
    it('addCategory - 应该添加分类', () => {
      const cat = { id: 'cat1', name: 'Test', icon: '🔗', color: '' }
      store.addCategory(cat)
      expect(store.categories).toHaveLength(1)
    })

    it('renameCategory - 应该重命名分类', () => {
      store.categories = [{ id: 'cat1', name: 'Old', icon: '', color: '' }]
      store.renameCategory('cat1', 'New')
      expect(store.categories[0].name).toBe('New')
    })

    it('deleteCategory - 应该将关联书签移至未分类并软删除分类', () => {
      store.bookmarks = [{ id: 'b1', categoryId: 'cat1' }] as any
      store.siblingGroups = [{ id: 'g1', categoryId: 'cat1' }] as any
      store.categories = [{ id: 'cat1', name: 'Test', icon: '', color: '' }]
      
      store.deleteCategory('cat1')
      
      expect(store.bookmarks[0].categoryId).toBe('uncategorized')
      expect(store.siblingGroups[0].categoryId).toBe('uncategorized')
      expect(store.categories[0].deletedAt).toBeDefined()
    })
  })

  describe('属性操作', () => {
    it('addAttribute - 应该添加属性', () => {
      store.addAttribute({ id: 'attr1', name: 'Important', type: 'boolean' })
      expect(store.customAttributes).toHaveLength(1)
    })

    it('renameAttribute - 应该重命名属性', () => {
      store.customAttributes = [{ id: 'attr1', name: 'Old', type: 'boolean' }]
      store.renameAttribute('attr1', 'New')
      expect(store.customAttributes[0].name).toBe('New')
    })

    it('deleteAttribute - 应该从所有书签中删除属性并软删除', () => {
      store.customAttributes = [{ id: 'attr1', name: 'Important', type: 'boolean' }]
      store.bookmarks = [
        { id: 'b1', attributes: { attr1: true } },
        { id: 'b2', attributes: { attr1: true, attr2: true } },
      ] as any
      store.siblingGroups = []
      
      store.deleteAttribute('attr1')
      
      expect(store.bookmarks[0].attributes.attr1).toBeUndefined()
      expect(store.bookmarks[1].attributes.attr1).toBeUndefined()
      expect(store.bookmarks[1].attributes.attr2).toBe(true)
      expect(store.customAttributes[0].deletedAt).toBeDefined()
    })
  })

  describe('Getters', () => {
    it('bookmarkMap - 应该创建 ID 到书签的映射', () => {
      store.bookmarks = [
        { id: 'b1', title: 'First' },
        { id: 'b2', title: 'Second' },
      ] as any
      expect(store.bookmarkMap['b1'].title).toBe('First')
      expect(store.bookmarkMap['b2'].title).toBe('Second')
    })

    it('groupMap - 应该创建 ID 到分组的映射', () => {
      store.siblingGroups = [
        { id: 'g1', name: 'Group 1' },
        { id: 'g2', name: 'Group 2' },
      ] as any
      expect(store.groupMap['g1'].name).toBe('Group 1')
    })

    it('childrenMap - 应该创建父子关系映射', () => {
      store.bookmarks = [
        { id: 'parent', parentId: null },
        { id: 'child1', parentId: 'parent' },
        { id: 'child2', parentId: 'parent' },
        { id: 'orphan', parentId: null },
      ] as any
      expect(store.childrenMap['parent']).toHaveLength(2)
      expect(store.childrenMap['orphan']).toBeUndefined()
    })

    it('cardCounts - 应该正确计数', () => {
      store.bookmarks = [
        { id: '1', categoryId: 'tools', parentId: null },
        { id: '2', categoryId: 'tools', parentId: null },
        { id: '3', categoryId: 'email', parentId: null },
        { id: '4', categoryId: 'tools', parentId: '1' },
      ] as any
      store.siblingGroups = [{ id: 'g1', categoryId: 'ai' }] as any
      const counts = store.cardCounts
      expect(counts['tools']).toBe(2)
      expect(counts['email']).toBe(1)
      expect(counts['ai']).toBe(1)
      expect(counts['all']).toBe(4)
    })
  })

  describe('filteredBookmarks', () => {
    it('应该返回空数组当没有书签', () => {
      expect(store.filteredBookmarks).toEqual([])
    })

    it('应该按分类过滤', () => {
      store.bookmarks = [
        { id: '1', title: 'Test', url: 'https://test.com', categoryId: 'cat1', notes: '', username: '', attributes: {}, order: 0 },
        { id: '2', title: 'Test2', url: 'https://test2.com', categoryId: 'cat2', notes: '', username: '', attributes: {}, order: 1 }
      ] as any
      uiStore.curCat = 'cat1'
      expect(store.filteredBookmarks).toHaveLength(1)
      expect(store.filteredBookmarks[0].id).toBe('1')
    })

    it('应该按搜索词过滤', () => {
      store.bookmarks = [
        { id: '1', title: 'GitHub', url: 'https://github.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 0 },
        { id: '2', title: 'Google', url: 'https://google.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 1 },
      ] as any
      uiStore.searchQuery = 'git'
      expect(store.filteredBookmarks).toHaveLength(1)
      expect(store.filteredBookmarks[0].title).toBe('GitHub')
    })

    it('应该按标题排序', () => {
      store.bookmarks = [
        { id: '1', title: 'Banana', url: 'https://b.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 0 },
        { id: '2', title: 'Apple', url: 'https://a.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 1 },
      ] as any
      uiStore.sortMode = 'title'
      uiStore.sortDir = 'asc'
      expect(store.filteredBookmarks.map(b => b.title)).toEqual(['Apple', 'Banana'])
    })

    it('应该按活跃属性过滤', () => {
      store.bookmarks = [
        { id: '1', title: 'A', url: 'https://a.com', categoryId: 'c', notes: '', username: '', attributes: { login: true }, order: 0 },
        { id: '2', title: 'B', url: 'https://b.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 1 },
      ] as any
      uiStore.activeAttrs = ['login']
      expect(store.filteredBookmarks).toHaveLength(1)
      expect(store.filteredBookmarks[0].id).toBe('1')
    })

    it('应该排除指定属性', () => {
      store.bookmarks = [
        { id: '1', title: 'A', url: 'https://a.com', categoryId: 'c', notes: '', username: '', attributes: { login: true }, order: 0 },
        { id: '2', title: 'B', url: 'https://b.com', categoryId: 'c', notes: '', username: '', attributes: {}, order: 1 },
      ] as any
      uiStore.excludedAttrs = ['login']
      expect(store.filteredBookmarks).toHaveLength(1)
      expect(store.filteredBookmarks[0].id).toBe('2')
    })
  })

  describe('filteredGroups', () => {
    it('应该按名称过滤组', () => {
      store.siblingGroups = [
        { id: 'g1', name: 'AI Tools', categoryId: 'c', bookmarkIds: [], attributes: {}, order: 0 },
        { id: 'g2', name: 'Social', categoryId: 'c', bookmarkIds: [], attributes: {}, order: 1 },
      ] as any
      uiStore.searchQuery = 'ai'
      expect(store.filteredGroups).toHaveLength(1)
      expect(store.filteredGroups[0].id).toBe('g1')
    })

    it('应该按包含的书签标题过滤组', () => {
      store.bookmarks = [{ id: 'b1', title: 'ChatGPT', url: 'https://chat.openai.com', categoryId: 'c', attributes: {} }] as any
      store.siblingGroups = [{ id: 'g1', name: 'Group', categoryId: 'c', bookmarkIds: ['b1'], attributes: {}, order: 0 }] as any
      uiStore.searchQuery = 'chatgpt'
      expect(store.filteredGroups).toHaveLength(1)
    })
  })

  describe('数据导入', () => {
    it('importFromData - 应该替换所有数据', () => {
      store.bookmarks = [{ id: 'old' }] as any
      const newData = {
        bookmarks: [{ id: 'new' }],
        siblingGroups: [{ id: 'g1' }],
        categories: [{ id: 'cat1' }],
        customAttributes: [{ id: 'attr1' }],
      }
      store.importFromData(newData as any)
      expect(store.bookmarks[0].id).toBe('new')
      expect(store.siblingGroups.some(g => g.id === 'g1')).toBe(true)
      expect(store.categories.some(c => c.id === 'cat1')).toBe(true)
      expect(store.customAttributes).toEqual([{ id: 'attr1' }])
    })
  })
})
