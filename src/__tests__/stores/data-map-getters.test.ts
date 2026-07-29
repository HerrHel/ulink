import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { preloadSearchLibs } from '../../lib/search.js'

// map getter 不触发 filteredBookmarks/filteredGroups（不走 searchBookmarkIds），
// 但 preloadSearchLibs 保险加防 store 初始化侧链需 Fuse。
beforeAll(async () => {
  await preloadSearchLibs()
})

/**
 * D1-32 护栏：四个 O(1) Map getter（bookmarkMap/groupMap/categoryMap/attributeMap）
 * 的 length 守卫懒回退重建不变量 + childrenMap 懒回退/软删过滤/悬空 id 过滤护栏。
 *
 * 这些 getter 是全表 CRUD 的 id→实例查找核心，被 _indexOfById（D1-16「CRUD 不丢写」
 * map 漂移回退姐妹缺口）与大量下游消费。本测试锁定其「length 守卫 + 懒回退重建」
 * 这一历来靠实现口头维护、无直测的核心不变量——回退若被误删（直接返缓存 _bmMap），
 * _syncMaps 增量维护与数组偶发不同步时返残缺 map，致 _indexOfById 拿 -1 丢写。
 *
 * 纯加测试零逻辑改动：getter 已可直接经 store 实例访问，不改任何源文件。
 */
