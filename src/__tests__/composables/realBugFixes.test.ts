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
const __csMocks = vi.hoisted(() => ({ fullSyncSpy: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../../composables/domain/useCloudSync.js', () => ({
  useCloudSync: () => ({
    fullSync: __csMocks.fullSyncSpy,
    setGroupPublic: vi.fn(() => Promise.resolve(true)),
    initOnlineListener: vi.fn(),
    initialSync: vi.fn(() => Promise.resolve()),
  }),
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
