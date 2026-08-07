import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { preloadSearchLibs } from '../../lib/search.js'

// filteredBookmarks/filteredGroups getter 求值不直接调 preloadSearchLibs 之外的 Fuse 侧，
// 但 store 初始化侧链（bookmarkMap 等）经由同 data-map-getters.test 口径，保险 preload。
beforeAll(async () => {
  await preloadSearchLibs()
})

/**
 * ab9f0fef9d18c9f9b Explore 缺口 #7（D2 search 立即性副反应护栏）：
 * `filteredBookmarks`/`filteredGroups` getter（data.ts:167-194 / 201-219）在
 * `q.trim()` 搜索分支内含一刻意 Vue 反模式副作用：
 *   if (state._searchIndexDirty) { state._searchVersion++; state._searchIndexDirty = false }
 *
 * 立即性语义（AUDIT-R11 刻意权衡，非可随意消除）：
 *   CRUD action（addBookmark/updateBookmark/...）末尾仅设 `_searchIndexDirty=true` 不递增 version。
 *   version 递增唯一时机即本 getter 求值时——首条脏搜索立即拿新 version 传 searchBookmarkIds，
 *   触发 `version !== _bmVersion` → Fuse 重建，返回新索引结果。
 *   若改为「写 action 末尾 debounced bump(setTimeout 0)」，Vue 调度 flush effect（微任务）早于
 *   setTimeout 0（宏任务），getter 首次求值时 version 仍旧 → 走 Fuse 缓存返回旧结果（搜索框闪旧值一 tick）。
 *
 * 此前现状：data-debounced-bump-search.test.ts L198-210 注释声称锁「getter 看到 dirty 会额外 +1」，
 * 但实际用例只测了 debounced bump 不消费 dirty（L209 仍 expect(_searchIndexDirty).toBe(true)）——
 * 「getter 求值消费 dirty 并 +1」这条副反应真路径零直接断言。本文件直锁该路径。
 *
 * 纯加测试零逻辑改动：getter 已暴露，state 内部字段经 store 实例可达，不改任何源文件。
 */
