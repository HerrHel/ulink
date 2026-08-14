/**
 * syncRemotePort — 远端同步 IO 端口端口层契约测试
 *
 * 三层锁行为：
 * 1) createMemorySyncPort（测试基建自身逻辑）——record 收集 / error 透传 / updateCount 默认 vs 0 / 各 select 默认空 vs 配置取 / error 短路
 *    基建逻辑错误会让所有依赖它的 sync 测假绿，独立锁住其行为契约
 * 2) getSyncRemotePort / setSyncRemotePort ——_injected ?? _default 注入回退
 * 3) createSupabaseSyncPort（生产）——error→{message,code} 映射 / count 透传（核心契约：注释明示「仅靠 error 无法识别静默失败，必须 count 透传，否则 syncPush 误判成功永久出队丢本地变更」）/ data||null 兜底
 *    用可控 fake supabase client 注入每表每操作的 {data,error,count}，覆盖注释中的 count 透传契约门
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SyncRemotePort, SyncPortError, SyncTable } from '../../composables/domain/syncRemotePort.js'

// ── 可控 fake supabase client（链式任意深 + await 出配置值）──
// builder 每个操作方法 + 链式过滤方法都返自身；await 时 resolve 该表该操作的配置结果。
type FakeResult = { data: unknown; error: { message: string; code?: string } | null; count?: number | null }
type OpKey = string // 'upsert' | 'update' | 'delete' | 'selectSince' | 'selectSoftDeleted' | 'selectAllIds'

function makeFakeSupabase(rows: Partial<Record<SyncTable, Partial<Record<OpKey, FakeResult>>>>) {
  function builder(table: SyncTable, op: OpKey) {
    const resolve = (): FakeResult => rows[table]?.[op] ?? { data: null, error: null }
    const b = {
      // 终端操作：标记当前 op
      upsert: () => mk(table, 'upsert'),
      update: () => mk(table, 'update'),
      delete: () => mk(table, 'delete'),
      select: (cols: string) => mk(table, opFromSelect(cols)),
      // 链式过滤：不改返回
      eq: () => b,
      gt: () => b,
      not: () => b,
      // thenable：await 出配置值
      then: (res: (v: FakeResult) => void) => res(resolve()),
    }
    function mk(_t: SyncTable, o: OpKey) {
      op = o
      return b
    }
    return b
  }
  // select 两类靠列字符串区分：'id' / 'id, updated_at_num' / '*' → 选 op
  function opFromSelect(cols: string): OpKey {
    if (cols === 'id') return 'selectAllIds'
    if (cols === 'id, updated_at_num') return 'selectSoftDeleted'
    return 'selectSince' // '*'
  }
  return {
    supabase: {
      from: (table: SyncTable) => builder(table, ''),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  }
}

// vi.mock 须在顶层；用 vi.hoisted 让 mock 工厂拿到可变配置
const { getSupabase, setSupabase, resetSupabase } = vi.hoisted(() => {
  let client: ReturnType<typeof makeFakeSupabase> | null = null
  return {
    getSupabase: () => client,
    setSupabase: (c: ReturnType<typeof makeFakeSupabase> | null) => { client = c },
    resetSupabase: () => { client = null },
  }
})
vi.mock('../../lib/supabase.js', () => ({
  // 代理到 vi.hoisted 的 getSupabase()——每次 from() 动态读当前 setSupabase 的 client，
  // 否则工厂求值时绑定死首个空 client，后续 setSupabase 注入不生效
  get supabase() {
    return getSupabase()?.supabase ?? makeFakeSupabase({}).supabase
  },
}))

// mock 后再 import 源（ESM vi.mock 提升，import 受 mock 拦截）
import {
  createMemorySyncPort,
  createSupabaseSyncPort,
  getSyncRemotePort,
  setSyncRemotePort,
} from '../../composables/domain/syncRemotePort.js'

// ── 1. createMemorySyncPort（测试基建行为契约）──
describe('createMemorySyncPort — 测试基建 record 收集与 error 透传契约', () => {
  beforeEach(() => { resetSupabase() })

  it('upsert 无 error → 收集 {table,row} + data null + error null', async () => {
    const port = createMemorySyncPort()
    const r = await port.upsert('bookmarks', { id: 'b1', x: 1 })
    expect(r.data).toBeNull()
    expect(r.error).toBeNull()
    expect(port.upserts).toEqual([{ table: 'bookmarks', row: { id: 'b1', x: 1 } }])
  })

  it('upsertError 注入 → 不收集 + error 透传（含 code）', async () => {
    const err: SyncPortError = { message: 'duplicate', code: '23505' }
    const port = createMemorySyncPort({ upsertError: () => err })
    const r = await port.upsert('categories', { id: 'c1' })
    expect(r.error).toEqual(err)
    expect(port.upserts).toHaveLength(0)
  })

  it('upsertError 返回 null → 仍收集（null = 无错误）', async () => {
    const port = createMemorySyncPort({ upsertError: () => null })
    await port.upsert('bookmarks', { id: 'b1' })
    expect(port.upserts).toHaveLength(1)
  })

  it('update 默认 count=1（命中）+ 收集 patch', async () => {
    const port = createMemorySyncPort()
    const r = await port.update('bookmarks', 'b1', 'u1', { title: 't' })
    expect(r.count).toBe(1)
    expect(r.error).toBeNull()
    expect(port.updates).toEqual([{ table: 'bookmarks', id: 'b1', patch: { title: 't' } }])
  })

  it('updateCount()=0 → count=0（模拟无匹配 update，远端行已删）', async () => {
    const port = createMemorySyncPort({ updateCount: () => 0 })
    const r = await port.update('bookmarks', 'b1', 'u1', {})
    expect(r.count).toBe(0)
    expect(port.updates).toHaveLength(1) // 仍记录（record 与 count 解耦）
  })

  it('updateError → 不收集 + error 透传 + count 随 updateCount(默认1)', async () => {
    const port = createMemorySyncPort({ updateError: () => ({ message: 'rls denied' }) })
    const r = await port.update('bookmarks', 'b1', 'u1', {})
    expect(r.error).toEqual({ message: 'rls denied' })
    expect(r.count).toBe(1)
    expect(port.updates).toHaveLength(0)
  })

  it('updateError + updateCount()=0 → error 透传 + count=0', async () => {
    const port = createMemorySyncPort({ updateError: () => ({ message: 'x' }), updateCount: () => 0 })
    const r = await port.update('bookmarks', 'b1', 'u1', {})
    expect(r.error).toEqual({ message: 'x' })
    expect(r.count).toBe(0)
  })

  it('delete 无 error → 收集 {table,id} + data null', async () => {
    const port = createMemorySyncPort()
    const r = await port.delete('bookmarks', 'b1', 'u1')
    expect(r.data).toBeNull()
    expect(r.error).toBeNull()
    expect(port.deletes).toEqual([{ table: 'bookmarks', id: 'b1' }])
  })

  it('deleteError → 不收集 + error 透传', async () => {
    const port = createMemorySyncPort({ deleteError: () => ({ message: 'fk' }) })
    const r = await port.delete('bookmarks', 'b1', 'u1')
    expect(r.error).toEqual({ message: 'fk' })
    expect(port.deletes).toHaveLength(0)
  })

  it('selectSince 默认 → 空数组 + error null', async () => {
    const port = createMemorySyncPort()
    const r = await port.selectSince('bookmarks', 'u1', 100)
    expect(r.data).toEqual([])
    expect(r.error).toBeNull()
  })

  it('sinceRows 按表取 → 透传配置数组', async () => {
    const port = createMemorySyncPort({ sinceRows: { bookmarks: [{ id: 'b1' }, { id: 'b2' }] } })
    const r = await port.selectSince('bookmarks', 'u1', 100)
    expect(r.data).toEqual([{ id: 'b1' }, { id: 'b2' }])
  })

  it('sinceRows 他表无配置 → 空数组（按表隔离）', async () => {
    const port = createMemorySyncPort({ sinceRows: { bookmarks: [{ id: 'b1' }] } })
    const r = await port.selectSince('categories', 'u1', 100)
    expect(r.data).toEqual([])
  })

  it('selectSinceError → data null + error 透传（短路，不看 sinceRows）', async () => {
    const port = createMemorySyncPort({ sinceRows: { bookmarks: [{ id: 'b1' }] }, selectSinceError: { message: 'timeout' } })
    const r = await port.selectSince('bookmarks', 'u1', 100)
    expect(r.data).toBeNull()
    expect(r.error).toEqual({ message: 'timeout' })
  })

  it('selectSoftDeleted 默认 → 空数组', async () => {
    const port = createMemorySyncPort()
    const r = await port.selectSoftDeleted('bookmarks', 'u1', 100)
    expect(r.data).toEqual([])
  })

  it('softDeleted 按表取 → 透传', async () => {
    const port = createMemorySyncPort({ softDeleted: { bookmarks: [{ id: 'b1', updated_at_num: 200 }] } })
    const r = await port.selectSoftDeleted('bookmarks', 'u1', 100)
    expect(r.data).toEqual([{ id: 'b1', updated_at_num: 200 }])
  })

  it('selectAllIds 默认 → 空数组', async () => {
    const port = createMemorySyncPort()
    const r = await port.selectAllIds('bookmarks', 'u1')
    expect(r.data).toEqual([])
    expect(r.error).toBeNull()
  })

  it('allIds 按表取 → 透传', async () => {
    const port = createMemorySyncPort({ allIds: { bookmarks: [{ id: 'b1' }, { id: 'b2' }] } })
    const r = await port.selectAllIds('bookmarks', 'u1')
    expect(r.data).toEqual([{ id: 'b1' }, { id: 'b2' }])
  })

  it('allIdsError 按表 → data null + error 透传（短路 allIds）', async () => {
    const port = createMemorySyncPort({
      allIds: { bookmarks: [{ id: 'b1' }] },
      allIdsError: { bookmarks: { message: 'rls', code: '42501' } },
    })
    const r = await port.selectAllIds('bookmarks', 'u1')
    expect(r.data).toBeNull()
    expect(r.error).toEqual({ message: 'rls', code: '42501' })
  })

  it('allIdsError 他表无配置 → 走 allIds 配置正常返回', async () => {
    const port = createMemorySyncPort({
      allIdsError: { categories: { message: 'c-err' } },
      allIds: { bookmarks: [{ id: 'b1' }] },
    })
    const r = await port.selectAllIds('bookmarks', 'u1')
    expect(r.data).toEqual([{ id: 'b1' }])
    expect(r.error).toBeNull()
  })

  it('upsert/delete/update 调用互不污染各自 record 数组', async () => {
    const port = createMemorySyncPort()
    await port.upsert('bookmarks', { id: 'b1' })
    await port.update('categories', 'c1', 'u1', { name: 'n' })
    await port.delete('bookmarks', 'b2', 'u1')
    expect(port.upserts).toHaveLength(1)
    expect(port.updates).toHaveLength(1)
    expect(port.deletes).toHaveLength(1)
  })
})

// ── 2. getSyncRemotePort / setSyncRemotePort 注入回退 ──
describe('getSyncRemotePort / setSyncRemotePort — 注入回退契约', () => {
  afterEach(() => { setSyncRemotePort(null) })

  it('未注入 → 返回默认 port（createSupabaseSyncPort 实例，有 update 方法）', () => {
    setSyncRemotePort(null)
    const port = getSyncRemotePort()
    expect(typeof port.update).toBe('function')
    expect(typeof port.upsert).toBe('function')
  })

  it('注入 fake → getSyncRemotePort 返回 fake', () => {
    const fake: SyncRemotePort = {
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      selectSince: vi.fn(),
      selectSoftDeleted: vi.fn(),
      selectAllIds: vi.fn(),
    }
    setSyncRemotePort(fake)
    expect(getSyncRemotePort()).toBe(fake)
  })

  it('setSyncRemotePort(null) → 回退默认 port（不再是 fake）', () => {
    const fake: SyncRemotePort = {
      upsert: vi.fn(), update: vi.fn(), delete: vi.fn(),
      selectSince: vi.fn(), selectSoftDeleted: vi.fn(), selectAllIds: vi.fn(),
    }
    setSyncRemotePort(fake)
    expect(getSyncRemotePort()).toBe(fake)
    setSyncRemotePort(null)
    expect(getSyncRemotePort()).not.toBe(fake)
  })
})

// ── 3. createSupabaseSyncPort — error/count 映射契约 ──
describe('createSupabaseSyncPort — 生产 error→{message,code} 映射 + count 透传契约', () => {
  let port: ReturnType<typeof createSupabaseSyncPort>

  beforeEach(() => { resetSupabase() })
  afterEach(() => { resetSupabase() })

  it('upsert 返 error → 映射为 {message,code} + data 透传 null', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { upsert: { data: null, error: { message: 'dup', code: '23505' } } } }))
    port = createSupabaseSyncPort()
    const r = await port.upsert('bookmarks', { id: 'b1' })
    expect(r.error).toEqual({ message: 'dup', code: '23505' })
    expect(r.data).toBeNull()
  })

  it('upsert 无 error → error null + data 透传', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { upsert: { data: [{ id: 'b1' }], error: null } } }))
    port = createSupabaseSyncPort()
    const r = await port.upsert('bookmarks', { id: 'b1' })
    expect(r.error).toBeNull()
    expect(r.data).toEqual([{ id: 'b1' }])
  })

  it('update 返 error+count → error 映射 + count 透传（核心契约门：syncPush 据 count 区分静默失败）', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { update: { data: null, error: { message: 'rls', code: '42501' }, count: 0 } } }))
    port = createSupabaseSyncPort()
    const r = await port.update('bookmarks', 'b1', 'u1', { title: 't' })
    expect(r.error).toEqual({ message: 'rls', code: '42501' })
    expect(r.count).toBe(0) // 透传 0 = 无匹配 update
  })

  it('update 无 error + count=1 → count 透传 1（成功更新命中行）', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { update: { data: [{ id: 'b1' }], error: null, count: 1 } } }))
    port = createSupabaseSyncPort()
    const r = await port.update('bookmarks', 'b1', 'u1', {})
    expect(r.error).toBeNull()
    expect(r.count).toBe(1)
  })

  it('update 无 error + count=null → count 透传 null（Supabase 不带 count 时）', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { update: { data: null, error: null, count: null } } }))
    port = createSupabaseSyncPort()
    const r = await port.update('bookmarks', 'b1', 'u1', {})
    expect(r.error).toBeNull()
    expect(r.count).toBeNull()
  })

  it('delete 返 error → 映射', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { delete: { data: null, error: { message: 'fk', code: '23503' } } } }))
    port = createSupabaseSyncPort()
    const r = await port.delete('bookmarks', 'b1', 'u1')
    expect(r.error).toEqual({ message: 'fk', code: '23503' })
  })

  it('delete 无 error → error null', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { delete: { data: null, error: null } } }))
    port = createSupabaseSyncPort()
    const r = await port.delete('bookmarks', 'b1', 'u1')
    expect(r.error).toBeNull()
  })

  it('selectSince 返 error → 映射 + data null', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { selectSince: { data: null, error: { message: 'timeout' } } } }))
    port = createSupabaseSyncPort()
    const r = await port.selectSince('bookmarks', 'u1', 100)
    expect(r.error).toEqual({ message: 'timeout' })
    expect(r.data).toBeNull()
  })

  it('selectSince 无 error → data 透传 + error null', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { selectSince: { data: [{ id: 'b1' }], error: null } } }))
    port = createSupabaseSyncPort()
    const r = await port.selectSince('bookmarks', 'u1', 100)
    expect(r.data).toEqual([{ id: 'b1' }])
    expect(r.error).toBeNull()
  })

  it('selectSince data=null 无 error → data || null 兜底仍 null', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { selectSince: { data: null, error: null } } }))
    port = createSupabaseSyncPort()
    const r = await port.selectSince('bookmarks', 'u1', 100)
    expect(r.data).toBeNull()
    expect(r.error).toBeNull()
  })

  it('selectSoftDeleted 返 null+无 error → 返回 [] || null = null', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { selectSoftDeleted: { data: null, error: null } } }))
    port = createSupabaseSyncPort()
    const r = await port.selectSoftDeleted('bookmarks', 'u1', 100)
    expect(r.data).toBeNull()
    expect(r.error).toBeNull()
  })

  it('selectSoftDeleted 返数据 + 无 error → data 透传', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { selectSoftDeleted: { data: [{ id: 'b1', updated_at_num: 200 }], error: null } } }))
    port = createSupabaseSyncPort()
    const r = await port.selectSoftDeleted('bookmarks', 'u1', 100)
    expect(r.data).toEqual([{ id: 'b1', updated_at_num: 200 }])
  })

  it('selectSoftDeleted 返 error → 映射 + data null', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { selectSoftDeleted: { data: null, error: { message: 'e', code: 'XX' } } } }))
    port = createSupabaseSyncPort()
    const r = await port.selectSoftDeleted('bookmarks', 'u1', 100)
    expect(r.error).toEqual({ message: 'e', code: 'XX' })
  })

  it('selectAllIds 返数据 → 透传', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { selectAllIds: { data: [{ id: 'b1' }, { id: 'b2' }], error: null } } }))
    port = createSupabaseSyncPort()
    const r = await port.selectAllIds('bookmarks', 'u1')
    expect(r.data).toEqual([{ id: 'b1' }, { id: 'b2' }])
  })

  it('selectAllIds data=null 无 error → null 兜底', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { selectAllIds: { data: null, error: null } } }))
    port = createSupabaseSyncPort()
    const r = await port.selectAllIds('bookmarks', 'u1')
    expect(r.data).toBeNull()
  })

  it('selectAllIds 返 error → 映射', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { selectAllIds: { data: null, error: { message: 'rls', code: '42501' } } } }))
    port = createSupabaseSyncPort()
    const r = await port.selectAllIds('bookmarks', 'u1')
    expect(r.error).toEqual({ message: 'rls', code: '42501' })
  })

  it('error 无 code 字段 → 映射后 code 为 undefined（不强行补）', async () => {
    setSupabase(makeFakeSupabase({ bookmarks: { delete: { data: null, error: { message: 'plain' } } } }))
    port = createSupabaseSyncPort()
    const r = await port.delete('bookmarks', 'b1', 'u1')
    expect(r.error).toEqual({ message: 'plain' })
    expect((r.error as any).code).toBeUndefined()
  })
})
