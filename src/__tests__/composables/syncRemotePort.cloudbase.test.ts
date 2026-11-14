/**
 * syncRemotePort.cloudbase — CloudBase PG 端口契约测试
 *
 * 与 Supabase 实现必须语义一致的门（syncPush 依赖，误判会永久出队丢本地变更）：
 * 1) update 的 count 透传 —— 原生不给 count 时补 head count，count=0 必须如实返回
 * 2) 全量查询分页 —— 超过单页上限后必须继续翻页，否则对账误删
 * 3) error 归一化成 { message, code }
 *
 * 刻意与 Supabase 实现不同的地方（有实测依据，见文件头注释）：
 * upsert **显式**传 onConflict: 'user_id,id'（CloudBase 全新库，复合主键从建表起就确定）
 */
import { describe, it, expect } from 'vitest'
import { createCloudBaseSyncPort } from '../../composables/domain/syncRemotePort.cloudbase.js'
import type { RdbClient } from '../../lib/cloudbase.js'

type FakeRow = { data: unknown; error: { message: string; code?: string } | null; count?: number | null }

interface Call {
  table: string
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete'
  args: unknown[]
  filters: Array<{ method: string; args: unknown[] }>
  columns?: string
  selectOpts?: Record<string, unknown>
  range?: [number, number]
}

/** 可控 fake RdbClient：记录每次终端调用（含链式过滤条件），按调用返回配置结果。
 *  respond 允许抛错或返回 rejected Promise，用于覆盖「rdb reject 时产品代码不吞错」。 */
function makeFakeDb(respond: (call: Call) => FakeRow | Promise<FakeRow>) {
  const calls: Call[] = []

  function builder(table: string) {
    const call: Call = { table, op: 'select', args: [], filters: [] }
    const b = {
      select(columns?: string, selectOpts?: Record<string, unknown>) {
        call.op = 'select'
        call.columns = columns
        call.selectOpts = selectOpts
        return b
      },
      insert(...args: unknown[]) {
        call.op = 'insert'
        call.args = args
        return b
      },
      upsert(...args: unknown[]) {
        call.op = 'upsert'
        call.args = args
        return b
      },
      update(...args: unknown[]) {
        call.op = 'update'
        call.args = args
        return b
      },
      delete() {
        call.op = 'delete'
        return b
      },
      eq(...args: unknown[]) {
        call.filters.push({ method: 'eq', args })
        return b
      },
      in(...args: unknown[]) {
        call.filters.push({ method: 'in', args })
        return b
      },
      neq(...args: unknown[]) {
        call.filters.push({ method: 'neq', args })
        return b
      },
      gt(...args: unknown[]) {
        call.filters.push({ method: 'gt', args })
        return b
      },
      not(...args: unknown[]) {
        call.filters.push({ method: 'not', args })
        return b
      },
      order() {
        return b
      },
      limit() {
        return b
      },
      range(from: number, to: number) {
        call.range = [from, to]
        return b
      },
      single() {
        return b
      },
      // then 同时接 resolve / reject：respond 抛错或返回 rejected Promise 时，
      // 把异常交给 await 链向上透传，而不是被 thenable 悄悄吞成成功 FakeRow。
      then(resolve: (v: FakeRow) => void, reject: (e: unknown) => void = () => {}) {
        calls.push(call)
        try {
          const r = respond(call)
          if (r instanceof Promise) {
            r.then(resolve, reject)
          } else {
            resolve(r)
          }
        } catch (e) {
          reject(e)
        }
      },
    }
    return b
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: () => {
      throw new Error('本用例不应触发 rpc')
    },
  }

  return { client: client as unknown as RdbClient, calls }
}

