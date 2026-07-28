/**
 * _mergeOps 纯函数护栏 (D1-6)
 *
 * 锁定 syncPush._mergeOps 的合并契约，重点 R30：同 item 多 upsert op 合并时
 * 取历史最大 retries，避免新编辑（retries=0）覆盖旧失败 op 的重试计数，致使
 * 死信阈值被绕过（持续编辑的坏 op 永不进死信，持续重试+错误态长期误导）。
 *
 * _mergeOps 是纯函数，但 syncPush.ts 顶层 import 了 data/sync/e2e/supabase 等
 * 模块，故在此 mock 掉 storage（避免真 IDB）与 supabase（避免真网络/认证），
 * 仅 import _mergeOps 本体做纯逻辑断言。无 Pinia 依赖断言，但导出自带新 Pinia
 * 仍以备 import chain。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../../stores/storage.js', () => ({
  enqueueSyncOps: vi.fn(),
  drainSyncOps: vi.fn(),
  removeSyncOps: vi.fn(),
  updateSyncOpRetry: vi.fn(),
  syncOpsCount: vi.fn(),
  clearAllSyncOps: vi.fn(),
}))

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      then: () => ({ data: null, error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      select: () => ({ then: () => null, eq: () => null }),
      eq: () => ({ then: () => null }),
      update: () => ({ then: () => null }),
      delete: () => ({ then: () => null }),
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

import { _mergeOps } from '../../composables/domain/syncPush.js'
import type { SyncOp } from '../../stores/storage.js'

beforeEach(() => {
  setActivePinia(createPinia())
})

/** 构造 upsert op 的便捷工厂（不带 id，因 _mergeOps 合并阶段不依赖 id） */
function upsert(
  table: SyncOp['table'],
  itemId: string,
  ts: number,
  retries = 0,
  extra: Record<string, unknown> = {},
): SyncOp {
  return {
    action: 'upsert',
    table,
    itemId,
    ts,
    retries,
    data: { ...extra },
  }
}

function del(
  table: SyncOp['table'],
  itemId: string,
  ts: number,
  retries = 0,
): SyncOp {
  return { action: 'delete', table, itemId, ts, retries, data: null }
}

