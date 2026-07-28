/**
 * initialSync 编排护栏 — D1-5
 *
 * 锁定 useCloudSync.initialSync （useCloudSync.ts:102-154）顶层编排的不变量：
 *   1. _initialized 幂等守卫：首次跑完后第二次直接空跑（不再 pull/push/not lazy subscribe 标记）。
 *   2. 未登录（auth.user 缺失）→ 直接 return。
 *   3. 双轮 pullChanges：首尾各一次（依据 setLastSyncAt 被设成功标记首 pull 跑通）。
 *   4. remoteIds id 探针：4 表 selectAllIds 合集；某表 error 跳过（该表项 fallback 全当远端无 → 全推）。
 *   5. shouldPush 四元回推条件：(a) 在 _dirtyIds、(b) 在 _newIds、(c) deletedAt 非空、
 *      (d) 远端无该 id 全部入 backfill；远端有 + 未脏未新 + 未删 → 不推（避免回环）。
 *   6. polled-and-push 落盘：被推项经 enqueueSyncOps+pushFromQueue 进去并转发至 port.upserts/updates。
 *
 * pullChanges / pushFromQueue 内部语义由各自独立测试覆盖，本护栏聚焦 initialSync 顶层流程的
 * 4 种因子编排与幂等性。jsdom 无真 IDB：借 syncPushPull.test.ts 同款 storage 内存队列 mock。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── 内存 syncOps 队列（替代 Dexie）── 与生产 storage 队列接口等价
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
        _ops.push({ ...op, data: op.data ? JSON.parse(JSON.stringify(op.data)) : null, id: _nextId++, retries: 0 })
      }
    },
    drainSyncOps: async () => [..._ops],
    removeSyncOps: async (ids: number[]) => { const s = new Set(ids); _ops = _ops.filter(o => o.id == null || !s.has(o.id)) },
    updateSyncOpRetry: async (id: number, retries: number) => { const o = _ops.find(x => x.id === id); if (o) o.retries = retries },
    syncOpsCount: async () => _ops.length,
    clearAllSyncOps: async () => { _ops = [] },
  }
})

// ── supabase mock：data_history insert / user_security select 均 stub；
//    channel 需支撑 subscribeRealtime 的 .channel().on().subscribe() 链 ──
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
import {
  useCloudSync, setSyncRemotePort, createMemorySyncPort, __resetInitialSync,
} from '../../composables/domain/useCloudSync.js'
import { clearAllSyncOps } from '../../stores/storage.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

// 不直接落 op 入队；initialSync 自身 enqueueSyncOps+pushFromQueue 即触发推送。

function makeBm(p: Record<string, unknown> = {}) {
  return {
    id: 'bm-init-1',
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
    attributes: {} as Record<string, boolean>,
    isExpanded: false,
    createdAt: 1000,
    updatedAt: 2000,
    ...p,
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  __resetInitialSync()
  _ops = []
  _nextId = 1
  await clearAllSyncOps()
  setSyncRemotePort(null)
  const auth = useAuthStore()
  ;(auth as any).user = { id: 'user-init', email: 'init@test.com' }
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

afterEach(async () => {
  setSyncRemotePort(null)
  await clearAllSyncOps()
})

/** 仅 bookmarks 上的编排面（足够覆盖 4 表中的 group/category/attribute 同形逻辑） */
async function prepareBookmarks(items: Array<{ id: string; dirty?: boolean; isNew?: boolean; deletedAt?: number }>) {
  const ds = useDataStore()
  for (const it of items) {
    ds.addBookmark(makeBm({ id: it.id, deletedAt: it.deletedAt }) as any)
  }
  // addBookmark 自身会向 _newIds 写入，测试需精确控制因子，故清后手动重打标
  ds._newIds.clear()
  ds._dirtyIds.clear()
  for (const it of items) {
    if (it.dirty) ds._dirtyIds.add(it.id)
    if (it.isNew) ds._newIds.add(it.id)
  }
  return ds
}