describe('createCloudBaseSyncPort — upsert', () => {
  it('显式传复合主键 onConflict: user_id,id（#27 另发一次 head count 回查）', async () => {
    const { client, calls } = makeFakeDb(() => ({ data: null, error: null }))
    const port = createCloudBaseSyncPort(client)

    await port.upsert('bookmarks', { id: 'b1', user_id: 'u1', title: 'x' })

    expect(calls).toHaveLength(2)
    expect(calls[0].op).toBe('upsert')
    expect(calls[0].table).toBe('bookmarks')
    expect(calls[0].args[1]).toEqual({ onConflict: 'user_id,id' })
    // #27: CloudBase .upsert() 不返回行，按 onConflict 复合主键回查一次 head count
    expect(calls[1].op).toBe('select')
    expect(calls[1].selectOpts).toEqual({ count: 'exact', head: true })
  })

  it('数组批量 upsert 原样透传', async () => {
    const { client, calls } = makeFakeDb(() => ({ data: null, error: null }))
    const port = createCloudBaseSyncPort(client)
    const rows = [{ id: 'b1', user_id: 'u1' }, { id: 'b2', user_id: 'u1' }]

    await port.upsert('bookmarks', rows)

    expect(calls[0].args[0]).toEqual(rows)
  })

  // #27: 「按 onConflict 后回查」可行方案 —— 后端 .upsert() 不返回行/count，
  // 回查 head count 拿到 0 行即如实透传，syncPush 与 update 同口径判失败。
  it('回查 0 行 → count=0 如实返回（RLS 静默 0 行供 syncPush 判失败）', async () => {
    const { client, calls } = makeFakeDb((call) => {
      if (call.op === 'upsert') return { data: null, error: null }
      return { data: null, error: null, count: 0 }
    })
    const port = createCloudBaseSyncPort(client)

    const r = await port.upsert('bookmarks', { id: 'b1', user_id: 'u1', title: 'x' })

    expect(r.error).toBeNull()
    expect(r.count).toBe(0)
    const readback = calls.find((c) => c.op === 'select')
    expect(readback?.selectOpts).toEqual({ count: 'exact', head: true })
    expect(readback?.filters).toEqual([
      { method: 'eq', args: ['user_id', 'u1'] },
      { method: 'in', args: ['id', ['b1']] },
    ])
  })

  it('批量 upsert 回查按 in(ids) 命中 N 行 → count=N', async () => {
    const { client, calls } = makeFakeDb((call) => {
      if (call.op === 'upsert') return { data: null, error: null }
      return { data: null, error: null, count: 2 }
    })
    const port = createCloudBaseSyncPort(client)
    const rows = [{ id: 'b1', user_id: 'u1' }, { id: 'b2', user_id: 'u1' }]

    const r = await port.upsert('bookmarks', rows)

    expect(r.count).toBe(2)
    const readback = calls.find((c) => c.op === 'select')
    expect(readback?.filters).toContainEqual({ method: 'in', args: ['id', ['b1', 'b2']] })
  })

  it('无 user_id 的行跳过回查（不产生 count、不新增请求）', async () => {
    const { client, calls } = makeFakeDb(() => ({ data: null, error: null }))
    const port = createCloudBaseSyncPort(client)

    const r = await port.upsert('bookmarks', { id: 'b1' })

    expect(r.count).toBeNull()
    expect(calls).toHaveLength(1)
  })
})

describe('createCloudBaseSyncPort — update 的 count 契约', () => {
  it('原生不返回 count 时补 head count，且过滤条件为 id + user_id', async () => {
    const { client, calls } = makeFakeDb((call) => {
      if (call.op === 'update') return { data: null, error: null } // 无 count
      return { data: null, error: null, count: 1 } // head count 查询
    })
    const port = createCloudBaseSyncPort(client)

    const r = await port.update('bookmarks', 'b1', 'u1', { title: 'y' })

    expect(r).toEqual({ data: null, error: null, count: 1 })
    expect(calls).toHaveLength(2)
    expect(calls[0].op).toBe('update')
    expect(calls[1].op).toBe('select')
    expect(calls[1].selectOpts).toEqual({ count: 'exact', head: true })
    expect(calls[1].filters).toEqual([
      { method: 'eq', args: ['id', 'b1'] },
      { method: 'eq', args: ['user_id', 'u1'] },
    ])
  })

  it('无匹配行（count=0）如实返回 0，不被当成成功', async () => {
    const { client } = makeFakeDb((call) => {
      if (call.op === 'update') return { data: null, error: null }
      return { data: null, error: null, count: 0 }
    })
    const port = createCloudBaseSyncPort(client)

    const r = await port.update('bookmarks', 'gone', 'u1', { title: 'z' })

    expect(r.count).toBe(0)
    expect(r.error).toBeNull()
  })

  it('原生已给 count 时不再补查（只发一次请求）', async () => {
    const { client, calls } = makeFakeDb(() => ({ data: null, error: null, count: 3 }))
    const port = createCloudBaseSyncPort(client)

    const r = await port.update('bookmarks', 'b1', 'u1', { title: 'y' })

    expect(r.count).toBe(3)
    expect(calls).toHaveLength(1)
  })

  it('update 出错时短路，不补 count 查询', async () => {
    const { client, calls } = makeFakeDb(() => ({
      data: null,
      error: { message: 'new row violates row-level security policy', code: '42501' },
    }))
    const port = createCloudBaseSyncPort(client)

    const r = await port.update('bookmarks', 'b1', 'u1', { title: 'y' })

    expect(r.error).toEqual({ message: 'new row violates row-level security policy', code: '42501' })
    expect(calls).toHaveLength(1)
  })
})

