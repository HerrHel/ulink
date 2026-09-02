/**
 * syncFirstRunWipe — 首次注册用户「登录即被清空到回收站」回归护栏
 *
 * 场景（用户报告）：本机已积累大量书签/分类，用户第一次注册并登录，
 * 首轮 initialSync 的全量 upsert 因网络/限流失败（云端仍是空库），随后用户点
 * 「重试同步」（或 fork 等路径）触发 fullSync → pullChanges(true) 的全量 ID 对账
 * 把「远端 selectAllIds 查不到」的本地项全部 reconcileDelete / full-absent-delete，
 * 本地数据整批进回收站。
 *
 * 根因：对账删除把「远端从未有过该用户数据」与「远端把数据物理删光」混为一谈。
 * 本系统删除走软删（deleted_at 列 + selectSoftDeleted 同步），物理整表消失不是正常
 * 流程；selectAllIds 返回 0 行时应判定为「云端未上云的本地数据」，禁止对账删除。
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
      // initialSync 末尾 subscribeRealtime 会建 realtime channel，测试无需真实订阅
      channel: () => {
        const chain: Record<string, unknown> = {}
        chain.on = () => chain
        chain.subscribe = () => undefined
        return chain
      },
      removeChannel: () => undefined,
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
import { clearAllSyncOps, syncOpsCount, enqueueSyncOps } from '../../stores/storage.js'
import {
  useCloudSync, __testPendingSync, __resetInitialSync,
  setSyncRemotePort, createMemorySyncPort,
} from '../../composables/domain/useCloudSync.js'
import { PUSH_CONCURRENCY } from '../../composables/domain/syncPush.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

function makeBm(partial: Record<string, unknown> = {}) {
  return {
    id: 'bm-x',
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

function makeGroup(partial: Record<string, unknown> = {}) {
  return {
    id: 'g-x',
    name: 'g',
    categoryId: CAT_UNCATEGORIZED,
    icon: '',
    order: 0,
    isExpanded: false,
    attributes: {},
    bookmarkIds: [],
    notes: '',
    updatedAt: 2000,
    useCount: 0,
    ...partial,
  }
}

/** 装配「本机长期离线使用后的存量数据」：20 书签 + 1 组 + 1 自定义分类 */
function seedLocalData(n = 20) {
  const ds = useDataStore()
  ds.addCategory({ id: 'c-mine', name: '我的分类', icon: 'folder', color: '#4f46e5', order: 1 })
  for (let i = 0; i < n; i++) {
    ds.addBookmark(makeBm({ id: `bm-${i}`, title: `书签 ${i}`, categoryId: 'c-mine', order: i }) as any)
  }
  ds.addGroup(makeGroup({ id: 'g-mine', name: '我的组', categoryId: 'c-mine' }) as any)
  ds._dirtyIds.clear()
  ds._newIds.clear()
  ds._deletedIds.clear()
  return ds
}

