/**
 * syncPushPull — fake SyncRemotePort 推演 push/pull 关键语义
 *
 * 覆盖：per-op 成败、死信 clear pending、锁定不 upsert、
 * selectAllIds error 不软删、pull merge insert。
 *
 * jsdom 无 IndexedDB：mock storage 的 syncOps 为内存队列。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── 内存 syncOps 队列（代替 Dexie）──
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
  return {
    supabase: {
      from: () => nullQ(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  }
})

import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { useAuthStore } from '../../stores/auth.js'
import { useE2EStore } from '../../stores/e2e.js'
import {
  enqueueSyncOps, drainSyncOps, clearAllSyncOps, syncOpsCount, updateSyncOpRetry,
} from '../../stores/storage.js'
import {
  useCloudSync, __testPendingSync, setSyncRemotePort, createMemorySyncPort, _isPendingSync,
} from '../../composables/domain/useCloudSync.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

function makeBm(partial: Record<string, unknown> = {}) {
  return {
    id: 'bm-pp-1',
    title: 't',
    url: 'https://x.example',
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
    ...partial,
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  __testPendingSync.clear()
  _ops = []
  _nextId = 1
  await clearAllSyncOps()
  setSyncRemotePort(null)
  const auth = useAuthStore()
  ;(auth as any).user = { id: 'user-pp', email: 'pp@test.com' }
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

afterEach(async () => {
  setSyncRemotePort(null)
  __testPendingSync.clear()
  await clearAllSyncOps()
})

describe('syncPushPull via SyncRemotePort', () => {
  it('1 per-op 成功：upsert 走 port 且 op 从队列移除', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm() as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    await enqueueSyncOps([{
      action: 'upsert',
      table: 'bookmarks',
      itemId: 'bm-pp-1',
      data: {
        ...makeBm(),
        _userId: 'user-pp',
        _isNew: true,
        _changedFields: null,
      },
      ts: Date.now(),
    }])

    const sync = useCloudSync()
    const ok = await sync.pushToCloud()
    expect(ok).toBe(true)
    expect(port.upserts.length).toBe(1)
    expect(port.upserts[0].table).toBe('bookmarks')
    expect(await syncOpsCount()).toBe(0)
    expect(useSyncStore().syncStatus).toBe('success')
  })

  it('2 per-op 失败：error 留队列并标 sync error', async () => {
    const port = createMemorySyncPort({
      upsertError: () => ({ message: 'simulated upsert fail' }),
    })
    setSyncRemotePort(port)

    await enqueueSyncOps([{
      action: 'upsert',
      table: 'bookmarks',
      itemId: 'bm-fail',
      data: {
        ...makeBm({ id: 'bm-fail' }),
        _userId: 'user-pp',
        _isNew: true,
        _changedFields: null,
      },
      ts: Date.now(),
    }])

    const sync = useCloudSync()
    const ok = await sync.pushToCloud()
    expect(ok).toBe(false)
    expect(port.upserts.length).toBe(0)
    expect(await syncOpsCount()).toBe(1)
    expect(useSyncStore().syncStatus).toBe('error')
    expect(useSyncStore().syncError).toMatch(/simulated upsert fail/)
  })

  it('3 死信：达重试上限后 remove op 并 clear pending', async () => {
    const port = createMemorySyncPort({
      upsertError: () => ({ message: 'always fail' }),
    })
    setSyncRemotePort(port)

    await enqueueSyncOps([{
      action: 'upsert',
      table: 'bookmarks',
      itemId: 'bm-dead',
      data: {
        ...makeBm({ id: 'bm-dead' }),
        _userId: 'user-pp',
        _isNew: true,
        _changedFields: null,
      },
      ts: Date.now(),
    }])
    const ops = await drainSyncOps()
    const id = ops[0]?.id
    expect(id).toBeDefined()
    await updateSyncOpRetry(id!, 2)
    __testPendingSync.add('bm-dead')

    const sync = useCloudSync()
    await sync.pushToCloud()

    expect(await syncOpsCount()).toBe(0)
    expect(_isPendingSync('bm-dead')).toBe(false)
  })

  it('4 锁定 + 敏感字段：不 upsert，op 留队', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const e2e = useE2EStore()
    e2e.setEnabled(true)
    e2e.setUnlocked(false)

    await enqueueSyncOps([{
      action: 'upsert',
      table: 'bookmarks',
      itemId: 'bm-sens',
      data: {
        ...makeBm({ id: 'bm-sens', username: 'secret-user', notes: '' }),
        _userId: 'user-pp',
        _isNew: false,
        _changedFields: ['username'],
      },
      ts: Date.now(),
    }])

    const sync = useCloudSync()
    const ok = await sync.pushToCloud()
    expect(ok).toBe(true)
    expect(port.upserts.length).toBe(0)
    expect(port.updates.length).toBe(0)
    expect(await syncOpsCount()).toBe(1)
  })

  it('5 selectAllIds error → reconcile 不软删本地', async () => {
    const ds = useDataStore()
    const syncStore = useSyncStore()
    ds.addBookmark(makeBm({ id: 'bm-keep' }) as any)
    ds._dirtyIds.clear()
    syncStore.setLastSyncAt(Date.now())

    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [],
        sibling_groups: [],
        categories: [],
        custom_attributes: [],
      },
      allIdsError: {
        bookmarks: { message: 'probe failed' },
      },
    })
    setSyncRemotePort(port)

    const sync = useCloudSync()
    const ok = await sync.pullFromCloud(false)
    expect(ok).toBe(true)
    expect(ds.bookmarkMap['bm-keep']?.deletedAt).toBeUndefined()
  })

  it('6 pull selectSince 成功 merge insert', async () => {
    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [{
          id: 'bm-remote-new',
          user_id: 'user-pp',
          title: '远端新',
          url: 'https://remote.example',
          username: '',
          password: '',
          notes: '',
          icon: '',
          category_id: CAT_UNCATEGORIZED,
          parent_id: null,
          order: 0,
          use_count: 0,
          attributes: {},
          is_expanded: false,
          created_at_num: 1000,
          updated_at_num: 9000,
          deleted_at: null,
        }],
        sibling_groups: [],
        categories: [],
        custom_attributes: [],
      },
      allIds: {
        bookmarks: [{ id: 'bm-remote-new' }],
        sibling_groups: [],
        categories: [],
        custom_attributes: [],
      },
    })
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(0)

    const sync = useCloudSync()
    const ok = await sync.pullFromCloud(false)
    expect(ok).toBe(true)
    const ds = useDataStore()
    expect(ds.bookmarks.some(b => b.id === 'bm-remote-new')).toBe(true)
  })
})
