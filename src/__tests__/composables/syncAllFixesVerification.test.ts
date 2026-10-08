/**
 * syncAllFixesVerification.test.ts
 *
 * 验证同步系统 5 大缺陷修复与 1 项批处理优化的行为契约：
 * 1. PostgREST 1000 行限制分页（fetchAllPages）
 * 2. Realtime DELETE 物理清除（_permanentDeleteWithoutEcho，不进回收站）
 * 3. 客户端时钟偏差防护（sanitizeRemoteTimestamp 截断未来时钟 + 本地 updatedAt 防倒退）
 * 4. SiblingGroup bookmarkIds 联合合并（并发加书签无损保留）
 * 5. 冲突解决保留本地（更新时间戳 > 远端 + 标记 dirty + 入队回推）
 * 6. 批量 upsert 与失败逐条降级隔离
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import {
  createSupabaseSyncPort,
  createMemorySyncPort,
  setSyncRemotePort,
} from '../../composables/domain/syncRemotePort.js'
import {
  sanitizeRemoteTimestamp,
  isRemoteNewer,
  MAX_FUTURE_CLOCK_SKEW_MS,
} from '../../composables/domain/syncMergeCore.js'
import { _mergeIntoLocal } from '../../composables/domain/syncLocalMerge.js'
import { _handleRealtimeChange } from '../../composables/domain/useSyncRealtime.js'
import { resolveConflict } from '../../composables/domain/useSyncConflict.js'
import { pushFromQueue } from '../../composables/domain/syncPush.js'
import { enqueueSyncOps } from '../../stores/storage.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

function makeBm(partial: Partial<Bookmark> & { id: string }): Bookmark {
  return {
    title: 'Test BM',
    url: 'https://example.com',
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: 'cat1',
    parentId: null,
    order: 1,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  }
}

function makeGroup(partial: Partial<SiblingGroup> & { id: string }): SiblingGroup {
  return {
    name: 'Test Group',
    categoryId: 'cat1',
    icon: '',
    order: 1,
    isExpanded: false,
    attributes: {},
    bookmarkIds: [],
    notes: '',
    updatedAt: 1000,
    useCount: 0,
    ...partial,
  }
}

// 内存 ops 存储
let _ops: any[] = []
let _nextId = 1

vi.mock('../../stores/storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/storage.js')>()
  return {
    ...actual,
    enqueueSyncOps: async (ops: any[]) => {
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
    updateSyncOpRetry: vi.fn(async (id: number, retries: number) => {
      const o = _ops.find(x => x.id === id)
      if (o) o.retries = retries
    }),
    syncOpsCount: async () => _ops.length,
    clearAllSyncOps: async () => { _ops = [] },
  }
})

// Mock Supabase
vi.mock('../../lib/supabase.js', () => {
  return {
    supabase: {
      from: vi.fn(),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      }),
      removeChannel: vi.fn(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  }
})

// Mock history & user
vi.mock('../../composables/domain/useSyncHistory.js', () => ({
  _getUserId: () => 'test-user-id',
  _saveHistory: () => Promise.resolve(),
}))

// Mock persist
vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))

import { supabase } from '../../lib/supabase.js'

describe('同步系统 5 大缺陷与批量优化综合契约测试', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    _ops = []
    _nextId = 1
    vi.clearAllMocks()
    setSyncRemotePort(null)
  })

  // ─────────────────────────────────────────────────────────────
  // 1. PostgREST 分页测试
  // ─────────────────────────────────────────────────────────────
  describe('缺陷 1：PostgREST 1000 行限制分页遍历', () => {
    it('selectAllIds 超过 1000 行时跨页拉取全部数据', async () => {
      const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}` }))
      const page2 = Array.from({ length: 1000 }, (_, i) => ({ id: `id-${1000 + i}` }))
      const page3 = Array.from({ length: 500 }, (_, i) => ({ id: `id-${2000 + i}` }))

      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockImplementation((from: number, _to: number) => {
          if (from === 0) return Promise.resolve({ data: page1, error: null })
          if (from === 1000) return Promise.resolve({ data: page2, error: null })
          if (from === 2000) return Promise.resolve({ data: page3, error: null })
          return Promise.resolve({ data: [], error: null })
        }),
      }

      vi.mocked(supabase.from).mockReturnValue(mockQueryBuilder as any)

      const port = createSupabaseSyncPort()
      const result = await port.selectAllIds('bookmarks', 'test-user-id')

      expect(result.error).toBeNull()
      expect(result.data).toHaveLength(2500)
      expect(result.data?.[0]).toEqual({ id: 'id-0' })
      expect(result.data?.[2499]).toEqual({ id: 'id-2499' })
      expect(mockQueryBuilder.range).toHaveBeenCalledTimes(3)
      expect(mockQueryBuilder.range).toHaveBeenNthCalledWith(1, 0, 999)
      expect(mockQueryBuilder.range).toHaveBeenNthCalledWith(2, 1000, 1999)
      expect(mockQueryBuilder.range).toHaveBeenNthCalledWith(3, 2000, 2999)
    })

    it('分页拉取中途遇到 error 时立即返回错误，不丢失 error 信息', async () => {
      const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}` }))
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockImplementation((from: number) => {
          if (from === 0) return Promise.resolve({ data: page1, error: null })
          return Promise.resolve({ data: null, error: { message: 'Network timeout', code: '57014' } })
        }),
      }

      vi.mocked(supabase.from).mockReturnValue(mockQueryBuilder as any)

      const port = createSupabaseSyncPort()
      const result = await port.selectAllIds('bookmarks', 'test-user-id')

      expect(result.error).toEqual({ message: 'Network timeout', code: '57014' })
      expect(result.data).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. Realtime DELETE 物理清除测试
  // ─────────────────────────────────────────────────────────────
  describe('缺陷 2：Realtime DELETE 物理清除（严禁转软删进回收站）', () => {
    it('收到远端 DELETE 事件时，彻底从本地物理抹除该条目，而不是留在回收站', async () => {
      const ds = useDataStore()
      const bm = makeBm({
        id: 'bm-remote-del',
        title: 'Bookmark To Delete',
        deletedAt: 1000,
      })
      ds.bookmarks = [bm]
      ds._bmMap[bm.id] = bm

      await _handleRealtimeChange({
        eventType: 'DELETE',
        old: { id: 'bm-remote-del', user_id: 'test-user-id' },
      }, 'bookmark')

      expect(ds.bookmarks.find(b => b.id === 'bm-remote-del')).toBeUndefined()
      expect(ds.bookmarkMap['bm-remote-del']).toBeUndefined()
      expect(ds._deletedIds.has('bm-remote-del')).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. 时钟偏差保护测试
  // ─────────────────────────────────────────────────────────────
  describe('缺陷 3：客户端未来时钟偏差防护与本地时间戳不倒退', () => {
    it('sanitizeRemoteTimestamp 截断未来超前时间戳至当前本地时间', () => {
      const now = 1700000000000
      expect(sanitizeRemoteTimestamp(now - 5000, now)).toBe(now - 5000)
      expect(sanitizeRemoteTimestamp(now + 30000, now)).toBe(now + 30000)

      const farFuture = now + MAX_FUTURE_CLOCK_SKEW_MS + 999999
      expect(sanitizeRemoteTimestamp(farFuture, now)).toBe(now)

      expect(sanitizeRemoteTimestamp(undefined, now)).toBe(0)
      expect(sanitizeRemoteTimestamp(-1, now)).toBe(0)
      expect(sanitizeRemoteTimestamp(NaN, now)).toBe(0)
    })

    it('isRemoteNewer 防御：远端极端未来时间戳被截断后无法无限压制本地新编辑', () => {
      const now = 1700000000000
      const local = { id: 'b1', updatedAt: now }
      const futureRemote = { id: 'b1', updatedAt: now + 3600000 * 24 * 365 } // 1 年后

      expect(isRemoteNewer(futureRemote, local, now)).toBe(false)
    })

    it('_mergeIntoLocal assign 时确保本地 updatedAt 不倒退', () => {
      const ds = useDataStore()
      const localBm = makeBm({
        id: 'bm-clock',
        title: 'Local Bookmark',
        updatedAt: 5000,
      })
      ds.bookmarks = [localBm]
      ds._bmMap[localBm.id] = localBm

      const remoteBm = makeBm({
        id: 'bm-clock',
        title: 'Remote Bookmark',
        updatedAt: 3000,
      })

      _mergeIntoLocal(ds.bookmarks, [remoteBm], 'bookmark')

      expect(ds.bookmarks[0].updatedAt).toBe(5000)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 4. SiblingGroup bookmarkIds 联合合并测试
  // ─────────────────────────────────────────────────────────────
  describe('缺陷 4：SiblingGroup bookmarkIds 联合合并', () => {
    it('_mergeIntoLocal 合并组时保留本地存活书签，防止并发添加时相互覆盖', () => {
      const ds = useDataStore()

      const b1 = makeBm({ id: 'b1', title: 'B1' })
      const b2 = makeBm({ id: 'b2', title: 'B2' })
      const bLocal = makeBm({ id: 'b_local', title: 'Local Added' })
      const bTrashed = makeBm({ id: 'b_trashed', title: 'Deleted', deletedAt: 999 })

      ds.bookmarks = [b1, b2, bLocal, bTrashed]
      ds._bmMap = { b1, b2, b_local: bLocal, b_trashed: bTrashed }

      const localGroup = makeGroup({
        id: 'grp-1',
        name: 'My Group',
        bookmarkIds: ['b1', 'b2', 'b_local', 'b_trashed'],
        updatedAt: 100,
      })
      ds.siblingGroups = [localGroup]
      ds._grpMap = { 'grp-1': localGroup }

      const remoteGroup = makeGroup({
        id: 'grp-1',
        name: 'My Group (Renamed on Remote)',
        bookmarkIds: ['b1', 'b2', 'b_remote'],
        updatedAt: 200,
      })

      _mergeIntoLocal(ds.siblingGroups, [remoteGroup], 'group')

      const merged = ds.siblingGroups[0]
      expect(merged.name).toBe('My Group (Renamed on Remote)')
      expect(merged.bookmarkIds).toContain('b1')
      expect(merged.bookmarkIds).toContain('b2')
      expect(merged.bookmarkIds).toContain('b_remote')
      expect(merged.bookmarkIds).toContain('b_local')
      expect(merged.bookmarkIds).not.toContain('b_trashed')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 5. 冲突解决“保留本地”测试
  // ─────────────────────────────────────────────────────────────
  describe('缺陷 5：冲突解决“保留本地”闭环回推', () => {
    it('resolveConflict(id, keepLocal=true) 递增本地时间戳并标记 dirty 入队', () => {
      const ds = useDataStore()
      const syncStore = useSyncStore()

      const localBm = makeBm({
        id: 'bm-conflict',
        title: 'Local Version Winner',
        updatedAt: 2000,
      })
      ds.bookmarks = [localBm]
      ds._bmMap[localBm.id] = localBm

      const remoteBm = makeBm({
        id: 'bm-conflict',
        title: 'Remote Version Loser',
        updatedAt: 5000,
      })

      syncStore.addConflict({
        id: 'bm-conflict',
        type: 'bookmark',
        local: localBm,
        remote: remoteBm,
      })

      expect(syncStore.conflicts).toHaveLength(1)

      resolveConflict('bm-conflict', true)

      expect(syncStore.conflicts).toHaveLength(0)
      expect(ds._dirtyIds.has('bm-conflict')).toBe(true)
      expect(ds.bookmarkMap['bm-conflict']?.updatedAt).toBeGreaterThan(5000)
      expect(ds.bookmarkMap['bm-conflict']?.title).toBe('Local Version Winner')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 6. 批量推送与隔离降级测试
  // ─────────────────────────────────────────────────────────────
  describe('优化 6：批量 upsert 推送与错误逐条隔离', () => {
    it('连续同表全量 upsert 批量打包发送，显著降低网络并发', async () => {
      const port = createMemorySyncPort()
      setSyncRemotePort(port)

      const ops = [
        { action: 'upsert' as const, table: 'bookmarks' as const, itemId: 'b1', data: { id: 'b1', title: 'B1', url: 'https://1.com' }, ts: 100 },
        { action: 'upsert' as const, table: 'bookmarks' as const, itemId: 'b2', data: { id: 'b2', title: 'B2', url: 'https://2.com' }, ts: 101 },
        { action: 'upsert' as const, table: 'bookmarks' as const, itemId: 'b3', data: { id: 'b3', title: 'B3', url: 'https://3.com' }, ts: 102 },
      ]
      await enqueueSyncOps(ops)

      const success = await pushFromQueue()
      expect(success).toBe(true)

      expect(port.upserts).toHaveLength(3)
      expect(port.upserts.map(u => (u.row as any).id)).toEqual(['b1', 'b2', 'b3'])
    })

    it('整批 upsert 发生错误时，自动降级逐条推送，隔离故障单项', async () => {
      let batchAttempted = false
      let singleAttemptedCount = 0

      const customPort = {
        ...createMemorySyncPort(),
        async upsert(table: any, row: any) {
          if (Array.isArray(row)) {
            batchAttempted = true
            return { data: null, error: { message: 'Batch insert constraint violation' } }
          }
          singleAttemptedCount++
          if (row.id === 'b2') {
            return { data: null, error: { message: 'Row b2 bad format' } }
          }
          return { data: row, error: null }
        },
      }
      setSyncRemotePort(customPort)

      const ops = [
        { action: 'upsert' as const, table: 'bookmarks' as const, itemId: 'b1', data: { id: 'b1', title: 'B1', url: 'https://1.com' }, ts: 100 },
        { action: 'upsert' as const, table: 'bookmarks' as const, itemId: 'b2', data: { id: 'b2', title: 'B2', url: 'https://2.com' }, ts: 101 },
        { action: 'upsert' as const, table: 'bookmarks' as const, itemId: 'b3', data: { id: 'b3', title: 'B3', url: 'https://3.com' }, ts: 102 },
      ]
      await enqueueSyncOps(ops)

      await pushFromQueue()

      expect(batchAttempted).toBe(true)
      expect(singleAttemptedCount).toBe(3)
    })
  })
})
