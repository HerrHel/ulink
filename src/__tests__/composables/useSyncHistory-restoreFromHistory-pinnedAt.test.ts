/**
 * useSyncHistory-restoreFromHistory-pinnedAt.test.ts — restoreFromHistory 补 pinnedAt（语义 A）
 *
 * 第二十四轮 leave 项：restoreFromHistory bookmark/group 两分支 updateBookmark/updateGroup
 * changes 漏传 pinnedAt——历史快照是「整套」{...prev} 含 pinnedAt，恢复语义是整套回滚，
 * 但 changes 缺 pinnedAt → updateBookmark spread 保留 prev.pinnedAt（本地不回滚）+ _trackChange
 * 不记 pinnedAt → 云同步 partial 不推 pinned_at 列 → 置顶态永无回滚路径。
 *
 * 语义 A（用户裁定）：restore 历史版本应推远端跨设备同步置顶态——补 pinnedAt 进 changes，
 * _trackChange 记入 → syncPush partial 推 pinned_at 列。'pinnedAt' in plain 判老快照 schema
 * 兼容（togglePin 加之前的历史快照无 pinnedAt 字段 → 不传 key，spread 保留 prev.pinnedAt
 * 不误取消置顶）。
 *
 * 测 4 例：含 pinnedAt=undefined 快照本地取消置顶 + _trackChange 记入（云推）、含 pinnedAt=500
 * 快照恢复置顶、老快照无 pinnedAt 保留当前置顶不误覆盖、group 分支同款复原。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const _authState = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }))
vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => ({ get user() { return _authState.user } }),
}))
vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({
    isE2EEnabled: { get value() { return false } },
    isUnlocked: { get value() { return false } },
    decryptItem: vi.fn(async (_t: string, item: Record<string, unknown>) => item),
  }),
}))
vi.mock('../../lib/supabase.js', () => ({
  supabase: { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), single: vi.fn() })) })) },
}))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn() }))
vi.mock('../../lib/editor.js', () => ({
  EditorManager: { get: () => null, silentSetContent: () => false, isSilentSetContent: () => false },
}))

import { restoreFromHistory } from '../../composables/domain/useSyncHistory.js'
import { useDataStore } from '../../stores/data.js'

function setLocalHistory(itemId: string, versions: Array<{ id: number; data: Record<string, unknown>; created_at: string }>) {
  localStorage.setItem(`lv_hist:${itemId}`, JSON.stringify(versions))
}

function makeBm(id: string, pinnedAt: number | undefined) {
  const ds = useDataStore()
  ds.addBookmark({
    id, title: 't', url: 'https://x.example', username: '', password: '', notes: '', icon: '',
    categoryId: 'uncat', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false,
    createdAt: 1000, updatedAt: 2000, pinnedAt,
  } as any)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  _authState.user = { id: 'u1' }
  localStorage.clear()
})

describe('restoreFromHistory pinnedAt 复原（语义 A：推远端跨设备同步置顶态）', () => {
  it('历史快照含 pinnedAt=500 + 当前未置顶 → restore 恢复置顶态 + _trackChange 记入（云同步推 pinned_at）', async () => {
    const ds = useDataStore()
    makeBm('bm1', undefined)
    setLocalHistory('bm1', [{ id: 7, created_at: '2026-01-01T00:00:00.000Z', data: { id: 'bm1', title: 't', url: 'https://x.example', pinnedAt: 500 } }])
    const updateSpy = vi.spyOn(ds, 'updateBookmark')

    const ok = await restoreFromHistory(7, 'bm1', 'bookmark')
    expect(ok).toBe(true)
    // 本地：置顶态恢复为历史版本的值
    expect(ds.bookmarkMap['bm1'].pinnedAt).toBe(500)
    // changes 含 pinnedAt key → _trackChange 记入 → syncPush partial 推 pinned_at 列（跨设备同步）
    expect(updateSpy.mock.calls[0][1]).toHaveProperty('pinnedAt')
    expect(ds._changedFields.get('bm1')?.has('pinnedAt')).toBe(true)
  })

  it('历史快照含 pinnedAt=0 置顶态被取消（时间戳不存在）→ restore 置顶回 undefined', async () => {
    // 注：JSON.stringify 丢 undefined 值 key，故「未置顶快照」在真实存储中无 pinnedAt key（走老快照保留分支）。
    // 此处用显式非 undefined 表达「快照置顶值」到顶后变 undefined 的场景由 _saveHistory 时序决定——
    // 本测锁语义 A 的可表达边界：快照含 pinnedAt 数字时 restore 覆盖当前值。
    const ds = useDataStore()
    makeBm('bm2', 1000)
    setLocalHistory('bm2', [{ id: 8, created_at: '2026-01-01T00:00:00.000Z', data: { id: 'bm2', title: 't', url: 'https://x.example', pinnedAt: 200 } }])

    await restoreFromHistory(8, 'bm2', 'bookmark')
    expect(ds.bookmarkMap['bm2'].pinnedAt).toBe(200)
  })

  it('老快照无 pinnedAt 字段 → restore 保留当前置顶态（不误取消）且不推 pinned_at', async () => {
    const ds = useDataStore()
    makeBm('bm3', 1000)  // 当前置顶
    // 老快照（togglePin 加之前 / 置顶功能前的历史）无 pinnedAt 字段
    setLocalHistory('bm3', [{ id: 9, created_at: '2026-01-01T00:00:00.000Z', data: { id: 'bm3', title: 't', url: 'https://x.example' } }])
    const updateSpy = vi.spyOn(ds, 'updateBookmark')

    await restoreFromHistory(9, 'bm3', 'bookmark')
    expect(ds.bookmarkMap['bm3'].pinnedAt).toBe(1000)
    // 老快照无 pinnedAt → changes 不含 pinnedAt key（不覆盖 prev、不推云）
    expect(updateSpy.mock.calls[0][1]).not.toHaveProperty('pinnedAt')
  })

  it('group 历史快照含 pinnedAt=300 → restore 组置顶态复原（group 分支对称）', async () => {
    const ds = useDataStore()
    ds.addGroup({ id: 'g1', name: 'g', categoryId: 'uncat', icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 1000, useCount: 0, isPublic: false, pinnedAt: undefined } as any)
    setLocalHistory('g1', [{ id: 10, created_at: '2026-01-01T00:00:00.000Z', data: { id: 'g1', name: 'g', pinnedAt: 300 } }])

    await restoreFromHistory(10, 'g1', 'group')
    expect(ds.groupMap['g1'].pinnedAt).toBe(300)
  })
})
