/**
 * useSyncHistory-fetchHistory-restoreFromHistory.test.ts
 *
 * 补 src/composables/domain/useSyncHistory.ts 直接护栏缺口（Explore agentId
 * a0503748e2598c1b 扫出真缺口首位）。
 *
 * 此前 0 直接护栏：
 *   - fetchHistory（L39）：HIST-1 未登录跳过云端 / supabase select-eq-eq-order-limit
 *     链构造 / E2E 启用+解锁按 itemId 类型 decryptItem 揭密 + 失败吞错保留密文态 /
 *     E2E 未启用透传 / created_at 去重保守云端（云端时序权威）/ 降序 + slice(max)
 *   - restoreFromHistory（L89）：本地命中不查云端 / 本地未命中+未登录返 false /
 *     本地未命中+登录 supabase error/no-data 返 false / E2E 启用解锁 decryptItem 揭密
 *     + 失败回退 histData / **软删守门**（group/bookmark 在 groupMap/bookmarkMap 缺失
 *     或 deletedAt truthy 时返 false 防误报成功）/ bookmark 分支 updateBookmark 字段集 /
 *     group 分支 **悬空 id 过滤**`bookmarkIds.filter(bid => bookmarkMap[bid])` /
 *     group EditorManager.get 命中调 setContent / 末尾 saveAppData + return true
 *
 * 纯加测试零源文件改动——fetchHistory/restoreFromHistory/_getUserId 均已 export
 * src/composables/domain/useSyncHistory.ts:15/39/89 无需改源（同 D1-117/D1-30 同源
 * 「纯加测试锁契约，sync 写路径/序列化/数据格式改动才标 needs-user-review，纯加测试
 * 不属」口径）。本护栏锁定现有真实行为契约防回归。
 *
 * mock 策略（参照 realBugFixes/useE2EChangePw/syncPushPull 既有范式）：
 *   - supabase：可控链式 stub（select.eq.eq.order.limit / .single），每用例重设返回
 *   - useAuth：可变 user stub（HIST-1 未登录 vs 已登录）
 *   - useE2E：mock 整个 composable，spy decryptItem 返可控值（验证调用契约 + 失败回退）
 *   - storage（fetchLocalHistory/getLocalHistoryVersion）：用真实 localStorage（setup.ts
 *     已 mock localStorage），让真实 IDB-less 路径工作（同 localHistory.test.ts 口径）
 *   - useUIStore/useDataStore：真实 Pinia store（setActivePinia）
 *   - saveAppData / EditorManager：mock 避免真实落盘/编辑器初始化
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── useAuth 可变 stub：默认 user=null（未登录 = HIST-1 路径）──
const _authState = vi.hoisted(() => ({ user: null as { id: string } | null }))
vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => ({ get user() { return _authState.user } }),
}))

// ── useE2E mock：spy decryptItem 验证调用契约 + 失败回退 ──
const _e2eState = vi.hoisted(() => ({
  isE2EEnabled: false,
  isUnlocked: false,
  decryptItem: vi.fn(async (_type: string, item: Record<string, unknown>) => item),
}))
vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({
    isE2EEnabled: { get value() { return _e2eState.isE2EEnabled } },
    isUnlocked: { get value() { return _e2eState.isE2EEnabled && _e2eState.isUnlocked } },
    decryptItem: _e2eState.decryptItem,
  }),
}))

// ── supabase mock：可控链式 stub ──
// fetchHistory 用：.from('data_history').select('id,data,created_at').eq('user_id',uid).eq('item_id',itemId).order(...).limit(max) → {data}
// restoreFromHistory 用：.from('data_history').select('data').eq('id',hid).eq('user_id',uid).single() → {data, error}
type ListRes = { data: unknown } | null
type SingleRes = { data: Record<string, unknown> | null; error: unknown } | null
const _supabaseStub = vi.hoisted(() => {
  return {
    // fetchHistory 的 .limit 返回值
    listRes: null as ListRes,
    // restoreFromHistory 的 .single 返回值
    singleRes: null as SingleRes,
  }
})
vi.mock('../../lib/supabase.js', () => {
  const thenable = (v: unknown) => ({ then: (resolve: (v: unknown) => void) => resolve(v) })
  // chainToList：select('id, data, created_at') 后的 list 链。
  // 用一个 spy 作为 eq 桩（次次返回包含自身 .order() 的对象），既支持链式又 Spy 可断言。
  const chainToList = () => {
    const self: { eq: ReturnType<typeof vi.fn>; order: () => { limit: () => unknown } } = { eq: vi.fn(), order: () => ({ limit: () => thenable(_supabaseStub.listRes) }) }
    self.eq.mockReturnValue(self)
    return self
  }
  const chainToSingleInner = () => ({
    eq: () => chainToSingleInner(),   // 支持连续两个 .eq() 链式（id + user_id）
    single: () => thenable(_supabaseStub.singleRes),
  })
  const chainToSingle = () => ({
    eq: () => chainToSingleInner(),
  })
  return {
    supabase: {
      from: vi.fn((table: string) => {
        // fetchHistory 路径 order+limit；restoreFromHistory 路径 single
        // 用返回对象的方法集合区分——返回带 select 的对象，
        // select('id,data,created_at') → 走 list 链；select('data') → 走 single 链
        const select = vi.fn((cols: string) => {
          if (cols === 'data') return chainToSingle()
          return chainToList()
        })
        return { select }
      }),
    },
  }
})

// ── saveAppData mock：避免真实 IDB 落盘 ──
vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
}))

// ── EditorManager mock：spy setContent（仅 group 分支验证）──
const _edState = vi.hoisted(() => ({ editor: null as { commands: { setContent: ReturnType<typeof vi.fn> } } | null }))
vi.mock('../../lib/editor.js', () => ({
  EditorManager: { get: () => _edState.editor },
}))

import { fetchHistory, restoreFromHistory } from '../../composables/domain/useSyncHistory.js'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'

// ── helper：写本地历史快照（复用真实 storage.fetchLocalHistory/getLocalHistoryVersion）──
function setLocalHistory(itemId: string, versions: Array<{ id: number; data: Record<string, unknown>; created_at: string }>) {
  localStorage.setItem(`lv_hist:${itemId}`, JSON.stringify(versions))
}

// ── helper：构造 Bookmark/SiblingGroup 真实 store 数据 ──
function makeBookmark(p: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'bm-1', title: 't', url: 'https://x.com', username: '', password: '',
    notes: '', categoryId: 'cat-1', parentId: null, order: 0, useCount: 0,
    attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0, deletedAt: null,
    pinnedAt: null, icon: '', ...p,
  }
}
function makeGroup(p: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'g-1', name: '组', categoryId: 'cat-1', icon: '', order: 0,
    isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 0,
    useCount: 0, isPublic: false, pinnedAt: null, ...p,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  _authState.user = null
  _e2eState.isE2EEnabled = false
  _e2eState.isUnlocked = false
  _e2eState.decryptItem = vi.fn(async (_t: string, item: Record<string, unknown>) => item)
  _supabaseStub.listRes = null
  _supabaseStub.singleRes = null
  _edState.editor = null
  localStorage.clear()
})

// ============================================================================
// fetchHistory 护栏
// ============================================================================
describe('fetchHistory — 版本历史合并编排护栏', () => {
  describe('HIST-1：未登录跳过云端查询（安全纵深，不依赖 RLS）', () => {
    it('★未登录时不调 supabase query，仅返本地', async () => {
      _authState.user = null
      setLocalHistory('g-1', [{ id: 90, data: { notes: 'local' }, created_at: '2026-01-01T00:00:00.000Z' }])
      const result = await fetchHistory('g-1')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(90)
      // supabase.from 从未被调（未登录不应触云端）
      const { supabase } = await import('../../lib/supabase.js')
      expect(supabase.from).not.toHaveBeenCalled()
    })

    it('已登录时调 supabase query 查云端历史', async () => {
      _authState.user = { id: 'user-1' }
      _supabaseStub.listRes = { data: [{ id: 100, data: { notes: 'cloud' }, created_at: '2026-02-01T00:00:00.000Z' }] }
      const result = await fetchHistory('g-1')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(100)
      const { supabase } = await import('../../lib/supabase.js')
      expect(supabase.from).toHaveBeenCalledWith('data_history')
    })
  })

  describe('supabase 链构造正确', () => {
    it('登录时调 .select("id, data, created_at").eq("user_id", uid).eq("item_id", itemId).order().limit()', async () => {
      _authState.user = { id: 'user-1' }
      _supabaseStub.listRes = { data: [] }
      await fetchHistory('g-1')
      const { supabase } = await import('../../lib/supabase.js')
      const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>
      const fromRet = fromMock.mock.results[0].value
      const selectMock = fromRet.select as ReturnType<typeof vi.fn>
      expect(selectMock).toHaveBeenCalledWith('id, data, created_at')
      const eqRet = selectMock.mock.results[0].value
      const eqMock = eqRet.eq as ReturnType<typeof vi.fn>
      expect(eqMock).toHaveBeenCalledWith('user_id', 'user-1')
      expect(eqMock).toHaveBeenCalledWith('item_id', 'g-1')
    })
  })

  describe('historyMax 截断（slice）', () => {
    it('超过 historyMax 的版本被 slice 截断', async () => {
      _authState.user = { id: 'user-1' }
      const ui = useUIStore()
      ui.historyMax = 2
      _supabaseStub.listRes = {
        data: [
          { id: 1, data: {}, created_at: '2026-03-01T00:00:00.000Z' },
          { id: 2, data: {}, created_at: '2026-02-01T00:00:00.000Z' },
          { id: 3, data: {}, created_at: '2026-01-01T00:00:00.000Z' },
          { id: 4, data: {}, created_at: '2025-12-01T00:00:00.000Z' },
        ],
      }
      const result = await fetchHistory('g-1')
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe(1)
      expect(result[1].id).toBe(2)
    })
  })

  describe('E2E 揭密（启用+解锁时对云端版本 decryptItem）', () => {
    it('★E2E 启用且解锁时按 itemId 类型调 decryptItem 揭密每个云端版本', async () => {
      _authState.user = { id: 'user-1' }
      _e2eState.isE2EEnabled = true
      _e2eState.isUnlocked = true
      _e2eState.decryptItem = vi.fn(async (_t: string, item: Record<string, unknown>) => ({ ...item, decrypted: true }))
      // 假设 itemId 是 group → ds.groupMap 命中判定 type='group'
      _supabaseStub.listRes = {
        data: [
          { id: 1, data: { cipher: true }, created_at: '2026-01-01T00:00:00.000Z' },
          { id: 2, data: { cipher: true }, created_at: '2026-02-01T00:00:00.000Z' },
        ],
      }
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1' })] as any
      const result = await fetchHistory('g-1')
      expect(_e2eState.decryptItem).toHaveBeenCalledTimes(2)
      // decryptItem 第一参数 type 由 ds.groupMap[itemId] 命中判定 → 'group'
      expect(_e2eState.decryptItem.mock.calls[0][0]).toBe('group')
      // 揭密后 data 含 decrypted: true
      expect(result[0].data).toMatchObject({ decrypted: true })
    })

    it('E2E 启用但未解锁：不调 decryptItem，保留密文态', async () => {
      _authState.user = { id: 'user-1' }
      _e2eState.isE2EEnabled = true
      _e2eState.isUnlocked = false
      _supabaseStub.listRes = { data: [{ id: 1, data: { cipher: true }, created_at: '2026-01-01T00:00:00.000Z' }] }
      await fetchHistory('bm-1')
      expect(_e2eState.decryptItem).not.toHaveBeenCalled()
    })

    it('E2E 未启用：不调 decryptItem', async () => {
      _authState.user = { id: 'user-1' }
      _e2eState.isE2EEnabled = false
      _supabaseStub.listRes = { data: [{ id: 1, data: { plain: 1 }, created_at: '2026-01-01T00:00:00.000Z' }] }
      await fetchHistory('bm-1')
      expect(_e2eState.decryptItem).not.toHaveBeenCalled()
    })

    it('★decryptItem 抛错时吞错保留密文态不阻断列版本', async () => {
      _authState.user = { id: 'user-1' }
      _e2eState.isE2EEnabled = true
      _e2eState.isUnlocked = true
      const cipher = { cipher: true }
      _e2eState.decryptItem = vi.fn(async () => { throw new Error('decrypt fail') })
      _supabaseStub.listRes = { data: [{ id: 1, data: cipher, created_at: '2026-01-01T00:00:00.000Z' }] }
      const result = await fetchHistory('g-1')
      // 不抛、返回 1 条、data 保留原密文态对象引用（未替换）
      expect(result).toHaveLength(1)
      expect(result[0].data).toBe(cipher)
    })

    it('E2E 揭密跳过 data 非 object 的版本（typeof string/number 不解密）', async () => {
      _authState.user = { id: 'user-1' }
      _e2eState.isE2EEnabled = true
      _e2eState.isUnlocked = true
      _supabaseStub.listRes = { data: [{ id: 1, data: 'not-an-object', created_at: '2026-01-01T00:00:00.000Z' }] }
      await fetchHistory('bm-1')
      // typeof data !== 'object' 分支短路不调 decryptItem
      expect(_e2eState.decryptItem).not.toHaveBeenCalled()
    })
  })

  describe('合并去重：相同 created_at 保留云端（云端时序权威）', () => {
    it('★本地与云端相同 created_at 时保留云端版本（去重）', async () => {
      _authState.user = { id: 'user-1' }
      const sharedTs = '2026-01-01T00:00:00.000Z'
      setLocalHistory('g-1', [{ id: 90, data: { source: 'local' }, created_at: sharedTs }])
      _supabaseStub.listRes = { data: [{ id: 100, data: { source: 'cloud' }, created_at: sharedTs }] }
      const result = await fetchHistory('g-1')
      expect(result).toHaveLength(1)
      // 保留云端（id=100），本地同时间戳被去重剔除
      expect(result[0].id).toBe(100)
      expect(result[0].data).toMatchObject({ source: 'cloud' })
    })

    it('本地与云端 created_at 不同时合并全集', async () => {
      _authState.user = { id: 'user-1' }
      setLocalHistory('g-1', [{ id: 90, data: {}, created_at: '2026-01-01T00:00:00.000Z' }])
      _supabaseStub.listRes = { data: [{ id: 100, data: {}, created_at: '2026-02-01T00:00:00.000Z' }] }
      const result = await fetchHistory('g-1')
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe(100) // 降序：cloud ts 更晚在前
      expect(result[1].id).toBe(90)
    })

    it('降序排序：created_at 倒序后置 slice', async () => {
      _authState.user = { id: 'user-1' }
      setLocalHistory('g-1', [
        { id: 1, data: {}, created_at: '2026-06-01T00:00:00.000Z' },
        { id: 2, data: {}, created_at: '2026-05-01T00:00:00.000Z' },
      ])
      _supabaseStub.listRes = { data: [{ id: 3, data: {}, created_at: '2026-04-01T00:00:00.000Z' }] }
      const result = await fetchHistory('g-1')
      expect(result.map(r => r.id)).toEqual([1, 2, 3])
    })
  })
})

// ============================================================================
// restoreFromHistory 护栏
// ============================================================================
describe('restoreFromHistory — 历史恢复编排护栏', () => {
  describe('本地命中优先（不查云端）', () => {
    it('★本地有该版本时不调 supabase.query', async () => {
      _authState.user = { id: 'user-1' }
      setLocalHistory('g-1', [{ id: 5, data: { name: '本地版', bookmarkIds: ['bm-1'], notes: '<p>x</p>' }, created_at: '2026-01-01T00:00:00.000Z' }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: ['bm-1'] })] as any
      ds.bookmarks = [makeBookmark({ id: 'bm-1' })] as any
      const ok = await restoreFromHistory(5, 'g-1', 'group')
      expect(ok).toBe(true)
      const { supabase } = await import('../../lib/supabase.js')
      expect(supabase.from).not.toHaveBeenCalled()
    })
  })

  describe('本地未命中 + 未登录 → return false（HIST-1 一致安全纵深）', () => {
    it('★本地无版本 + 未登录 → 返 false 不查云端', async () => {
      _authState.user = null
      const ok = await restoreFromHistory(999, 'g-1', 'group')
      expect(ok).toBe(false)
      const { supabase } = await import('../../lib/supabase.js')
      expect(supabase.from).not.toHaveBeenCalled()
    })
  })

  describe('本地未命中 + 已登录 supabase 兜底', () => {
    it('supabase error → console.warn + return false', async () => {
      _authState.user = { id: 'user-1' }
      _supabaseStub.singleRes = { data: null, error: new Error('rpc fail') }
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const ok = await restoreFromHistory(999, 'g-1', 'group')
      expect(ok).toBe(false)
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('supabase data 空（无 error）→ return false', async () => {
      _authState.user = { id: 'user-1' }
      _supabaseStub.singleRes = { data: null, error: null }
      const ok = await restoreFromHistory(999, 'g-1', 'group')
      expect(ok).toBe(false)
    })

    it('本地未命中 + 已登录 + supabase 命中 → histData 用云端 data.data', async () => {
      _authState.user = { id: 'user-1' }
      _supabaseStub.singleRes = { data: { data: { name: '云端版', bookmarkIds: ['bm-1'], notes: 'x' } }, error: null }
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: ['bm-1'] })] as any
      ds.bookmarks = [makeBookmark({ id: 'bm-1' })] as any
      const ok = await restoreFromHistory(999, 'g-1', 'group')
      expect(ok).toBe(true)
      // restore 已用云端 name='云端版'
      expect(ds.siblingGroups[0].name).toBe('云端版')
    })
  })

  describe('★软删守门（防 restore 已删组/书签误报成功）', () => {
    it('group 在 groupMap 缺失 → return false 不 updateGroup', async () => {
      setLocalHistory('g-missing', [{ id: 1, data: { name: 'override' }, created_at: '2026-01-01T00:00:00.000Z' }])
      const ds = useDataStore()
      ds.siblingGroups = [] as any // groupMap 无 g-missing
      const updateSpy = vi.spyOn(ds, 'updateGroup')
      const ok = await restoreFromHistory(1, 'g-missing', 'group')
      expect(ok).toBe(false)
      expect(updateSpy).not.toHaveBeenCalled()
    })

    it('group 已软删（deletedAt truthy）→ return false 不 updateGroup', async () => {
      setLocalHistory('g-soft', [{ id: 1, data: { name: 'override' }, created_at: '2026-01-01T00:00:00.000Z' }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-soft', deletedAt: Date.now() })] as any
      const updateSpy = vi.spyOn(ds, 'updateGroup')
      const ok = await restoreFromHistory(1, 'g-soft', 'group')
      expect(ok).toBe(false)
      expect(updateSpy).not.toHaveBeenCalled()
    })

    it('bookmark 在 bookmarkMap 缺失 → return false 不 updateBookmark', async () => {
      setLocalHistory('bm-missing', [{ id: 1, data: { title: 'override' }, created_at: '2026-01-01T00:00:00.000Z' }])
      const ds = useDataStore()
      ds.bookmarks = [] as any
      const updateSpy = vi.spyOn(ds, 'updateBookmark')
      const ok = await restoreFromHistory(1, 'bm-missing', 'bookmark')
      expect(ok).toBe(false)
      expect(updateSpy).not.toHaveBeenCalled()
    })

    it('bookmark 已软删 → return false 不 updateBookmark', async () => {
      setLocalHistory('bm-soft', [{ id: 1, data: { title: 'override' }, created_at: '2026-01-01T00:00:00.000Z' }])
      const ds = useDataStore()
      ds.bookmarks = [makeBookmark({ id: 'bm-soft', deletedAt: Date.now() })] as any
      const updateSpy = vi.spyOn(ds, 'updateBookmark')
      const ok = await restoreFromHistory(1, 'bm-soft', 'bookmark')
      expect(ok).toBe(false)
      expect(updateSpy).not.toHaveBeenCalled()
    })
  })

  describe('bookmark 分支：updateBookmark 字段集正确赋值', () => {
    it('histData 的 13 字段正确赋给 updateBookmark', async () => {
      _authState.user = null // 走本地路径避开 supabase
      setLocalHistory('bm-1', [{
        id: 7, created_at: '2026-01-01T00:00:00.000Z',
        data: {
          title: '历史标题', url: 'https://hist.com', username: 'u', password: 'p',
          notes: '历史笔记', icon: 'i', categoryId: 'cat-2', parentId: null,
          order: 9, useCount: 5, attributes: { a1: true }, isExpanded: true,
        },
      }])
      const ds = useDataStore()
      ds.bookmarks = [makeBookmark({ id: 'bm-1' })] as any
      const updateSpy = vi.spyOn(ds, 'updateBookmark').mockImplementation(() => {})
      const ok = await restoreFromHistory(7, 'bm-1', 'bookmark')
      expect(ok).toBe(true)
      expect(updateSpy).toHaveBeenCalledTimes(1)
      const [idArg, changesArg] = updateSpy.mock.calls[0]
      expect(idArg).toBe('bm-1')
      expect(changesArg).toMatchObject({
        title: '历史标题', url: 'https://hist.com', username: 'u', password: 'p',
        notes: '历史笔记', icon: 'i', categoryId: 'cat-2', parentId: null,
        order: 9, useCount: 5, attributes: { a1: true }, isExpanded: true,
      })
    })
  })

  describe('group 分支：updateGroup 字段集 + 悬空 id 过滤', () => {
    it('★悬空 bookmarkIds 被过滤（bookmarkMap 无对应 id 的不进 updateGroup.bookmarkIds）', async () => {
      _authState.user = null
      // 历史快照引用 bm-1（活着）、bm-soft（软删但仍在 bookmarkMap）、bm-dangling（完全不在 bookmarks 数组）
      setLocalHistory('g-1', [{
        id: 8, created_at: '2026-01-01T00:00:00.000Z',
        data: { name: '组名', bookmarkIds: ['bm-1', 'bm-soft', 'bm-dangling'], notes: '<p>组</p>' },
      }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: ['bm-old'] })] as any
      ds.bookmarks = [
        makeBookmark({ id: 'bm-1' }),
        makeBookmark({ id: 'bm-soft', deletedAt: Date.now() }),
      ] as any
      // bm-dangling 不在 bookmarks 数组里 → bookmarkMap 无此 id → 被过滤
      // bm-soft 软删但仍在 bookmarks 数组里 → bookmarkMap 命中 → 不过滤（源码仅按 map 存在过滤）
      const updateSpy = vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
      const ok = await restoreFromHistory(8, 'g-1', 'group')
      expect(ok).toBe(true)
      const [, changesArg] = updateSpy.mock.calls[0]
      // 直锁真实行为：只过滤 map 无 id 的悬空 id，软删仍存活（防误以为会过滤软删）
      expect(changesArg.bookmarkIds).toEqual(['bm-1', 'bm-soft'])
    })

    it('悬空 id 过滤：bookmarkMap 无全部历史 id 时返空数组', async () => {
      _authState.user = null
      setLocalHistory('g-1', [{
        id: 81, created_at: '2026-01-01T00:00:00.000Z',
        data: { name: '组', bookmarkIds: ['gone-1', 'gone-2'], notes: '<p>组</p>' },
      }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: [] })] as any
      ds.bookmarks = [] as any
      const updateSpy = vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
      const ok = await restoreFromHistory(81, 'g-1', 'group')
      expect(ok).toBe(true)
      const [, changesArg] = updateSpy.mock.calls[0]
      expect(changesArg.bookmarkIds).toEqual([])
    })

    it('plain.bookmarkIds 缺省（undefined）→ filter 空数组兜底不抛', async () => {
      _authState.user = null
      setLocalHistory('g-1', [{ id: 9, created_at: '2026-01-01T00:00:00.000Z', data: { name: '无 refs' } }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: ['bm-1'] })] as any
      ds.bookmarks = [makeBookmark({ id: 'bm-1' })] as any
      const updateSpy = vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
      const ok = await restoreFromHistory(9, 'g-1', 'group')
      expect(ok).toBe(true)
      const [, changesArg] = updateSpy.mock.calls[0]
      expect(changesArg.bookmarkIds).toEqual([])
    })

    it('group 字段集正确赋给 updateGroup', async () => {
      _authState.user = null
      setLocalHistory('g-1', [{
        id: 10, created_at: '2026-01-01T00:00:00.000Z',
        data: { name: '新组名', categoryId: 'cat-3', icon: '🎯', order: 7, isExpanded: true, attributes: { a: true }, notes: '<p>组</p>', useCount: 3, bookmarkIds: [] },
      }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: [] })] as any
      const updateSpy = vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
      const ok = await restoreFromHistory(10, 'g-1', 'group')
      expect(ok).toBe(true)
      const [idArg, changesArg] = updateSpy.mock.calls[0]
      expect(idArg).toBe('g-1')
      expect(changesArg).toMatchObject({
        name: '新组名', categoryId: 'cat-3', icon: '🎯', order: 7,
        isExpanded: true, attributes: { a: true }, notes: '<p>组</p>', useCount: 3, bookmarkIds: [],
      })
    })
  })

  describe('EditorManager.setContent 同步（防 GroupEditor 覆盖 restore）', () => {
    it('★group 分支 + 编辑器挂载 → 调 ed.commands.setContent(notes)', async () => {
      _authState.user = null
      const setContent = vi.fn()
      _edState.editor = { commands: { setContent } } as any
      setLocalHistory('g-1', [{ id: 11, created_at: '2026-01-01T00:00:00.000Z', data: { name: '组', bookmarkIds: [], notes: '<p>新</p>' } }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1' })] as any
      vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
      await restoreFromHistory(11, 'g-1', 'group')
      expect(setContent).toHaveBeenCalledWith('<p>新</p>')
    })

    it('group 分支 + notes 缺省 → setContent("") 不抛', async () => {
      _authState.user = null
      const setContent = vi.fn()
      _edState.editor = { commands: { setContent } } as any
      setLocalHistory('g-1', [{ id: 12, created_at: '2026-01-01T00:00:00.000Z', data: { name: '组' } }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1' })] as any
      vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
      await restoreFromHistory(12, 'g-1', 'group')
      expect(setContent).toHaveBeenCalledWith('')
    })

    it('group 分支 + 编辑器未挂载（get 返 null）→ 不抛', async () => {
      _authState.user = null
      _edState.editor = null
      setLocalHistory('g-1', [{ id: 13, created_at: '2026-01-01T00:00:00.000Z', data: { name: '组', bookmarkIds: [], notes: '<p>新</p>' } }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1' })] as any
      vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
      const ok = await restoreFromHistory(13, 'g-1', 'group')
      expect(ok).toBe(true) // 不抛、仍 return true、saveAppData 被调
    })

    it('bookmark 分支不调 setContent（编辑器仅 group 用）', async () => {
      _authState.user = null
      const setContent = vi.fn()
      _edState.editor = { commands: { setContent } } as any
      setLocalHistory('bm-1', [{ id: 14, created_at: '2026-01-01T00:00:00.000Z', data: { title: 'bm' } }])
      const ds = useDataStore()
      ds.bookmarks = [makeBookmark({ id: 'bm-1' })] as any
      vi.spyOn(ds, 'updateBookmark').mockImplementation(() => {})
      await restoreFromHistory(14, 'bm-1', 'bookmark')
      expect(setContent).not.toHaveBeenCalled()
    })
  })

  describe('E2E 揭密（启用+解锁 histData decryptItem）', () => {
    it('★E2E 启用+解锁时 histData 调 decryptItem 揭密再赋值', async () => {
      _authState.user = null
      _e2eState.isE2EEnabled = true
      _e2eState.isUnlocked = true
      const cipher = { name: '密文态', bookmarkIds: [] }
      _e2eState.decryptItem = vi.fn(async (_t: string, item: Record<string, unknown>) => ({ ...item, name: '明文态' }))
      setLocalHistory('g-1', [{ id: 15, created_at: '2026-01-01T00:00:00.000Z', data: cipher }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: [] })] as any
      const updateSpy = vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
      const ok = await restoreFromHistory(15, 'g-1', 'group')
      expect(ok).toBe(true)
      expect(_e2eState.decryptItem).toHaveBeenCalledTimes(1)
      expect(_e2eState.decryptItem.mock.calls[0][0]).toBe('group')
      // 揭密后赋值用明文态 name（decryptItem 返回 {...item, name:'明文态'} 进 updateGroup.name）
      expect(updateSpy.mock.calls[0][1].name).toBe('明文态')
    })

    it('decryptItem 抛错时回退 histData 原值（catch 兜底）', async () => {
      _authState.user = null
      _e2eState.isE2EEnabled = true
      _e2eState.isUnlocked = true
      const cipher = { name: '密文态', bookmarkIds: [] }
      _e2eState.decryptItem = vi.fn(async () => { throw new Error('decrypt fail') })
      setLocalHistory('g-1', [{ id: 16, created_at: '2026-01-01T00:00:00.000Z', data: cipher }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: [] })] as any
      const updateSpy = vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
      const ok = await restoreFromHistory(16, 'g-1', 'group')
      expect(ok).toBe(true)
      // 解密失败回退 histData 原值 → name 仍是密文态
      expect(updateSpy.mock.calls[0][1].name).toBe('密文态')
    })

    it('E2E 未启用：histData 原样透传不调 decryptItem', async () => {
      _authState.user = null
      _e2eState.isE2EEnabled = false
      setLocalHistory('g-1', [{ id: 17, created_at: '2026-01-01T00:00:00.000Z', data: { name: '原样', bookmarkIds: [] } }])
      const ds = useDataStore()
      ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: [] })] as any
      vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
      await restoreFromHistory(17, 'g-1', 'group')
      expect(_e2eState.decryptItem).not.toHaveBeenCalled()
    })
  })

  describe('末尾 saveAppData + return true', () => {
    it('成功 restore 后调 saveAppData', async () => {
      _authState.user = null
      setLocalHistory('bm-1', [{ id: 18, created_at: '2026-01-01T00:00:00.000Z', data: { title: 'bm' } }])
      const ds = useDataStore()
      ds.bookmarks = [makeBookmark({ id: 'bm-1' })] as any
      vi.spyOn(ds, 'updateBookmark').mockImplementation(() => {})
      const ok = await restoreFromHistory(18, 'bm-1', 'bookmark')
      expect(ok).toBe(true)
      expect(saveAppData).toHaveBeenCalled()
    })

    it('软删守门失败时不调 saveAppData（false 路径无副作用）', async () => {
      setLocalHistory('bm-soft', [{ id: 19, created_at: '2026-01-01T00:00:00.000Z', data: { title: 'bm' } }])
      const ds = useDataStore()
      ds.bookmarks = [makeBookmark({ id: 'bm-soft', deletedAt: Date.now() })] as any
      const ok = await restoreFromHistory(19, 'bm-soft', 'bookmark')
      expect(ok).toBe(false)
      expect(saveAppData).not.toHaveBeenCalled()
    })
  })
})
