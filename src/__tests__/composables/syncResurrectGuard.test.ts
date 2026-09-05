/**
 * syncResurrectGuard — 「删除被复活」防线端到端护栏（R-RESURRECT）
 *
 * 事故：A 删除条目（软删墓碑上云）→ B 上线把本地仍存活的旧快照推回云端 →
 * 复活行携带旧 updated_at_num，A 的增量 pull 走 gt 过滤永远看不到 → 永久分叉，
 * 用户只能再删一遍。
 *
 * 修复面（本文件锁定）：
 *  1. initialSync：pull 失败 → 跳过 _enqueueMissingToCloud 补推（本地视图可能落后
 *     云端，补推=复活）。
 *  2. _enqueueMissingToCloud：墓园（032 deleted_item_graveyard）条目一律不补推，
 *     且优先级高于 dirty/new——服务端触发器虽会拦截存活重推，客户端预排除避免
 *     每次 initialSync 反复入队注定失败的 op。
 *  3. pullChanges(full) 墓碑重申：云端存活但 updated_at_num 早于本地墓碑 → 重推
 *     墓碑收敛历史分叉；远端更新（正规恢复/revive）不受影响。
 *  4. 增量 pull 游标安全余量：since = lastSyncAt - PULL_SINCE_SAFETY_MS（设备间
 *     时钟偏差不再漏收他端新写入的墓碑）。
 *  5. bumpBookmarkUseCount：静默计数（不标脏/不刷 updatedAt），点开书签不再生成
 *     同步 op。
 *
 * 服务端防线（BEFORE UPDATE/INSERT 触发器 + 墓园）见
 * supabase/migrations/032_sync_delete_guard.sql 与 supabase/tests/database.test.sql。
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
import { useSyncStore } from '../../stores/sync.js'
import { useAuthStore } from '../../stores/auth.js'
import { clearAllSyncOps, syncOpsCount } from '../../stores/storage.js'
import {
  useCloudSync, setSyncRemotePort, createMemorySyncPort, __resetInitialSync,
} from '../../composables/domain/useCloudSync.js'
import { pullChanges, PULL_SINCE_SAFETY_MS } from '../../composables/domain/syncPull.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

function makeBm(partial: Record<string, unknown> = {}) {
  return {
    id: 'bm-rg-1',
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

/** 远端存活行（snake_case，经 FROM_REMOTE/Zod 校验） */
function remoteAliveRow(id: string, updatedAtNum: number) {
  return {
    id,
    user_id: 'user-rg',
    title: '远端存活',
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
    updated_at_num: updatedAtNum,
    deleted_at: null,
  }
}

const EMPTY_ROWS = {
  bookmarks: [] as unknown[],
  sibling_groups: [] as unknown[],
  categories: [] as unknown[],
  custom_attributes: [] as unknown[],
}
const EMPTY_ALL_IDS = {
  bookmarks: [] as Array<{ id: string }>,
  sibling_groups: [] as Array<{ id: string }>,
  categories: [] as Array<{ id: string }>,
  custom_attributes: [] as Array<{ id: string }>,
}

beforeEach(async () => {
  setActivePinia(createPinia())
  __resetInitialSync()
  _ops = []
  _nextId = 1
  await clearAllSyncOps()
  setSyncRemotePort(null)
  const auth = useAuthStore()
  ;(auth as any).user = { id: 'user-rg', email: 'rg@test.com' }
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  setSyncRemotePort(null)
  await clearAllSyncOps()
  vi.mocked(console.warn).mockRestore()
})