describe('DataStore filteredBookmarks/filteredGroups getter _searchIndexDirty 副反应护栏（ab9#7）', () => {
  let store: ReturnType<typeof useDataStore>
  let ui: ReturnType<typeof useUIStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDataStore()
    ui = useUIStore()
    // 预置一条可被搜索命中的书签（github）
    store.bookmarks = [
      { id: 'b1', title: 'GitHub', url: 'https://github.com', categoryId: 'c1', attributes: {}, parentId: null } as any,
    ]
    store._bmMap['b1'] = store.bookmarks[0]
  })

  afterEach(() => {
    if (store._searchVersionTimer) {
      clearTimeout(store._searchVersionTimer)
      store._searchVersionTimer = null
    }
    vi.useRealTimers()
  })

  describe('CRUD 末尾只设 dirty 不递增 version（副反应触发面前置）', () => {
    it('addBookmark 后 _searchIndexDirty=true 且 _searchVersion 未递增', () => {
      const before = store._searchVersion
      expect(store._searchIndexDirty).toBe(false)
      store.addBookmark({
        id: 'b2', title: 'Google', url: 'https://google.com', categoryId: 'c1', attributes: {}, parentId: null,
      } as any)
      // CRUD 末尾设 dirty
      expect(store._searchIndexDirty).toBe(true)
      // CRUD 不递增 version（递增唯一时机是 getter 求值）
      expect(store._searchVersion).toBe(before)
    })
  })

  describe('filteredBookmarks getter 求值消费 dirty 副反应（核心缺失路径）', () => {
    it('searchQuery 非空 + dirty=true：getter 求值后 _searchVersion +1 且 _searchIndexDirty 归 false', () => {
      // 经真 CRUD 把 dirty 设 true（更真实的护栏，非手动 mutate）
      store.addBookmark({
        id: 'b2', title: 'Google', url: 'https://google.com', categoryId: 'c1', attributes: {}, parentId: null,
      } as any)
      expect(store._searchIndexDirty).toBe(true)

      const before = store._searchVersion
      ui.searchQuery = 'git' // 进 q.trim() 搜索分支
      // 触发 getter 求值（值本身不未消费，只为驱动副反应）
      void store.filteredBookmarks

      // 副反应：version 递增恰好 1
      expect(store._searchVersion).toBe(before + 1)
      // 副反应：dirty 被消费归 false（守护防无限递归）
      expect(store._searchIndexDirty).toBe(false)
    })

    it('dirty=false 时 getter 求值不再递增 version（锁每次求值 ++ 误改）', () => {
      ui.searchQuery = 'git'
      // 首次求值（dirty=false 初始态）不应递增
      const before = store._searchVersion
      void store.filteredBookmarks
      expect(store._searchVersion).toBe(before)
      expect(store._searchIndexDirty).toBe(false)
      // 第二次求值仍不递增
      void store.filteredBookmarks
      expect(store._searchVersion).toBe(before)
    })

    it('searchQuery 空（q.trim() 假）时 getter 不触发副反应（锁副反应仅在搜索分支内）', () => {
      store.addBookmark({
        id: 'b2', title: 'Google', url: 'https://google.com', categoryId: 'c1', attributes: {}, parentId: null,
      } as any)
      expect(store._searchIndexDirty).toBe(true)

      const before = store._searchVersion
      ui.searchQuery = '' // 不进搜索分支
      void store.filteredBookmarks

      // 不进 q.trim() 分支 → 不触碰 dirty 副反应
      expect(store._searchVersion).toBe(before)
      // dirty 保持 true（仅搜索分支消费）
      expect(store._searchIndexDirty).toBe(true)
    })

    it('连续两次 CRUD 后第二次 getter 求值再次消费 dirty +1（dirty 守护防无限递归 + 每轮消费正确）', () => {
      ui.searchQuery = 'git'
      // 第一轮：设 dirty → 求值消费 → dirty 归 false、version +1
      store.addBookmark({
        id: 'b2', title: 'Google', url: 'https://google.com', categoryId: 'c1', attributes: {}, parentId: null,
      } as any)
      const v0 = store._searchVersion
      void store.filteredBookmarks
      expect(store._searchVersion).toBe(v0 + 1)
      expect(store._searchIndexDirty).toBe(false)

      // 第二轮：再次 CRUD 设 dirty → 再次求值再次 +1
      store.addBookmark({
        id: 'b3', title: 'GitLab', url: 'https://gitlab.com', categoryId: 'c1', attributes: {}, parentId: null,
      } as any)
      expect(store._searchIndexDirty).toBe(true)
      const v1 = store._searchVersion
      void store.filteredBookmarks
      expect(store._searchVersion).toBe(v1 + 1)
      expect(store._searchIndexDirty).toBe(false)
    })

    it('副反应递增的 version 真传入 searchBookmarkIds 触发 Fuse 重建（立即性语义）', async () => {
      // 用 spy 锁定传入 searchBookmarkIds 的 version 即副反应 +1 后的新 version
      const searchLib = await import('../../lib/search.js')
      const spy = vi.spyOn(searchLib, 'searchBookmarkIds')

      store.addBookmark({
        id: 'b2', title: 'Google', url: 'https://google.com', categoryId: 'c1', attributes: {}, parentId: null,
      } as any)
      const before = store._searchVersion
      ui.searchQuery = 'git'
      void store.filteredBookmarks

      // 副反应已让 _searchVersion +1
      const after = store._searchVersion
      expect(after).toBe(before + 1)
      // searchBookmarkIds 收到的 version 入参即新 version（立即性：脏搜索首求值即用新 version）
      expect(spy).toHaveBeenCalled()
      const versionArg = spy.mock.calls[0][3]
      expect(versionArg).toBe(after)
      spy.mockRestore()
    })
  })

  describe('filteredGroups getter 求值同款 dirty 副反应（data.ts:208 对称）', () => {
    beforeEach(() => {
      // 预置一条 siblingGroup 供 filteredGroups 搜索
      store.siblingGroups = [
        { id: 'g1', name: 'AI Tools', categoryId: 'c1', bookmarkIds: [], attributes: {}, order: 0 } as any,
      ]
      store._grpMap['g1'] = store.siblingGroups[0]
    })

    it('searchQuery 非空 + dirty=true：filteredGroups 求值后 version +1 且 dirty→false', () => {
      // addGroup 末尾也设 _searchIndexDirty=true（data.ts:544）
      store.addGroup({
        id: 'g2', name: 'Dev Tools', categoryId: 'c1', bookmarkIds: [], attributes: {}, order: 1,
      } as any)
      expect(store._searchIndexDirty).toBe(true)

      const before = store._searchVersion
      ui.searchQuery = 'tool'
      void store.filteredGroups

      expect(store._searchVersion).toBe(before + 1)
      expect(store._searchIndexDirty).toBe(false)
    })

    it('searchQuery 空：filteredGroups 不触发副反应', () => {
      store.addGroup({
        id: 'g2', name: 'Dev Tools', categoryId: 'c1', bookmarkIds: [], attributes: {}, order: 1,
      } as any)
      const before = store._searchVersion
      ui.searchQuery = ''
      void store.filteredGroups
      expect(store._searchVersion).toBe(before)
      expect(store._searchIndexDirty).toBe(true)
    })

    it('filteredGroups 副反应递增的 version 真传入 searchGroupIds 触发重建', async () => {
      const searchLib = await import('../../lib/search.js')
      const spy = vi.spyOn(searchLib, 'searchGroupIds')

      store.addGroup({
        id: 'g2', name: 'Dev Tools', categoryId: 'c1', bookmarkIds: [], attributes: {}, order: 1,
      } as any)
      const before = store._searchVersion
      ui.searchQuery = 'tool'
      void store.filteredGroups

      const after = store._searchVersion
      expect(after).toBe(before + 1)
      expect(spy).toHaveBeenCalled()
      const versionArg = spy.mock.calls[0][4]
      expect(versionArg).toBe(after)
      spy.mockRestore()
    })
  })

  describe('filteredBookmarks 与 filteredGroups 同 tick 求值不双计（dirty 一次性消费）', () => {
    it('同 tick 先 filteredBookmarks 再 filteredGroups：第二次求值 dirty 已 false 不再 +1', () => {
      store.siblingGroups = [
        { id: 'g1', name: 'AI Tools', categoryId: 'c1', bookmarkIds: [],
          attributes: {}, order: 0 } as any,
      ]
      store._grpMap['g1'] = store.siblingGroups[0]

      store.addBookmark({
        id: 'b2', title: 'Google', url: 'https://google.com', categoryId: 'c1', attributes: {}, parentId: null,
      } as any)
      expect(store._searchIndexDirty).toBe(true)

      ui.searchQuery = 'git'
      const before = store._searchVersion
      void store.filteredBookmarks
      const mid = store._searchVersion
      expect(mid).toBe(before + 1)
      expect(store._searchIndexDirty).toBe(false)

      // 同 tick 再求 filteredGroups：dirty 已 false → 不再递增
      void store.filteredGroups
      expect(store._searchVersion).toBe(mid)
      expect(store._searchIndexDirty).toBe(false)
    })
  })
})
