/**
 * useDataShare-management.test.ts — 分享管理（停止分享、全部停止、分类分享拉取）单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useAuthStore } from '../../stores/auth.js'
import {
  stopShareGroup,
  stopShareCategory,
  stopAllUserShares,
  fetchUserCategoryShares,
} from '../../composables/domain/useDataShare.js'

// Mock supabase
const _mockDelete = vi.fn().mockReturnThis()
const _mockSelect = vi.fn().mockReturnThis()
const _mockEq = vi.fn()
const _mockAuthGetUser = vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } })

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getUser: () => _mockAuthGetUser(),
    },
    from: (_table: string) => ({
      delete: () => {
        _mockDelete()
        return {
          eq: (_col1: string, _val1: string) => ({
            eq: (_col2: string, _val2: string) => Promise.resolve({ error: null }),
          }),
        }
      },
      select: (_cols: string) => {
        _mockSelect()
        return {
          eq: (_col: string, _val: string) => Promise.resolve({
            data: [{ id: 'share-123', category_id: 'cat-abc' }],
            error: null,
          }),
        }
      },
      update: () => ({
        eq: (_col1: string, _val1: string) => ({
          eq: (_col2: string, _val2: string) => Promise.resolve({ error: null }),
        }),
      }),
    }),
  },
  isSupabaseConfigured: () => true,
}))

// Mock syncShare setGroupPublic
vi.mock('../../composables/domain/syncShare.js', async () => {
  const actual = await vi.importActual<typeof import('../../composables/domain/syncShare.js')>('../../composables/domain/syncShare.js')
  return {
    ...actual,
    setGroupPublic: vi.fn(async (gid: string, isPub: boolean) => {
      const ds = useDataStore()
      if (ds.groupMap[gid]) {
        ds.groupMap[gid].isPublic = isPub
      }
      return true
    }),
  }
})

describe('Share Management API', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const authStore = useAuthStore()
    authStore.user = { id: 'test-user-id' } as any
    vi.clearAllMocks()
  })

  it('stopShareGroup updates group isPublic to false', async () => {
    const ds = useDataStore()
    ds.siblingGroups = [
      { id: 'grp-1', name: '公开组 1', categoryId: 'c1', order: 0, bookmarkIds: [], isPublic: true } as any,
    ]

    const ok = await stopShareGroup('grp-1')
    expect(ok).toBe(true)
    expect(ds.groupMap['grp-1']?.isPublic).toBe(false)
  })

  it('stopShareGroup returns false if group does not exist', async () => {
    const ok = await stopShareGroup('non-existent')
    expect(ok).toBe(false)
  })

  it('stopShareCategory deletes record from public_category_shares', async () => {
    // Inject auth user
    localStorage.setItem('supabase.auth.token', JSON.stringify({
      currentSession: { user: { id: 'test-user-id' } },
    }))

    const ok = await stopShareCategory('cat-abc')
    expect(ok).toBe(true)
  })

  it('stopAllUserShares closes all public groups and deletes all category shares', async () => {
    const ds = useDataStore()
    ds.siblingGroups = [
      { id: 'grp-1', name: '组 1', categoryId: 'c1', order: 0, bookmarkIds: [], isPublic: true } as any,
      { id: 'grp-2', name: '组 2', categoryId: 'c1', order: 1, bookmarkIds: [], isPublic: true } as any,
      { id: 'grp-3', name: '组 3', categoryId: 'c1', order: 2, bookmarkIds: [], isPublic: false } as any,
    ]

    const ok = await stopAllUserShares()
    expect(ok).toBe(true)
    expect(ds.siblingGroups.every(g => !g.isPublic)).toBe(true)
  })

  it('fetchUserCategoryShares returns category share list for logged in user', async () => {
    localStorage.setItem('supabase.auth.token', JSON.stringify({
      currentSession: { user: { id: 'test-user-id' } },
    }))

    const shares = await fetchUserCategoryShares()
    expect(shares).toEqual([{ id: 'share-123', category_id: 'cat-abc' }])
  })
})
