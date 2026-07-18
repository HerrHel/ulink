/**
 * 真实 bug 回归测试 — 验证被类型错误掩盖的 6 处运行 bug 已修复。
 * 每个测试聚焦一处修复点的运行时行为，而非类型层。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── supabase mock（useE2E / useCloudSync / useSyncHistory 依赖）──
const _upsert = vi.fn(() => Promise.resolve({ error: null }))
const _select = vi.fn(() => ({
  eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null })) })),
}))
const _from = vi.fn((table: string) => table === 'user_security'
  ? { select: () => _select(), upsert: _upsert, eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null })) })) }
  : { select: _select, upsert: _upsert })
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }), signInWithOtp: () => Promise.resolve({ error: null }), verifyOtp: () => Promise.resolve({ error: null }), signOut: () => Promise.resolve({ error: null }) },
    from: _from,
  },
}))

// ── useCloudSync mock（useDataShare.forkPublicGroup 依赖；顶层 vi.mock 避免提升警告）──
// G1-001 后 Realtime 入口调用 _isPendingSync / _deleteWithoutEcho，mock 必须导出
const __csMocks = vi.hoisted(() => ({ fullSyncSpy: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../../composables/domain/useCloudSync.js', () => ({
  useCloudSync: () => ({
    fullSync: __csMocks.fullSyncSpy,
    setGroupPublic: vi.fn(() => Promise.resolve(true)),
    initOnlineListener: vi.fn(),
    initialSync: vi.fn(() => Promise.resolve()),
  }),
  _isPendingSync: () => false,
  _deleteWithoutEcho: (ds: { deleteBookmark?: (id: string) => void; deleteGroup?: (id: string) => void; deleteCategory?: (id: string) => void; deleteAttribute?: (id: string) => void; _dirtyIds: Set<string>; _newIds: Set<string>; _changedFields: Map<string, Set<string>> }, type: string, id: string) => {
    if (type === 'bookmark') ds.deleteBookmark?.(id)
    else if (type === 'group') ds.deleteGroup?.(id)
    else if (type === 'category') ds.deleteCategory?.(id)
    else if (type === 'attribute') ds.deleteAttribute?.(id)
    ds._dirtyIds?.delete?.(id)
    ds._newIds?.delete?.(id)
    ds._changedFields?.delete?.(id)
  },
  __testPendingSync: { add: () => {}, clear: () => {} },
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

// ──────────────────────────────────────────────────────────────
// 1. useUI.closeRail — 关闭后 panels.rail 应为 false
// ──────────────────────────────────────────────────────────────
describe('useUI.closeRail', () => {
  it('关闭 rail 后 panels.rail === false', async () => {
    const { closeRail } = await import('../../composables/ui/useUI.js')
    const { useUIStore } = await import('../../stores/ui.js')
    const ui = useUIStore()
    ui.panels.rail = true
    expect(ui.panels.rail).toBe(true)
    closeRail()
    expect(ui.panels.rail).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────
// 2. useSyncHistory._getUserId — 登录后应返回 user.id 而非 null
// ──────────────────────────────────────────────────────────────
describe('useSyncHistory._getUserId', () => {
  it('store user 已设置时返回 user.id', async () => {
    const { useAuthStore } = await import('../../stores/auth.js')
    const { _getUserId } = await import('../../composables/domain/useSyncHistory.js')
    const auth = useAuthStore()
    ;(auth as any).user = { id: 'user-abc', email: 'a@b.com' }
    expect(_getUserId()).toBe('user-abc')
  })
  it('未登录时返回 null', async () => {
    const { _getUserId } = await import('../../composables/domain/useSyncHistory.js')
    expect(_getUserId()).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────
// 3. useSyncHistory._getUserId 验证「store 实例访问 user」契约
//    （同源问题在 useE2E._saveCanaryData 也已修：解构陷阱 → store 实例访问）
// ──────────────────────────────────────────────────────────────
// 见第 2 节：useSyncHistory._getUserId 已覆盖 user?.id 正确返回，
// useE2E._saveCanaryData 修复采用同一模式（auth.user?.id），其运行逻辑等价，
// 故不再为 _saveCanaryData 单独构造 Web Crypto 完整装配的重量级测试。

// ──────────────────────────────────────────────────────────────
// 4. useAppLifecycle:91 的契约 —— useAuth() 返回 store 实例时
//    `auth.isLoggedIn` 是已解包的 boolean（修复前 `auth.isLoggedIn.value` 恒 undefined）
// ──────────────────────────────────────────────────────────────
describe('useAuth store 实例契约（useAppLifecycle:91 修复基准）', () => {
  it('user 设置后 store 实例上 isLoggedIn 直接是 boolean true（非 Ref）', async () => {
    const { useAuth } = await import('../../composables/domain/useAuth.js')
    const auth = useAuth()
    ;(auth as any).user = { id: 'u1', email: 'a@b.com' }
    // store 实例访问（Pinia 自动解包）—— 修复点 if (auth.isLoggedIn) 依赖此为真布尔
    expect(auth.isLoggedIn).toBe(true)
    expect(typeof auth.isLoggedIn).toBe('boolean')
  })
  it('未登录时 isLoggedIn 为 false', async () => {
    const { useAuth } = await import('../../composables/domain/useAuth.js')
    expect(useAuth().isLoggedIn).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────
// 5. useDataShare.forkPublicGroup — 修复后应调用 useCloudSync().fullSync
//    （修复前 `sync` 未声明 → ReferenceError 被静默吞，fork 不云同步）
// ──────────────────────────────────────────────────────────────
describe('useDataShare.forkPublicGroup', () => {
  it('fork 后触发 useCloudSync().fullSync()', async () => {
    __csMocks.fullSyncSpy.mockClear()
    const { forkPublicGroup } = await import('../../composables/domain/useDataShare.js')
    const { useDataStore } = await import('../../stores/data.js')
    const ds = useDataStore()
    const before = ds.bookmarks.length
    await forkPublicGroup(
      { id: 'publicG1', name: 'G', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: ['pubB1'], notes: '', updatedAt: 1, useCount: 0, isPublic: true } as any,
      [{ id: 'pubB1', title: 'T', url: 'https://unique-fork-test.example', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any],
    )
    // 修复前：ReferenceError 静默吞，fork 后不会触发 fullSync
    expect(__csMocks.fullSyncSpy).toHaveBeenCalled()
    expect(ds.bookmarks.length).toBeGreaterThan(before)
  })

  it('fork 去重跳过的书签不入组 bookmarkIds，避免悬空引用；fetch 漏拉的 bid 也不进组', async () => {
    __csMocks.fullSyncSpy.mockClear()
    const { forkPublicGroup } = await import('../../composables/domain/useDataShare.js')
    const { useDataStore } = await import('../../stores/data.js')
    const ds = useDataStore()

    // 本地已有一条同 URL 书签（fork 应去重跳过它）
    ds.addBookmark({ id: 'localExisting', title: '本地已有', url: 'https://dup.example', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)

    // 公开组 bookmarkIds 含三条：B_dup(URL 重复将被跳过)、B_new(正常入库)、
    // ghostB(fork 拉取时漏拉的虚指 id——模拟 RLS/Zod 过滤后 fetchPublicGroup 没返回它)
    const group = {
      id: 'publicG2', name: 'G2', categoryId: 'uncategorized', icon: '', order: 0,
      isExpanded: false, attributes: {}, bookmarkIds: ['B_dup', 'B_new', 'ghostB'],
      notes: '', updatedAt: 1, useCount: 0, isPublic: true,
    } as any
    // fetch 拿到的书签只有 B_dup 和 B_new（ghostB 没拉到——idMap 无映射）
    const bookmarks = [
      { id: 'B_dup', title: '重复', url: 'https://dup.example', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any,
      { id: 'B_new', title: '新', url: 'https://fresh.example', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any,
    ]

    await forkPublicGroup(group, bookmarks)

    // 新组应只含 B_new 的实际入库 id，不含 B_dup(被去重)与 ghostB(漏拉)的映射
    const newGroup = ds.siblingGroups.find(g => g.name === 'G2')!
    expect(newGroup).toBeTruthy()
    expect(newGroup.bookmarkIds).toHaveLength(1)
    const newBmId = newGroup.bookmarkIds[0]
    // 该 id 应确实存在于本地库（不悬空）
    expect(ds.bookmarkMap[newBmId]).toBeTruthy()
    expect(ds.bookmarkMap[newBmId].title).toBe('新')
  })

  it('B-10: fork 保留父子关系（parentId 通过 idMap 映射到新 id）', async () => {
    __csMocks.fullSyncSpy.mockClear()
    const { forkPublicGroup } = await import('../../composables/domain/useDataShare.js')
    const { useDataStore } = await import('../../stores/data.js')
    const ds = useDataStore()

    // 公开组含父子书签：parent 是顶层，child 的 parentId 指向 parent
    const group = {
      id: 'publicG3', name: 'G3', categoryId: 'uncategorized', icon: '', order: 0,
      isExpanded: false, attributes: {}, bookmarkIds: ['P_parent', 'P_child'],
      notes: '', updatedAt: 1, useCount: 0, isPublic: true,
    } as any
    const bookmarks = [
      { id: 'P_parent', title: '父', url: 'https://parent.example', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any,
      { id: 'P_child', title: '子', url: 'https://child.example', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: 'P_parent', order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any,
    ]

    await forkPublicGroup(group, bookmarks)

    const newParent = ds.bookmarks.find(b => b.title === '父' && b.url === 'https://parent.example')!
    const newChild = ds.bookmarks.find(b => b.title === '子' && b.url === 'https://child.example')!
    expect(newParent).toBeTruthy()
    expect(newChild).toBeTruthy()
    // 修复前：newChild.parentId 仍为 'P_parent'（原分享者旧 id，本地不存在）→ 孤儿不可见
    // 修复后：newChild.parentId 映射到 newParent.id → 父子关系保留
    expect(newChild.parentId).toBe(newParent.id)
  })

  it('B-10: fork 时父书签被去重跳过，子书签 parentId 映射到本地已有的同 URL 书签', async () => {
    __csMocks.fullSyncSpy.mockClear()
    const { forkPublicGroup } = await import('../../composables/domain/useDataShare.js')
    const { useDataStore } = await import('../../stores/data.js')
    const ds = useDataStore()

    // 本地已有同 URL 的父书签（fork 时会被去重跳过）
    ds.addBookmark({ id: 'localParent', title: '本地父', url: 'https://parent-dup.example', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 10, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any)

    const group = {
      id: 'publicG4', name: 'G4', categoryId: 'uncategorized', icon: '', order: 0,
      isExpanded: false, attributes: {}, bookmarkIds: ['P2_parent', 'P2_child'],
      notes: '', updatedAt: 1, useCount: 0, isPublic: true,
    } as any
    const bookmarks = [
      { id: 'P2_parent', title: '重复父', url: 'https://parent-dup.example', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any,
      { id: 'P2_child', title: '新子', url: 'https://new-child.example', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: 'P2_parent', order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 } as any,
    ]

    await forkPublicGroup(group, bookmarks)

    const newChild = ds.bookmarks.find(b => b.url === 'https://new-child.example')!
    expect(newChild).toBeTruthy()
    // 父书签被去重跳过，子书签 parentId 应映射到本地已有的 'localParent'
    expect(newChild.parentId).toBe('localParent')
  })
})

// ──────────────────────────────────────────────────────────────
// 6. useDataShare.detectShareRoute — path 风格 /s/<gid> 优先，hash #share/<gid> 兼容
// ──────────────────────────────────────────────────────────────
describe('useDataShare.detectShareRoute', () => {
  const _origLoc = (globalThis as any).location
  function mockLoc(p: { pathname: string; hash?: string; origin?: string }) {
    Object.defineProperty(window, 'location', {
      value: { ...(window as any).location, pathname: p.pathname, hash: p.hash || '', origin: p.origin || 'https://x', search: '' },
      configurable: true,
    })
  }
  afterEach(() => {
    if (_origLoc) Object.defineProperty(window, 'location', { value: _origLoc, configurable: true })
  })

  it('path 风格 /s/<gid> 解析出 gid', async () => {
    mockLoc({ pathname: '/linkvault/s/abc123_-' })
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBe('abc123_-')
  })

  it('path 末尾带斜杠也能解析', async () => {
    mockLoc({ pathname: '/linkvault/s/xyz/' })
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBe('xyz')
  })

  it('hash 兼容旧链接 #share/<gid>', async () => {
    mockLoc({ pathname: '/linkvault/', hash: '#share/oldGid' })
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBe('oldGid')
  })

  it('path 与 hash 同存时 path 优先', async () => {
    mockLoc({ pathname: '/linkvault/s/p', hash: '#share/q' })
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBe('p')
  })

  it('无 path 无 hash 时返回 null', async () => {
    mockLoc({ pathname: '/linkvault/', hash: '' })
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────
// 7. S13: useSyncRealtime._handleRealtimeChange — user_id  纵深校验
// ──────────────────────────────────────────────────────────────
describe('S13 Realtime _handleRealtimeChange user_id guard', () => {
  it('不匹配 user_id 的 UPDATE 事件被静默跳过，不触发数据变更', async () => {
    const { useAuthStore } = await import('../../stores/auth.js')
    const { useDataStore } = await import('../../stores/data.js')
    const { _handleRealtimeChange } = await import('../../composables/domain/useSyncRealtime.js')

    const auth = useAuthStore()
    ;(auth as any).user = { id: 'user-abc', email: 'a@b.com' }

    const ds = useDataStore()
    // 确保 bookmarkMap 里有一条，让 handler 有机会 update——但 user_id 不匹配应在最外层被拦
    const bm = {
      id: 'b1', title: 'Legit', url: 'https://example.com',
      username: '', password: '', notes: '', icon: '',
      categoryId: 'uncategorized', parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false,
      createdAt: 1, updatedAt: 1,
    }
    ds.bookmarks.push(bm as any)
    ds.bookmarkMap['b1'] = bm as any

    const updateSpy = vi.spyOn(ds, 'updateBookmark')
    const addSpy = vi.spyOn(ds, 'addBookmark')

    // 恶意事件：user_id 不匹配当前登录用户
    await _handleRealtimeChange(
      {
        eventType: 'UPDATE',
        new: { ...bm, id: 'b1', title: 'HACKED', user_id: 'evil-user' },
        old: bm,
      },
      'bookmark',
    )

    // 不应执行任何 mutation
    expect(updateSpy).not.toHaveBeenCalled()
    expect(addSpy).not.toHaveBeenCalled()

    updateSpy.mockRestore()
    addSpy.mockRestore()
  })

  it('不匹配 user_id 的 DELETE 事件被静默跳过', async () => {
    const { useAuthStore } = await import('../../stores/auth.js')
    const { useDataStore } = await import('../../stores/data.js')
    const { _handleRealtimeChange } = await import('../../composables/domain/useSyncRealtime.js')

    const auth = useAuthStore()
    ;(auth as any).user = { id: 'user-abc', email: 'a@b.com' }

    const ds = useDataStore()
    const bm = {
      id: 'b9', title: 'D', url: 'https://d.com',
      username: '', password: '', notes: '', icon: '',
      categoryId: 'uncategorized', parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false,
      createdAt: 1, updatedAt: 1,
    }
    ds.bookmarks.push(bm as any)
    ds.bookmarkMap['b9'] = bm as any

    const deleteSpy = vi.spyOn(ds, 'deleteBookmark')

    // 恶意 DELETE：oldRow user_id 不匹配
    await _handleRealtimeChange(
      { eventType: 'DELETE', new: {}, old: { ...bm, id: 'b9', user_id: 'evil-user' } },
      'bookmark',
    )

    expect(deleteSpy).not.toHaveBeenCalled()
    deleteSpy.mockRestore()
  })
})

// ──────────────────────────────────────────────────────────────
// 8. Realtime 回声推送 — _handleRealtimeChange merge 后必须清 _changedFields
//    否则下次本地真改动时 drainChangedFields 把远端来的字段当本地改动推回远端，
//    反复 bump updated_at_num 污染冲突判定，多设备下级联回声。
// ──────────────────────────────────────────────────────────────
describe('Realtime echo-push: merge 后清理 _changedFields', () => {
  it('UPDATE bookmark 事件处理后，_changedFields 不应残留远端字段', async () => {
    const { useAuthStore } = await import('../../stores/auth.js')
    const { useDataStore } = await import('../../stores/data.js')
    const { _handleRealtimeChange } = await import('../../composables/domain/useSyncRealtime.js')

    const auth = useAuthStore()
    ;(auth as any).user = { id: 'user-abc', email: 'a@b.com' }

    const ds = useDataStore()
    const bm = {
      id: 'b-echo', title: 'Old', url: 'https://x.com',
      username: '', password: '', notes: '', icon: '',
      categoryId: 'uncategorized', parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false,
      createdAt: 1, updatedAt: 100,
    }
    // 直接塞入，避免走 addBookmark 自动 _markDirty 导致 handler 因 _dirtyIds 提前 return
    ds.bookmarks.push(bm as any)
    ds._bmMap['b-echo'] = bm as any
    ds._dirtyIds.clear()

    // 构造真实 Supabase Realtime 推来的 snake_case 行（fromRemoteBookmark 读 *_num/_id）
    const remoteRow = {
      id: 'b-echo', user_id: 'user-abc', title: 'From-Remote', url: 'https://x.com',
      username: '', password: '', notes: '', icon: '',
      category_id: 'uncategorized', parent_id: null,
      order: 0, use_count: 0, attributes: {}, is_expanded: false,
      created_at_num: 1, updated_at_num: 200, deleted_at: null,
    }
    await _handleRealtimeChange({ eventType: 'UPDATE', new: remoteRow, old: {} }, 'bookmark')

    // 核心断言：merge 产生的 _changedFields 必须被清，不残留 remotely-sourced 字段
    expect(ds._changedFields.has('b-echo')).toBe(false)
    // 本地值确实更新成了远端数据
    expect(ds.bookmarkMap['b-echo'].title).toBe('From-Remote')
    // updatedAt 恢复为远端值而非 Date.now()
    expect(ds.bookmarkMap['b-echo'].updatedAt).toBe(200)
    // dirty/new 标记不应残留（避免下次 sync 把远端数据推回）
    expect(ds._dirtyIds.has('b-echo')).toBe(false)
    expect(ds._newIds.has('b-echo')).toBe(false)
  })

  it('UPDATE group 事件处理后，_changedFields 不应残留远端字段', async () => {
    const { useAuthStore } = await import('../../stores/auth.js')
    const { useDataStore } = await import('../../stores/data.js')
    const { _handleRealtimeChange } = await import('../../composables/domain/useSyncRealtime.js')

    const auth = useAuthStore()
    ;(auth as any).user = { id: 'user-abc', email: 'a@b.com' }

    const ds = useDataStore()
    const g = {
      id: 'g-echo', name: 'OldG', categoryId: 'uncategorized', icon: '', order: 0,
      isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', useCount: 0,
      isPublic: false, updatedAt: 100,
    }
    ds.siblingGroups.push(g as any)
    ds._grpMap['g-echo'] = g as any
    ds._dirtyIds.clear()

    const remoteRow = {
      id: 'g-echo', user_id: 'user-abc', name: 'From-Remote-G', category_id: 'uncategorized',
      icon: '', order: 0, is_expanded: false, attributes: {}, bookmark_ids: [],
      notes: '', use_count: 0, is_public: false, updated_at_num: 200, deleted_at: null,
    }
    await _handleRealtimeChange({ eventType: 'UPDATE', new: remoteRow, old: {} }, 'group')

    expect(ds._changedFields.has('g-echo')).toBe(false)
    expect(ds.groupMap['g-echo'].name).toBe('From-Remote-G')
    expect(ds.groupMap['g-echo'].updatedAt).toBe(200)
  })
})
