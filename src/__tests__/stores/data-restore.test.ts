/**
 * 行为契约护栏：restoreAttribute / restoreGroup / restoreCategory / _restoreFrom 软删恢复编排
 *
 * Explore agentId a24b8b3c64e00e66a 逐函数覆盖率深度核出真缺口 #4（扩到四类姐妹面）：
 * - restoreAttribute + _deletedAttrMemberships A2-002 成员回写：撤销删属性时把卡片上
 *   消失的标签键 [id]:true 复原——全目录字面 0 直测（restoreBookmark 组关系恢复已在
 *   batchMove.test.ts:147 直测，restoreAttribute 对应面从未被任何用例直触）
 * - restoreGroup / restoreCategory / _restoreFrom 通用软删恢复：删 deletedAt + updatedAt=now
 *   + map 同步 + _markDirty + _searchIndexDirty——仅 restoreGroup 在 batchMove.test.ts:188
 *   经编排链间接直触一次，restoreCategory/_restoreFrom 全 0 直测
 *
 * 纯加测试零源文件改动：restore* 全经 useDataStore() return 暴露，不改 data.ts。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { preloadSearchLibs } from '../../lib/search.js'

beforeAll(async () => {
  await preloadSearchLibs()
})

describe('restore* 软删恢复编排护栏', () => {
  let store: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDataStore()
    useUIStore()
  })

  describe('_restoreFrom 通用软删恢复（经 restoreGroup/restoreCategory 触发）', () => {
    it('restoreGroup: 删 deletedAt + updatedAt 刷新 + _grpMap 同步 + dirty + searchIndexDirty', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(1700000000000))
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [] } as any)
      store.deleteGroup('g1')
      expect(store.groupMap['g1'].deletedAt).toBeGreaterThan(0)
      store.drainDirtyIds()

      store.restoreGroup('g1')

      expect(store.groupMap['g1'].deletedAt).toBeUndefined()
      expect(store.groupMap['g1'].updatedAt).toBe(1700000000000)
      expect(store._dirtyIds.has('g1')).toBe(true)
      expect(store._searchIndexDirty).toBe(true)
      vi.useRealTimers()
    })

    it('restoreCategory: 删 deletedAt + _catMap 同步', () => {
      store.addCategory({ id: 'c1', name: 'C' } as any)
      store.deleteCategory('c1')
      expect(store.categoryMap['c1'].deletedAt).toBeDefined()
      store.drainDirtyIds()

      store.restoreCategory('c1')

      expect(store.categoryMap['c1'].deletedAt).toBeUndefined()
      expect(store._dirtyIds.has('c1')).toBe(true)
      // 恢复后 categories getter（已 filteredBookmarks 类排软删）应重新含此项
      expect(store.categories.map(c => c.id)).toContain('c1')
    })

    it('不存在的 id：_restoreFrom 静默不抛（idx<0 早返回）', () => {
      expect(() => store.restoreGroup('no-such')).not.toThrow()
      expect(() => store.restoreCategory('no-such')).not.toThrow()
      expect(store._dirtyIds.has('no-such')).toBe(false)
    })

    it('未软删的活项 restore：deletedAt 本就 undefined，仍走 update 刷新 updatedAt + dirty', () => {
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [] } as any)
      store.drainDirtyIds()
      expect(store.groupMap['g1'].deletedAt).toBeUndefined()

      store.restoreGroup('g1')

      // _restoreFrom 不前置检查 deletedAt，无条件 delete next.deletedAt（本就是 undefined）+ 刷新
      expect(store.groupMap['g1'].deletedAt).toBeUndefined()
      expect(store._dirtyIds.has('g1')).toBe(true)
    })
  })

  describe('restoreAttribute A2-002 成员回写', () => {
    it('恢复属性：对仍存活书签/组把 [id]:true 回写 attributes', () => {
      store.addAttribute({ id: 'a1', name: '标签', type: 'boolean' } as any)
      store.addBookmark({
        id: 'bm1', title: 'a', url: 'https://a.com',
        attributes: { a1: true },
      } as any)
      store.addGroup({
        id: 'g1', name: 'G', bookmarkIds: [],
        attributes: { a1: true },
      } as any)
      // deleteAttribute 快照 _deletedAttrMemberships + 抹掉实体上的 a1 键
      store.deleteAttribute('a1')
      expect(store._deletedAttrMemberships.get('a1')?.length).toBe(2)
      expect(store.bookmarkMap['bm1'].attributes.a1).toBeUndefined()
      expect(store.groupMap['g1'].attributes.a1).toBeUndefined()
      store.drainDirtyIds()

      store.restoreAttribute('a1')

      // A2-002：回写 [id]:true
      expect(store.bookmarkMap['bm1'].attributes.a1).toBe(true)
      expect(store.groupMap['g1'].attributes.a1).toBe(true)
      // 两实体都 trackChange('attributes') + dirty
      expect(store._changedFields.get('bm1')?.has('attributes')).toBe(true)
      expect(store._changedFields.get('g1')?.has('attributes')).toBe(true)
      expect(store._dirtyIds.has('bm1')).toBe(true)
      expect(store._dirtyIds.has('g1')).toBe(true)
      expect(store._searchIndexDirty).toBe(true)
      // 末尾清 _deletedAttrMemberships
      expect(store._deletedAttrMemberships.get('a1')).toBeUndefined()
    })

    it('恢复属性：已软删的实体此刻不回写，但 membership 保留待其 restore 回填（r10-attr-restore B1 复现）', () => {
      store.addAttribute({ id: 'a1', name: '标签', type: 'boolean' } as any)
      store.addBookmark({ id: 'bm-alive', title: 'a', url: 'https://a.com', attributes: { a1: true } } as any)
      store.addBookmark({ id: 'bm-dead', title: 'd', url: 'https://d.com', attributes: { a1: true } } as any)
      store.deleteBookmark('bm-dead') // 软删 bm-dead
      store.deleteAttribute('a1') // 快照含 bm-alive + bm-dead
      expect(store._deletedAttrMemberships.get('a1')?.length).toBe(2)
      store.drainDirtyIds()

      store.restoreAttribute('a1')

      // 仅存活 bm-alive 此刻回写（!b.deletedAt 守卫）
      expect(store.bookmarkMap['bm-alive'].attributes.a1).toBe(true)
      // bm-dead 仍软删，此刻不回写（属性不可见给软删体是正确语义）
      expect(store.bookmarkMap['bm-dead'].attributes.a1).toBeUndefined()
      // r10-attr-restore B1 真 bug 复现：旧实现末尾无条件清缓存 → bm-dead 的 membership 丢失。
      // 正确行为：remaining 仍含 bm-dead，缓存保留待其自身 restore 时由 helper 回填
      const remaining = store._deletedAttrMemberships.get('a1')
      expect(remaining?.length).toBe(1)
      expect(remaining?.[0]?.entityId).toBe('bm-dead')

      // 关键：后续恢复 bm-dead 时拿回 [a1]:true（旧 bug 此处永远 undefined）
      store.restoreBookmark('bm-dead')
      expect(store.bookmarkMap['bm-dead'].attributes.a1).toBe(true)
      expect(store._changedFields.get('bm-dead')?.has('attributes')).toBe(true)
      // bm-dead 被消化后缓存清空
      expect(store._deletedAttrMemberships.get('a1')).toBeUndefined()
    })

    it('恢复属性：成员是组时，软删组后续 restoreGroup 回填 attributes（B1 对称面）', () => {
      store.addAttribute({ id: 'a1', name: '标签', type: 'boolean' } as any)
      store.addBookmark({ id: 'bm-alive', title: 'a', url: 'https://a.com', attributes: { a1: true } } as any)
      store.addGroup({ id: 'g-dead', name: 'G', bookmarkIds: [], attributes: { a1: true } } as any)
      store.deleteGroup('g-dead')
      store.deleteAttribute('a1')
      store.drainDirtyIds()

      store.restoreAttribute('a1')
      // g-dead 仍软删，此刻不回写，缓存保留其 membership
      expect(store.groupMap['g-dead'].attributes.a1).toBeUndefined()
      expect(store._deletedAttrMemberships.get('a1')?.some(m => m.entityId === 'g-dead' && m.kind === 'group')).toBe(true)

      store.restoreGroup('g-dead')
      // 组恢复时通过 helper 拿回 [a1]:true
      expect(store.groupMap['g-dead'].attributes.a1).toBe(true)
      expect(store._deletedAttrMemberships.get('a1')).toBeUndefined()
    })

    it('恢复属性：成员此刻仍软删、属性本体也仍软删时，restoreBookmark 不强行回填（避免给活体打回收站属性键）', () => {
      store.addAttribute({ id: 'a1', name: '标签', type: 'boolean' } as any)
      store.addBookmark({ id: 'bm', title: 'a', url: 'https://a.com', attributes: { a1: true } } as any)
      store.deleteAttribute('a1') // 属性软删前快照 bm；缓存含 bm
      store.deleteBookmark('bm') // 成员软删
      store.drainDirtyIds()

      // 属性本体未恢复，先恢复成员：helper 因 _attrMap[a1].deletedAt 跳过回填
      store.restoreBookmark('bm')
      expect(store.bookmarkMap['bm'].attributes.a1).toBeUndefined()
      // membership 仍留缓存待属性恢复
      expect(store._deletedAttrMemberships.get('a1')?.length).toBe(1)

      // 属性后恢复：此刻成员已活，restoreAttribute 回写它（另一条消化路径）
      store.restoreAttribute('a1')
      expect(store.bookmarkMap['bm'].attributes.a1).toBe(true)
      expect(store._deletedAttrMemberships.get('a1')).toBeUndefined()
    })

    it('permanentDeleteBookmark 清理 _deletedAttrMemberships 残留 membership（防缓存泄漏）', () => {
      store.addAttribute({ id: 'a1', name: '标签', type: 'boolean' } as any)
      store.addBookmark({ id: 'bm', title: 'a', url: 'https://a.com', attributes: { a1: true } } as any)
      store.addBookmark({ id: 'bm2', title: 'b', url: 'https://b.com', attributes: { a1: true } } as any)
      store.deleteAttribute('a1') // 快照含 bm + bm2
      store.drainDirtyIds()
      expect(store._deletedAttrMemberships.get('a1')?.length).toBe(2)

      store.permanentDeleteBookmark('bm') // bm 永久删，应从 membership 消去
      const remaining = store._deletedAttrMemberships.get('a1')
      expect(remaining?.map(m => m.entityId)).toEqual(['bm2'])
    })

    it('permanentDeleteGroup 清理 _deletedAttrMemberships 残留 membership', () => {
      store.addAttribute({ id: 'a1', name: '标签', type: 'boolean' } as any)
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [], attributes: { a1: true } } as any)
      store.addGroup({ id: 'g2', name: 'G2', bookmarkIds: [], attributes: { a1: true } } as any)
      store.deleteAttribute('a1')
      store.drainDirtyIds()

      store.permanentDeleteGroup('g1')
      expect(store._deletedAttrMemberships.get('a1')?.map(m => m.entityId)).toEqual(['g2'])
    })

    it('恢复属性：快照为空（无持有方）时不回写不抛，仍清 _deletedAttrMemberships 真链', () => {
      store.addAttribute({ id: 'a1', name: '标签', type: 'boolean' } as any)
      // 无任何实体持有 a1，deleteAttribute 时 members.length===0 不写 _deletedAttrMemberships
      store.deleteAttribute('a1')
      expect(store._deletedAttrMemberships.get('a1')).toBeUndefined()

      expect(() => store.restoreAttribute('a1')).not.toThrow()
      // _restoreItem 已把 deletedAt 删了（属性本体恢复），但无成员回写
      expect(store.attributeMap['a1'].deletedAt).toBeUndefined()
    })

    it('恢复属性后 searchIndexDirty=true（attributes 影响搜索/过滤需重建索引）', () => {
      store.addAttribute({ id: 'a1', name: '标签', type: 'boolean' } as any)
      store.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com', attributes: { a1: true } } as any)
      store.deleteAttribute('a1')
      store.drainDirtyIds()
      store._searchIndexDirty = false // 隔离

      store.restoreAttribute('a1')

      expect(store._searchIndexDirty).toBe(true)
    })

    it('属性本体恢复：deletedAt 删除 + _attrMap 同步（_restoreItem 通用语义）', () => {
      store.addAttribute({ id: 'a1', name: '标签', type: 'boolean' } as any)
      store.deleteAttribute('a1')
      expect(store.attributeMap['a1'].deletedAt).toBeDefined()
      store.drainDirtyIds()

      store.restoreAttribute('a1')

      expect(store.attributeMap['a1'].deletedAt).toBeUndefined()
      expect(store._dirtyIds.has('a1')).toBe(true)
    })
  })

  describe('restore 编排与 _deletedIds 隔离', () => {
    it('restore 软删恢复不影响 _deletedIds（永久删队列，软删恢复与永久删解耦）', () => {
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [] } as any)
      store.deleteGroup('g1')
      // 软删恢复前 _deletedIds 不应因 restore 产生项（仅 permanentDelete* 入队）
      const beforeDeleted = store._deletedIds.size
      store.restoreGroup('g1')
      expect(store._deletedIds.size).toBe(beforeDeleted)
      expect(store._deletedIds.get('g1')).toBeUndefined()
    })
  })
})
