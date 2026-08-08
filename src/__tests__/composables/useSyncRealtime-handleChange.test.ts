/**
 * useSyncRealtime-handleChange.test.ts — realtime 变更编排核心 `_handleRealtimeChange` 行为契约护栏（精简版）
 *
 * 补 useSyncRealtime._handleRealtimeChange(L36 export async) 是 realtime 远端变更 → 本地合并编排核心,
 * 含多条真 bug 痕迹安全契约。原 35 例含 ★真契约(isReencrypting 短路防旧 cryptoKey 解新密文、G1-001
 * dirty/pending 不抹、FROM_REMOTE Zod 失败 mapped null、M2 await 前后双校验、R13 await 后复查跳过、
 * revive-assign bug 痕迹、H16 group notes silentSet)与纯镜像(isReencrypting DELETE 对称、未登录 DELETE
 * 对称、DELETE 缺 id、G1-001 pending 对称、conflict 幂等、M2 insert 未解锁、R13 pending 对称、
 * HANDLERS bookmark insert/category/attribute、group editor 不存在/相同)。
 *
 * 此精简版留 ~22 例守核心契约,删去对称镜像与已被主例覆盖的边界。
 *
 * 口径:纯加测试零源文件改动——_handleRealtimeChange 已 export 含 `_` 前缀约定私有可测。
 * 真实 decideRemoteApply / FROM_REMOTE / _deleteWithoutEcho / useDataStore / useSyncStore / useAuthStore;
 * mock 部分桩:useE2E(decryptItem spy + 可控 isUnlocked)/ debouncedSaveAppData / EditorManager。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const _e2e = vi.hoisted(() => ({
  isUnlockedRef: { value: false },
  decryptItemSpy: vi.fn(async (_t: string, item: any) => ({ ...item, _decrypted: true })),
}))
vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({ isUnlocked: _e2e.isUnlockedRef, decryptItem: _e2e.decryptItemSpy }),
}))

const _app = vi.hoisted(() => ({
  debouncedSaveAppDataSpy: vi.fn(),
  saveAppDataSpy: vi.fn(),
}))
vi.mock('../../stores/app.js', () => ({
  debouncedSaveAppData: _app.debouncedSaveAppDataSpy,
  saveAppData: _app.saveAppDataSpy,
}))

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) }) }),
    })),
  },
}))

const _editor = vi.hoisted(() => ({
  getSpy: vi.fn((): any => null),
  silentSetContentSpy: vi.fn(),
}))
vi.mock('../../lib/editor.js', () => ({
  EditorManager: { get: _editor.getSpy, silentSetContent: _editor.silentSetContentSpy },
}))

function makeRemoteBookmarkRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r-bm-1', title: '远端书签', url: 'https://remote.example.com', username: '', password: '',
    notes: '', icon: '', category_id: 'uncategorized', parent_id: null, order: 0, use_count: 0,
    attributes: {}, is_expanded: false, created_at_num: 100, updated_at_num: 200, pinned_at: null,
    deleted_at: null, user_id: 'user-abc', ...over,
  }
}
function makeRemoteGroupRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r-grp-1', name: '远端组', category_id: 'uncategorized', icon: '', order: 0, is_expanded: false,
    attributes: {}, bookmark_ids: [], notes: '', use_count: 0, is_public: false, updated_at_num: 200,
    pinned_at: null, deleted_at: null, user_id: 'user-abc', ...over,
  }
}

// seed helpers 绕开 add* 的 _markDirty(add* 会让 L230 R13 复查「dirty return」误跳过 upsert)
function seedBookmark(ds: any, b: Partial<any> & { id: string }) {
  const full = {
    title: 'seed', url: 'https://seed.example.com', username: '', password: '', notes: '', icon: '',
    categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false,
    createdAt: 1, updatedAt: 1, ...b,
  }
  ds.bookmarks.push(full)
  ds._bmMap[full.id] = full
  if (full.parentId) {
    if (!ds._childrenIdx[full.parentId]) ds._childrenIdx[full.parentId] = []
    if (ds._childrenIdx[full.parentId].indexOf(full.id) === -1) ds._childrenIdx[full.parentId].push(full.id)
  }
  return full
}
function seedGroup(ds: any, g: Partial<any> & { id: string }) {
  const full = {
    name: 'seed-group', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
    attributes: {}, bookmarkIds: [], notes: '', useCount: 0, updatedAt: 1, isPublic: false, ...g,
  }
  ds.siblingGroups.push(full)
  ds._grpMap[full.id] = full
  return full
}
function seedCategory(ds: any, c: Partial<any> & { id: string }) {
  const full = { name: 'seed-cat', icon: '', color: '', order: 0, updatedAt: 1, ...c }
  ds.categories.push(full)
  ds._catMap[full.id] = full
  return full
}
function seedAttribute(ds: any, a: Partial<any> & { id: string }) {
  const full = { name: 'seed-attr', type: 'boolean', updatedAt: 1, ...a }
  ds.customAttributes.push(full)
  ds._attrMap[full.id] = full
  return full
}

async function withAuth(userId = 'user-abc') {
  const { useAuthStore } = await import('../../stores/auth.js')
  ;(useAuthStore() as any).user = { id: userId, email: 'a@b.com' }
}

async function getDeps() {
  const { _handleRealtimeChange } = await import('../../composables/domain/useSyncRealtime.js')
  const { useDataStore } = await import('../../stores/data.js')
  const { useSyncStore } = await import('../../stores/sync.js')
  const { __testPendingSync } = await import('../../composables/domain/syncPending.js')
  return { _handleRealtimeChange, ds: useDataStore(), sync: useSyncStore(), __testPendingSync }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  _e2e.isUnlockedRef.value = false
  _e2e.decryptItemSpy.mockClear()
  _e2e.decryptItemSpy.mockImplementation(async (_t: string, item: any) => ({ ...item, _decrypted: true }))
  _app.debouncedSaveAppDataSpy.mockClear()
  _app.saveAppDataSpy.mockClear()
  _editor.getSpy.mockClear()
  _editor.getSpy.mockReturnValue(null)
  _editor.silentSetContentSpy.mockClear()
  const { __testPendingSync } = await import('../../composables/domain/syncPending.js')
  __testPendingSync.clear()
})
afterEach(async () => {
  const { __testPendingSync } = await import('../../composables/domain/syncPending.js')
  __testPendingSync.clear()
})

describe('_handleRealtimeChange — 入口守卫:isReencrypting 短路 + _getUserId 缺', () => {
  it('★isReencrypting=true 时 UPDATE/DELETE 事件被短路（重加密期间一律不处理远端变更,防旧 cryptoKey 解新密文致乱码）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, sync } = await getDeps()
    sync.setReencrypting(true)
    const addSpy = vi.spyOn(ds, 'addBookmark')
    const delSpy = vi.spyOn(ds, 'deleteBookmark')
    _e2e.isUnlockedRef.value = true

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow(), old: {} }, 'bookmark')
    await _handleRealtimeChange({ eventType: 'DELETE', new: {}, old: { id: 'r-bm-1', user_id: 'user-abc' } }, 'bookmark')

    expect(addSpy).not.toHaveBeenCalled() // 短路在所有编排前
    expect(delSpy).not.toHaveBeenCalled()
    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled()
    expect(_app.debouncedSaveAppDataSpy).not.toHaveBeenCalled()
  })

  it('★未登录（auth.user=null）UPDATE/DELETE 事件 return，不处理远端变更（_getUserId 缺契约）', async () => {
    const auth = (await import('../../stores/auth.js')).useAuthStore()
    ;(auth as any).user = null
    const { _handleRealtimeChange, ds } = await getDeps()
    _e2e.isUnlockedRef.value = true
    ds.addBookmark({ id: 'r-bm-1', title: 'x', url: 'https://a.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    const delSpy = vi.spyOn(ds, 'deleteBookmark')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow(), old: {} }, 'bookmark')
    await _handleRealtimeChange({ eventType: 'DELETE', new: {}, old: { id: 'r-bm-1', user_id: 'user-abc' } }, 'bookmark')

    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled()
    expect(delSpy).not.toHaveBeenCalled()
  })
})

describe('_handleRealtimeChange — DELETE 分支：G1-001 dirty/pending 不抹 + 正常删除', () => {
  it('★G1-001：DELETE 命中本地 dirty / pending 的项不被远端静默抹掉（本地未推编辑优先于远端软删）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, __testPendingSync } = await getDeps()
    // dirty 项
    ds.addBookmark({ id: 'b-dirty', title: 'x', url: 'https://a.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    ds._dirtyIds.add('b-dirty')
    // pending 项
    ds.addBookmark({ id: 'b-pending', title: 'x', url: 'https://a.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    __testPendingSync.add('b-pending')
    const delSpy = vi.spyOn(ds, 'deleteBookmark')

    await _handleRealtimeChange({ eventType: 'DELETE', new: {}, old: { id: 'b-dirty', user_id: 'user-abc' } }, 'bookmark')
    await _handleRealtimeChange({ eventType: 'DELETE', new: {}, old: { id: 'b-pending', user_id: 'user-abc' } }, 'bookmark')

    expect(delSpy).not.toHaveBeenCalled() // dirty 与 pending 两态都不被抹
  })

  it('正常 DELETE：无 dirty 无 pending 的项被删除（_deleteWithoutEcho 真调 deleteBookmark）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    seedBookmark(ds, { id: 'b-clean' })
    const delSpy = vi.spyOn(ds, 'deleteBookmark')

    await _handleRealtimeChange({ eventType: 'DELETE', new: {}, old: { id: 'b-clean', user_id: 'user-abc' } }, 'bookmark')

    expect(delSpy).toHaveBeenCalledWith('b-clean')
  })
})

describe('_handleRealtimeChange — FROM_REMOTE Zod 失败 mapped null return 契约', () => {
  it('★UPDATE 远端行 Zod 校验失败（缺必填 url）→ mapped null → return 不 upsert 不 decrypt', async () => {
    await withAuth()
    const { _handleRealtimeChange } = await getDeps()
    _e2e.isUnlockedRef.value = true
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteBookmarkRow({ url: undefined, title: undefined, id: 'bad' } as any), old: {} },
      'bookmark',
    )

    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled() // mapped null 短路在 decrypt 前
    warnSpy.mockRestore()
  })
})

describe('_handleRealtimeChange — decision skip/conflict/soft-delete 三分支', () => {
  it('skip：本地较新且无变更（decision skip）→ 不 decrypt 不 upsert', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, sync } = await getDeps()
    ds.addBookmark({ id: 'r-bm-1', title: '本地新', url: 'https://a.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 300 } as any)
    sync.setLastSyncAt(0)
    _e2e.isUnlockedRef.value = true

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-1' }), old: {} }, 'bookmark')

    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled()
    expect(_app.debouncedSaveAppDataSpy).not.toHaveBeenCalled()
  })

  it('★conflict：远端 newer 且本地存在且非 dirty/pending → addConflict 一次 + resetConflictBanner 不 upsert', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, sync } = await getDeps()
    // 本地 addBookmark 标 dirty + 远端 updatedAt=200 newer + lastSyncAt>0 → conflict
    ds.addBookmark({ id: 'r-bm-1', title: '本地旧', url: 'https://local.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    sync.setLastSyncAt(1000)
    const addConflictSpy = vi.spyOn(sync, 'addConflict')
    const resetBannerSpy = vi.spyOn(sync, 'resetConflictBanner')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-1' }), old: {} }, 'bookmark')

    expect(addConflictSpy).toHaveBeenCalledTimes(1)
    expect(resetBannerSpy).toHaveBeenCalledTimes(1)
    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled() // conflict 不 upsert
  })

  it('★soft-delete：远端软删（deletedAt 非 null）且非 dirty/pending → _deleteWithoutEcho + debouncedSaveAppData', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, sync } = await getDeps()
    seedBookmark(ds, { id: 'r-bm-1', title: '本地', url: 'https://a.com' })
    sync.setLastSyncAt(0)
    const delSpy = vi.spyOn(ds, 'deleteBookmark')

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-1', updated_at_num: 200, deleted_at: '2026-01-01T00:00:00.000Z' }), old: {} },
      'bookmark',
    )

    expect(delSpy).toHaveBeenCalledWith('r-bm-1')
    expect(_app.debouncedSaveAppDataSpy).toHaveBeenCalledTimes(1)
  })
})

describe('_handleRealtimeChange — M2 await 前后解锁态双校验', () => {
  it('★M2：入口未解锁（wasUnlocked=false）→ 保留密文 mapped 不调 decryptItem，仍 upsert', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    _e2e.isUnlockedRef.value = false
    const addSpy = vi.spyOn(ds, 'addBookmark')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-new' }), old: {} }, 'bookmark')

    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled()
    expect(addSpy).toHaveBeenCalledTimes(1)
    expect(_app.debouncedSaveAppDataSpy).toHaveBeenCalled()
  })

  it('★M2：入口已解锁 → decryptItem；await 解密后仍 unlocked → upsert 明文', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    _e2e.isUnlockedRef.value = true
    _e2e.decryptItemSpy.mockImplementation(async (_t: string, item: any) => ({ ...item, title: '明文态', _decrypted: true }))
    const addSpy = vi.spyOn(ds, 'addBookmark')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-new' }), old: {} }, 'bookmark')

    expect(_e2e.decryptItemSpy).toHaveBeenCalledTimes(1)
    expect(addSpy).toHaveBeenCalledTimes(1)
    expect((ds.bookmarkMap['r-bm-new'] as any)?.title).toBe('明文态') // 解密后明文落盘
  })

  it('★M2：入口已解锁,await 解密期间被 lock → 丢弃不 upsert（防密文态落盘）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    _e2e.isUnlockedRef.value = true
    _e2e.decryptItemSpy.mockImplementation(async (_t: string, item: any) => {
      _e2e.isUnlockedRef.value = false // 模拟 await 期间被 lock
      return { ...item, _decrypted: true }
    })
    const addSpy = vi.spyOn(ds, 'addBookmark')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-locked' }), old: {} }, 'bookmark')

    expect(addSpy).not.toHaveBeenCalled()
    expect(ds.bookmarkMap['r-bm-locked']).toBeUndefined()
  })
})

describe('_handleRealtimeChange — R13 await 后 dirty/pending 复查跳过', () => {
  it('★R13：await 解密期间本地编辑变 dirty → 复查跳过不 upsert（防较旧远端覆盖较新本地）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    _e2e.isUnlockedRef.value = true
    _e2e.decryptItemSpy.mockImplementation(async (_t: string, item: any) => {
      ds._dirtyIds.add('r-bm-r13') // await 期间本地编辑 → dirty
      return { ...item, _decrypted: true }
    })
    const addSpy = vi.spyOn(ds, 'addBookmark')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-r13' }), old: {} }, 'bookmark')

    expect(addSpy).not.toHaveBeenCalled() // 复查 dirty 跳过
  })

  it('R13：await 期间变 pending → 复查跳过不 upsert', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, __testPendingSync } = await getDeps()
    _e2e.isUnlockedRef.value = true
    _e2e.decryptItemSpy.mockImplementation(async (_t: string, item: any) => {
      __testPendingSync.add('r-bm-pend')
      return { ...item, _decrypted: true }
    })
    const addSpy = vi.spyOn(ds, 'addBookmark')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-pend' }), old: {} }, 'bookmark')

    expect(addSpy).not.toHaveBeenCalled()
  })
})

describe('_handleRealtimeChange — revive-assign 清 deletedAt 契约（修复后复活生效）', () => {
  it('★revive-assign：远端复活(edleted_at=null) → 本地 deletedAt 被 changes.deletedAt=undefined 经 spread 覆盖清空 → 复活生效（修复 bug:旧 delete 删 key 致 spread 保留 prev.deletedAt）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    seedBookmark(ds, { id: 'r-bm-revive', title: '旧', url: 'https://a.com', deletedAt: 100 })
    _e2e.isUnlockedRef.value = true
    const updateSpy = vi.spyOn(ds, 'updateBookmark')

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-revive', updated_at_num: 200, deleted_at: null }), old: {} },
      'bookmark',
    )

    expect(updateSpy).toHaveBeenCalledTimes(1)
    // 修复后:revive-assign 显式把 changes.deletedAt 设 undefined(保 key),
    // updateBookmark `{...prev, ...changes}` spread 用 undefined 覆盖 prev.deletedAt=100
    // → 新对象 deletedAt=undefined → 复活生效(UI 软删过滤不再隐藏)。
    // 旧 bug:源 L233 `delete plain.deletedAt` 删掉 changes 的 deletedAt key,
    // spread 不动没出现的 key → prev.deletedAt=100 被保留 → 复活失效。
    expect((ds.bookmarkMap['r-bm-revive'] as any).deletedAt).toBeUndefined()
  })

  it('★revive-assign group：远端复活组 → 本地 deletedAt 被清空复活（同 bookmark 修复对称）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    seedGroup(ds, { id: 'r-grp-revive', name: 'g', deletedAt: 200 })
    _e2e.isUnlockedRef.value = true
    const updateSpy = vi.spyOn(ds, 'updateGroup')

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteGroupRow({ id: 'r-grp-revive', updated_at_num: 300, deleted_at: null }), old: {} },
      'group',
    )

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect((ds.groupMap['r-grp-revive'] as any).deletedAt).toBeUndefined()
  })

  it('revive-assign category：远端复活分类 → 本地 deletedAt 被清空复活（同 bookmark 修复对称）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    seedCategory(ds, { id: 'r-cat-revive', name: 'c', deletedAt: 50 })
    _e2e.isUnlockedRef.value = true
    const updateSpy = vi.spyOn(ds, 'updateCategory')

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: { id: 'r-cat-revive', name: '远端', icon: 'i', color: 'k', order: 0, updated_at_num: 300, deleted_at: null, user_id: 'user-abc' }, old: {} },
      'category',
    )

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect((ds.categoryMap['r-cat-revive'] as any).deletedAt).toBeUndefined()
  })

  it('revive-assign 未解锁路径：wasUnlocked=false 仍 plain=mapped 带 deletedAt=undefined → spread 覆盖复活（不依赖 decryptItem）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    seedBookmark(ds, { id: 'r-bm-revive-locked', title: '旧', url: 'https://a.com', deletedAt: 100 })
    _e2e.isUnlockedRef.value = false // 未解锁,plain=mapped 不经 decryptItem
    const updateSpy = vi.spyOn(ds, 'updateBookmark')

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-revive-locked', updated_at_num: 200, deleted_at: null }), old: {} },
      'bookmark',
    )

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled() // 未解锁不 decrypt
    expect((ds.bookmarkMap['r-bm-revive-locked'] as any).deletedAt).toBeUndefined()
  })
})

describe('_handleRealtimeChange — HANDLERS 四 type upsert + bookmark parentId 变 + group notes silentSetContent', () => {
  it('★HANDLERS bookmark（本地已存在）：updateBookmark + 恢复远端 updatedAt + 清 dirty/new/changedFields（防回声）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    seedBookmark(ds, { id: 'r-bm-upd', title: '旧', url: 'https://a.com', updatedAt: 50 })
    _e2e.isUnlockedRef.value = true
    const updateSpy = vi.spyOn(ds, 'updateBookmark')

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-upd', updated_at_num: 200, title: '远端新' }), old: {} },
      'bookmark',
    )

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(ds.bookmarkMap['r-bm-upd'].updatedAt).toBe(200) // 恢复远端 updatedAt 防 Date.now() 覆盖
    expect(ds._dirtyIds.has('r-bm-upd')).toBe(false) // HANDLERS 末尾 _dirtyIds.delete
    expect(ds._newIds.has('r-bm-upd')).toBe(false)
    expect(ds._changedFields.has('r-bm-upd')).toBe(false) // L244 清本次 merge 产生的 changedFields 防回声
  })

  it('HANDLERS bookmark（本地无）：addBookmark + 清 dirty/new', async () => {
    await withAuth()
    const { _handleRealtimeChange } = await getDeps()
    _e2e.isUnlockedRef.value = true
    const addBmSpy = vi.spyOn((await import('../../stores/data.js')).useDataStore(), 'addBookmark')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-insert' }), old: {} }, 'bookmark')

    expect(addBmSpy).toHaveBeenCalledTimes(1)
  })

  it('★HANDLERS bookmark parentId 变更：旧 parentId 移出 _childrenIdx + 新 parentId 加入 _childrenIdx', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    seedBookmark(ds, { id: 'r-bm-move', title: 'x', url: 'https://a.com', parentId: 'p1' })
    ds._childrenIdx['p1'] = ['r-bm-move']
    _e2e.isUnlockedRef.value = true

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-move', updated_at_num: 200, parent_id: 'p2' }), old: {} },
      'bookmark',
    )

    expect(ds.bookmarkMap['r-bm-move'].parentId).toBe('p2')
    expect(ds._childrenIdx['p1']).not.toContain('r-bm-move')
    expect(ds._childrenIdx['p2']).toContain('r-bm-move')
  })

  it('★HANDLERS group：notes 非 H16 静默写入 editor（silentSetContent）抑制 onUpdate→markDirty 回声', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    seedGroup(ds, { id: 'r-grp-notes', name: 'g', notes: '旧', updatedAt: 1 })
    _e2e.isUnlockedRef.value = true
    _editor.getSpy.mockReturnValue({ getHTML: () => '旧 HTML' }) // HTML 与远端 notes 不同触发 silentSetContent

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteGroupRow({ id: 'r-grp-notes', updated_at_num: 200, notes: '远端笔记新' }), old: {} },
      'group',
    )

    expect(_editor.silentSetContentSpy).toHaveBeenCalledWith('r-grp-notes', '远端笔记新')
    expect(ds._dirtyIds.has('r-grp-notes')).toBe(false) // silentSet 抑制 onUpdate→markDirty
    expect(ds._changedFields.has('r-grp-notes')).toBe(false) // 双保险清 changedFields
  })

  it('HANDLERS group：editor 不存在或 HTML 已相同 → 跳过 silentSetContent（无意义 setContent）', async () => {
    await withAuth()
    const { _handleRealtimeChange } = await getDeps()
    ;(await import('../../stores/data.js')).useDataStore().addGroup({ id: 'r-grp-noeditor', name: 'g', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', useCount: 0, updatedAt: 1, isPublic: false } as any)
    _e2e.isUnlockedRef.value = true
    _editor.getSpy.mockReturnValue(null) // 无 editor

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteGroupRow({ id: 'r-grp-noeditor', updated_at_num: 200, notes: '新 notes' }), old: {} },
      'group',
    )

    expect(_editor.silentSetContentSpy).not.toHaveBeenCalled() // 无 editor 不 setContent
  })

  it('HANDLERS category / attribute：updateCategory/updateAttribute + 恢复远端 updatedAt + 清 dirty', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    // category
    seedCategory(ds, { id: 'r-cat', name: 'c', updatedAt: 1 })
    _e2e.isUnlockedRef.value = true
    const updateCatSpy = vi.spyOn(ds, 'updateCategory')

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: { id: 'r-cat', name: '远端分类', icon: 'i', color: 'k', order: 0, updated_at_num: 200, deleted_at: null, user_id: 'user-abc' }, old: {} },
      'category',
    )

    expect(updateCatSpy).toHaveBeenCalledTimes(1)
    expect(ds.categoryMap['r-cat'].updatedAt).toBe(200)
    expect(ds._dirtyIds.has('r-cat')).toBe(false)

    // attribute
    ds._dirtyIds.clear?.()
    seedAttribute(ds, { id: 'r-attr', name: 'a', updatedAt: 1 })
    const updateAttrSpy = vi.spyOn(ds, 'updateAttribute')

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: { id: 'r-attr', name: '远端属性', type: 'boolean', updated_at_num: 200, deleted_at: null, user_id: 'user-abc' }, old: {} },
      'attribute',
    )

    expect(updateAttrSpy).toHaveBeenCalledTimes(1)
    expect(ds.attributeMap['r-attr'].updatedAt).toBe(200)
    expect(ds._dirtyIds.has('r-attr')).toBe(false)
  })

  it('DATA-3：merge 完成（非 soft-delete/skip）后落盘 debouncedSaveAppData', async () => {
    await withAuth()
    const { _handleRealtimeChange } = await getDeps()
    _e2e.isUnlockedRef.value = true

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-data3' }), old: {} }, 'bookmark')

    expect(_app.debouncedSaveAppDataSpy).toHaveBeenCalledTimes(1)
  })
})
