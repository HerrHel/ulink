/**
 * 行为契约护栏：emptyTrash + permanentDelete* 系列（D2 行为契约层）
 *
 * Explore agentId a24b8b3c64e00e66a 逐函数覆盖率深度核出真缺口：
 * emptyTrash / permanentDeleteBookmark / permanentDeleteGroup /
 * permanentDeleteCategory / permanentDeleteAttribute / _permanentDelete
 * 全测试目录 0 直测——仅 data.test.ts:378 经 switchSpace 间接清空
 * _deletedIds.size，跨设备永久删除传播（drainDeletedIds 消费 _deletedIds
 * 生成云端 delete op）安全契约此前无任何护栏断言。
 *
 * 纯加测试零源文件改动：全经 useDataStore() return 暴露，不改 data.ts。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { preloadSearchLibs } from '../../lib/search.js'

beforeAll(async () => {
  await preloadSearchLibs()
})

describe('emptyTrash + permanentDelete* 行为契约护栏', () => {
  let store: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDataStore()
    useUIStore()
  })

  describe('_permanentDelete 入队契约（跨设备永久删除传播）', () => {
    it('permanentDeleteBookmark: _deletedIds.set(id,"bookmarks") + _dirtyIds.delete', () => {
      store.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com' } as any)
      store.deleteBookmark('bm1') // 软删
      store._dirtyIds.add('bm1') // 模拟 dirty 状态
      expect(store._dirtyIds.has('bm1')).toBe(true)
      store.permanentDeleteBookmark('bm1')
      expect(store._deletedIds.get('bm1')).toBe('bookmarks')
      expect(store._dirtyIds.has('bm1')).toBe(false)
    })

    it('permanentDeleteGroup: _deletedIds.set(id,"sibling_groups")', () => {
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [] } as any)
      store.deleteGroup('g1')
      store.permanentDeleteGroup('g1')
      expect(store._deletedIds.get('g1')).toBe('sibling_groups')
      expect(store._dirtyIds.has('g1')).toBe(false)
    })

    it('permanentDeleteCategory: _deletedIds.set(id,"categories")', () => {
      store.addCategory({ id: 'c1', name: 'C' } as any)
      store.deleteCategory('c1')
      store.permanentDeleteCategory('c1')
      expect(store._deletedIds.get('c1')).toBe('categories')
    })

    it('permanentDeleteAttribute: _deletedIds.set(id,"custom_attributes") + 清 _deletedAttrMemberships', () => {
      store.addAttribute({ id: 'a1', name: 'tag', type: 'boolean' } as any)
      store.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com', attributes: { a1: true } } as any)
      store.deleteAttribute('a1') // 快照 _deletedAttrMemberships
      expect(store._deletedAttrMemberships.get('a1')?.length).toBe(1)
      store.permanentDeleteAttribute('a1')
      expect(store._deletedIds.get('a1')).toBe('custom_attributes')
      expect(store._deletedAttrMemberships.get('a1')).toBeUndefined()
    })

    it('drainDeletedIds 取出 _deletedIds 副本并清空（跨设备删除 op 消费契约）', () => {
      store.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com' } as any)
      store.deleteBookmark('bm1')
      store.permanentDeleteBookmark('bm1')
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [] } as any)
      store.deleteGroup('g1')
      store.permanentDeleteGroup('g1')
      const drained = store.drainDeletedIds()
      expect(drained.get('bm1')).toBe('bookmarks')
      expect(drained.get('g1')).toBe('sibling_groups')
      expect(drained.size).toBe(2)
      // 清空语义：第二次 drain 应为空
      expect(store.drainDeletedIds().size).toBe(0)
    })
  })

  describe('permanentDeleteBookmark RC-1 BFS 孤儿收敛', () => {
    it('多层嵌套：永久删根 → 所有后代 parentId 置 null', () => {
      // grandparent → parent → child 三层（API 层 addBookmark 可编程挂多层）
      store.addBookmark({ id: 'gp', title: 'gp', url: 'https://gp.com', parentId: null } as any)
      store.addBookmark({ id: 'p', title: 'p', url: 'https://p.com', parentId: 'gp' } as any)
      store.addBookmark({ id: 'c', title: 'c', url: 'https://c.com', parentId: 'p' } as any)
      store.addBookmark({ id: 'gc', title: 'gc', url: 'https://gc.com', parentId: 'c' } as any)
      store._syncMaps()
      expect(store._childrenIdx['gp']).toEqual(['p'])
      expect(store._childrenIdx['p']).toEqual(['c'])
      expect(store._childrenIdx['c']).toEqual(['gc'])

      store.permanentDeleteBookmark('gp')

      // 三个后代都仍在数组里（BFS 只清 parentId，不级联删），且 parentId 已置 null
      expect(store.bookmarkMap['p']).toBeDefined()
      expect(store.bookmarkMap['c']).toBeDefined()
      expect(store.bookmarkMap['gc']).toBeDefined()
      expect(store.bookmarkMap['p'].parentId).toBeNull()
      expect(store.bookmarkMap['c'].parentId).toBeNull()
      expect(store.bookmarkMap['gc'].parentId).toBeNull()
      // 根本身已从数组移除
      expect(store.bookmarkMap['gp']).toBeUndefined()
      // _childrenIdx 中根及中间层索引已清
      expect(store._childrenIdx['gp']).toBeUndefined()
      expect(store._childrenIdx['p']).toBeUndefined()
      expect(store._childrenIdx['c']).toBeUndefined()
    })

    it('仅直接子项单层：删父清子 parentId + 清 _childrenIdx[父]', () => {
      store.addBookmark({ id: 'p', title: 'p', url: 'https://p.com', parentId: null } as any)
      store.addBookmark({ id: 'c1', title: 'c1', url: 'https://c1.com', parentId: 'p' } as any)
      store.addBookmark({ id: 'c2', title: 'c2', url: 'https://c2.com', parentId: 'p' } as any)
      store._syncMaps()
      store.permanentDeleteBookmark('p')
      expect(store.bookmarkMap['c1'].parentId).toBeNull()
      expect(store.bookmarkMap['c2'].parentId).toBeNull()
      expect(store._childrenIdx['p']).toBeUndefined()
    })

    it('删无子项的叶子书签：不抛，正常入删除队列', () => {
      store.addBookmark({ id: 'leaf', title: 'l', url: 'https://l.com', parentId: null } as any)
      store.permanentDeleteBookmark('leaf')
      expect(store.bookmarkMap['leaf']).toBeUndefined()
      expect(store._deletedIds.get('leaf')).toBe('bookmarks')
    })

    it('已软删书签被永久删后退路：_deletedGroupMemberships 同步清', () => {
      store.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com' } as any)
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: ['bm1'] } as any)
      store.deleteBookmark('bm1')
      // deleteBookmark 记录 _deletedGroupMemberships
      expect(store._deletedGroupMemberships.get('bm1')).toEqual(['g1'])
      store.permanentDeleteBookmark('bm1')
      expect(store._deletedGroupMemberships.get('bm1')).toBeUndefined()
    })
  })

  describe('permanentDeleteGroup/Category/Attribute 实体移除契约', () => {
    it('permanentDeleteGroup: 数组移除 + _grpMap 索引同步清', () => {
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [] } as any)
      store.addGroup({ id: 'g2', name: 'G2', bookmarkIds: [] } as any)
      store.deleteGroup('g1')
      store.permanentDeleteGroup('g1')
      expect(store.siblingGroups.map(g => g.id)).toEqual(['g2'])
      expect(store.groupMap['g1']).toBeUndefined()
      expect(store.groupMap['g2']).toBeDefined()
    })

    it('permanentDeleteCategory: 数组移除 + _catMap 索引同步清', () => {
      store.addCategory({ id: 'c1', name: 'C1' } as any)
      store.addCategory({ id: 'c2', name: 'C2' } as any)
      store.deleteCategory('c1')
      store.permanentDeleteCategory('c1')
      expect(store.categories.map(c => c.id)).toEqual(['c2'])
      expect(store.categoryMap['c1']).toBeUndefined()
    })

    it('permanentDeleteAttribute: 数组移除 + _attrMap 索引同步清', () => {
      store.addAttribute({ id: 'a1', name: 't1', type: 'boolean' } as any)
      store.addAttribute({ id: 'a2', name: 't2', type: 'boolean' } as any)
      store.deleteAttribute('a1')
      store.permanentDeleteAttribute('a1')
      expect(store.customAttributes.map(a => a.id)).toEqual(['a2'])
      expect(store.attributeMap['a1']).toBeUndefined()
    })
  })

  describe('emptyTrash 编排契约', () => {
    it('一键清空：四数组的软删项全部永久删除 + active 项保留', () => {
      // 准备：各类实体含软删与活跃混合
      store.addBookmark({ id: 'bm-keep', title: 'keep', url: 'https://keep.com' } as any)
      store.addBookmark({ id: 'bm-del', title: 'del', url: 'https://del.com' } as any)
      store.deleteBookmark('bm-del')
      store.addGroup({ id: 'g-keep', name: 'Gkeep', bookmarkIds: [] } as any)
      store.addGroup({ id: 'g-del', name: 'Gdel', bookmarkIds: [] } as any)
      store.deleteGroup('g-del')
      store.addCategory({ id: 'c-keep', name: 'Ckeep' } as any)
      store.addCategory({ id: 'c-del', name: 'Cdel' } as any)
      store.deleteCategory('c-del')
      store.addAttribute({ id: 'a-keep', name: 'keep', type: 'boolean' } as any)
      store.addAttribute({ id: 'a-del', name: 'del', type: 'boolean' } as any)
      store.deleteAttribute('a-del')

      expect(store.trashCount).toBe(4)
      store._dirtyIds.clear() // 隔离 emptyTrash 自身副作用

      store.emptyTrash()

      // 四数组只剩活跃项
      expect(store.bookmarks.map(b => b.id)).toEqual(['bm-keep'])
      expect(store.siblingGroups.map(g => g.id)).toEqual(['g-keep'])
      expect(store.categories.map(c => c.id)).toEqual(['c-keep'])
      expect(store.customAttributes.map(a => a.id)).toEqual(['a-keep'])
      // 回收站清空
      expect(store.trashCount).toBe(0)
      // _deletedIds 含全部被清的四种表项
      expect(store._deletedIds.get('bm-del')).toBe('bookmarks')
      expect(store._deletedIds.get('g-del')).toBe('sibling_groups')
      expect(store._deletedIds.get('c-del')).toBe('categories')
      expect(store._deletedIds.get('a-del')).toBe('custom_attributes')
    })

    it('空回收站（无软删项）：emptyTrash 不抛，状态不变', () => {
      store.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com' } as any)
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [] } as any)
      const bmBefore = store.bookmarks.slice()
      const gBefore = store.siblingGroups.slice()
      expect(() => store.emptyTrash()).not.toThrow()
      expect(store.bookmarks).toEqual(bmBefore)
      expect(store.siblingGroups).toEqual(gBefore)
      expect(store.trashCount).toBe(0)
    })

    it('末尾 _syncMaps 重建索引：清空后 bookmarkMap/groupMap 等与数组同步', () => {
      store.addBookmark({ id: 'bm-del', title: 'd', url: 'https://d.com' } as any)
      store.addBookmark({ id: 'bm-keep', title: 'k', url: 'https://k.com' } as any)
      store.deleteBookmark('bm-del')
      store.emptyTrash()
      // 索引与过滤后数组一致（_syncMaps 重建后 _bmMap 不残留已删 id）
      expect(Object.keys(store.bookmarkMap)).toEqual(['bm-keep'])
      expect(store.bookmarkMap['bm-del']).toBeUndefined()
      // 数组长度 = 索引键数（_syncMaps 后的不变量）
      expect(Object.keys(store.bookmarkMap).length).toBe(store.bookmarks.length)
    })

    it('deleteAttribute 软删后 emptyTrash 永久删：_deletedAttrMemberships 同步清零', () => {
      store.addAttribute({ id: 'a1', name: 't', type: 'boolean' } as any)
      store.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com', attributes: { a1: true } } as any)
      store.deleteAttribute('a1')
      expect(store._deletedAttrMemberships.get('a1')?.length).toBe(1)
      store.emptyTrash()
      expect(store._deletedAttrMemberships.get('a1')).toBeUndefined()
      expect(store.customAttributes).toHaveLength(0)
    })

    it('emptyTrash 后 _deletedIds 可经 drainDeletedIds 取出全表删除 op（跨设备传播链）', () => {
      store.addBookmark({ id: 'bm-del', title: 'd', url: 'https://d.com' } as any)
      store.deleteBookmark('bm-del')
      store.addCategory({ id: 'c-del', name: 'C' } as any)
      store.deleteCategory('c-del')
      store.emptyTrash()
      const drained = store.drainDeletedIds()
      expect(drained.get('bm-del')).toBe('bookmarks')
      expect(drained.get('c-del')).toBe('categories')
    })
  })
})
