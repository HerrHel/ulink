/**
 * syncGraveyardPurge.test.ts
 *
 * 验证回收站多设备同步彻底删除与防复活闭环：
 * 1. initialSync / _enqueueMissingToCloud 探测到墓园条目时，本地物理抹除（永久删除残留，彻底清空回收站）；
 * 2. 本地物理抹除走 _permanentDeleteWithoutEcho，不残留 _deletedIds 回声 op；
 * 3. syncImmediate 绕过 3 秒防抖立即执行 pushFromQueue；
 * 4. pullChanges(full) 全量对账时，本地已处于回收站（deletedAt 非空）且云端全表缺失项，直接物理删除，避免发霉与复活。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

type MemOp = {
  id: number
  action: 'upsert' | 'delete'
  table: 'bookmarks' | 'sibling_groups' | 'categories' | 'custom_attributes'
  itemId: string
  data: Record<string, unknown> | null
  ts: number
  retries: number
}
let _ops: MemOp[] = []
let _nextId = 1

vi.mock('../../stores/storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/storage.js')>()
  return {
    ...actual,
    enqueueSyncOps: async (ops: Array<Omit<MemOp, 'id' | 'retries'>>) => {
      for (const op of ops) {
        _ops.push({
          ...op,
          data: op.data ? JSON.parse(JSON.stringify(op.data)) : null,
          id: _nextId++,
          retries: 0,
        })
      }
    },
    drainSyncOps: async () => [..._ops],
    removeSyncOps: async (ids: number[]) => {
      const set = new Set(ids)
      _ops = _ops.filter(o => o.id == null || !set.has(o.id))
    },
    updateSyncOpRetry: async (id: number, retries: number) => {
      const o = _ops.find(x => x.id === id)
      if (o) o.retries = retries
    },
    syncOpsCount: async () => _ops.length,
    clearAllSyncOps: async () => { _ops = [] },
  }
})

vi.mock('../../lib/supabase.js', () => {
  const nullQ = () => ({
    then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ data: null, error: null }),
    select: () => nullQ(),
    eq: () => nullQ(),
    update: () => nullQ(),
    delete: () => nullQ(),
  })
  const chan = () => ({
    on: () => chan(),
    subscribe: (_cb?: (status: string) => void) => ({ unsubscribe: () => {} }),
  })
  return {
    supabase: {
      from: () => nullQ(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      channel: () => chan(),
      removeChannel: () => {},
    },
  }
})

import { useDataStore } from '../../stores/data.js'
import { useAuthStore } from '../../stores/auth.js'
import { useSyncStore } from '../../stores/sync.js'
import { clearAllSyncOps } from '../../stores/storage.js'
import {
  useCloudSync, setSyncRemotePort, createMemorySyncPort, __resetInitialSync,
} from '../../composables/domain/useCloudSync.js'
import { pullChanges } from '../../composables/domain/syncPull.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

function makeBookmark(id: string, deletedAt?: number) {
  return {
    id,
    title: 'title-' + id,
    url: 'https://example.com',
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: CAT_UNCATEGORIZED,
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 1000,
    updatedAt: 2000,
    ...(deletedAt ? { deletedAt } : {}),
  }
}

describe('syncGraveyardPurge — 回收站彻底删除与防复活闭环', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    __resetInitialSync()
    _ops = []
    _nextId = 1
    await clearAllSyncOps()
    setSyncRemotePort(null)
    const auth = useAuthStore()
    ;(auth as any).user = { id: 'test-user-1', email: 'test@example.com' }
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    setSyncRemotePort(null)
    await clearAllSyncOps()
    vi.mocked(console.warn).mockRestore()
  })

  it('墓园条目在 initialSync 时从本地物理清除，包括回收站和存活条目', async () => {
    const port = createMemorySyncPort({
      allIds: {
        bookmarks: [{ id: 'bm-alive' }],
        sibling_groups: [],
        categories: [],
        custom_attributes: [],
      },
      graveyard: [
        { table_name: 'bookmarks', item_id: 'bm-in-trash' },
        { table_name: 'bookmarks', item_id: 'bm-was-alive' },
      ],
    })
    setSyncRemotePort(port)
    const ds = useDataStore()

    // 本地有一条回收站条目，一条存活条目，一条云端已有的存活条目
    ds.addBookmark(makeBookmark('bm-in-trash', 1500) as any)
    ds.addBookmark(makeBookmark('bm-was-alive') as any)
    ds.addBookmark(makeBookmark('bm-alive') as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    expect(ds.bookmarkMap['bm-in-trash']).toBeDefined()
    expect(ds.bookmarkMap['bm-was-alive']).toBeDefined()
    expect(ds.bookmarkMap['bm-alive']).toBeDefined()

    await useCloudSync().initialSync()

    // 命中墓园的两条必须在本地被彻底抹除（物理删除）
    expect(ds.bookmarkMap['bm-in-trash']).toBeUndefined()
    expect(ds.bookmarkMap['bm-was-alive']).toBeUndefined()
    expect(ds.bookmarks.some(b => b.id === 'bm-in-trash')).toBe(false)
    expect(ds.bookmarks.some(b => b.id === 'bm-was-alive')).toBe(false)

    // 未在墓园的条目保留
    expect(ds.bookmarkMap['bm-alive']).toBeDefined()

    // 回声清理契约：无回声推送，_deletedIds 不应包含墓园被抹除的条目
    expect(ds._deletedIds.has('bm-in-trash')).toBe(false)
    expect(ds._deletedIds.has('bm-was-alive')).toBe(false)
  })

  it('syncImmediate 绕过 3 秒防抖即刻发起推送', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ds = useDataStore()

    ds.addBookmark(makeBookmark('bm-quick-del', 1500) as any)
    ds.permanentDeleteBookmark('bm-quick-del')

    expect(ds._deletedIds.get('bm-quick-del')).toBe('bookmarks')

    const sync = useCloudSync()
    const ok = await sync.syncImmediate()

    expect(ok).toBe(true)
    // 立即执行了 delete op 推送
    const deletedOps = port.deletes
    expect(deletedOps.some(d => d.id === 'bm-quick-del' && d.table === 'bookmarks')).toBe(true)
  })

  it('pullChanges(full) 全量对账时，本地处于回收站且云端全表缺失项被彻底物理抹除', async () => {
    const port = createMemorySyncPort({
      allIds: {
        bookmarks: [{ id: 'bm-remote-alive' }],
        sibling_groups: [],
        categories: [],
        custom_attributes: [],
      },
    })
    setSyncRemotePort(port)
    const ds = useDataStore()
    const syncStore = useSyncStore()
    syncStore.setLastSyncAt(1000)

    // 本地有一条处于回收站（已软删），但在云端已物理删除（allIds 缺失）
    ds.addBookmark(makeBookmark('bm-trash-ghost', 1200) as any)
    // 本地有一条存活但在云端缺失
    ds.addBookmark(makeBookmark('bm-local-alive') as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    await pullChanges(true)

    // 本地在回收站且云端彻底缺失的项，应被彻底抹除（而非继续留着）
    expect(ds.bookmarkMap['bm-trash-ghost']).toBeUndefined()
    expect(ds.bookmarks.some(b => b.id === 'bm-trash-ghost')).toBe(false)

    // 本地存活但云端缺失的项，防灾机制下被软删进回收站
    expect(ds.bookmarkMap['bm-local-alive']?.deletedAt).toBeDefined()
  })
})
