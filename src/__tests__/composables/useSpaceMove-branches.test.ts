/**
 * useSpaceMove-branches.test.ts — 移入私密空间分支补测
 *
 * 既有 useSpaceMove.test.ts 只锁三个 async 动作的基本正路径（单卡/批量/子递归/整分类/组），
 * useSpaceMoveHelpers.test.ts 锁 _mergeById/_attrIdsUsed 纯函数。本文件补未测分支：
 * - _clean 剥离 `_` 前缀运行时脏字段（私密数据集不应含 _changedFields 等运行时态）
 * - _persistIntoVault 的 customAttributes 随迁（书签/组引用的 attr 一并并入密空间）
 * - moveBookmarksToVault 各早退（空 ids / 无命中书签）+ 组全员命中整组迁入并删组
 * - moveCategoryToVault cat 不存在早退 + 组跨分类引用书签纳入迁入 + 删组
 * - moveGroupsToVault 空 ids / groupMap 查无结果早退
 * - moveBatchSelectedToVault 整函数（既有测完全未触达）：group: 前缀分流 + 私密空间内早退 + 空批量早退 + 混合批量
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import {
  useSpaceMove,
  moveBatchSelectedToVault,
} from '../../composables/domain/useSpaceMove.js'
import { STORAGE_KEY_VAULT } from '../../config/constants.js'
import { preloadSearchLibs } from '../../lib/search.js'

// 隔离 IDB（jsdom 无 IndexedDB）：vault idbKey 模拟真实 IDB 自写自读（idbGet 返回上次 idbSet 存的值），
// 使跨多次 spaceMove 调用时私密数据集可在 IDB 层往返（loadFromIDB 走 idbGet 读回上次 saveData 的 stamped）。
// idbGet 返回的 stamped 结构含 bookmarks 数组即满足 loadFromIDB 的结构性守门。
const _idbStore: Record<string, any> = {}
vi.mock('../../stores/storage.js', () => ({
  idbGet: vi.fn(async (key: string) => _idbStore[key] ?? null),
  idbSet: vi.fn(async (key: string, val: any) => { _idbStore[key] = val; return true }),
  localHistoryKey: vi.fn(() => 'lv_history_test'),
}))

// app.saveAppData 经 facade 走当前空间落盘；空间移动测里主页数据落盘走真实路径即可
vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(async () => true),
}))

beforeAll(async () => {
  await preloadSearchLibs()
})

function readVault(): any {
  const raw = localStorage.getItem(STORAGE_KEY_VAULT)
  return raw ? JSON.parse(raw) : null
}

describe('useSpaceMove - 分支补测', () => {
  let dataStore: ReturnType<typeof useDataStore>
  let uiStore: ReturnType<typeof useUIStore>
  let spaceMove: ReturnType<typeof useSpaceMove>

  beforeEach(() => {
    setActivePinia(createPinia())
    // 清 IDB 模拟存储，防跨测污染（同一进程多次 spaceMove 调用共享此存储）
    for (const k of Object.keys(_idbStore)) delete _idbStore[k]
    dataStore = useDataStore()
    uiStore = useUIStore()
    spaceMove = useSpaceMove()
  })

  describe('moveBookmarksToVault 早退 + 组全员迁入', () => {
    it('空 ids 数组直接早退：不读 vault 不删不写不 toast', async () => {
      await spaceMove.moveBookmarksToVault([])
      expect(readVault()).toBeNull()
    })

    it('ids 全部不在 bookmarkMap：无书签收集早退（_assertMain 通过但 bms 为空）', async () => {
      await spaceMove.moveBookmarksToVault(['ghost1', 'ghost2'])
      // 无书签可移入 → 不写 vault
      expect(readVault()).toBeNull()
    })

    it('_clean 剥离书签 `_` 前缀运行时脏字段：私密数据集不含 _changedFields', async () => {
      // addBookmark 不接受 _ 字段，直接 patch 注入运行时态
      dataStore.addBookmark({ id: 'b1', title: '脏态书签', url: 'u', categoryId: 'all' } as any)
      const b = dataStore.bookmarkMap['b1']
      ;(b as any)._changedFields = ['title']
      ;(b as any)._dirty = true
      dataStore._syncMaps()
      await spaceMove.moveBookmarksToVault(['b1'])
      const vaultData = readVault()
      const moved = vaultData.bookmarks.find((x: any) => x.id === 'b1')
      expect(moved._changedFields).toBeUndefined()
      expect(moved._dirty).toBeUndefined()
    })

    it('组全员命中迁入：被移书签恰好覆盖某组全部成员 → 整组迁入私密 + 主页删组', async () => {
      dataStore.addBookmark({ id: 'm1', title: '成员1', url: 'u1', categoryId: 'all' } as any)
      dataStore.addBookmark({ id: 'm2', title: '成员2', url: 'u2', categoryId: 'all' } as any)
      dataStore.addGroup({
        id: 'g1', name: '全员组', categoryId: 'all', icon: '', order: 0,
        isExpanded: false, attributes: {}, bookmarkIds: ['m1', 'm2'], notes: '', useCount: 0,
      } as any)
      dataStore._syncMaps()
      await spaceMove.moveBookmarksToVault(['m1', 'm2'])
      // 组主页删除
      expect(dataStore.groupMap['g1']).toBeUndefined()
      // 组迁入私密
      const vaultData = readVault()
      expect(vaultData.siblingGroups.some((g: any) => g.id === 'g1')).toBe(true)
      const movedGroup = vaultData.siblingGroups.find((g: any) => g.id === 'g1')
      // _clean 后 bookmarkIds 保留（非 _ 前缀）
      expect(movedGroup.bookmarkIds).toEqual(['m1', 'm2'])
    })

    it('组部分成员命中不迁入：仅移入一个成员 → 组留在主页', async () => {
      dataStore.addBookmark({ id: 'm1', title: '成员1', url: 'u1', categoryId: 'all' } as any)
      dataStore.addBookmark({ id: 'm2', title: '成员2', url: 'u2', categoryId: 'all' } as any)
      dataStore.addGroup({
        id: 'g1', name: '部分组', categoryId: 'all', icon: '', order: 0,
        isExpanded: false, attributes: {}, bookmarkIds: ['m1', 'm2'], notes: '', useCount: 0,
      } as any)
      dataStore._syncMaps()
      await spaceMove.moveBookmarksToVault(['m1'])
      // 仅 m1 移入，组留在主页
      expect(dataStore.groupMap['g1']).toBeDefined()
      const vaultData = readVault()
      expect(vaultData.siblingGroups.some((g: any) => g.id === 'g1')).toBe(false)
    })
  })

  describe('moveCategoryToVault 早退 + 组跨分类引用 + 删组', () => {
    it('cat 不存在早退：虚拟守门通过但 categoryMap 查无结果不改 vault', async () => {
      await spaceMove.moveCategoryToVault('nonexistent-cat')
      expect(readVault()).toBeNull()
    })

    it('空 catId 早退（!catId 分支）', async () => {
      await spaceMove.moveCategoryToVault('')
      expect(readVault()).toBeNull()
    })

    it('分类下含组：整组随分类迁入 + 主页删组（删组分支）', async () => {
      dataStore.addCategory({ id: 'cat1', name: '工作', icon: 'w', color: '#fff', order: 1 } as any)
      dataStore.addBookmark({ id: 'b1', title: '工书1', url: 'u1', categoryId: 'cat1' } as any)
      dataStore.addBookmark({ id: 'b2', title: '工书2', url: 'u2', categoryId: 'cat1' } as any)
      dataStore.addGroup({
        id: 'g1', name: '工组', categoryId: 'cat1', icon: '', order: 0,
        isExpanded: false, attributes: {}, bookmarkIds: ['b1', 'b2'], notes: '', useCount: 0,
      } as any)
      dataStore._syncMaps()
      await spaceMove.moveCategoryToVault('cat1')
      // 组从主页删除（line 195）
      expect(dataStore.groupMap['g1']).toBeUndefined()
      const vaultData = readVault()
      expect(vaultData.siblingGroups.some((g: any) => g.id === 'g1')).toBe(true)
    })

    it('组跨分类引用的书签一并纳入迁入集合（改挂未分类）：该跨分类书签从主页删除', async () => {
      dataStore.addCategory({ id: 'cat1', name: '工作', icon: 'w', color: '#fff', order: 1 } as any)
      dataStore.addCategory({ id: 'cat2', name: '其他', icon: 'o', color: '#000', order: 2 } as any)
      dataStore.addBookmark({ id: 'b1', title: '工书', url: 'u1', categoryId: 'cat1' } as any)
      // 跨分类书签 b2 属 cat2，但被 cat1 的组引用
      dataStore.addBookmark({ id: 'b2', title: '跨类书签', url: 'u2', categoryId: 'cat2' } as any)
      dataStore.addGroup({
        id: 'g1', name: '跨类组', categoryId: 'cat1', icon: '', order: 0,
        isExpanded: false, attributes: {}, bookmarkIds: ['b1', 'b2'], notes: '', useCount: 0,
      } as any)
      dataStore._syncMaps()
      await spaceMove.moveCategoryToVault('cat1')
      // 跨分类书签 b2 也从主页删除（被纳入迁入集合）
      expect(dataStore.bookmarkMap['b2']).toBeUndefined()
      const vaultData = readVault()
      // b2 改挂未分类（CAT_UNCATEGORIZED），不归本分类 cat1
      const movedB2 = vaultData.bookmarks.find((b: any) => b.id === 'b2')
      expect(movedB2).toBeDefined()
      expect(movedB2.categoryId).toBe('uncategorized')
      expect(movedB2.parentId).toBeNull()
    })

    it('分类下含软删书签：被排除不迁入（!b.deletedAt 过滤分支）', async () => {
      dataStore.addCategory({ id: 'cat1', name: '工作', icon: 'w', color: '#fff', order: 1 } as any)
      dataStore.addBookmark({ id: 'b1', title: '活书签', url: 'u1', categoryId: 'cat1' } as any)
      dataStore.addBookmark({ id: 'b2', title: '软删书签', url: 'u2', categoryId: 'cat1' } as any)
      // 模拟软删：b2 软删后既不在 cat1 rootBms（!b.deletedAt 滤除），也不应被 _syncMaps 软删逻辑纳入
      const b2 = dataStore.bookmarkMap['b2']
      ;(b2 as any).deletedAt = Date.now()
      dataStore._syncMaps()
      await spaceMove.moveCategoryToVault('cat1')
      const vaultData = readVault()
      // 软删 b2 不进私密
      expect(vaultData.bookmarks.some((b: any) => b.id === 'b2')).toBe(false)
      expect(vaultData.bookmarks.some((b: any) => b.id === 'b1')).toBe(true)
    })
  })

  describe('moveGroupsToVault 早退 + bookmarkIds 兜底', () => {
    it('空 ids 数组直接早退：不读 vault 不写', async () => {
      await spaceMove.moveGroupsToVault([])
      expect(readVault()).toBeNull()
    })

    it('groupMap 查无结果早退：ids 全非法不删不写', async () => {
      await spaceMove.moveGroupsToVault(['ghostG1', 'ghostG2'])
      expect(readVault()).toBeNull()
    })

    it('组 bookmarkIds 为 undefined 走 ||[] 兜底：不抛 TypeError，组无成员仅迁空组', async () => {
      // 旧数据组可能缺 bookmarkIds 字段，源码三处用 g.bookmarkIds || [] 兜底防 TypeError
      dataStore.addGroup({
        id: 'g1', name: '无成员组', categoryId: 'all', icon: '', order: 0,
        isExpanded: false, attributes: {}, bookmarkIds: undefined as any, notes: '', useCount: 0,
      } as any)
      dataStore._syncMaps()
      await spaceMove.moveGroupsToVault(['g1'])
      // 不抛错、组从主页删除并迁入私密（无成员书签）
      expect(dataStore.groupMap['g1']).toBeUndefined()
      const vaultData = readVault()
      expect(vaultData.siblingGroups.some((g: any) => g.id === 'g1')).toBe(true)
      expect(vaultData.bookmarks.length).toBe(0)
    })
  })

  describe('_persistIntoVault — customAttributes 随迁', () => {
    it('书签引用的 customAttribute 随迁并入私密空间', async () => {
      // 建一个 boolean 类型的自定义属性
      dataStore.addAttribute({ id: 'attr1', name: '收藏', type: 'boolean' } as any)
      dataStore.addBookmark({
        id: 'b1', title: '带属性书签', url: 'u', categoryId: 'all',
        attributes: { attr1: true },
      } as any)
      dataStore._syncMaps()
      await spaceMove.moveBookmarksToVault(['b1'])
      const vaultData = readVault()
      // customAttributes 随迁并入
      expect(vaultData.customAttributes.some((a: any) => a.id === 'attr1')).toBe(true)
      const movedAttr = vaultData.customAttributes.find((a: any) => a.id === 'attr1')
      expect(movedAttr.name).toBe('收藏')
      expect(movedAttr.type).toBe('boolean')
    })

    it('组引用的 customAttribute 随迁并入私密空间', async () => {
      dataStore.addAttribute({ id: 'attr2', name: '组属性', type: 'boolean' } as any)
      dataStore.addBookmark({ id: 'b1', title: '成员', url: 'u', categoryId: 'all' } as any)
      dataStore.addGroup({
        id: 'g1', name: '带属性组', categoryId: 'all', icon: '', order: 0,
        isExpanded: false, attributes: { attr2: true }, bookmarkIds: ['b1'], notes: '', useCount: 0,
      } as any)
      dataStore._syncMaps()
      await spaceMove.moveGroupsToVault(['g1'])
      const vaultData = readVault()
      expect(vaultData.customAttributes.some((a: any) => a.id === 'attr2')).toBe(true)
    })

    it('私密已存同 id attr 不被覆盖（_mergeById 跳过同 id）', async () => {
      // 第一次移入建立 attr1
      dataStore.addAttribute({ id: 'attr1', name: '原名', type: 'boolean' } as any)
      dataStore.addBookmark({
        id: 'b1', title: 'a', url: 'u', categoryId: 'all', attributes: { attr1: true },
      } as any)
      dataStore._syncMaps()
      await spaceMove.moveBookmarksToVault(['b1'])
      // 改 attr 名后第二次移入新书签引用同一 attr1
      const attr1 = dataStore.customAttributes.find((a: any) => a.id === 'attr1')
      ;(attr1 as any).name = '改名'
      dataStore.addBookmark({
        id: 'b2', title: 'b', url: 'u2', categoryId: 'all', attributes: { attr1: false },
      } as any)
      dataStore._syncMaps()
      await spaceMove.moveBookmarksToVault(['b2'])
      const vaultData = readVault()
      const attrs = vaultData.customAttributes.filter((a: any) => a.id === 'attr1')
      // 不重复并入（去重），且保留首次的 name
      expect(attrs.length).toBe(1)
    })
  })

  describe('moveBatchSelectedToVault（批量按钮统一入口）', () => {
    it('空 batchSelected 早退', async () => {
      await moveBatchSelectedToVault([])
      expect(readVault()).toBeNull()
    })

    it('私密空间内调用早退：toast 提示不移入', async () => {
      uiStore.curSpace = 'vault'
      await moveBatchSelectedToVault(['b1'])
      expect(readVault()).toBeNull()
    })

    it('书签批量：无 group: 前缀全部走 moveBookmarksToVault', async () => {
      dataStore.addBookmark({ id: 'b1', title: 'a', url: 'u', categoryId: 'all' } as any)
      dataStore.addBookmark({ id: 'b2', title: 'b', url: 'u2', categoryId: 'all' } as any)
      dataStore._syncMaps()
      await moveBatchSelectedToVault(['b1', 'b2'])
      expect(dataStore.bookmarkMap['b1']).toBeUndefined()
      expect(dataStore.bookmarkMap['b2']).toBeUndefined()
      const vaultData = readVault()
      expect(vaultData.bookmarks.some((b: any) => b.id === 'b1')).toBe(true)
      expect(vaultData.bookmarks.some((b: any) => b.id === 'b2')).toBe(true)
    })

    it('组批量：group: 前缀剥离走 moveGroupsToVault', async () => {
      dataStore.addBookmark({ id: 'b1', title: '成员', url: 'u', categoryId: 'all' } as any)
      dataStore.addGroup({
        id: 'g1', name: '批量组', categoryId: 'all', icon: '', order: 0,
        isExpanded: false, attributes: {}, bookmarkIds: ['b1'], notes: '', useCount: 0,
      } as any)
      dataStore._syncMaps()
      await moveBatchSelectedToVault(['group:g1'])
      expect(dataStore.groupMap['g1']).toBeUndefined()
      expect(dataStore.bookmarkMap['b1']).toBeUndefined()
      const vaultData = readVault()
      expect(vaultData.siblingGroups.some((g: any) => g.id === 'g1')).toBe(true)
    })

    it('混合批量：书签 + 组前缀分流分别迁入', async () => {
      dataStore.addBookmark({ id: 'b1', title: '游离书签', url: 'u', categoryId: 'all' } as any)
      dataStore.addBookmark({ id: 'gm1', title: '组成员', url: 'u2', categoryId: 'all' } as any)
      dataStore.addGroup({
        id: 'g1', name: '混合组', categoryId: 'all', icon: '', order: 0,
        isExpanded: false, attributes: {}, bookmarkIds: ['gm1'], notes: '', useCount: 0,
      } as any)
      dataStore._syncMaps()
      await moveBatchSelectedToVault(['b1', 'group:g1'])
      expect(dataStore.bookmarkMap['b1']).toBeUndefined()
      expect(dataStore.groupMap['g1']).toBeUndefined()
      expect(dataStore.bookmarkMap['gm1']).toBeUndefined()
      const vaultData = readVault()
      expect(vaultData.bookmarks.some((b: any) => b.id === 'b1')).toBe(true)
      expect(vaultData.siblingGroups.some((g: any) => g.id === 'g1')).toBe(true)
      expect(vaultData.bookmarks.some((b: any) => b.id === 'gm1')).toBe(true)
    })
  })
})
