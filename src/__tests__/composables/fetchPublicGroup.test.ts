/**
 * QUAL：fetchPublicGroup 走 get_public_group RPC（SEC-01 列级隔离）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const rpcMock = vi.hoisted(() => vi.fn())
const fromMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => ({ isLoggedIn: false, user: null }),
}))

vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({
    isUnlocked: { value: false },
    encryptItem: async (_t: string, x: unknown) => x,
    decryptItem: async (_t: string, x: unknown) => x,
  }),
}))

vi.mock('../../composables/domain/useSyncRealtime.js', () => ({
  subscribeRealtime: vi.fn(),
  unsubscribeRealtime: vi.fn(),
}))

vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))

import { useCloudSync } from '../../composables/domain/useCloudSync.js'

beforeEach(() => {
  setActivePinia(createPinia())
  rpcMock.mockReset()
  fromMock.mockReset()
})

describe('fetchPublicGroup SEC-01 RPC', () => {
  it('成功：rpc get_public_group 映射 group + bookmarks，强制空凭证', async () => {
    rpcMock.mockResolvedValue({
      data: {
        group: {
          id: 'g-pub',
          name: '公开组',
          category_id: 'uncategorized',
          icon: '',
          order: 0,
          is_expanded: false,
          attributes: {},
          bookmark_ids: ['b1'],
          notes: 'hello',
          use_count: 0,
          is_public: true,
          updated_at_num: 100,
          deleted_at: null,
        },
        bookmarks: [
          {
            id: 'b1',
            title: '链接',
            url: 'https://example.com',
            notes: '',
            icon: '',
            category_id: 'uncategorized',
            parent_id: null,
            order: 0,
            attributes: {},
            is_expanded: false,
            created_at_num: 1,
            updated_at_num: 1,
            deleted_at: null,
          },
        ],
      },
      error: null,
    })

    const { fetchPublicGroup } = useCloudSync()
    const res = await fetchPublicGroup('g-pub')

    expect(rpcMock).toHaveBeenCalledWith('get_public_group', { p_gid: 'g-pub' })
    expect(fromMock).not.toHaveBeenCalled()
    expect(res).not.toBeNull()
    expect(res!.group.name).toBe('公开组')
    expect(res!.bookmarks).toHaveLength(1)
    expect(res!.bookmarks[0].url).toBe('https://example.com')
    expect(res!.bookmarks[0].username).toBe('')
    expect(res!.bookmarks[0].password).toBe('')
  })

  it('rpc error 或 null → 返回 null', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'fn missing' } })
    const { fetchPublicGroup } = useCloudSync()
    expect(await fetchPublicGroup('x')).toBeNull()
  })

  it('payload 无 group → null', async () => {
    rpcMock.mockResolvedValue({ data: { bookmarks: [] }, error: null })
    const { fetchPublicGroup } = useCloudSync()
    expect(await fetchPublicGroup('x')).toBeNull()
  })
})