/** 云端完全空库（首次注册用户）：所有查询返回空 */
function emptyCloud() {
  return createMemorySyncPort({
    sinceRows: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
  })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  __testPendingSync.clear()
  __resetInitialSync()
  _ops = []
  _nextId = 1
  await clearAllSyncOps()
  setSyncRemotePort(null)
  const auth = useAuthStore()
  ;(auth as any).user = { id: 'user-fresh', email: 'fresh@test.com' }
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

afterEach(async () => {
  setSyncRemotePort(null)
  __testPendingSync.clear()
  await clearAllSyncOps()
})

describe('首次注册用户同步不清空本地数据', () => {
  it('initialSync：云端空库 + 本地存量 → 数据全部入队待推，本地不被删', async () => {
    const ds = seedLocalData(20)
    const port = emptyCloud()
    setSyncRemotePort(port)

    await useCloudSync().initialSync()

    // 本地 20 书签 + 1 组 + 分类全部存活
    for (let i = 0; i < 20; i++) {
      expect(ds.bookmarkMap[`bm-${i}`]?.deletedAt, `bm-${i} 被误删`).toBeUndefined()
    }
    expect(ds.groupMap['g-mine']?.deletedAt).toBeUndefined()
    expect(ds.categoryMap['c-mine']?.deletedAt).toBeUndefined()
    // 全部入队待上云
    expect(port.upserts.length).toBeGreaterThanOrEqual(20)
  })

  it('首轮 push 全失败后 fullSync：不得把「云端查不到」的本地项批量软删（核心回归）', async () => {
    const ds = seedLocalData(20)
    // 首轮注册推送被限流/网络打爆：upsert 全部失败
    const failPort = createMemorySyncPort({
      upsertError: () => ({ message: 'simulated rate limit' }),
      sinceRows: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    setSyncRemotePort(failPort)

    await useCloudSync().initialSync()
    // 首轮推送失败：队列里仍有失败待重试的 op
    expect(await syncOpsCount()).toBeGreaterThan(0)

    // 用户看到同步失败 → 点「重试同步」→ fullSync → pullChanges(true) 全量对账
    await useCloudSync().fullSync()

    // 回归断言：修复前 full 对账把 20 条书签 + 组 + 分类全软删进回收站
    const wiped: string[] = []
    for (let i = 0; i < 20; i++) {
      if (ds.bookmarkMap[`bm-${i}`]?.deletedAt) wiped.push(`bm-${i}`)
    }
    if (ds.groupMap['g-mine']?.deletedAt) wiped.push('g-mine')
    if (ds.categoryMap['c-mine']?.deletedAt) wiped.push('c-mine')
    expect(wiped, `被误删的项: ${wiped.join(', ')}`).toEqual([])
  })

  it('首轮 push 成功后 fullSync：云端有数据，对账不误删', async () => {
    const ds = seedLocalData(5)
    const okPort = emptyCloud()
    setSyncRemotePort(okPort)
    await useCloudSync().initialSync()
    expect(okPort.upserts.length).toBeGreaterThanOrEqual(5)

    // 云端现在有数据：对账查得到全部 id
    const ids = (t: 'bookmarks' | 'sibling_groups' | 'categories' | 'custom_attributes') =>
      okPort.upserts.filter(u => u.table === t).map(u => ({ id: String(u.row.id) }))
    const syncedPort = createMemorySyncPort({
      sinceRows: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: {
        bookmarks: ids('bookmarks'),
        sibling_groups: ids('sibling_groups'),
        categories: ids('categories'),
        custom_attributes: ids('custom_attributes'),
      },
    })
    setSyncRemotePort(syncedPort)
    await useCloudSync().fullSync()

    for (let i = 0; i < 5; i++) {
      expect(ds.bookmarkMap[`bm-${i}`]?.deletedAt).toBeUndefined()
    }
    expect(useSyncStore().syncStatus).toBe('success')
  })

  it('initialSync 首轮推送瞬时失败 → 编排层退避重试后全部上云', async () => {
    const ds = seedLocalData(6)
    // 前 3 次 upsert 失败（模拟限流/冷启动瞬时故障），之后一律成功
    let calls = 0
    const flakyPort = createMemorySyncPort({
      upsertError: () => (++calls <= 3 ? { message: 'transient 429' } : null),
      sinceRows: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    setSyncRemotePort(flakyPort)

    await useCloudSync().initialSync()

    // 重试后 6 条书签 + 组 + 分类全部上云，队列清空
    expect(flakyPort.upserts.filter(u => u.table === 'bookmarks').length).toBe(6)
    expect(await syncOpsCount()).toBe(0)
    for (let i = 0; i < 6; i++) {
      expect(ds.bookmarkMap[`bm-${i}`]?.deletedAt).toBeUndefined()
    }
  }, 15000)

  it('push 分块限并发：整批 op 不再一次性打向远端', async () => {
    const ds = useDataStore()
    for (let i = 0; i < 30; i++) {
      ds.addBookmark(makeBm({ id: `bm-c-${i}`, title: `并发 ${i}` }) as any)
    }
    ds._dirtyIds.clear()
    ds._newIds.clear()

    let inFlight = 0
    let peak = 0
    const port = createMemorySyncPort()
    const realUpsert = port.upsert.bind(port)
    port.upsert = async (table, row) => {
      inFlight++
      if (inFlight > peak) peak = inFlight
      await new Promise(r => setTimeout(r, 1))
      inFlight--
      return realUpsert(table, row)
    }
    setSyncRemotePort(port)

    await enqueueSyncOps(
      Array.from({ length: 30 }, (_, i) => ({
        action: 'upsert' as const,
        table: 'bookmarks' as const,
        itemId: `bm-c-${i}`,
        data: { ...makeBm({ id: `bm-c-${i}` }), _userId: 'user-fresh', _isNew: true, _changedFields: null },
        ts: Date.now(),
      })),
    )
    await useCloudSync().pushToCloud()

    expect(port.upserts.length).toBe(30)
    // 修复前：整批 Promise.all → peak 逼近 30，直接触发远端限流
    expect(peak).toBeLessThanOrEqual(PUSH_CONCURRENCY)
    expect(peak).toBeGreaterThan(1) // 仍是并发而非串行退化
  })

  it('resyncAllToCloud：死信 op 强制全量重传恢复上云（种子固定 id 撞车场景）', async () => {
    const ds = seedLocalData(6)
    // 系统性失败（不是瞬时抖动）：模拟「种子固定 id 撞别人占的行 → RLS USING 拒绝」。
    // 修复前每个新账户 initialSync 都会踩：upsert 每轮都失败，3 轮后 op 进死信被永久移除。
    const failPort = createMemorySyncPort({
      upsertError: () => ({ message: 'new row violates row-level security policy (USING expression)' }),
      sinceRows: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    setSyncRemotePort(failPort)

    await useCloudSync().initialSync()
    // 编排层补了一轮退避重试（retries 0→2），队列里还有 6 条待重试
    expect(await syncOpsCount()).toBeGreaterThan(0)
    // 用户再点「重试同步」→ fullSync 内 pushFromQueue：retries 2→3 全部进死信，队列清空
    await useCloudSync().fullSync()
    expect(await syncOpsCount()).toBe(0)
    // 死信清空队列后，云端仍是空库：full 对账的「云端零行守卫」保证本地不被软删
    expect(ds.bookmarkMap['bm-0']?.deletedAt).toBeUndefined()

    // 根因修复后（主键已改、RLS 已放行）：云端从空库开始，但 op 已死信，fullSync 推不动
    const okPort = createMemorySyncPort({
      sinceRows: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    // memory port 的 selectAllIds 默认只返回静态配置；模拟 PostgREST 真实行为——
    // 已 upsert 成功的行在后续 ID 探测（幂等判据的数据源）中可见
    const realSelectAllIds = okPort.selectAllIds.bind(okPort)
    okPort.selectAllIds = async (table, userId) => {
      const res = await realSelectAllIds(table, userId)
      const staticRows = res.data ?? []
      const pushed = okPort.upserts
        .filter(u => u.table === table)
        .map(u => ({ id: String((u.row as { id?: unknown }).id ?? '') }))
        .filter(r => r.id)
      return { data: [...staticRows, ...pushed], error: res.error }
    }
    setSyncRemotePort(okPort)

    // 用户点「强制全量重传」：清空队列 → 按云端缺失重新入队 → 推送 → 拉取
    const ok = await useCloudSync().resyncAllToCloud()
    expect(ok).toBe(true)
    expect(okPort.upserts.filter(u => u.table === 'bookmarks').length).toBe(6)
    expect(okPort.upserts.some(u => u.table === 'sibling_groups' && (u.row as { id: string }).id === 'g-mine')).toBe(true)
    expect(await syncOpsCount()).toBe(0)
    for (let i = 0; i < 6; i++) {
      expect(ds.bookmarkMap[`bm-${i}`]?.deletedAt).toBeUndefined()
    }

    // 幂等：再跑一次不重复推送（云端已有全部 id，本地无 dirty → 0 个 op 入队）
    const upsertCount = okPort.upserts.length
    await useCloudSync().resyncAllToCloud()
    expect(okPort.upserts.length).toBe(upsertCount)
  }, 20000)
})
