/**
 * 行为契约护栏：togglePin 置顶切换编排
 *
 * Explore agentId a24b8b3c64e00e66a 逐函数覆盖率深度核出真缺口 #5：
 * togglePin(entityType, id) 是右键菜单「置顶/取消置顶」用户可见唯一入口
 * （ContextMenu.vue:136/175 + useApp.ts:50/68 经 store 调），全目录 0 直测——
 * syncMapping.test.ts:118 仅一行注释引用 pinnedAt 跨端序列化未直触 togglePin 编排；
 * pinnedAt 字段在多处排序/schema 用例出现，但 togglePin action 本体的
 * toggle 语义（undefined↔Date.now）+ _trackChange('pinnedAt') + _saveLocalHistory
 * + _markDirty + updatedAt + _searchIndexDirty 编排契约此前零护栏。
 *
 * 纯加测试零源文件改动：togglePin 经 useDataStore() return 暴露，不改 data.ts。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { preloadSearchLibs } from '../../lib/search.js'
import { __testHistDebounce } from '../../stores/data.js'

beforeAll(async () => {
  await preloadSearchLibs()
})

describe('togglePin 行为契约护栏', () => {
  let store: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDataStore()
    useUIStore()
    __testHistDebounce.clear()
  })

  describe('bookmark 置顶切换', () => {
    it('首次置顶：pinnedAt 由 undefined → Date.now()，记 dirty + trackChange', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(1700000000000))
      store.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com' } as any)
      expect(store.bookmarkMap['bm1'].pinnedAt).toBeUndefined()
      store.drainDirtyIds() // 隔离 add 留下的 dirty

      store.togglePin('bookmark', 'bm1')

      expect(store.bookmarkMap['bm1'].pinnedAt).toBe(1700000000000)
      expect(store.bookmarkMap['bm1'].updatedAt).toBe(1700000000000)
      expect(store._dirtyIds.has('bm1')).toBe(true)
      expect(store._changedFields.get('bm1')?.has('pinnedAt')).toBe(true)
      expect(store._searchIndexDirty).toBe(true)
      vi.useRealTimers()
    })

    it('二次切换：已置顶 → 取消（pinnedAt 置 undefined），不抛', () => {
      store.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com', pinnedAt: 1700000000000 } as any)
      store.drainDirtyIds()
      expect(store.bookmarkMap['bm1'].pinnedAt).toBe(1700000000000)

      store.togglePin('bookmark', 'bm1')

      expect(store.bookmarkMap['bm1'].pinnedAt).toBeUndefined()
      expect(store._dirtyIds.has('bm1')).toBe(true)
      expect(store._changedFields.get('bm1')?.has('pinnedAt')).toBe(true)
    })

    it('pinnedAt=0 falsy 边界：视为未置顶，切换后置 Date.now', () => {
      store.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com', pinnedAt: 0 } as any)
      store.drainDirtyIds()
      expect(store.bookmarkMap['bm1'].pinnedAt).toBe(0)

      store.togglePin('bookmark', 'bm1')

      // pinnedAt=0 是 falsy，按 `bm.pinnedAt ? undefined : Date.now()` 走"置顶"分支
      expect(typeof store.bookmarkMap['bm1'].pinnedAt).toBe('number')
      expect(store.bookmarkMap['bm1'].pinnedAt).toBeGreaterThan(0)
    })

    it('不存在的 bookmark id：静默不抛，状态不变', () => {
      expect(() => store.togglePin('bookmark', 'no-such')).not.toThrow()
      expect(store.bookmarks).toHaveLength(0)
    })

    it('_saveLocalHistory 布置防抖：togglePin 后 __testHistDebounce 暂存该 id 旧态 + timer', () => {
      vi.useFakeTimers()
      store.addBookmark({ id: 'bm1', title: 'orig', url: 'https://a.com', pinnedAt: 1700000000000 } as any)
      store.drainDirtyIds()
      expect(__testHistDebounce.has('bm1')).toBe(false)

      store.togglePin('bookmark', 'bm1') // 取消置顶，_saveLocalHistory 应留存原 pinnedAt=1700000000000 旧态

      // _saveLocalHistory 经模块级 Map 暂存历史旧态 + 布置防抖 timer（D1-31 钩子口径）
      expect(__testHistDebounce.has('bm1')).toBe(true)
      const peek = __testHistDebounce.peekSize()
      expect(peek.timers).toBeGreaterThanOrEqual(1)
      expect(peek.data).toBeGreaterThanOrEqual(1)
      // 真契约：取消后 pinnedAt 已置 undefined
      expect(store.bookmarkMap['bm1'].pinnedAt).toBeUndefined()
      vi.runOnlyPendingTimers() // 触发防抖回调写 localStorage 历史
      vi.useRealTimers()
    })
  })

  describe('group 置顶切换', () => {
    it('首次置顶：pinnedAt 由 undefined → Date.now()，记 dirty + trackChange', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(1800000000000))
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [] } as any)
      store.drainDirtyIds()
      expect(store.groupMap['g1'].pinnedAt).toBeUndefined()

      store.togglePin('group', 'g1')

      expect(store.groupMap['g1'].pinnedAt).toBe(1800000000000)
      expect(store.groupMap['g1'].updatedAt).toBe(1800000000000)
      expect(store._dirtyIds.has('g1')).toBe(true)
      expect(store._changedFields.get('g1')?.has('pinnedAt')).toBe(true)
      expect(store._searchIndexDirty).toBe(true)
      vi.useRealTimers()
    })

    it('二次切换：已置顶 → 取消（pinnedAt 置 undefined）', () => {
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [], pinnedAt: 1800000000000 } as any)
      store.drainDirtyIds()
      store.togglePin('group', 'g1')
      expect(store.groupMap['g1'].pinnedAt).toBeUndefined()
      expect(store._changedFields.get('g1')?.has('pinnedAt')).toBe(true)
    })

    it('group.pinnedAt=null 边界：null falsy 视为未置顶，切换后置 Date.now', () => {
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [], pinnedAt: null } as any)
      store.drainDirtyIds()
      store.togglePin('group', 'g1')
      expect(typeof store.groupMap['g1'].pinnedAt).toBe('number')
    })

    it('不存在的 group id：静默不抛', () => {
      expect(() => store.togglePin('group', 'no-such')).not.toThrow()
      expect(store.siblingGroups).toHaveLength(0)
    })
  })

  describe('跨实体隔离', () => {
    it('toggle bookmark 不影响 group，反之亦然', () => {
      store.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com' } as any)
      store.addGroup({ id: 'g1', name: 'G', bookmarkIds: [] } as any)
      store.drainDirtyIds()

      store.togglePin('bookmark', 'bm1')

      // 仅 bm1 置顶，g1 不受影响
      expect(store.bookmarkMap['bm1'].pinnedAt).toBeGreaterThan(0)
      expect(store.groupMap['g1'].pinnedAt).toBeUndefined()
      // dirty/trackChange 仅命 bm1
      expect(store._changedFields.get('bm1')?.has('pinnedAt')).toBe(true)
      expect(store._changedFields.get('g1')).toBeUndefined()
    })
  })
})
