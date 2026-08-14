/**
 * storage.ts 自身真实逻辑补测（补覆盖率第三十三轮）。
 *
 * 既有测（persist.test / syncPushPull.test 等）全部 vi.mock 掉 storage.js，
 * 从调用方验证委托——storage.ts 自身的 Dexie 操作、cloneDeep 脱 reactive、
 * sorted drain、bulk* 批量、版本历史纯 localStorage 函数从未被直接测试，
 * 故覆盖率仅 48.07%。
 *
 * 策略：vi.mock('dexie') 替换默认导出为可控假 Dexie class，让 storage.ts 内
 * `class LinkVaultDB extends Dexie` 用假表。关键点：**表经 `version().stores(schema)`
 * 链式注册**（对齐真实 Dexie schema 驱动建表）——因 storage.ts 内 LinkVaultDB 字段
 * 声明 `syncOps!: Table` 在 esbuild useDefineForClassFields 行为下会重置 super 构造器
 * 设的实例 syncOps 为 undefined，必须在 `version().stores()` 里注册表（调用顺序在
 * super 之后 = 字段重置之后）才胜出。验证真实逻辑：put/get/bulkAdd/bulkDelete/orderBy
 * /update/count/clear 调用契约 + 错误 catch 分支 + cloneDeep 脱 reactive Proxy +
 * 空数组早退 + 版本历史纯 localStorage 函数。不引入 fake-indexeddb 新依赖，
 * 沿用守则「优先复用既有基建桩」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type OpRow = { id: number; action: string; table: string; itemId: string; data: Record<string, unknown> | null; ts: number; retries: number }
type DataRow = { key: string; value: unknown; updatedAt: number }

// 可控后端：假 Tables 持有同一数组引用读写；测经 fakeDB.opRows / fakeDB.dataRows 旁路验证
const fakeDB = vi.hoisted(() => {
  const dataRows: DataRow[] = []
  const opRows: OpRow[] = []
  const errors: Record<string, Error | undefined> = {}
  function reset() { dataRows.length = 0; opRows.length = 0; Object.keys(errors).forEach((k) => delete errors[k]) }
  return { dataRows, opRows, errors, reset }
})

// 假表：按 schema 表名在 version().stores() 里挂到实例（绕过字段声明重置陷阱）
function makeTable(rowsRef: Record<string, unknown>[]) {
  return {
    async put(row: Record<string, unknown>) {
      if (fakeDB.errors.put) throw fakeDB.errors.put
      if ('key' in row) { const i = rowsRef.findIndex((r) => r.key === row.key); if (i >= 0) rowsRef[i] = row; else rowsRef.push(row) }
      else rowsRef.push(row)
      return row
    },
    async get(key: unknown) {
      if (fakeDB.errors.get) throw fakeDB.errors.get
      return rowsRef.find((r) => r.key === key) ?? undefined
    },
    async bulkAdd(items: Record<string, unknown>[]) {
      if (fakeDB.errors.bulkAdd) throw fakeDB.errors.bulkAdd
      rowsRef.push(...items)
      return items.length
    },
    async bulkDelete(ids: unknown[]) {
      if (fakeDB.errors.bulkDelete) throw fakeDB.errors.bulkDelete
      for (let i = rowsRef.length - 1; i >= 0; i--) { if (ids.includes(rowsRef[i].id)) rowsRef.splice(i, 1) }
    },
    async update(id: unknown, patch: Record<string, unknown>) {
      if (fakeDB.errors.update) throw fakeDB.errors.update
      const r = rowsRef.find((x) => x.id === id); if (r) Object.assign(r, patch)
      return 1
    },
    async count() {
      if (fakeDB.errors.count) throw fakeDB.errors.count
      return rowsRef.length
    },
    async clear() {
      if (fakeDB.errors.clear) throw fakeDB.errors.clear
      rowsRef.length = 0
    },
    async toArray() {
      if (fakeDB.errors.toArray) throw fakeDB.errors.toArray
      return [...rowsRef] as Record<string, unknown>[]
    },
    orderBy(field: string) {
      return {
        async toArray() {
          if (fakeDB.errors.orderByToArray) throw fakeDB.errors.orderByToArray
          return [...rowsRef].sort((a, b) => {
            const av = a[field] as number
            const bv = b[field] as number
            return (av ?? 0) - (bv ?? 0)
          }) as Record<string, unknown>[]
        },
      }
    },
  }
}

vi.mock('dexie', () => {
  class FakeDexie {
    version() {
      const self = this
      const chain = {
        stores(schema: Record<string, string>) {
          for (const tableName of Object.keys(schema)) {
            if (tableName === 'data') self.data = makeTable(fakeDB.dataRows as unknown as Record<string, unknown>[]) as never
            else if (tableName === 'syncOps') self.syncOps = makeTable(fakeDB.opRows as unknown as Record<string, unknown>[]) as never
          }
          return chain
        },
        upgrade() { return chain },
      }
      return chain
    }
    data!: ReturnType<typeof makeTable>
    syncOps!: ReturnType<typeof makeTable>
  }
  return { default: FakeDexie, Dexie: FakeDexie }
})

import {
  idbSet, idbGet,
  enqueueSyncOps, drainSyncOps, removeSyncOps, updateSyncOpRetry, syncOpsCount, clearAllSyncOps,
  fetchLocalHistory, getLocalHistoryVersion, localHistoryKey,
} from '../../stores/storage.js'
import type { SyncOp } from '../../stores/storage.js'
import { localStorageMock } from '../setup.js'

beforeEach(() => {
  fakeDB.reset()
  localStorageMock.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// 按 key 查 data 表后端行（idbSet 写入验证用）
function dataRow(key: string) {
  return fakeDB.dataRows.find((r) => r.key === key)
}
// 往 syncOps 后端直接推一条预置 op（跳过 enqueue 自增，模拟乱序/预设队列）
function pushOp(op: OpRow) {
  fakeDB.opRows.push(op)
}
// reactive Proxy 够造：structuredClone 遇 Proxy 抛 → cloneDeep 回退 JSON
function makeReactiveProxy(snapshot: Record<string, unknown>) {
  return new Proxy(snapshot, {
    get(t, k) { return Reflect.get(t, k) },
    set(t, k, v) { return Reflect.set(t, k, v) },
  })
}

describe('storage.ts — idbSet / idbGet', () => {
  it('idbSet 成功写入返回 true，行带 updatedAt 时间戳', async () => {
    const ok = await idbSet('lv:data', { bookmarks: [1] })
    expect(ok).toBe(true)
    expect(dataRow('lv:data')?.value).toEqual({ bookmarks: [1] })
    expect(typeof dataRow('lv:data')?.updatedAt).toBe('number')
  })

  it('idbSet 同 key 重复写入覆盖旧值（put 去重契约）', async () => {
    await idbSet('k', { v: 1 })
    await idbSet('k', { v: 2 })
    expect(fakeDB.dataRows).toHaveLength(1)
    expect(dataRow('k')?.value).toEqual({ v: 2 })
  })

  it('idbGet 读回写入的值', async () => {
    await idbSet('k', { a: 1 })
    expect(await idbGet('k')).toEqual({ a: 1 })
  })

  it('idbGet 读不存在的 key 返回 null（row?.value ?? null）', async () => {
    expect(await idbGet('missing')).toBeNull()
  })

  it('idbSet put 抛错时捕获返回 false 不向调用方抛（B-1：写入失败必须如实上报非静默吞错）', async () => {
    fakeDB.errors.put = new Error('QuotaExceeded')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = await idbSet('k', 'v')
    expect(ok).toBe(false)
    expect(warn).toHaveBeenCalledWith('[IDB] set error:', expect.any(Error))
  })

  it('idbGet get 抛错时捕获返回 null 不向调用方抛', async () => {
    fakeDB.errors.get = new Error('IDB unavailable')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await idbGet('k')).toBeNull()
    expect(warn).toHaveBeenCalledWith('[IDB] get error:', expect.any(Error))
  })
})

describe('storage.ts — enqueueSyncOps', () => {
  it('空数组早退不触 bulkAdd', async () => {
    const warn = vi.spyOn(console, 'warn')
    await enqueueSyncOps([])
    expect(warn).not.toHaveBeenCalled()
    expect(fakeDB.opRows).toHaveLength(0)
  })

  it('正常入队：注入 retries=0', async () => {
    await enqueueSyncOps([
      { action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 100 },
      { action: 'delete', table: 'categories', itemId: 'c1', data: null, ts: 200 },
    ])
    expect(fakeDB.opRows).toHaveLength(2)
    expect(fakeDB.opRows[0]).toMatchObject({ itemId: 'b1', retries: 0 })
    expect(fakeDB.opRows[1]).toMatchObject({ itemId: 'c1', retries: 0, data: null })
  })

  it('data 为 reactive Proxy 时经 cloneDeep 脱 Proxy 后入库（防 DataCloneError 核心契约）', async () => {
    const reactiveData = makeReactiveProxy({ id: 'b1', title: 't', attributes: { flag: true } })
    await enqueueSyncOps([
      { action: 'upsert', table: 'bookmarks', itemId: 'b1', data: reactiveData, ts: 1 },
    ])
    const stored = fakeDB.opRows[0] as unknown as SyncOp
    expect(stored.data).toEqual({ id: 'b1', title: 't', attributes: { flag: true } })
    expect(stored.data).not.toBe(reactiveData)
  })

  it('data 为 null 时入库保持 null（cloneDeep(null) 不变）', async () => {
    await enqueueSyncOps([
      { action: 'delete', table: 'bookmarks', itemId: 'b1', data: null, ts: 1 },
    ])
    expect((fakeDB.opRows[0] as unknown as SyncOp).data).toBeNull()
  })

  it('bulkAdd 抛错时捕获 warn 不向调用方抛（吞错降级——enqueue 不返 boolean，与 idbSet 不同）', async () => {
    fakeDB.errors.bulkAdd = new Error('DataCloneError')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await enqueueSyncOps([{ action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 1 }])
    expect(warn).toHaveBeenCalledWith('[IDB] enqueueSyncOps error:', expect.any(Error))
  })
})

describe('storage.ts — drainSyncOps', () => {
  it('按 id 升序返回全部 op（orderBy("id") 排序契约）', async () => {
    pushOp({ id: 3, action: 'upsert', table: 'bookmarks', itemId: 'b3', data: { id: 'b3' }, ts: 3, retries: 0 })
    pushOp({ id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 1, retries: 0 })
    pushOp({ id: 2, action: 'delete', table: 'categories', itemId: 'c2', data: null, ts: 2, retries: 1 })
    const ops = await drainSyncOps()
    expect(ops.map((o) => o.id)).toEqual([1, 2, 3])
  })

  it('空队列返回空数组', async () => {
    expect(await drainSyncOps()).toEqual([])
  })

  it('orderBy toArray 抛错时捕获 warn 返回空数组', async () => {
    pushOp({ id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 1, retries: 0 })
    fakeDB.errors.orderByToArray = new Error('IDB corrupt')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await drainSyncOps()).toEqual([])
    expect(warn).toHaveBeenCalledWith('[IDB] drainSyncOps error:', expect.any(Error))
  })
})

describe('storage.ts — removeSyncOps', () => {
  it('空 ids 数组早退不触 bulkDelete', async () => {
    pushOp({ id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 1, retries: 0 })
    const warn = vi.spyOn(console, 'warn')
    await removeSyncOps([])
    expect(warn).not.toHaveBeenCalled()
    expect(fakeDB.opRows).toHaveLength(1)
  })

  it('按 id 批量删除指定 op', async () => {
    pushOp({ id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 1, retries: 0 })
    pushOp({ id: 2, action: 'upsert', table: 'bookmarks', itemId: 'b2', data: { id: 'b2' }, ts: 2, retries: 0 })
    pushOp({ id: 3, action: 'upsert', table: 'bookmarks', itemId: 'b3', data: { id: 'b3' }, ts: 3, retries: 0 })
    await removeSyncOps([1, 3])
    expect(fakeDB.opRows.map((o) => o.id)).toEqual([2])
  })

  it('bulkDelete 抛错时捕获 warn 不向调用方抛', async () => {
    pushOp({ id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 1, retries: 0 })
    fakeDB.errors.bulkDelete = new Error('tx aborted')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await removeSyncOps([1])
    expect(warn).toHaveBeenCalledWith('[IDB] removeSyncOps error:', expect.any(Error))
  })
})

describe('storage.ts — updateSyncOpRetry', () => {
  it('更新指定 op 的 retries 字段（失败累计用于判定是否达上限移除）', async () => {
    pushOp({ id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 1, retries: 0 })
    await updateSyncOpRetry(1, 3)
    expect((fakeDB.opRows[0] as unknown as SyncOp).retries).toBe(3)
  })

  it('update 不存在 id 不抛错（update 返 1 但 find 无匹配）', async () => {
    await updateSyncOpRetry(999, 5)
    expect(fakeDB.opRows).toHaveLength(0)
  })

  it('update 抛错时捕获 warn 不向调用方抛', async () => {
    pushOp({ id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 1, retries: 0 })
    fakeDB.errors.update = new Error('readonly')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await updateSyncOpRetry(1, 5)
    expect(warn).toHaveBeenCalledWith('[IDB] updateSyncOpRetry error:', expect.any(Error))
  })
})

describe('storage.ts — syncOpsCount', () => {
  it('返回当前队列长度', async () => {
    pushOp({ id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 1, retries: 0 })
    pushOp({ id: 2, action: 'upsert', table: 'categories', itemId: 'c2', data: null, ts: 2, retries: 0 })
    expect(await syncOpsCount()).toBe(2)
  })

  it('空队列返回 0', async () => {
    expect(await syncOpsCount()).toBe(0)
  })

  it('count 抛错时捕获 warn 返回 0', async () => {
    fakeDB.errors.count = new Error('blocked')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await syncOpsCount()).toBe(0)
    expect(warn).toHaveBeenCalledWith('[IDB] syncOpsCount error:', expect.any(Error))
  })
})

describe('storage.ts — clearAllSyncOps', () => {
  it('清空整个 syncOps 表（A4-002：重置本地数据时清队防旧 op 复活云端）', async () => {
    pushOp({ id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 1, retries: 0 })
    pushOp({ id: 2, action: 'upsert', table: 'bookmarks', itemId: 'b2', data: { id: 'b2' }, ts: 2, retries: 0 })
    await clearAllSyncOps()
    expect(fakeDB.opRows).toHaveLength(0)
  })

  it('clear 抛错时捕获 warn 不向调用方抛', async () => {
    pushOp({ id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { id: 'b1' }, ts: 1, retries: 0 })
    fakeDB.errors.clear = new Error('IDB closed')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await clearAllSyncOps()
    expect(warn).toHaveBeenCalledWith('[IDB] clearAllSyncOps error:', expect.any(Error))
  })

  it('空队列 clear 不抛错（幂等）', async () => {
    await clearAllSyncOps()
    expect(fakeDB.opRows).toHaveLength(0)
  })
})

describe('storage.ts — 本地版本历史（纯 localStorage，无 IDB 依赖）', () => {
  it('localHistoryKey 拼 "lv_hist:" 前缀', () => {
    expect(localHistoryKey('bm-1')).toBe('lv_hist:bm-1')
  })

  it('fetchLocalHistory 读取合法 JSON 数组返回版本列表', () => {
    const arr = [
      { id: 1, data: { title: 'v1' }, created_at: '2024-01-01' },
      { id: 2, data: { title: 'v2' }, created_at: '2024-01-02' },
    ]
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(arr))
    expect(fetchLocalHistory('bm-1')).toEqual(arr)
  })

  it('fetchLocalHistory 存储为非数组（对象）时返回空数组（Array.isArray 守门）', () => {
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({ not: 'array' }))
    expect(fetchLocalHistory('bm-1')).toEqual([])
  })

  it('fetchLocalHistory getItem 返回 null（无历史）时返回空数组', () => {
    localStorageMock.getItem.mockReturnValueOnce(null)
    expect(fetchLocalHistory('bm-1')).toEqual([])
  })

  it('fetchLocalHistory getItem 返回非法 JSON 时 safeJsonParse 兜底返回空数组', () => {
    localStorageMock.getItem.mockReturnValueOnce('not-json{')
    expect(fetchLocalHistory('bm-1')).toEqual([])
  })

  it('getLocalHistoryVersion 按 historyId 取对应版本 data', () => {
    const arr = [
      { id: 1, data: { title: 'v1' }, created_at: '2024-01-01' },
      { id: 2, data: { title: 'v2' }, created_at: '2024-01-02' },
    ]
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(arr))
    expect(getLocalHistoryVersion('bm-1', 2)).toEqual({ title: 'v2' })
  })

  it('getLocalHistoryVersion historyId 不存在返回 null', () => {
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify([{ id: 1, data: {}, created_at: 'x' }]))
    expect(getLocalHistoryVersion('bm-1', 99)).toBeNull()
  })

  it('getLocalHistoryVersion 无任何历史（getItem null）返回 null', () => {
    localStorageMock.getItem.mockReturnValueOnce(null)
    expect(getLocalHistoryVersion('bm-1', 1)).toBeNull()
  })
})