describe('initialSync 补推防线（R-RESURRECT）', () => {
  it('pull 失败 → 跳过补推（本地视图落后云端时补推=把已删条目复活）', async () => {
    const port = createMemorySyncPort({
      selectSinceError: { message: 'pull boom' },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-stale' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    await useCloudSync().initialSync()

    // pull 两次均失败，_enqueueMissingToCloud 未执行：无任何 op 入队/推送
    expect(port.upserts.length).toBe(0)
    expect(await syncOpsCount()).toBe(0)
  })

  it('墓园条目不补推：clean/dirty 均跳过（graveyard 优先级最高），墓园外条目照常 backfill', async () => {
    const port = createMemorySyncPort({
      allIds: {
        bookmarks: [],
        sibling_groups: [],
        categories: [],
        custom_attributes: [],
      },
      graveyard: [
        { table_name: 'bookmarks', item_id: 'bm-gone' },
        { table_name: 'bookmarks', item_id: 'bm-gone-dirty' },
      ],
    })
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-gone' }) as any)
    ds.addBookmark(makeBm({ id: 'bm-gone-dirty' }) as any)
    ds.addBookmark(makeBm({ id: 'bm-fresh' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds._dirtyIds.add('bm-gone-dirty') // 墓园优先级高于 dirty

    await useCloudSync().initialSync()

    const pushedIds = port.upserts.map(u => u.row.id)
    expect(pushedIds).not.toContain('bm-gone')
    expect(pushedIds).not.toContain('bm-gone-dirty')
    expect(pushedIds).toContain('bm-fresh') // 控制组：云端缺失且不在墓园 → backfill
  })

  it('pull 成功 → 补推照常执行（首次登录建基线不受防线影响）', async () => {
    const port = createMemorySyncPort({
      allIds: {
        bookmarks: [],
        sibling_groups: [],
        categories: [],
        custom_attributes: [],
      },
    })
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-base' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    await useCloudSync().initialSync()

    expect(port.upserts.map(u => u.row.id)).toContain('bm-base')
  })
})

describe('pullChanges(full) 墓碑重申（R-RESURRECT 反向对账）', () => {
  function seedLocalTombstone(id: string, tombTime: number) {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds.deleteBookmark(id)
    ds._dirtyIds.clear() // deleteBookmark 标脏，重申判据要求非 dirty
    // deleteBookmark 以 Date.now() 覆盖 updatedAt/deletedAt，改写为确定性时间戳
    const bm = ds.bookmarkMap[id]
    bm!.deletedAt = tombTime
    bm!.updatedAt = tombTime
    expect(bm?.deletedAt).toBeTruthy()
  }

  it('云端存活但早于本地墓碑 → fullSync 重推墓碑上云（分叉自愈）', async () => {
    // 本地 10:00 删除；云端是被他端旧快照复活的存活行（时间戳 09:00）
    seedLocalTombstone('bm-fork', 9_000)
    const port = createMemorySyncPort({
      sinceRows: { ...EMPTY_ROWS, bookmarks: [remoteAliveRow('bm-fork', 5_000)] },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: { ...EMPTY_ALL_IDS, bookmarks: [{ id: 'bm-fork' }] },
    })
    setSyncRemotePort(port)
    const syncStore = useSyncStore()
    syncStore.setLastSyncAt(Date.now()) // canReconcile 要求 lastSyncAt > 0

    const ok = await useCloudSync().fullSync()

    expect(ok).toBe(true)
    const reassert = port.upserts.find(u => u.row.id === 'bm-fork')
    expect(reassert).toBeTruthy()
    expect(reassert!.row.deleted_at).toBeTruthy()  // 重申的是墓碑而非存活快照
    expect(reassert!.row.updated_at_num).toBe(9_000)
    // 本地保持墓碑态（重申不改变本地数据）
    expect(useDataStore().bookmarkMap['bm-fork']?.deletedAt).toBeTruthy()
  })

  it('云端存活且更新（正规恢复）→ revive 本地，不重申', async () => {
    seedLocalTombstone('bm-revive', 1_000)
    const port = createMemorySyncPort({
      sinceRows: { ...EMPTY_ROWS, bookmarks: [remoteAliveRow('bm-revive', 9_000)] },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: { ...EMPTY_ALL_IDS, bookmarks: [{ id: 'bm-revive' }] },
    })
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(Date.now())

    await useCloudSync().pullFromCloud(true)

    const ds = useDataStore()
    expect(ds.bookmarkMap['bm-revive']?.deletedAt).toBeUndefined() // revive-assign
    expect(await syncOpsCount()).toBe(0) // 无重申 op
  })

  it('云端是墓碑（正常软删传播）→ 不重申', async () => {
    seedLocalTombstone('bm-both-del', 5_000)
    const remoteTombstoned = {
      ...remoteAliveRow('bm-both-del', 6_000),
      deleted_at: new Date(6_000).toISOString(),
    }
    const port = createMemorySyncPort({
      sinceRows: { ...EMPTY_ROWS, bookmarks: [remoteTombstoned] },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: { ...EMPTY_ALL_IDS, bookmarks: [{ id: 'bm-both-del' }] },
    })
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(Date.now())

    await useCloudSync().pullFromCloud(true)

    expect(await syncOpsCount()).toBe(0)
  })

  it('增量 pull 不触发重申（仅 full 对账运行）', async () => {
    seedLocalTombstone('bm-incr', 9_000)
    const port = createMemorySyncPort({
      sinceRows: { ...EMPTY_ROWS, bookmarks: [remoteAliveRow('bm-incr', 5_000)] },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(Date.now())

    await useCloudSync().pullFromCloud(false)

    expect(await syncOpsCount()).toBe(0)
  })
})

describe('增量 pull 游标时钟偏移安全余量', () => {
  function capturingPort() {
    const base = createMemorySyncPort({
      sinceRows: { ...EMPTY_ROWS },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    const seen: number[] = []
    const wrapped = {
      ...base,
      selectSince: async (table: Parameters<typeof base.selectSince>[0], userId: string, since: number) => {
        seen.push(since)
        return base.selectSince(table, userId, since)
      },
    }
    return { port: wrapped, seen }
  }

  it('增量 pull：since = lastSyncAt - PULL_SINCE_SAFETY_MS（时钟偏差不漏墓碑）', async () => {
    const { port, seen } = capturingPort()
    setSyncRemotePort(port)
    const lastSync = Date.now()
    useSyncStore().setLastSyncAt(lastSync)

    await pullChanges(false)

    expect(seen.length).toBeGreaterThan(0)
    const expected = lastSync - PULL_SINCE_SAFETY_MS
    for (const s of seen) expect(s).toBe(expected)
  })

  it('lastSyncAt 小于余量 → since 收敛到 0（不产生负游标）', async () => {
    const { port, seen } = capturingPort()
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(1000)

    await pullChanges(false)

    expect(seen.length).toBeGreaterThan(0)
    for (const s of seen) expect(s).toBe(0)
  })

  it('full pull：since 恒为 0，不受余量影响', async () => {
    const { port, seen } = capturingPort()
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(Date.now())

    await pullChanges(true)

    expect(seen.length).toBeGreaterThan(0)
    for (const s of seen) expect(s).toBe(0)
  })
})

describe('bumpBookmarkUseCount 静默计数（R-RESURRECT 修复6）', () => {
  it('累加 useCount 但不标脏、不刷 updatedAt、不记 changedFields', () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-uc', useCount: 3, updatedAt: 5555 }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds._changedFields.clear()

    ds.bumpBookmarkUseCount('bm-uc')

    const bm = ds.bookmarkMap['bm-uc']
    expect(bm?.useCount).toBe(4)
    expect(bm?.updatedAt).toBe(5555) // 不刷新时间戳
    expect(ds._dirtyIds.has('bm-uc')).toBe(false)
    expect(ds._changedFields.has('bm-uc')).toBe(false)
  })

  it('软删项与不存在的 id 为 no-op（不产生任何脏状态）', () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-del-uc' }) as any)
    ds.deleteBookmark('bm-del-uc')
    ds._dirtyIds.clear()
    const tombUpdatedAt = ds.bookmarkMap['bm-del-uc']?.updatedAt

    ds.bumpBookmarkUseCount('bm-del-uc')
    ds.bumpBookmarkUseCount('bm-not-exist')

    expect(ds.bookmarkMap['bm-del-uc']?.useCount).toBe(0)
    expect(ds.bookmarkMap['bm-del-uc']?.updatedAt).toBe(tombUpdatedAt)
    expect(ds._dirtyIds.size).toBe(0)
  })
})
