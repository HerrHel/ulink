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
    // 锁定跳过的 op 被显式计入 pendingLockedCount，徽章据此显示「等待解锁后同步」
    // 而非笼统「N 项待同步」无从归因。
    expect(useSyncStore().pendingLockedCount).toBe(1)
  })

  it('4b 解锁态重推：lockedItemKeys 为空 → pendingLockedCount 复位为 0', async () => {
    // 不管 op 本身加密成败，解锁后 isLocked=false → pushFromQueue 末尾
    // setPendingLockedCount(lockedItemKeys.size=0) 把 stale 计数清掉。
    // 这正是用户解锁后徽章从「等待解锁后同步」恢复正常的语义保证。
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const e2e = useE2EStore()
    const syncStore = useSyncStore()
    e2e.setEnabled(true)
    e2e.setUnlocked(true) // 已解锁：isLocked=false，无锁定跳过

    await enqueueSyncOps([{
      action: 'upsert',
      table: 'sibling_groups',
      itemId: 'sg-x',
      data: {
        // name/notes 留空 → _opNeedsUnlock 判 false（无敏感字段需加密），
        // 解锁态下也不经 encryptField，避开 jsdom 无 SubtleCrypto 的干扰，
        // 专注验证 isLocked=false 时末尾 setPendingLockedCount(0) 复位计数。
        id: 'sg-x', name: '', notes: '', categoryId: 'cat-1', order: 3,
        _userId: 'user-pp', _isNew: false, _changedFields: ['order'],
      },
      ts: Date.now(),
    }])
    syncStore.setPendingLockedCount(5) // 假装 stale

    const sync = useCloudSync()
    await sync.pushToCloud()
    expect(syncStore.pendingLockedCount).toBe(0)
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

  it('7 审计 R1：resetSyncState 清空 IDB syncOps 队列与模块级 _pendingSyncIds（防跨账号残留）', async () => {
    // 模拟 A 登录断网 push 失败后队列残留 + pending 标记未清 ——
    // onLogout 调 resetSyncState 必须一并清队列与 pending，否则 B 登录 initialSync 会推到 B 云端。
    const ds = useDataStore()
    ds.addBookmark(makeBm() as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-residual',
      data: { ...makeBm(), id: 'bm-residual', _userId: 'user-A', _isNew: true, _changedFields: null },
      ts: Date.now(),
    }])
    __testPendingSync.add('bm-residual')
    expect(await syncOpsCount()).toBe(1)
    expect(_isPendingSync('bm-residual')).toBe(true)

    const sync = useCloudSync()
    await sync.resetSyncState()

    expect(await syncOpsCount()).toBe(0)
    expect(_isPendingSync('bm-residual')).toBe(false)
  })

  it('8 审计 R12：push 部分失败仍 pull，不因单条坏 op 阻断多设备变更拉取', async () => {
    // 旧实现 fullSync 用 `if (pushed) await pullChanges()`，pushed 单布尔守门：
    // 任一 op 失败 pushFromQueue 返回 false → 整体跳过 pull → 1 条坏 op 长期阻断 pull
    // 直到该 op 进死信。修后 pull 独立于 push 成败，坏 op 留队列待重试，仍拉远端变更。
    const ds = useDataStore()
    ds._dirtyIds.clear()
    ds._newIds.clear()

    // 队列里 2 条 op：bm-ok 推送成功，bm-fail 推送失败
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-ok',
      data: { ...makeBm({ id: 'bm-ok' }), _userId: 'user-pp', _isNew: true, _changedFields: null },
      ts: 1000,
    }, {
      action: 'upsert', table: 'bookmarks', itemId: 'bm-fail',
      data: { ...makeBm({ id: 'bm-fail' }), _userId: 'user-pp', _isNew: true, _changedFields: null },
      ts: 1001,
    }])

    // 远端 preapare 一条新书签供 pull merge 进本地（验证 pull 真的跑了）
    const port = createMemorySyncPort({
      upsertError: (_t, row) => (row.id === 'bm-fail' ? { message: 'partial upsert fail' } : null),
      sinceRows: {
        bookmarks: [{
          id: 'bm-remote-arrived', user_id: 'user-pp',
          title: '远端到达', url: 'https://remote.example', username: '', password: '',
          notes: '', icon: '', category_id: CAT_UNCATEGORIZED, parent_id: null,
          order: 0, use_count: 0, attributes: {}, is_expanded: false,
          created_at_num: 1000, updated_at_num: 9000, deleted_at: null,
        }],
        sibling_groups: [], categories: [], custom_attributes: [],
      },
    })
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(0)

    const sync = useCloudSync()
    const ok = await sync.fullSync()

    // fullSync 仍返回 false（push 有失败），但 pull 已执行——远端书签被拉进本地
    expect(ok).toBe(false)
    expect(ds.bookmarks.some(b => b.id === 'bm-remote-arrived')).toBe(true)
    // bm-fail 推送失败 → 留队列；bm-ok 推送成功 → 已移除
    expect(await syncOpsCount()).toBe(1)
    // push 失败状态被保留（不被 pull 的 success 覆盖），用户感知到有失败
    expect(useSyncStore().syncStatus).toBe('error')
    expect(useSyncStore().syncError).toMatch(/partial upsert fail/)
  })
})