describe('DataStore map getter 懒回退护栏（D1-32）', () => {
  let store: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDataStore()
  })

  describe('bookmarkMap — length 守卫懒回退重建', () => {
    it('快路径：_syncMaps 同步后 length 相等时返 state._bmMap 缓存（与数组项同引用）', () => {
      store.bookmarks = [
        { id: 'b1', title: 'T1' } as any,
        { id: 'b2', title: 'T2' } as any,
      ]
      store._syncMaps() // 增量维护同步 _bmMap
      // length 守卫命中 → 返缓存 _bmMap；getter 返回项与从 reactive store.array 取的同 id 项同引用
      // （Pinia state 是深度 reactive proxy，getter 返回的也是 proxy；
      //  对照 reactive store.bookmarks[i] 而非外部原始对象——与 data.test.ts:104 既有正确断言同口径）
      expect(Object.keys(store._bmMap).length).toBe(2)
      expect(store.bookmarkMap['b1']).toBe(store.bookmarks[0])
      expect(store.bookmarkMap['b2']).toBe(store.bookmarks[1])
    })

    it('回退分支：直接赋值 bookmarks 不经 _syncMaps 时整体重建返回新 map 且项与数组同引用', () => {
      store.bookmarks = [{ id: 'b1', title: 'T1' } as any]
      // 不调 _syncMaps → _bmMap 仍为空 {}，length 0 !== 1 → 走回退重建
      const map = store.bookmarkMap
      expect(map['b1']).toBe(store.bookmarks[0])
    })

    it('★ 回退不写回 state._bmMap：重新求值仍走回退直到显式 _syncMaps（getter 副作用级不应 mutate state）', () => {
      store.bookmarks = [{ id: 'b1', title: 'T1' } as any]
      // 触发回退分支求值一次
      expect(store.bookmarkMap['b1'].title).toBe('T1')
      // 关键不变量：回退构建的新 map 仅本次返回，不写回 state._bmMap
      // 否则 getter 产生副作用（mutate state）违反 Vue getter 纯读约定
      expect(Object.keys(store._bmMap).length).toBe(0)
      // 再次求值仍能命中（因每次都重建，不依赖 _bmMap 被写回）
      expect(store.bookmarkMap['b1'].title).toBe('T1')
    })

    it('★ length 守卫：_bmMap 比 bookmarks 多项时也走回退重建（双向不等触发）', () => {
      store.bookmarks = [] // 空
      store._syncMaps() // _bmMap 同步为空，length 0 === 0
      expect(store.bookmarkMap['b1']).toBeUndefined()
      // 直接给 _bmMap 塞多于 bookmarks 的脏项 → length 1 !== 0 触发回退
      store._bmMap = { stale: { id: 'stale', title: '脏' } as any }
      const map = store.bookmarkMap
      // 回退重建 = 空 bookmarks → 脏项被剔除不返回
      expect(Object.keys(map).length).toBe(0)
      expect(map['stale']).toBeUndefined()
    })

    it('★ 增量维护漂移保护：数组新增项后 _bmMap 未同步时 getter 回退仍能查到新项（防丢写）', () => {
      store.bookmarks = [{ id: 'b1', title: 'T1' } as any]
      store._syncMaps()
      // 模拟增量维护漂移：数组追加了项但 _bmMap 未更新（_syncMaps 调用点遗漏场景）
      store.bookmarks = [
        { id: 'b1', title: 'T1' } as any,
        { id: 'b2', title: 'T2' } as any,
      ]
      // _bmMap 此刻 length 1 !== 2 → length 守卫触发回退重建
      expect(Object.keys(store._bmMap).length).toBe(1)
      // 回退后 b2 仍可查到——这是 _indexOfById「map 漂移不丢查」的前置保证
      expect(store.bookmarkMap['b2']).toBe(store.bookmarks[1])
      expect(store.bookmarkMap['b1']).toBe(store.bookmarks[0])
    })

    it('空 store 返空对象不抛', () => {
      expect(Object.keys(store.bookmarkMap).length).toBe(0)
      expect(store.bookmarkMap['any']).toBeUndefined()
    })
  })

  describe('groupMap / categoryMap / attributeMap — 同源 length 守卫懒回退', () => {
    it('groupMap 回退：直接赋值 siblingGroups 不经 _syncMaps 时整体重建', () => {
      store.siblingGroups = [{ id: 'g1', name: 'G1', bookmarkIds: [] } as any]
      expect(store.groupMap['g1']).toBe(store.siblingGroups[0])
      // 回退不写回 _grpMap
      expect(Object.keys(store._grpMap).length).toBe(0)
    })

    it('groupMap 快路径：_syncMaps 后返缓存', () => {
      store.siblingGroups = [{ id: 'g1', name: 'G1', bookmarkIds: [] } as any]
      store._syncMaps()
      expect(store.groupMap['g1']).toBe(store.siblingGroups[0])
      expect(Object.keys(store._grpMap).length).toBe(1)
    })

    it('categoryMap 回退：直接赋值 categories 时整体重建', () => {
      store.categories = [{ id: 'cat1', name: 'C1' } as any]
      expect(store.categoryMap['cat1']).toBe(store.categories[0])
      expect(Object.keys(store._catMap).length).toBe(0)
    })

    it('categoryMap 快路径：_syncMaps 后返缓存', () => {
      store.categories = [{ id: 'cat1', name: 'C1' } as any]
      store._syncMaps()
      expect(store.categoryMap['cat1']).toBe(store.categories[0])
    })

    it('attributeMap 回退：直接赋值 customAttributes 时整体重建（含软删项）', () => {
      // attributeMap 含软删除（与 bookmarkMap 同，由 _syncMaps 维护、不滤软删——见注释 L262）
      store.customAttributes = [
        { id: 'a1', name: '标签一', type: 'boolean' } as any,
        { id: 'a2', name: '标签二', type: 'boolean', deletedAt: 100 } as any,
      ]
      const map = store.attributeMap
      expect(map['a1']).toBe(store.customAttributes[0])
      // ★ 软删项仍命中 attributeMap（getter 不过滤 deletedAt）—— 锁定此真实语义
      expect(map['a2']).toBe(store.customAttributes[1])
      expect(Object.keys(map).length).toBe(2)
    })

    it('attributeMap 快路径：_syncMaps 后返缓存含软删项', () => {
      store.customAttributes = [
        { id: 'a1', name: 'x', type: 'boolean' } as any,
        { id: 'a2', name: 'y', type: 'boolean', deletedAt: 100 } as any,
      ]
      store._syncMaps()
      expect(store.attributeMap['a1']).toBe(store.customAttributes[0])
      expect(store.attributeMap['a2']).toBe(store.customAttributes[1])
    })

    it('★ 跨实体隔离：bookmarkMap 不含 group/category/attribute，各 map 互不污染', () => {
      store.bookmarks = [{ id: 'b1', title: 'T' } as any]
      store.siblingGroups = [{ id: 'g1', name: 'G', bookmarkIds: [] } as any]
      store.categories = [{ id: 'cat1', name: 'C' } as any]
      store.customAttributes = [{ id: 'a1', name: 'A', type: 'boolean' } as any]
      // 各回退 map 只含自身实体，互不串台
      expect(store.bookmarkMap['g1']).toBeUndefined()
      expect(store.bookmarkMap['cat1']).toBeUndefined()
      expect(store.bookmarkMap['a1']).toBeUndefined()
      expect(store.groupMap['b1']).toBeUndefined()
      expect(store.categoryMap['b1']).toBeUndefined()
      expect(store.attributeMap['b1']).toBeUndefined()
      // 互为 truthy 只在各自 map
      expect(store.bookmarkMap['b1']).toBeTruthy()
      expect(store.groupMap['g1']).toBeTruthy()
      expect(store.categoryMap['cat1']).toBeTruthy()
      expect(store.attributeMap['a1']).toBeTruthy()
    })
  })

  describe('childrenMap — 懒回退分支 / 软删除子项过滤 / 悬空 id 过滤', () => {
    /**
     * childrenMap 两分支（data.ts:281-302）：
     * 分支1（懒回退）：_childrenIdx 空 且 bookmarks.some(parentId) → 手动 forEach 构建，
     *   排除软删除子项（L286 !b.deletedAt）
     * 分支2：否则从 _childrenIdx 解析 id → 经 _bmMap 解析为 Bookmark 对象，
     *   filter 排除软删除与悬空 id（L298-299 !!b && !b.deletedAt）
     */
    it('★ 分支1懒回退：_childrenIdx 空且存在 parentId 时手动构建（不经 _syncMaps）', () => {
      store.bookmarks = [
        { id: 'p1', parentId: null } as any,
        { id: 'c1', parentId: 'p1' } as any,
        { id: 'c2', parentId: 'p1' } as any,
        { id: 'p2', parentId: null } as any,
      ]
      // _childrenIdx 初始空 + bookmarks.some(parentId) → 走分支1手动构建
      expect(Object.keys(store._childrenIdx).length).toBe(0)
      const map = store.childrenMap
      expect(map['p1'].map((b: any) => b.id)).toEqual(['c1', 'c2'])
      expect(map['p2']).toBeUndefined() // p2 无子，分支1不建空 key
    })

    it('★ 分支1软删除子项过滤：deletedAt 子项不进父的子列表（L286 !b.deletedAt）', () => {
      store.bookmarks = [
        { id: 'p1', parentId: null } as any,
        { id: 'live', parentId: 'p1' } as any,
        { id: 'softdel', parentId: 'p1', deletedAt: 100 } as any,
      ]
      const map = store.childrenMap
      expect(map['p1'].map((b: any) => b.id)).toEqual(['live'])
      // 软删子项被过滤
      expect(map['p1'].find((b: any) => b.id === 'softdel')).toBeUndefined()
    })

    it('分支1无子时不建空 key（空对象）', () => {
      store.bookmarks = [
        { id: 'p1', parentId: null } as any,
        { id: 'p2', parentId: null } as any,
      ]
      expect(Object.keys(store.childrenMap).length).toBe(0)
    })

    it('★ 分支2 经 _syncMaps 构建后走 _childrenIdx 解析路径', () => {
      store.bookmarks = [
        { id: 'p1', parentId: null } as any,
        { id: 'c1', parentId: 'p1' } as any,
      ]
      store._syncMaps() // _childrenIdx 现已构建（length!==0），走分支2
      expect(Object.keys(store._childrenIdx).length).toBeGreaterThan(0)
      const map = store.childrenMap
      // 分支2经 _bmMap 解析：返回 Bookmark 对象（Pinia reactive；与前字段断言用 id 对照）
      expect(map['p1'].map((b: any) => b.id)).toEqual(['c1'])
    })

    it('★ 分支2软删除子项过滤：_syncMaps 后子项被软删则 childrenMap 不含该子', () => {
      const p1 = { id: 'p1', parentId: null } as any
      const live = { id: 'live', parentId: 'p1' } as any
      const softdel = { id: 'softdel', parentId: 'p1' } as any
      store.bookmarks = [p1, live, softdel]
      store._syncMaps() // _childrenIdx['p1'] = ['live','softdel']
      // 子项软删后，分支2 filter 的 !b.deletedAt 把它剔除
      softdel.deletedAt = 100
      const map = store.childrenMap
      expect(map['p1'].map((b: any) => b.id)).toEqual(['live'])
    })

    it('★ 分支2悬空 id 过滤：_childrenIdx 含 _bmMap 查不到的脏 id 时被 filter 剔除（L298 !!b）', () => {
      const p1 = { id: 'p1', parentId: null } as any
      const live = { id: 'live', parentId: 'p1' } as any
      store.bookmarks = [p1, live]
      store._syncMaps() // _childrenIdx['p1'] = ['live']
      // 注入悬空 id 进 _childrenIdx（_syncMaps 漂移场景：引用了不存在书签）
      store._childrenIdx['p1'] = ['live', 'ghost-nonexistent']
      // _bmMap['ghost-nonexistent']===undefined → 分支2 filter !!b 剔除悬空
      const map = store.childrenMap
      expect(map['p1'].map((b: any) => b.id)).toEqual(['live'])
    })

    it('分支2 _childrenIdx 已构建但无 parentId 项时返空对象（some(parentId) false）', () => {
      store.bookmarks = [
        { id: 'p1', parentId: null } as any,
        { id: 'p2', parentId: null } as any,
      ]
      store._syncMaps() // _childrenIdx 仍空（无 parentId 项）→ 分支1 some false → 走分支2全 0 key
      expect(Object.keys(store.childrenMap).length).toBe(0)
    })

    it('★ 懒回退不写回 _childrenIdx：分支1构建的 map 不写回 state（getter 无副作用）', () => {
      store.bookmarks = [
        { id: 'p1', parentId: null } as any,
        { id: 'c1', parentId: 'p1' } as any,
      ]
      // 触发分支1求值一次
      expect(store.childrenMap['p1']).toHaveLength(1)
      // 关键不变量：分支1构建的 map 仅本次返回，不写回 state._childrenIdx
      expect(Object.keys(store._childrenIdx).length).toBe(0)
      // 再次求值仍走分支1（childrenIdx 仍空）
      expect(store.childrenMap['p1']).toHaveLength(1)
    })
  })

  describe('四 map getter 一致性回退（联合场景）', () => {
    it('全部实体不经 _syncMaps 赋值后各 map 回退均正确', () => {
      store.bookmarks = [{ id: 'b1', title: 'T' } as any]
      store.siblingGroups = [{ id: 'g1', name: 'G', bookmarkIds: [] } as any]
      store.categories = [{ id: 'cat1', name: 'C' } as any]
      store.customAttributes = [{ id: 'a1', name: 'A', type: 'boolean' } as any]
      // 全部应走各自回退分支
      expect(store.bookmarkMap['b1']).toBeTruthy()
      expect(store.groupMap['g1']).toBeTruthy()
      expect(store.categoryMap['cat1']).toBeTruthy()
      expect(store.attributeMap['a1']).toBeTruthy()
      // 全部不写回各自缓存
      expect(Object.keys(store._bmMap).length).toBe(0)
      expect(Object.keys(store._grpMap).length).toBe(0)
      expect(Object.keys(store._catMap).length).toBe(0)
      expect(Object.keys(store._attrMap).length).toBe(0)
    })
  })
})