describe('createCloudBaseSyncPort — delete / 查询过滤', () => {
  it('delete 同时按 id 与 user_id 限定', async () => {
    const { client, calls } = makeFakeDb(() => ({ data: null, error: null }))
    const port = createCloudBaseSyncPort(client)

    await port.delete('sibling_groups', 'g1', 'u1')

    expect(calls[0].op).toBe('delete')
    expect(calls[0].filters).toEqual([
      { method: 'eq', args: ['id', 'g1'] },
      { method: 'eq', args: ['user_id', 'u1'] },
    ])
  })

  it('selectSoftDeleted 按 deleted_at IS NOT NULL + updated_at_num 过滤', async () => {
    const { client, calls } = makeFakeDb(() => ({ data: [], error: null }))
    const port = createCloudBaseSyncPort(client)

    await port.selectSoftDeleted('bookmarks', 'u1', 100)

    const eqFilters = calls[0].filters.filter((f) => f.method === 'eq')
    expect(eqFilters).toContainEqual({ method: 'eq', args: ['user_id', 'u1'] })
    expect(calls[0].filters).toContainEqual({ method: 'not', args: ['deleted_at', 'is', null] })
    expect(calls[0].filters).toContainEqual({ method: 'gt', args: ['updated_at_num', 100] })
  })
})

describe('createCloudBaseSyncPort — 分页', () => {
  it('首页满 1000 行时继续翻页，总计跨页累加', async () => {
    const PAGE = 1000
    const { client, calls } = makeFakeDb((call) => {
      const from = call.range ? call.range[0] : 0
      if (from === 0) {
        return { data: Array.from({ length: PAGE }, (_, i) => ({ id: `b${i}` })), error: null }
      }
      return { data: [{ id: 'tail' }], error: null }
    })
    const port = createCloudBaseSyncPort(client)

    const r = await port.selectAllIds('bookmarks', 'u1')

    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(PAGE + 1)
    expect(calls).toHaveLength(2)
    expect(calls[0].range).toEqual([0, PAGE - 1])
    expect(calls[1].range).toEqual([PAGE, PAGE * 2 - 1])
  })

  it('首页不足一页时立即停止（只发一次请求）', async () => {
    const { client, calls } = makeFakeDb(() => ({ data: [{ id: 'a' }, { id: 'b' }], error: null }))
    const port = createCloudBaseSyncPort(client)

    const r = await port.selectAllIds('bookmarks', 'u1')

    expect(r.data).toHaveLength(2)
    expect(calls).toHaveLength(1)
  })

  it('分页中途出错时整体返回 error，不返回半截数据', async () => {
    const PAGE = 1000
    const { client } = makeFakeDb((call) => {
      const from = call.range ? call.range[0] : 0
      if (from === 0) {
        return { data: Array.from({ length: PAGE }, (_, i) => ({ id: `b${i}` })), error: null }
      }
      return { data: null, error: { message: 'gateway timeout', code: 'GATEWAY_TIMEOUT' } }
    })
    const port = createCloudBaseSyncPort(client)

    const r = await port.selectAllIds('bookmarks', 'u1')

    expect(r.data).toBeNull()
    expect(r.error).toEqual({ message: 'gateway timeout', code: 'GATEWAY_TIMEOUT' })
  })
})

describe('createCloudBaseSyncPort — 墓园查询', () => {
  it('查 deleted_item_graveyard 并只按 user_id 过滤', async () => {
    const { client, calls } = makeFakeDb(() => ({
      data: [{ table_name: 'bookmarks', item_id: 'b9' }],
      error: null,
    }))
    const port = createCloudBaseSyncPort(client)

    const r = await port.selectGraveyardIds('u1')

    expect(calls[0].table).toBe('deleted_item_graveyard')
    expect(calls[0].columns).toBe('table_name, item_id')
    expect(calls[0].filters).toEqual([{ method: 'eq', args: ['user_id', 'u1'] }])
    expect(r.data).toEqual([{ table_name: 'bookmarks', item_id: 'b9' }])
  })
})

describe('createCloudBaseSyncPort — rdb rejection', () => {
  it('rdb reject 时产品代码不吞错（异常向上透传，而非静默转成 {error:null}）', async () => {
    // 情形 1：respond 返回 rejected Promise（rdb 返回 rejection）
    const rejectDb = makeFakeDb(() => Promise.reject(new Error('rdb connection reset')))
    await expect(createCloudBaseSyncPort(rejectDb.client).upsert('bookmarks', { id: 'b1' }))
      .rejects.toThrow('rdb connection reset')
    // 情形 2：respond 同步抛错（rdb 抛异常），同样不能被吞
    const throwDb = makeFakeDb(() => { throw new Error('rdb boom') })
    await expect(createCloudBaseSyncPort(throwDb.client).upsert('bookmarks', { id: 'b1' }))
      .rejects.toThrow('rdb boom')
  })
})
