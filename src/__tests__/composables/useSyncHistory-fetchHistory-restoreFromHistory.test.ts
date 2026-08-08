/**
 * useSyncHistory-fetchHistory-restoreFromHistory.test.ts（精简版）
 *
 * 补 src/composables/domain/useSyncHistory.ts 直接护栏缺口。原 33 例含 ★真实安全/数据契约
 * (HIST-1 未登录跳过云端、E2E 揭密+失败吞错保留密文态、软删守门防误报成功、悬空 id 过滤防
 * restore 进已删项、EditorManager setContent 同步防 GroupEditor 覆盖 restore)与纯镜像(supabase
 * 链构造逐调参数、historyMax slice、E2E 启用未解锁/未启用两态、合并去重不同时戳/降序、
 * 字段集 13 字段逐镜像、setContent 缺省/未挂载/bookmark 不调互斥)。
 *
 * 此精简版留 ~15 例守核心契约,删去零增量镜像:suptable 链构造逐断言、historyMax slice 单例、
 * E2E 启用未解锁/未启用(被启用+解锁主例覆盖)、合并去重不同时戳/降序(被同戳保留云端覆盖)、
 * 软删守门四路(group 缺失代表其余三)、bookmark/group 字段集逐镜像、setContent 缺省/未挂载/
 * bookmark 不调(被 group notes 主例覆盖)、saveAppData 成功后单例(并入软删守门)。
 *
 * 纯加测试零源文件改动——fetchHistory/restoreFromHistory/_getUserId 均已 export。
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
type ListRes = { data: unknown } | null
type SingleRes = { data: Record<string, unknown> | null; error: unknown } | null
const _supabaseStub = vi.hoisted(() => ({
  listRes: null as ListRes,
  singleRes: null as SingleRes,
}))
vi.mock('../../lib/supabase.js', () => {
  const thenable = (v: unknown) => ({ then: (resolve: (v: unknown) => void) => resolve(v) })
  const chainToList = () => {
    const self: { eq: ReturnType<typeof vi.fn>; order: () => { limit: () => unknown } } = { eq: vi.fn(), order: () => ({ limit: () => thenable(_supabaseStub.listRes) }) }
    self.eq.mockReturnValue(self)
    return self
  }
  const chainToSingleInner = () => ({
    eq: () => chainToSingleInner(),
    single: () => thenable(_supabaseStub.singleRes),
  })
  const chainToSingle = () => ({ eq: () => chainToSingleInner() })
  return {
    supabase: {
      from: vi.fn(() => {
        const select = vi.fn((cols: string) => {
          if (cols === 'data') return chainToSingle()
          return chainToList()
        })
        return { select }
      }),
    },
  }
})

vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn() }))

const _edState = vi.hoisted(() => ({ editor: null as { commands: { setContent: ReturnType<typeof vi.fn> } } | null }))
vi.mock('../../lib/editor.js', () => ({ EditorManager: { get: () => _edState.editor } }))

import { fetchHistory, restoreFromHistory } from '../../composables/domain/useSyncHistory.js'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'

function setLocalHistory(itemId: string, versions: Array<{ id: number; data: Record<string, unknown>; created_at: string }>) {
  localStorage.setItem(`lv_hist:${itemId}`, JSON.stringify(versions))
}
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

describe('fetchHistory — 版本历史合并编排核心契约', () => {
  it('★HIST-1 未登录不调 supabase query，仅返本地（安全纵深不依赖 RLS）', async () => {
    _authState.user = null
    setLocalHistory('g-1', [{ id: 90, data: { notes: 'local' }, created_at: '2026-01-01T00:00:00.000Z' }])
    const result = await fetchHistory('g-1')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(90)
    const { supabase } = await import('../../lib/supabase.js')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('★E2E 启用且解锁时按 itemId 类型调 decryptItem 揭密每个云端版本', async () => {
    _authState.user = { id: 'user-1' }
    _e2eState.isE2EEnabled = true
    _e2eState.isUnlocked = true
    _e2eState.decryptItem = vi.fn(async (_t: string, item: Record<string, unknown>) => ({ ...item, decrypted: true }))
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
    expect(_e2eState.decryptItem.mock.calls[0][0]).toBe('group') // groupId 命中判定 type='group'
    expect(result[0].data).toMatchObject({ decrypted: true })
  })

  it('★decryptItem 抛错时吞错保留密文态不阻断列版本', async () => {
    _authState.user = { id: 'user-1' }
    _e2eState.isE2EEnabled = true
    _e2eState.isUnlocked = true
    const cipher = { cipher: true }
    _e2eState.decryptItem = vi.fn(async () => { throw new Error('decrypt fail') })
    _supabaseStub.listRes = { data: [{ id: 1, data: cipher, created_at: '2026-01-01T00:00:00.000Z' }] }
    const result = await fetchHistory('g-1')
    expect(result).toHaveLength(1)
    expect(result[0].data).toBe(cipher) // 不抛、返回 1 条、data 保留原密文态引用未替换
  })

  it('★本地与云端相同 created_at 时保留云端版本（去重，云端时序权威）', async () => {
    _authState.user = { id: 'user-1' }
    const sharedTs = '2026-01-01T00:00:00.000Z'
    setLocalHistory('g-1', [{ id: 90, data: { source: 'local' }, created_at: sharedTs }])
    _supabaseStub.listRes = { data: [{ id: 100, data: { source: 'cloud' }, created_at: sharedTs }] }
    const result = await fetchHistory('g-1')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(100) // 保留云端，本地同时间戳被去重剔除
    expect(result[0].data).toMatchObject({ source: 'cloud' })
  })
})

describe('restoreFromHistory — 历史恢复编排核心契约', () => {
  it('★本地有该版本时不调 supabase.query（本地命中优先）', async () => {
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

  it('★本地无版本 + 未登录 → 返 false 不查云端（HIST-1 安全纵深）', async () => {
    _authState.user = null
    const ok = await restoreFromHistory(999, 'g-1', 'group')
    expect(ok).toBe(false)
    const { supabase } = await import('../../lib/supabase.js')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('本地未命中 + 已登录 supabase 兜底：error/data 空 → false；命中 → 用云端 data', async () => {
    _authState.user = { id: 'user-1' }
    // error 路径
    _supabaseStub.singleRes = { data: null, error: new Error('rpc fail') }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await restoreFromHistory(999, 'g-1', 'group')).toBe(false)
    warnSpy.mockRestore()
    // 命中路径
    _supabaseStub.singleRes = { data: { data: { name: '云端版', bookmarkIds: ['bm-1'], notes: 'x' } }, error: null }
    const ds = useDataStore()
    ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: ['bm-1'] })] as any
    ds.bookmarks = [makeBookmark({ id: 'bm-1' })] as any
    const ok = await restoreFromHistory(999, 'g-1', 'group')
    expect(ok).toBe(true)
    expect(ds.siblingGroups[0].name).toBe('云端版')
  })

  it('★软删守门：group 缺失 / 已软删 → return false 不 update（防 restore 已删项误报成功）', async () => {
    // groupMap 缺失
    setLocalHistory('g-missing', [{ id: 1, data: { name: 'override' }, created_at: '2026-01-01T00:00:00.000Z' }])
    const ds = useDataStore()
    ds.siblingGroups = [] as any
    expect(await restoreFromHistory(1, 'g-missing', 'group')).toBe(false)
    // 已软删
    setLocalHistory('g-soft', [{ id: 1, data: { name: 'override' }, created_at: '2026-01-01T00:00:00.000Z' }])
    ds.siblingGroups = [makeGroup({ id: 'g-soft', deletedAt: Date.now() })] as any
    const updateSpy = vi.spyOn(ds, 'updateGroup')
    expect(await restoreFromHistory(1, 'g-soft', 'group')).toBe(false)
    expect(updateSpy).not.toHaveBeenCalled() // 不 update 已软删项
  })

  it('★软删守门不含 saveAppData：restore 失败路径无落盘副作用', async () => {
    setLocalHistory('bm-soft', [{ id: 19, data: { title: 'bm' }, created_at: '2026-01-01T00:00:00.000Z' }])
    const ds = useDataStore()
    ds.bookmarks = [makeBookmark({ id: 'bm-soft', deletedAt: Date.now() })] as any
    expect(await restoreFromHistory(19, 'bm-soft', 'bookmark')).toBe(false)
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('★group 悬空 bookmarkIds 被过滤（bookmarkMap 无对应 id 的不进 updateGroup；软删仍存活）', async () => {
    _authState.user = null
    setLocalHistory('g-1', [{
      id: 8, created_at: '2026-01-01T00:00:00.000Z',
      data: { name: '组名', bookmarkIds: ['bm-1', 'bm-soft', 'bm-dangling'], notes: '<p>组</p>' },
    }])
    const ds = useDataStore()
    ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: ['bm-old'] })] as any
    ds.bookmarks = [
      makeBookmark({ id: 'bm-1' }),
      makeBookmark({ id: 'bm-soft', deletedAt: Date.now() }), // 软删但仍在 bookmarkMap → 不过滤
    ] as any
    // bm-dangling 不在 bookmarks 数组 → bookmarkMap 无此 id → 被过滤
    const updateSpy = vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
    const ok = await restoreFromHistory(8, 'g-1', 'group')
    expect(ok).toBe(true)
    const [, changesArg] = updateSpy.mock.calls[0]
    expect(changesArg.bookmarkIds).toEqual(['bm-1', 'bm-soft']) // 直锁真实行为：只过滤 map 无 id，软删仍存活
  })

  it('★group 分支 + 编辑器挂载 → 调 ed.commands.setContent(notes)（防 GroupEditor 覆盖 restore）', async () => {
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

  it('★E2E 启用+解锁时 histData 调 decryptItem 揭密再赋值；抛错回退原值；未启用不调', async () => {
    const ds = useDataStore()
    ds.siblingGroups = [makeGroup({ id: 'g-1', bookmarkIds: [] })] as any
    // 启用+解密
    _e2eState.isE2EEnabled = true
    _e2eState.isUnlocked = true
    const cipher = { name: '密文态', bookmarkIds: [] }
    _e2eState.decryptItem = vi.fn(async (_t: string, item: Record<string, unknown>) => ({ ...item, name: '明文态' }))
    setLocalHistory('g-1', [{ id: 15, created_at: '2026-01-01T00:00:00.000Z', data: cipher }])
    const updateSpy = vi.spyOn(ds, 'updateGroup').mockImplementation(() => {})
    await restoreFromHistory(15, 'g-1', 'group')
    expect(_e2eState.decryptItem).toHaveBeenCalledTimes(1)
    expect(_e2eState.decryptItem.mock.calls[0][0]).toBe('group')
    expect(updateSpy.mock.calls[0][1].name).toBe('明文态')
    // 抛错回退
    _e2eState.decryptItem = vi.fn(async () => { throw new Error('decrypt fail') })
    setLocalHistory('g-1', [{ id: 16, created_at: '2026-01-01T00:00:00.000Z', data: { name: '密文态', bookmarkIds: [] } }])
    await restoreFromHistory(16, 'g-1', 'group')
    expect(updateSpy.mock.calls[1][1].name).toBe('密文态') // 解密失败回退 histData 原值
    // 未启用不调
    _e2eState.isE2EEnabled = false
    _e2eState.decryptItem.mockClear()
    setLocalHistory('g-1', [{ id: 17, created_at: '2026-01-01T00:00:00.000Z', data: { name: '原样', bookmarkIds: [] } }])
    await restoreFromHistory(17, 'g-1', 'group')
    expect(_e2eState.decryptItem).not.toHaveBeenCalled()
  })

  it('成功 restore 后调 saveAppData（落盘）', async () => {
    _authState.user = null
    setLocalHistory('bm-1', [{ id: 18, created_at: '2026-01-01T00:00:00.000Z', data: { title: 'bm' } }])
    const ds = useDataStore()
    ds.bookmarks = [makeBookmark({ id: 'bm-1' })] as any
    vi.spyOn(ds, 'updateBookmark').mockImplementation(() => {})
    const ok = await restoreFromHistory(18, 'bm-1', 'bookmark')
    expect(ok).toBe(true)
    expect(saveAppData).toHaveBeenCalled()
  })
})