describe('_mergeOps (syncPush 纯合并)', () => {
  it('空数组进空数组出', () => {
    expect(_mergeOps([])).toEqual([])
  })

  it('单 op 原样（保留 ts/retries/data）', () => {
    const op = upsert('bookmarks', 'a', 100, 0, { title: 'x' })
    const out = _mergeOps([op])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      action: 'upsert',
      table: 'bookmarks',
      itemId: 'a',
      ts: 100,
      retries: 0,
    })
    // data 取 last op 的 data
    expect(out[0].data).toEqual({ title: 'x' })
  })

  it('R30 核心：同 item 多 upsert 合并取历史最大 retries，新编辑 retries=0 不覆盖旧失败计数', () => {
    // 模拟：同一书签先失败 2 次（retries=2），后又被编辑产生新 op（retries=0）
    const ops: SyncOp[] = [
      upsert('bookmarks', 'a', 100, 2, { title: 'v1' }),
      upsert('bookmarks', 'a', 200, 0, { title: 'v2' }), // 新编辑，retries 归零
    ]
    const out = _mergeOps(ops)
    expect(out).toHaveLength(1)
    // 合并后 retries 必须保留 max=2，不能被新编辑的 0 覆盖
    expect(out[0].retries).toBe(2)
    // data 取最后一条（last）= v2，避免推旧中间态
    expect(out[0].data).toEqual({ title: 'v2' })
    // ts 取首条（itemOps[0].ts）= 100，保序基准
    expect(out[0].ts).toBe(100)
  })

  it('R30：三 op 多历史重试取 max，且 data 恒取 last', () => {
    const ops: SyncOp[] = [
      upsert('bookmarks', 'a', 100, 1, { v: 1 }),
      upsert('bookmarks', 'a', 200, 3, { v: 2 }), // max
      upsert('bookmarks', 'a', 300, 0, { v: 3 }), // 新编辑归零
    ]
    const out = _mergeOps(ops)
    expect(out).toHaveLength(1)
    expect(out[0].retries).toBe(3)
    expect(out[0].data).toEqual({ v: 3 })
    expect(out[0].ts).toBe(100)
  })

  it('R30：retries 全 0 时 max 为 0', () => {
    const ops: SyncOp[] = [
      upsert('bookmarks', 'a', 100, 0),
      upsert('bookmarks', 'a', 200, 0),
    ]
    const out = _mergeOps(ops)
    expect(out).toHaveLength(1)
    expect(out[0].retries).toBe(0)
  })

  it('delete 终态优先：同 item upsert 序列后跟 delete，合并为单 delete（取 last=delete）', () => {
    const ops: SyncOp[] = [
      upsert('bookmarks', 'a', 100, 1, { title: 'v1' }),
      upsert('bookmarks', 'a', 200, 0, { title: 'v2' }),
      del('bookmarks', 'a', 300, 0),
    ]
    const out = _mergeOps(ops)
    expect(out).toHaveLength(1)
    expect(out[0].action).toBe('delete')
    expect(out[0].data).toBeNull()
    // delete 分支直接 push last，不取 maxRetries（delete 无需重试计数语义）
    expect(out[0].ts).toBe(300)
  })

  it('delete 中途再 upsert：delete 非 last 时走入 else 分支保留 maxRetries + last data', () => {
    // 同 item：先 delete（ts=100），后 reset 重新 upsert（ts=200）
    const ops: SyncOp[] = [
      del('bookmarks', 'a', 100, 0),
      upsert('bookmarks', 'a', 200, 2, { title: 'reborn' }),
    ]
    const out = _mergeOps(ops)
    expect(out).toHaveLength(1)
    // last 是 upsert，走 else 分支：保留 maxRetries=2
    expect(out[0].action).toBe('upsert')
    expect(out[0].retries).toBe(2)
    expect(out[0].data).toEqual({ title: 'reborn' })
    expect(out[0].ts).toBe(100)
  })

  it('不同 item 各自独立合并，互不串台', () => {
    const ops: SyncOp[] = [
      upsert('bookmarks', 'a', 100, 2, { t: 'a1' }),
      upsert('bookmarks', 'b', 200, 0, { t: 'b1' }),
      upsert('bookmarks', 'a', 300, 0, { t: 'a2' }), // 覆盖 a 的 data，但 maxRetries 保留 2
      upsert('categories', 'c', 400, 1, { name: 'c1' }),
    ]
    const out = _mergeOps(ops)
    // 三个不同 (table,itemId) 键合并为 3 条
    expect(out).toHaveLength(3)
    const aOut = out.find(o => o.table === 'bookmarks' && o.itemId === 'a')!
    const bOut = out.find(o => o.table === 'bookmarks' && o.itemId === 'b')!
    const cOut = out.find(o => o.table === 'categories' && o.itemId === 'c')!
    expect(aOut.retries).toBe(2) // R30：a 历史失败计数保留
    expect(aOut.data).toEqual({ t: 'a2' }) // last data
    expect(bOut.retries).toBe(0)
    expect(bOut.data).toEqual({ t: 'b1' })
    expect(cOut.retries).toBe(1)
    expect(cOut.data).toEqual({ name: 'c1' })
  })

  it('输出按 ts 升序排序（跨 item）', () => {
    const ops: SyncOp[] = [
      upsert('bookmarks', 'b', 500, 0, {}),
      upsert('bookmarks', 'a', 100, 0, {}),
      upsert('bookmarks', 'c', 300, 0, {}),
    ]
    const out = _mergeOps(ops)
    expect(out.map(o => o.itemId)).toEqual(['a', 'c', 'b'])
  })

  it('跨表同 itemId 互不影响（键含 table）', () => {
    // bookmarks 表 'x' 与 sibling_groups 表 'x' 是不同键
    const ops: SyncOp[] = [
      upsert('bookmarks', 'x', 100, 3, { from: 'bm' }),
      upsert('sibling_groups', 'x', 200, 0, { from: 'group' }),
    ]
    const out = _mergeOps(ops)
    expect(out).toHaveLength(2)
    const bmOut = out.find(o => o.table === 'bookmarks' && o.itemId === 'x')!
    const groupOut = out.find(o => o.table === 'sibling_groups' && o.itemId === 'x')!
    expect(bmOut.retries).toBe(3)
    expect(bmOut.data).toEqual({ from: 'bm' })
    expect(groupOut.retries).toBe(0)
    expect(groupOut.data).toEqual({ from: 'group' })
  })
})
