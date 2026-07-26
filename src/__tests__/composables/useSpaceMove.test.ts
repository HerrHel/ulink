/**
 * useSpaceMove.test.ts — 移入私密空间逻辑测试
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useSpaceMove } from '../../composables/domain/useSpaceMove.js'
import { STORAGE_KEY_VAULT } from '../../config/constants.js'
import { preloadSearchLibs } from '../../lib/search.js'

// 隔离 IDB（jsdom 无 IndexedDB）
vi.mock('../../stores/storage.js', () => ({
  idbGet: vi.fn(async () => null),
  idbSet: vi.fn(async () => true),
  localHistoryKey: vi.fn(() => 'lv_history_test'),
}))

beforeAll(async () => {
  await preloadSearchLibs()
})

describe('useSpaceMove', () => {
  let dataStore: ReturnType<typeof useDataStore>
  let uiStore: ReturnType<typeof useUIStore>
  let spaceMove: ReturnType<typeof useSpaceMove>

  beforeEach(() => {
    setActivePinia(createPinia())
    dataStore = useDataStore()
    uiStore = useUIStore()
    spaceMove = useSpaceMove()
    // 私密空间无历史数据（localStorage.clear 由 setup.ts 处理）
  })

  describe('moveBookmarksToVault', () => {
    it('单书签移入私密空间：从主页删除、私密空间建立副本', async () => {
      dataStore.addBookmark({ id: 'b1', title: '测试', url: 't', categoryId: 'all' } as any)
      dataStore._syncMaps()
      await spaceMove.moveBookmarksToVault(['b1'])
      // 主页书签已删除（permanentDelete 使 bookmarkMap 清空）
      expect(dataStore.bookmarkMap['b1']).toBeUndefined()
      // 私密空间 localStorage 应有 vault 键数据
      const vaultRaw = localStorage.getItem(STORAGE_KEY_VAULT)
      expect(vaultRaw).not.toBeNull()
      const vaultData = JSON.parse(vaultRaw!)
      expect(vaultData.bookmarks.some((b: any) => b.id === 'b1')).toBe(true)
      // 移入的书签应挂到未分类
      const moved = vaultData.bookmarks.find((b: any) => b.id === 'b1')
      expect(moved.categoryId).toBe('uncategorized')
    })

    it('批量书签移入：全部从主页删除、私密空间含全部副本', async () => {
      dataStore.addBookmark({ id: 'b1', title: 'a', url: 'a', categoryId: 'all' } as any)
      dataStore.addBookmark({ id: 'b2', title: 'b', url: 'b', categoryId: 'all' } as any)
      dataStore._syncMaps()
      await spaceMove.moveBookmarksToVault(['b1', 'b2'])
      expect(dataStore.bookmarkMap['b1']).toBeUndefined()
      expect(dataStore.bookmarkMap['b2']).toBeUndefined()
      const vaultData = JSON.parse(localStorage.getItem(STORAGE_KEY_VAULT)!)
      expect(vaultData.bookmarks.some((b: any) => b.id === 'b1')).toBe(true)
      expect(vaultData.bookmarks.some((b: any) => b.id === 'b2')).toBe(true)
    })

    it('子书签递归移入：父+子书签一起迁入私密', async () => {
      dataStore.addBookmark({ id: 'p1', title: '父', url: 'p', categoryId: 'all' } as any)
      dataStore.addBookmark({ id: 'c1', title: '子', url: 'c', categoryId: 'all', parentId: 'p1' } as any)
      dataStore._syncMaps()
      await spaceMove.moveBookmarksToVault(['p1'])
      // 子书签也应从主页删除
      expect(dataStore.bookmarkMap['c1']).toBeUndefined()
      const vaultData = JSON.parse(localStorage.getItem(STORAGE_KEY_VAULT)!)
      expect(vaultData.bookmarks.some((b: any) => b.id === 'p1')).toBe(true)
      expect(vaultData.bookmarks.some((b: any) => b.id === 'c1')).toBe(true)
    })

    it('在私密空间内调用无意义（已私密）：不报错、不重复移入', async () => {
      uiStore.curSpace = 'vault'
      await spaceMove.moveBookmarksToVault(['nonexistent'])
      // 不崩溃、不写入额外数据
    })
  })

  describe('moveCategoryToVault', () => {
    it('整分类移入：分类+书签从主页删除、私密空间含分类结构', async () => {
      dataStore.addCategory({ id: 'cat1', name: '工作', icon: 'work', color: '#fff', order: 1 } as any)
      dataStore.addBookmark({ id: 'b1', title: '工书', url: 'w', categoryId: 'cat1' } as any)
      dataStore.addBookmark({ id: 'b2', title: '工书2', url: 'w2', categoryId: 'cat1' } as any)
      dataStore._syncMaps()
      await spaceMove.moveCategoryToVault('cat1')
      // 主页：分类和书签均已删除
      expect(dataStore.categoryMap['cat1']).toBeUndefined()
      expect(dataStore.bookmarkMap['b1']).toBeUndefined()
      expect(dataStore.bookmarkMap['b2']).toBeUndefined()
      // 私密空间：含分类和书签
      const vaultData = JSON.parse(localStorage.getItem(STORAGE_KEY_VAULT)!)
      expect(vaultData.categories.some((c: any) => c.id === 'cat1')).toBe(true)
      expect(vaultData.bookmarks.some((b: any) => b.id === 'b1')).toBe(true)
      expect(vaultData.bookmarks.some((b: any) => b.id === 'b2')).toBe(true)
    })

    it('不可移入虚拟分类（CAT_ALL/CAT_UNCATEGORIZED）', async () => {
      await spaceMove.moveCategoryToVault('all')
      await spaceMove.moveCategoryToVault('uncategorized')
      // 无操作、无崩溃
    })
  })

  describe('moveGroupsToVault', () => {
    it('组+成员书签移入私密空间', async () => {
      dataStore.addBookmark({ id: 'b1', title: '成员', url: 'b', categoryId: 'all' } as any)
      dataStore.addGroup({ id: 'g1', name: '测试组', categoryId: 'all', icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: ['b1'], notes: '', useCount: 0 } as any)
      dataStore._syncMaps()
      await spaceMove.moveGroupsToVault(['g1'])
      // 组和成员都从主页删除
      expect(dataStore.groupMap['g1']).toBeUndefined()
      expect(dataStore.bookmarkMap['b1']).toBeUndefined()
      // 私密空间含组和成员
      const vaultData = JSON.parse(localStorage.getItem(STORAGE_KEY_VAULT)!)
      expect(vaultData.siblingGroups.some((g: any) => g.id === 'g1')).toBe(true)
      expect(vaultData.bookmarks.some((b: any) => b.id === 'b1')).toBe(true)
    })
  })
})