describe('initialSync 编排护栏', () => {
  it('1 未登录时直接 return（不 pull 的 Legacy 标记不被设、lastSyncAt 仍为空）', async () => {
    const auth = useAuthStore()
    ;(auth as any).user = null
    setSyncRemotePort(createMemorySyncPort())
    const sync = useCloudSync()
    const syncStore = useSyncStore()

    await sync.initialSync()

    expect(syncStore.lastSyncAt).toBe(0) // 说明首轮 pullChanges 全程未跑
  })

  it('2 _initialized 幂等守卫：连调两次，后一次不再触发回推', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ds = await prepareBookmarks([
      { id: 'bm-dirty', dirty: true },   // 应推
      { id: 'bm-clean' },                 // 不在 remoteIds → 因远端无 → 也应推
    ])
    void ds
    const sync = useCloudSync()
    const syncStore = useSyncStore()

    await sync.initialSync()
    const firstUpsertCount = port.upserts.length
    expect(firstUpsertCount).toBeGreaterThan(0)
    expect(syncStore.lastSyncAt).toBeGreaterThan(0)
    const firstLastSyncAt = syncStore.lastSyncAt

    // 第二次：守卫已置 true → 直接 return，不再 pull/push/subscribe
    await sync.initialSync()
    expect(port.upserts.length).toBe(firstUpsertCount) // 没有新增推送
    expect(syncStore.lastSyncAt).toBe(firstLastSyncAt) // 未再 pull（lastSyncAt 不变）
  })

  it('3 shouldPush 四元回推条件：dirty/new/远端无 → backfill；远端已有且非脏非新非删 → 不推', async () => {
    // 远端已有的 id：bm-remote 既是远端 also 本地存在且未脏未新未删 → 不应推
    // 远端无的 id：bm-absent 本地未脏未新未删 → 因 !remoteIds.has → 应推（backfill）
    // 本地脏但远端有：bm-dirty-remote → 仅凭 _dirtyIds 命中 → 应推
    // 本地新：bm-new → _newIds 命中 → 应推
    const port = createMemorySyncPort({
      allIds: { bookmarks: [{ id: 'bm-remote' }, { id: 'bm-dirty-remote' }] },
    })
    setSyncRemotePort(port)
    await prepareBookmarks([
      { id: 'bm-remote' },                // 远端有 + 非脏非新非删 → 不推
      { id: 'bm-absent' },                // 远端无 → 推
      { id: 'bm-dirty-remote', dirty: true }, // dirty → 推
      { id: 'bm-new', isNew: true },      // new → 推
    ])
    const sync = useCloudSync()

    await sync.initialSync()

    const pushedIds = port.upserts.map(u => u.row.id)
    expect(pushedIds).not.toContain('bm-remote')          // 已同步且无变更 → 不回推
    expect(pushedIds).toContain('bm-absent')             // 远端无 → backfill
    expect(pushedIds).toContain('bm-dirty-remote')       // dirty → 推
    expect(pushedIds).toContain('bm-new')               // new → 推
  })

  it('4 deletedAt 非空的软删项即使远端有也回推 delete upsert（deletedAt 是独立因子）', async () => {
    // 远端也有 bm-del，但本地软删（deletedAt 非空）→ shouldPush 因 deletedAt 非空命中 → 应推
    const port = createMemorySyncPort({
      allIds: { bookmarks: [{ id: 'bm-del' }] },
    })
    setSyncRemotePort(port)
    await prepareBookmarks([{ id: 'bm-del', deletedAt: 9999 }])
    const sync = useCloudSync()

    await sync.initialSync()

    const pushedIds = port.upserts.map(u => u.row.id)
    expect(pushedIds).toContain('bm-del') // deletedAt 作为独立回推因子触发
  })

  it('5 selectAllIds 某表 error：不抛错，warn 后 continue；该表 remoteIds 落空 → 该表本地项 fallback 全当远端无 → 全推', async () => {
    // 远端实际无 bm-only，但 selectAllIds('bookmarks') 报 error。
    // 行为：循环遇 r.error 跳过该表 → remoteIds 没有它的任何 id → fallback `!remoteIds.has` 把本地项全推。
    // 这是容错设计（id probe 失败不阻塞同步，宁可多推让对账修正）。
    const port = createMemorySyncPort({
      allIdsError: { bookmarks: { message: 'probe boom' } },
      allIds: {
        // 其它三表正常空集
        categories: [],
      },
    })
    setSyncRemotePort(port)
    await prepareBookmarks([{ id: 'bm-only' }])
    const sync = useCloudSync()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sync.initialSync()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('initialSync id probe failed'),
      expect.objectContaining({ message: 'probe boom' }),
    )
    const pushedIds = port.upserts.map(u => u.row.id)
    expect(pushedIds).toContain('bm-only')
    warnSpy.mockRestore()
  })

  it('6 末轮双 pull：w首 pull 设 lastSyncAt、监控 lastSyncAt 再次变化前 roundValue 之后续', async () => {
    // 仅断言 lastSyncAt 被设），全程无 error。
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    await prepareBookmarks([{ id: 'bm-x' }])
    const sync = useCloudSync()
    const syncStore = useSyncStore()
    expect(syncStore.lastSyncAt).toBe(0)

    await sync.initialSync()

    expect(syncStore.lastSyncAt).toBeGreaterThan(0)
    expect(syncStore.syncStatus).not.toBe('error')
  })
})
