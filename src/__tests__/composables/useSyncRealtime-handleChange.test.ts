/**
 * useSyncRealtime-handleChange.test.ts — realtime 变更编排核心 `_handleRealtimeChange` 行为契约护栏
 *
 * 补 chunk #8 Explore 6 候选②号余项：useSyncRealtime._handleRealtimeChange（L36 export async）
 * 是 realtime 远端变更 → 本地合并编排核心，含多条真 bug 痕迹安全契约，编排层零护栏：
 *   - isReencrypting 短路（重加密全量迁移期间短路所有远端变更，注释明记防旧 cryptoKey 解新密文致乱码）
 *   - _getUserId 缺 return / S13 user_id 不匹配 return（S13 已被 realBugFixes.test.ts 7 段护栏 2 用例，
 *     本 chunk 避开此 4 已测用例，专注其余编排分支）
 *   - DELETE 分支：无 id return / G1-001 dirty 跳过 / pending 跳过 / 正常 _deleteWithoutEcho
 *   - FROM_REMOTE Zod 失败 mapped null return（远端坏数据不污染本地）
 *   - decision skip / conflict（addConflict 幂等不重 + resetConflictBanner）/ soft-delete（_deleteWithoutEcho+debouncedSaveAppData）
 *   - M2 wasUnlocked false 保留密文 + true await decrypt + await 后 lock return
 *   - R13 await 后 dirty/pending 复查跳过（防 await 期间本地编辑交错被覆盖）
 *   - revive-assign 清 deletedAt（HANDLERS 显式清一次防保留本地软删标记）
 *   - HANDLERS bookmark parentId 变 _childrenIdx 同步 / group notes silentSetContent H16 G1-003 /
 *     category / attribute 分支 / 清 _changedFields（DATA-3 落盘）
 *
 * 口径：纯加测试零源文件改动——_handleRealtimeChange 已 export 含 `_` 前缀约定私有可测。
 * 真实 decideRemoteApply（L91 输入构造后调纯决策）/ 真实 FROM_REMOTE / 真实 _deleteWithoutEcho /
 * 真实 useDataStore / 真实 useSyncStore / 真实 useAuthStore.user；
 * mock 部分仅桩：useE2E（decryptItem spy + 可控 isUnlocked ref，抑制真实 crypto 副作用 + 提供 M2
 * 双校验可控态）/ debouncedSaveAppData（spy 防真 persist 写盘 IO）/ EditorManager（get + silentSetContent
 * spy 捕 H16 group notes silentSet 路径）。realBugFixes.test.ts 7-8 段（S13 + 回声 _changedFields 清理）
 * 已护栏的 4 用例本 chunk 避开，专注编排层其余分支。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── useE2E mock：可控 isUnlocked ref + decryptItem spy（抑制真实 crypto 副作用，提供 M2 双校验可控态）──
const _e2e = vi.hoisted(() => ({
  isUnlockedRef: { value: false }, // 直接读写 .value，_handleRealtimeChange L128 读 e2e.isUnlocked.value
  decryptItemSpy: vi.fn(async (_t: string, item: any) => ({ ...item, _decrypted: true })),
}))
vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({
    isUnlocked: _e2e.isUnlockedRef,
    decryptItem: _e2e.decryptItemSpy,
  }),
}))

// ── app.js mock：debouncedSaveAppData spy（防真 persist 写盘 IO 副作用 + 捕 DATA-3 落盘断言）──
const _app = vi.hoisted(() => ({
  debouncedSaveAppDataSpy: vi.fn(),
  saveAppDataSpy: vi.fn(),
}))
vi.mock('../../stores/app.js', () => ({
  debouncedSaveAppData: _app.debouncedSaveAppDataSpy,
  saveAppData: _app.saveAppDataSpy,
}))

// ── supabase mock（useSyncStore 依赖 supabase import 未被本测试直接用但模块初始化需要）──
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

// ── EditorManager mock：get + silentSetContent spy（捕 H16 group notes silentSet 路径）──
const _editor = vi.hoisted(() => ({
  getSpy: vi.fn((): any => null),
  silentSetContentSpy: vi.fn(),
}))
vi.mock('../../lib/editor.js', () => ({
  EditorManager: {
    get: _editor.getSpy,
    silentSetContent: _editor.silentSetContentSpy,
  },
}))

// ── 远端 BookmarkRow 合法构造器（snake_case，含 schema 必填字段；用于绕过真实 FROM_REMOTE Zod 但本测试仍
//     经真实 FROM_REMOTE，故字段需满足 BookmarkSchema）──
function makeRemoteBookmarkRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r-bm-1',
    title: '远端书签',
    url: 'https://remote.example.com',
    username: '',
    password: '',
    notes: '',
    icon: '',
    category_id: 'uncategorized',
    parent_id: null,
    order: 0,
    use_count: 0,
    attributes: {},
    is_expanded: false,
    created_at_num: 100,
    updated_at_num: 200,
    pinned_at: null,
    deleted_at: null,
    user_id: 'user-abc',
    ...over,
  }
}

function makeRemoteGroupRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r-grp-1',
    name: '远端组',
    category_id: 'uncategorized',
    icon: '',
    order: 0,
    is_expanded: false,
    attributes: {},
    bookmark_ids: [],
    notes: '',
    use_count: 0,
    is_public: false,
    updated_at_num: 200,
    pinned_at: null,
    deleted_at: null,
    user_id: 'user-abc',
    ...over,
  }
}

// ── seed helpers：直接操作 store 数组+map 绕开 addBookmark/addGroup/addCategory/addAttribute 的
//    _markDirty（add* action 会把项标 dirty，让 _handleRealtimeChange L230 R13 复查「dirty return」误跳过 upsert，
//    编排测试无法抵达 assign/revive-assign 分支——同款范式见 realBugFixes.test.ts:305-306「不存在 addBookmark，改用
//    ds.bookmarks.push(bm); ds.bookmarkMap['b1']=bm」既绕 _markDirty 又同步 _bmMap）。seed 顺手同步 _childrenIdx。──
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
  const auth = useAuthStore()
  ;(auth as any).user = { id: userId, email: 'a@b.com' }
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

describe('_handleRealtimeChange — isReencrypting 短路契约', () => {
  it('isReencrypting=true 时 UPDATE 事件被短路，不查 store 不 decrypt 不 upsert', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, sync } = await getDeps()
    sync.setReencrypting(true)
    const addSpy = vi.spyOn(ds, 'addBookmark')
    _e2e.isUnlockedRef.value = true

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow(), old: {} }, 'bookmark')

    expect(addSpy).not.toHaveBeenCalled()
    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled()
    expect(_app.debouncedSaveAppDataSpy).not.toHaveBeenCalled()
  })

  it('isReencrypting=true 时 DELETE 事件也被短路（重加密期间一律不处理远端变更）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, sync } = await getDeps()
    ds.addBookmark({ id: 'r-bm-1', title: 'x', url: 'https://a.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    sync.setReencrypting(true)
    const delSpy = vi.spyOn(ds, 'deleteBookmark')

    await _handleRealtimeChange({ eventType: 'DELETE', new: {}, old: { id: 'r-bm-1', user_id: 'user-abc' } }, 'bookmark')

    expect(delSpy).not.toHaveBeenCalled()
  })
})

describe('_handleRealtimeChange — _getUserId 缺契约（未登录不处理远端变更）', () => {
  it('未登录（auth.user=null）UPDATE 事件 return，不 decrypt 不 upsert', async () => {
    const auth = (await import('../../stores/auth.js')).useAuthStore()
    ;(auth as any).user = null
    const { _handleRealtimeChange } = await getDeps()
    _e2e.isUnlockedRef.value = true

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow(), old: {} }, 'bookmark')

    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled()
  })

  it('未登录 DELETE 事件 return，不删', async () => {
    const auth = (await import('../../stores/auth.js')).useAuthStore()
    ;(auth as any).user = null
    const { _handleRealtimeChange, ds } = await getDeps()
    ds.addBookmark({ id: 'r-bm-1', title: 'x', url: 'https://a.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    const delSpy = vi.spyOn(ds, 'deleteBookmark')

    await _handleRealtimeChange({ eventType: 'DELETE', new: {}, old: { id: 'r-bm-1', user_id: 'user-abc' } }, 'bookmark')

    expect(delSpy).not.toHaveBeenCalled()
  })
})

describe('_handleRealtimeChange — DELETE 分支四路：G1-001 dirty/pending 不抹 + 无 id return + 正常删除', () => {
  it('DELETE 缺 id（oldRow.id 空）return，不删不留脏', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    const delSpy = vi.spyOn(ds, 'deleteBookmark')

    await _handleRealtimeChange({ eventType: 'DELETE', new: {}, old: {} }, 'bookmark')

    expect(delSpy).not.toHaveBeenCalled()
  })

  it('G1-001：DELETE 命中本地 dirty 的 bookmark 不抹掉（本地未推编辑比远端软删优先）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    ds.addBookmark({ id: 'b-dirty', title: 'x', url: 'https://a.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    ds._dirtyIds.add('b-dirty')
    const delSpy = vi.spyOn(ds, 'deleteBookmark')

    await _handleRealtimeChange({ eventType: 'DELETE', new: {}, old: { id: 'b-dirty', user_id: 'user-abc' } }, 'bookmark')

    expect(delSpy).not.toHaveBeenCalled() // dirty 项不被远端 DELETE 静默抹掉
  })

  it('G1-001：DELETE 命中 in-flight pending 的 id 跳过（防远端 DELETE 抹掉刚推未 ack 的项）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, __testPendingSync } = await getDeps()
    ds.addBookmark({ id: 'b-pending', title: 'x', url: 'https://a.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    __testPendingSync.add('b-pending')
    const delSpy = vi.spyOn(ds, 'deleteBookmark')

    await _handleRealtimeChange({ eventType: 'DELETE', new: {}, old: { id: 'b-pending', user_id: 'user-abc' } }, 'bookmark')

    expect(delSpy).not.toHaveBeenCalled()
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
  it('DELETE 不经 FROM_REMOTE（无 mapped 校验），仅按 id+dirty+pending 判定', async () => {
    // 此契约顺带锁定：DELETE 分支不调 FROM_REMOTE（mapped 校验只 for insert/assign/upsert 路径）
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    const fromRemoteMod = await import('../../composables/domain/useSyncMapping.js')
    const fromSpy = vi.spyOn(fromRemoteMod.FROM_REMOTE, 'bookmark').mockImplementation((r: any) => r as any)
    seedBookmark(ds, { id: 'b1' })
    try {
      await _handleRealtimeChange({ eventType: 'DELETE', new: {}, old: { id: 'b1', user_id: 'user-abc' } }, 'bookmark')
      expect(fromSpy).not.toHaveBeenCalled() // DELETE 不调 FROM_REMOTE
    } finally {
      fromSpy.mockRestore()
    }
  })

  it('UPDATE 远端行 Zod 校验失败（缺必填 url）→ mapped null → return 不 upsert 不 decrypt', async () => {
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
  it('skip：本地较新且无变更（decision skip）→ 不调 decryptItem 不 upsert', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, sync } = await getDeps()
    // 本地 updatedAt=300 远端 updatedAt=200（远程更旧）+ 无 dirty/pending + lastSyncAt=0
    // decideRemoteApply：localItem 存在 远程非 newer 也不软删 → skip
    ds.addBookmark({ id: 'r-bm-1', title: '本地新', url: 'https://a.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 300 } as any)
    sync.setLastSyncAt(0)
    _e2e.isUnlockedRef.value = true

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-1' }), old: {} }, 'bookmark')

    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled() // skip 早退在 decryptItem 前
    expect(_app.debouncedSaveAppDataSpy).not.toHaveBeenCalled()
  })

  it('conflict：远端 newer 且本地存在且非 dirty/pending → addConflict 一次 + resetConflictBanner 不 upsert', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, sync } = await getDeps()
    // 本地 updatedAt=1 远端 updatedAt=200（远程 newer）+ 本地 addBookmark 标 dirty + lastSyncAt>0
    // decideRemoteApply L72：isDirty + remoteNewer + lastSyncAt>0 → conflict（非 dirty 不会走 conflict，只会 assign）
    ds.addBookmark({ id: 'r-bm-1', title: '本地旧', url: 'https://local.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    sync.setLastSyncAt(1000)
    const addConflictSpy = vi.spyOn(sync, 'addConflict')
    const resetBannerSpy = vi.spyOn(sync, 'resetConflictBanner')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-1' }), old: {} }, 'bookmark')

    expect(addConflictSpy).toHaveBeenCalledTimes(1)
    expect(resetBannerSpy).toHaveBeenCalledTimes(1)
    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled() // conflict 分支不 upsert
  })

  it('conflict 幂等：已存在同 id conflict 时不再 addConflict（防重复冲突横幅）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, sync } = await getDeps()
    ds.addBookmark({ id: 'r-bm-1', title: '本地', url: 'https://local.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)
    sync.setLastSyncAt(0)
    // 预置一个 conflict 占位
    sync.addConflict({ id: 'r-bm-1', type: 'bookmark', local: {}, remote: {} } as any)
    const addConflictSpy = vi.spyOn(sync, 'addConflict')
    const resetBannerSpy = vi.spyOn(sync, 'resetConflictBanner')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-1' }), old: {} }, 'bookmark')

    expect(addConflictSpy).not.toHaveBeenCalled() // 已存在不重复 add
    expect(resetBannerSpy).not.toHaveBeenCalled()  // 既不 add 也不 reset banner
  })

  it('soft-delete：远端软删（deletedAt 非 null）且非 dirty/pending → _deleteWithoutEcho + debouncedSaveAppData', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds, sync } = await getDeps()
    // 本地非 dirty（seedBookmark 绕 markDirty）+ 远端 updatedAt=200 较新 + 远端 deleted_at 非空 + 无 dirty/pending → soft-delete
    // decideRemoteApply L85：非 dirty + remoteNewer + remote.deletedAt truthy + local.deletedAt falsy → soft-delete
    seedBookmark(ds, { id: 'r-bm-1', title: '本地', url: 'https://a.com' })
    sync.setLastSyncAt(0)
    const delSpy = vi.spyOn(ds, 'deleteBookmark')

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-1', updated_at_num: 200, deleted_at: '2026-01-01T00:00:00.000Z' }), old: {} },
      'bookmark',
    )

    expect(delSpy).toHaveBeenCalledWith('r-bm-1') // _deleteWithoutEcho → deleteBookmark
    expect(_app.debouncedSaveAppDataSpy).toHaveBeenCalledTimes(1) // soft-delete 分支落盘
  })
})

describe('_handleRealtimeChange — M2 await 前后解锁态双校验', () => {
  it('M2：入口未解锁（wasUnlocked=false）→ 保留密文 mapped 不调 decryptItem，仍 upsert', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    // 远端 new bookmark + 本地无 → decision insert + wasUnlocked=false
    _e2e.isUnlockedRef.value = false
    const addSpy = vi.spyOn(ds, 'addBookmark')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-new' }), old: {} }, 'bookmark')

    expect(_e2e.decryptItemSpy).not.toHaveBeenCalled() // 未解锁不解密，保留密文态
    expect(addSpy).toHaveBeenCalledTimes(1)            // 仍 upsert（密文态落盘，待解锁补解密 decryptStoreItems）
    expect(_app.debouncedSaveAppDataSpy).toHaveBeenCalled()
  })

  it('M2：入口已解锁 → wasUnlocked=true 调 decryptItem；await 解密后仍 unlocked → upsert 明文', async () => {
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

  it('M2：入口已解锁，await 解密期间被 lock → 丢弃不 upsert（防密文态落盘）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    _e2e.isUnlockedRef.value = true
    _e2e.decryptItemSpy.mockImplementation(async (_t: string, item: any) => {
      _e2e.isUnlockedRef.value = false // 模拟 await 期间被 lock
      return { ...item, _decrypted: true }
    })
    const addSpy = vi.spyOn(ds, 'addBookmark')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-locked' }), old: {} }, 'bookmark')

    expect(addSpy).not.toHaveBeenCalled() // await 后 lock 丢弃
    expect(ds.bookmarkMap['r-bm-locked']).toBeUndefined()
  })
})

describe('_handleRealtimeChange — R13 await 后 dirty/pending 复查跳过', () => {
  it('R13：await 解密期间本地编辑变 dirty → 复查跳过不 upsert（防较旧远端覆盖较新本地）', async () => {
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

  it('R13：await 解密期间变 pending → 复查跳过不 upsert', async () => {
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

describe('_handleRealtimeChange — revive-assign 清 deletedAt 契约', () => {
  it('revive-assign：源 L232-235 delete plain.deletedAt 已执行，但 updateBookmark 的 {...prev,...changes} 不透传删除（已知 bug 痕迹，待独立修源分支）', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    // 本地非 dirty（seedBookmark 绕 markDirty）+ 本地软删 deletedAt=100 + 远端 updatedAt 较新且无 deleted_at（远端复活）→ decision revive-assign
    seedBookmark(ds, { id: 'r-bm-revive', title: '旧', url: 'https://a.com', deletedAt: 100 })
    _e2e.isUnlockedRef.value = true
    const updateSpy = vi.spyOn(ds, 'updateBookmark')

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-revive', updated_at_num: 200, deleted_at: null }), old: {} },
      'bookmark',
    )

    expect(updateSpy).toHaveBeenCalledTimes(1)
    // 源 L233 `delete (plain as any).deletedAt` 确实删掉 plain 自身的 deletedAt key，
    // 但 updateBookmark L508 `this.bookmarks[idx] = { ...prev, ...changes }` 的 spread 不会因
    // changes 缺 deletedAt 就抹掉 prev.deletedAt —— 删除只作用于 changes 对象，merge 后 prev.deletedAt=100 保留。
    // 这是 revive-assign 复活后本地仍带软删标记的真 bug 痕迹，属 sync 写路径需独立修源分支（needs-user-review），
    // 此用例锁定现状防回归恶化，待修源（updateBookmark 显式置 deletedAt=undefined 或 _handleRealtimeChange 用 Object.assign(plain,{deletedAt:undefined})）。
    expect((ds.bookmarkMap['r-bm-revive'] as any).deletedAt).toBe(100)
  })
})

describe('_handleRealtimeChange — HANDLERS 四 type upsert + bookmark parentId 变 _childrenIdx 同步 + group notes silentSetContent', () => {
  it('HANDLERS bookmark：本地已存在 → updateBookmark + 恢复远端 updatedAt + 清 changedFields', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    // 本地非 dirty（seedBookmark 绕 markDirty）+ 远端 updatedAt 较新 → decision assign → HANDLERS updateBookmark
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

  it('HANDLERS bookmark：本地无 → addBookmark + 清 dirty/new', async () => {
    await withAuth()
    const { _handleRealtimeChange } = await getDeps()
    _e2e.isUnlockedRef.value = true
    const addBmSpy = vi.spyOn((await import('../../stores/data.js')).useDataStore(), 'addBookmark')

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-insert' }), old: {} }, 'bookmark')

    expect(addBmSpy).toHaveBeenCalledTimes(1)
  })

  it('HANDLERS bookmark parentId 变更：旧 parentId 移出 _childrenIdx + 新 parentId 加入 _childrenIdx', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    // 本地非 dirty（seedBookmark 绕 markDirty）+ bookmark parentId=p1 已在 _childrenIdx[p1]
    seedBookmark(ds, { id: 'r-bm-move', title: 'x', url: 'https://a.com', parentId: 'p1' })
    ds._childrenIdx['p1'] = ['r-bm-move']
    _e2e.isUnlockedRef.value = true

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-move', updated_at_num: 200, parent_id: 'p2' }), old: {} },
      'bookmark',
    )

    expect(ds.bookmarkMap['r-bm-move'].parentId).toBe('p2') // parentId 已变
    expect(ds._childrenIdx['p1']).not.toContain('r-bm-move') // 旧 parent 移出
    expect(ds._childrenIdx['p2']).toContain('r-bm-move')     // 新 parent 加入
  })

  it('HANDLERS group：notes 非 H16 静默写入 editor（silentSetContent）抑制 onUpdate→markDirty 回声', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    // 本地非 dirty（seedGroup 绕 markDirty）+ 远端 updatedAt 较新 → decision assign → HANDLERS group upsert
    seedGroup(ds, { id: 'r-grp-notes', name: 'g', notes: '旧', updatedAt: 1 })
    _e2e.isUnlockedRef.value = true
    // EditorManager.get 返回有 getHTML 的编辑器，HTML 与远端 notes 不同触发 silentSetContent
    _editor.getSpy.mockReturnValue({ getHTML: () => '旧 HTML' })

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteGroupRow({ id: 'r-grp-notes', updated_at_num: 200, notes: '远端笔记新' }), old: {} },
      'group',
    )

    expect(_editor.silentSetContentSpy).toHaveBeenCalledWith('r-grp-notes', '远端笔记新')
    // silentSet 抑制 onUpdate→markDirty，本 chunk 锁定：group upsert 后该 id dirty 应已清
    expect(ds._dirtyIds.has('r-grp-notes')).toBe(false)
    expect(ds._changedFields.has('r-grp-notes')).toBe(false) // 双保险清 changedFields
  })

  it('HANDLERS group：editor 不存在或 notes 相同时跳过 silentSetContent（防无意义 setContent）', async () => {
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

  it('HANDLERS group：editor HTML 已与远端 notes 相同 → 跳过 silentSetContent', async () => {
    await withAuth()
    const { _handleRealtimeChange } = await getDeps()
    ;(await import('../../stores/data.js')).useDataStore().addGroup({ id: 'r-grp-same', name: 'g', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', useCount: 0, updatedAt: 1, isPublic: false } as any)
    _e2e.isUnlockedRef.value = true
    _editor.getSpy.mockReturnValue({ getHTML: () => '与远端相同' }) // 已一致

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: makeRemoteGroupRow({ id: 'r-grp-same', updated_at_num: 200, notes: '与远端相同' }), old: {} },
      'group',
    )

    expect(_editor.silentSetContentSpy).not.toHaveBeenCalled()
  })

  it('HANDLERS category：本地已存在 → updateCategory + 恢复远端 updatedAt + 清 dirty/new', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    // 本地非 dirty（seedCategory 绕 markDirty）+ 远端 updatedAt 较新 → decision assign → HANDLERS category upsert
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
  })

  it('HANDLERS attribute：本地已存在 → updateAttribute + 恢复远端 updatedAt + 清 dirty/new', async () => {
    await withAuth()
    const { _handleRealtimeChange, ds } = await getDeps()
    // 本地非 dirty（seedAttribute 绕 markDirty）+ 远端 updatedAt 较新 → decision assign → HANDLERS attribute upsert
    seedAttribute(ds, { id: 'r-attr', name: 'a', updatedAt: 1 })
    _e2e.isUnlockedRef.value = true
    const updateAttrSpy = vi.spyOn(ds, 'updateAttribute')

    await _handleRealtimeChange(
      { eventType: 'UPDATE', new: { id: 'r-attr', name: '远端属性', type: 'boolean', updated_at_num: 200, deleted_at: null, user_id: 'user-abc' }, old: {} },
      'attribute',
    )

    expect(updateAttrSpy).toHaveBeenCalledTimes(1)
    expect(ds.attributeMap['r-attr'].updatedAt).toBe(200)
    expect(ds._dirtyIds.has('r-attr')).toBe(false)
  })

  it('DATA-3：merge 完成（非 soft-delete）后落盘 debouncedSaveAppData 调用一次', async () => {
    await withAuth()
    const { _handleRealtimeChange } = await getDeps()
    _e2e.isUnlockedRef.value = true

    await _handleRealtimeChange({ eventType: 'UPDATE', new: makeRemoteBookmarkRow({ id: 'r-bm-data3' }), old: {} }, 'bookmark')

    expect(_app.debouncedSaveAppDataSpy).toHaveBeenCalledTimes(1)
  })
})
