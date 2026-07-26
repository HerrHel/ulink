import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { preloadSearchLibs } from '../../lib/search.js'

beforeAll(async () => {
  await preloadSearchLibs()
})

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

    // M25：走真实 action 验证 dirty / newIds / searchVersion 副作用
    it('M25: addBookmark 标记 dirty/new 并 bump searchVersion', () => {
      store.addBookmark({ id: 'b-m25', title: 'M25', url: 'https://m25.example' } as any)
      expect(store._dirtyIds.has('b-m25')).toBe(true)
      expect(store._newIds.has('b-m25')).toBe(true)
      expect(store._searchIndexDirty).toBe(true)
      expect(store.bookmarkMap['b-m25'].title).toBe('M25')
    })

    it('updateBookmark - 应该更新书签属性', () => {
      store.addBookmark({ id: 'b1', title: 'Old', url: 'https://example.com' } as any)
      store.drainDirtyIds() // 清空 add 留下的 dirty，隔离 update 副作用
      store.updateBookmark('b1', { title: 'New' })
      expect(store.bookmarkMap['b1'].title).toBe('New')
      expect(store._dirtyIds.has('b1')).toBe(true)
      expect(store._searchIndexDirty).toBe(true)
    })

    it('updateBookmark - 不存在的 ID 应该静默失败', () => {
      store.updateBookmark('nonexistent', { title: 'New' })
      expect(store.bookmarks).toHaveLength(0)
    })

    it('deleteBookmark - 应该软删除书签', () => {
      store.addBookmark({ id: 'b1' } as any)
      store.addBookmark({ id: 'b2' } as any)
      store.deleteBookmark('b1')
      expect(store.bookmarks).toHaveLength(2)
      expect(store.bookmarks[0].deletedAt).toBeDefined()
      expect(store.bookmarks[1].deletedAt).toBeUndefined()
      expect(store._dirtyIds.has('b1')).toBe(true)
    })

    it('deleteBookmark - 应该从组中移除书签引用', () => {
      store.addBookmark({ id: 'b1' } as any)
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: ['b1', 'b2'] } as any)
      store.deleteBookmark('b1')
      expect(store.siblingGroups[0].bookmarkIds).toEqual(['b2'])
    })

    it('batchPatchBookmarkAttributes - 批量写 attributes 并 dirty，末尾一次 bump', () => {
      store.addBookmark({ id: 'b1', title: 'A', url: 'https://a.com', attributes: { tag: true } } as any)
      store.addBookmark({ id: 'b2', title: 'B', url: 'https://b.com', attributes: {} } as any)
      store.drainDirtyIds()
      store.batchPatchBookmarkAttributes({
        b1: { tag: true, 'dead-link': true },
        b2: { 'gfw-blocked': true },
      })
      expect(store.bookmarkMap['b1'].attributes['dead-link']).toBe(true)
      expect(store.bookmarkMap['b1'].attributes['tag']).toBe(true)
      expect(store.bookmarkMap['b2'].attributes['gfw-blocked']).toBe(true)
      expect(store._dirtyIds.has('b1')).toBe(true)
      expect(store._dirtyIds.has('b2')).toBe(true)
      expect(store._searchIndexDirty).toBe(true)
    })

    it('attributeByName - 仅索引未软删属性，重命名后按新名可查', () => {
      store.addAttribute({ id: 'a1', name: '标签甲', type: 'boolean' } as any)
      store.addAttribute({ id: 'a2', name: '标签乙', type: 'boolean' } as any)
      expect(store.attributeByName['标签甲']?.id).toBe('a1')
      expect(store.attributeByName['标签乙']?.id).toBe('a2')
      store.deleteAttribute('a1')
      expect(store.attributeByName['标签甲']).toBeUndefined()
      expect(store.attributeMap['a1']?.deletedAt).toBeDefined()
      store.renameAttribute('a2', '标签丙')
      expect(store.attributeByName['标签乙']).toBeUndefined()
      expect(store.attributeByName['标签丙']?.id).toBe('a2')
    })

    it('updateBookmark 经 map 定位后仍可正确更新', () => {
      store.addBookmark({ id: 'b-map', title: 'X', url: 'https://x.com' } as any)
      store.drainDirtyIds()
      store.updateBookmark('b-map', { title: 'Y' })
      expect(store.bookmarks[0].title).toBe('Y')
      expect(store.bookmarkMap['b-map'].title).toBe('Y')
      expect(store.bookmarks[0]).toBe(store.bookmarkMap['b-map'])
    })
  })

  describe('分组操作', () => {
    it('addGroup - 应该添加分组', () => {
      const group = { id: 'g1', name: 'Test Group', bookmarkIds: [] } as any
      store.addGroup(group)
      expect(store.siblingGroups).toHaveLength(1)
      expect(store._dirtyIds.has('g1')).toBe(true)
      expect(store._newIds.has('g1')).toBe(true)
    })

    it('updateGroup - 应该更新分组属性', () => {
      store.addGroup({ id: 'g1', name: 'Old', bookmarkIds: [] } as any)
      store.drainDirtyIds()
      store.updateGroup('g1', { name: 'New' })
      expect(store.groupMap['g1'].name).toBe('New')
      expect(store._dirtyIds.has('g1')).toBe(true)
      expect(store._searchIndexDirty).toBe(true)
    })

    it('deleteGroup - 应该软删除分组', () => {
      store.addGroup({ id: 'g1' } as any)
      store.addGroup({ id: 'g2' } as any)
      store.deleteGroup('g1')
      expect(store.siblingGroups).toHaveLength(2)
      expect(store.siblingGroups[0].deletedAt).toBeDefined()
      expect(store.siblingGroups[1].deletedAt).toBeUndefined()
    })
  })

  describe('分类操作', () => {
    it('addCategory - 应该添加分类', () => {
      const cat = { id: 'cat1', name: 'Test', icon: '🔗', color: '', order: 0 }
      store.addCategory(cat)
      expect(store.categories).toHaveLength(1)
    })

    it('renameCategory - 应该重命名分类', () => {
      store.addCategory({ id: 'cat1', name: 'Old', icon: '', color: '', order: 0 })
      store.renameCategory('cat1', 'New')
      expect(store.categories[0].name).toBe('New')
    })

    it('deleteCategory - 应该将关联书签移至未分类并软删除分类', () => {
      store.addBookmark({ id: 'b1', categoryId: 'cat1' } as any)
      store.addGroup({ id: 'g1', categoryId: 'cat1', bookmarkIds: [] } as any)
      store.addCategory({ id: 'cat1', name: 'Test', icon: '', color: '', order: 0 })

      store.deleteCategory('cat1')

      expect(store.bookmarks[0].categoryId).toBe('uncategorized')
      expect(store.siblingGroups[0].categoryId).toBe('uncategorized')
      expect(store.categories[0].deletedAt).toBeDefined()
    })

    it('reorderCategories - 写 order/updatedAt + dirty/track，保留未参与项', () => {
      store.categories = [
        { id: 'all', name: '全部', icon: '', color: '', order: 0 },
        { id: 'a', name: 'A', icon: '', color: '', order: 1, updatedAt: 1 },
        { id: 'b', name: 'B', icon: '', color: '', order: 2, updatedAt: 1 },
        { id: 'gone', name: 'Gone', icon: '', color: '', order: 9, deletedAt: 99, updatedAt: 1 },
      ] as any
      store._syncMaps()

      store.reorderCategories([
        store.categories[0],
        store.categories[2], // b 提前
        store.categories[1], // a 靠后
      ])

      expect(store.categories.map(c => c.id)).toEqual(['all', 'b', 'a', 'gone'])
      expect(store.categories[1].order).toBe(1)
      expect(store.categories[2].order).toBe(2)
      expect(store.categories[1].updatedAt).toBeGreaterThan(1)
      expect(store._dirtyIds.has('b')).toBe(true)
      expect(store._dirtyIds.has('a')).toBe(true)
      expect(store._changedFields.get('b')?.has('order')).toBe(true)
      expect(store.categories.find(c => c.id === 'gone')?.deletedAt).toBe(99)
    })

    it('selectableCategories - 按 order 升序且排除全部/软删', () => {
      store.categories = [
        { id: 'all', name: '全部', icon: '', color: '', order: 0 },
        { id: 'z', name: 'Z', icon: '', color: '', order: 5 },
        { id: 'a', name: 'A', icon: '', color: '', order: 2 },
        { id: 'x', name: 'X', icon: '', color: '', order: 3, deletedAt: 1 },
      ] as any
      expect(store.selectableCategories.map(c => c.id)).toEqual(['a', 'z'])
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

  // 私密空间独立数据集：switchSpace 主页⇄vault 切换
  describe('switchSpace — 独立数据集切换', () => {
    it('切到 vault：当前四数组落主页 key、清 dirty/同步队列、载入 vault 空四数组', async () => {
      // 主页数据
      store.addCategory({ id: 'catHome', name: '主页分类', icon: '', color: '', order: 1 } as any)
      store.addBookmark({ id: 'bh1', title: '主页书签', url: 'h', categoryId: 'catHome' } as any)
      store.addBookmark({ id: 'bh2', title: '脏', url: 'x', categoryId: 'catHome' } as any)
      expect(store._dirtyIds.size).toBeGreaterThan(0)
      await store.switchSpace('vault')
      // 内存已替换为 vault 数据集（基础分类由 runMigrations 注入，无示例书签/组）
      expect(store.bookmarks).toEqual([])
      expect(store.siblingGroups).toEqual([])
      // dirty 三集清空
      expect(store._dirtyIds.size).toBe(0)
      expect(store._newIds.size).toBe(0)
      expect(store._deletedIds.size).toBe(0)
      // curSpace 已切到 vault
      expect(uiStore.curSpace).toBe('vault')
    })

    it('vault 首进空库：载入基础分类（CAT_ALL/UNCATEGORIZED 等）而非 DEFAULTS 示例书签', async () => {
      // switchSpace 调 _maybeLoadLocalSpace：localStorage 无 vault 键 → null → 空四数组。
      // importFromData 里 runMigrations 会注入 DEFAULTS 基础分类（all/uncategorized 等）——
      // 这是正确行为，空私密空间也需要基础分类才能正常渲染。
      // 但不应有 DEFAULTS 示例书签/组（如 welcome 书签）。
      await store.switchSpace('vault')
      // 基础分类存在（all/uncategorized 等），无示例书签/组
      expect(store.bookmarks).toEqual([])
      expect(store.siblingGroups).toEqual([])
      expect(store.customAttributes).toEqual([])
      // categories 含基础分类（CAT_ALL、CAT_UNCATEGORIZED 等），不为空
      expect(store.categories.length).toBeGreaterThan(0)
      expect(store.categories.some(c => c.id === 'all')).toBe(true)
    })

    it('从 vault 切回 main：落 vault 数据、载入主页数据集还原', async () => {
      uiStore.curSpace = 'vault'
      // 先给主页 localStorage 写入真数据（模拟主页历史数据存在）
      localStorage.setItem('linkvault_v2', JSON.stringify({
        bookmarks: [{ id: 'bm1', title: '主页书签', url: 'm', username: '', password: '', notes: '', icon: '', categoryId: 'all', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 }],
        siblingGroups: [], categories: [], customAttributes: [],
      }))
      await store.switchSpace('main')
      // 内存换回主页书签
      expect(store.bookmarks.map(b => b.id)).toContain('bm1')
      expect(uiStore.curSpace).toBe('main')
    })

    it('curSpace 已是目标空间时不切（幂等 no-op）', async () => {
      uiStore.curSpace = 'vault'
      const before = JSON.stringify(store._dataSnapshot())
      await store.switchSpace('vault')
      // 快照不变
      expect(JSON.stringify(store._dataSnapshot())).toBe(before)
    })
  })
})
