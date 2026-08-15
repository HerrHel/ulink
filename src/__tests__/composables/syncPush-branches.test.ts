/**
 * syncPush-branches — 补 syncPush.ts 未触分支：纯函数（_opNeedsUnlock / _mergeOps /
 * _redactOpData）+ enqueueDirtyAsOps 编排 + pushFromQueue 离线/加密失败一条龙/
 * delete catch / 锁定全跳过 idle / 部分锁定跳过。
 *
 * 锁真实行为契约（非刷行数）：每条配一句「锁住什么」。
 * 桩沿用 syncPushPull.test.ts 同构：内存 _ops 队列 + nullQ supabase + createMemorySyncPort。
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
    updateSyncOpRetry: vi.fn(async (id: number, retries: number) => {
      const o = _ops.find(x => x.id === id)
      if (o) o.retries = retries
    }),
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
  enqueueSyncOps, drainSyncOps, clearAllSyncOps, syncOpsCount,
} from '../../stores/storage.js'
import {
  useCloudSync, __testPendingSync, setSyncRemotePort, createMemorySyncPort,
} from '../../composables/domain/useCloudSync.js'
import {
  _opNeedsUnlock, _mergeOps, _redactOpData, enqueueDirtyAsOps,
  MAX_PUSH_RETRIES,
} from '../../composables/domain/syncPush.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

function makeBm(partial: Record<string, unknown> = {}) {
  return {
    id: 'bm-sp-1',
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
    id: 'sg-sp-1',
    name: 'g',
    categoryId: 'cat-1',
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

beforeEach(async () => {
  setActivePinia(createPinia())
  __testPendingSync.clear()
  _ops = []
  _nextId = 1
  await clearAllSyncOps()
  setSyncRemotePort(null)
  const auth = useAuthStore()
  ;(auth as any).user = { id: 'user-sp', email: 'sp@test.com' }
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

afterEach(async () => {
  setSyncRemotePort(null)
  __testPendingSync.clear()
  await clearAllSyncOps()
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

describe('_opNeedsUnlock — 锁定态判定所用的敏感字段表', () => {
  // 锁：判定哪些 upsert op 必须等解锁才能安全推送，避免锁定态把仍加密的旧密文/明文
  // 敏感内容误推云。changedFields 优先（只看本次变更字段），否则全字段扫描敏感字段非空。

  it('data 为 null → false（无数据无需解锁）', () => {
    expect(_opNeedsUnlock({ id: 1, action: 'upsert', table: 'bookmarks', itemId: 'x', data: null, ts: 1, retries: 0 })).toBe(false)
  })

  it('table 未映射到 EntityType（未知表）→ sens undefined → false', () => {
    expect(_opNeedsUnlock({
      id: 1, action: 'upsert', table: 'unknown_table' as any, itemId: 'x',
      data: { username: 'secret' }, ts: 1, retries: 0,
    })).toBe(false)
  })

  it('category 敏感字段为空数组 → false（类别无敏感内容，锁定态可正常推）', () => {
    expect(_opNeedsUnlock({
      id: 1, action: 'upsert', table: 'categories', itemId: 'c1',
      data: { name: 'cat' }, ts: 1, retries: 0,
    })).toBe(false)
  })

  it('changedFields 非空且命中敏感字段 → true（本次变更含敏感字段须解锁）', () => {
    expect(_opNeedsUnlock({
      id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1',
      data: { username: 'x', _changedFields: ['username'] }, ts: 1, retries: 0,
    })).toBe(true)
  })

  it('changedFields 非空且全不命中敏感 → false（改了非敏感字段，锁定态仍可推）', () => {
    expect(_opNeedsUnlock({
      id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1',
      data: { username: 'secret', title: 't', _changedFields: ['title', 'url'] }, ts: 1, retries: 0,
    })).toBe(false)
  })

  it('changedFields 为空数组 → 退回全字段扫描，命中非空敏感 → true', () => {
    // changedFields.length>0 守门：空数组 falsy → 走 line 42-46 全字段扫描
    expect(_opNeedsUnlock({
      id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1',
      data: { username: 'secret', _changedFields: [] }, ts: 1, retries: 0,
    })).toBe(true)
  })

  it('changedFields null + 全字段扫描：敏感字段为空/非字符串 → false', () => {
    expect(_opNeedsUnlock({
      id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1',
      data: { username: '', notes: '', title: 't', _changedFields: null }, ts: 1, retries: 0,
    })).toBe(false)
  })

  it('group 表敏感字段命中 notes 非空 → true', () => {
    expect(_opNeedsUnlock({
      id: 1, action: 'upsert', table: 'sibling_groups', itemId: 'g1',
      data: { name: '', notes: 'secret-notes', _changedFields: null }, ts: 1, retries: 0,
    })).toBe(true)
  })

  it('group 表敏感字段 name 非空但 changedFields 指向 notes → true（name 被忽略走 changedFields）', () => {
    // changedFields 非空只看 changedFields.some(sens.includes(f))，name 虽非空但不在 changedFields
    // → 若 changedFields 不含 name/notes 则 false；此处 changedFields 含 notes → true
    expect(_opNeedsUnlock({
      id: 1, action: 'upsert', table: 'sibling_groups', itemId: 'g1',
      data: { name: 'grp', notes: '', _changedFields: ['notes'] }, ts: 1, retries: 0,
    })).toBe(true)
  })
})

describe('_mergeOps — 同 key 合并 + R30 maxRetries + delete 取末条 + sort', () => {
  // 锁：同 table:itemId 多 op 合一条：delete 取最末条 delete op；非 delete 取末条 data
  // + R30 保留历史最大 retries（防新编辑 retries=0 覆盖旧失败 op 重试计数致死信阈值被绕过）；
  // ts 用首条 ts（保序）；结果按 ts 升序。for 循环取 max 而非 spread（防超长数组爆栈）。

  it('delete op 取最末条 delete：同 key 先 upsert 后 delete → 合并为末条 delete', () => {
    const merged = _mergeOps([
      { id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { title: 'v1' }, ts: 100, retries: 0 },
      { id: 2, action: 'delete', table: 'bookmarks', itemId: 'b1', data: null, ts: 200, retries: 0 },
    ])
    expect(merged.length).toBe(1)
    expect(merged[0].action).toBe('delete')
    expect(merged[0].ts).toBe(200) // delete 取末条 ts（last 的 ts）
  })

  it('非 delete 合并取末条 data + 首条 ts + max retries', () => {
    const merged = _mergeOps([
      { id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { title: 'v1' }, ts: 100, retries: 2 },
      { id: 2, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { title: 'v2' }, ts: 200, retries: 0 },
    ])
    expect(merged.length).toBe(1)
    expect(merged[0].data).toEqual({ title: 'v2' }) // 末条 data
    expect(merged[0].ts).toBe(100) // 首条 ts
    expect(merged[0].retries).toBe(2) // max(2,0)=2
  })

  it('R30 maxRetries 取多条最大值（防重试计数被新 op 覆盖绕过死信阈值）', () => {
    const merged = _mergeOps([
      { id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { t: 1 }, ts: 100, retries: 0 },
      { id: 2, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { t: 2 }, ts: 200, retries: 1 },
      { id: 3, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { t: 3 }, ts: 300, retries: 5 },
      { id: 4, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { t: 4 }, ts: 400, retries: 0 },
    ])
    expect(merged[0].retries).toBe(5) // for 循环取 max 非 spread
    expect(merged[0].data).toEqual({ t: 4 }) // 末条
  })

  it('结果按 ts 升序排序（跨 key）', () => {
    const merged = _mergeOps([
      { id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b2', data: { t: 2 }, ts: 300, retries: 0 },
      { id: 2, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { t: 1 }, ts: 100, retries: 0 },
    ])
    expect(merged.map(m => m.itemId)).toEqual(['b1', 'b2']) // 按 ts 升序
  })

  it('空 ops → 空结果', () => {
    expect(_mergeOps([])).toEqual([])
  })

  it('不同 key 各自独立合并不串扰', () => {
    const merged = _mergeOps([
      { id: 1, action: 'upsert', table: 'bookmarks', itemId: 'b1', data: { t: 1 }, ts: 100, retries: 2 },
      { id: 2, action: 'upsert', table: 'bookmarks', itemId: 'b2', data: { t: 2 }, ts: 200, retries: 0 },
      { id: 3, action: 'delete', table: 'bookmarks', itemId: 'b1', data: null, ts: 300, retries: 0 },
    ])
    expect(merged.length).toBe(2)
    const b1 = merged.find(m => m.itemId === 'b1')!
    const b2 = merged.find(m => m.itemId === 'b2')!
    expect(b1.action).toBe('delete') // b1 末条是 delete
    expect(b2.retries).toBe(0) // b2 单条
  })
})

describe('_redactOpData — 日志脱敏边界', () => {
  // 锁：push 失败 warn 输出 op 原始 data 时，敏感字段替换 [redacted] 防明文落控制台。
  // 脱敏集合 ≠ 加密集合：bookmark 额外脱敏 password（E2E 关闭时纯明文，最敏感单字段）。

  it('data 为 null → return null（无数据可脱敏）', () => {
    expect(_redactOpData({ id: 1, action: 'delete', table: 'bookmarks', itemId: 'x', data: null, ts: 1, retries: 0 })).toBeNull()
  })

  it('type 未映射（无 sens）→ 原样返回不脱敏（保留排障可定位）', () => {
    const r = _redactOpData({
      id: 1, action: 'upsert', table: 'unknown_tbl' as any, itemId: 'x', ts: 1, retries: 0,
      data: { name: 'keep', notes: 'keep' },
    })
    expect(r).toEqual({ name: 'keep', notes: 'keep' })
  })

  it('bookmark 空敏感字段不被脱敏（!=null && !=="" 守门跳过空值）', () => {
    const r = _redactOpData({
      id: 1, action: 'upsert', table: 'bookmarks', itemId: 'x', ts: 1, retries: 0,
      data: { username: '', password: '', notes: '', title: 'keep' },
    })
    expect(r!.username).toBe('') // 空不脱敏
    expect(r!.title).toBe('keep')
  })

  it('bookmark 全敏感字段非空 → username/notes/password 全脱敏，title 保留', () => {
    const r = _redactOpData({
      id: 1, action: 'upsert', table: 'bookmarks', itemId: 'x', ts: 1, retries: 0,
      data: { username: 'alice', password: 'super-secret', notes: 'note', title: 'keep' },
    })
    expect(r!.username).toBe('[redacted]')
    expect(r!.password).toBe('[redacted]') // REDACT_EXTRA_FIELDS 补的 password
    expect(r!.notes).toBe('[redacted]')
    expect(r!.title).toBe('keep')
  })

  it('group 表 name/notes 非空 → 脱敏（无 password 额外项）', () => {
    const r = _redactOpData({
      id: 1, action: 'upsert', table: 'sibling_groups', itemId: 'x', ts: 1, retries: 0,
      data: { name: 'grp', notes: 'secret-notes', password: 'should-keep' },
    })
    expect(r!.name).toBe('[redacted]')
    expect(r!.notes).toBe('[redacted]')
    expect(r!.password).toBe('should-keep') // group 不在 REDACT_EXTRA_FIELDS，password 原样保留
  })
})

describe('enqueueDirtyAsOps — 把内存 dirtyIds 转为持久化 ops', () => {
  // 锁：编排 dirty/deleted/newIds/changedFields 四路 drain→ops，调 _markPendingSync 标 pending，
  // 有 op 才 enqueue。无 userId 早退不入队（防匿名脏态推云）。

  it('无 userId → 早退不入队（防未登录推云）', async () => {
    const auth = useAuthStore()
    ;(auth as any).user = null
    const ds = useDataStore()
    ds.addBookmark(makeBm() as any)
    ds._dirtyIds.add('bm-sp-1')
    ds._newIds.add('bm-sp-1')
    ds._trackChange('bm-sp-1', 'title')

    await enqueueDirtyAsOps()
    expect(await syncOpsCount()).toBe(0) // 早返不入队
  })

  it('无脏无删 → ops 为空 → 不调 enqueueSyncOps（if.length 守门）', async () => {
    await enqueueDirtyAsOps()
    expect(await syncOpsCount()).toBe(0)
  })

  it('有 dirty bookmark + changedFields → 入 upsert op 含 _changedFields 数组 + 标 pending', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm() as any)
    ds._dirtyIds.add('bm-sp-1')
    ds._newIds.add('bm-sp-1')
    ds._trackChange('bm-sp-1', 'title')

    await enqueueDirtyAsOps()

    expect(await syncOpsCount()).toBe(1)
    const ops = await drainSyncOps()
    expect(ops[0].action).toBe('upsert')
    expect(ops[0].table).toBe('bookmarks')
    expect(ops[0].data!._changedFields).toEqual(['title'])
    expect(ops[0].data!._isNew).toBe(true)
    expect(ops[0].data!._userId).toBe('user-sp')
    expect(__testPendingSync.has('bm-sp-1')).toBe(true) // dirty 标 pending
  })

  it('dirty 无对应 changedFields → _changedFields 写 null', async () => {
    const ds = useDataStore()
    ds.categories = [{ id: 'c1', name: 'cat', icon: '', color: '', order: 0, updatedAt: 3000 } as any]
    ds._dirtyIds.add('c1')

    await enqueueDirtyAsOps()
    const ops = await drainSyncOps()
    expect(ops[0].table).toBe('categories')
    expect(ops[0].data!._changedFields).toBeNull()
  })

  it('deleted 项 → 入 delete op + data null + 标 pending', async () => {
    const ds = useDataStore()
    ds._deletedIds.set('bm-del', 'bookmarks')

    await enqueueDirtyAsOps()
    const ops = await drainSyncOps()
    expect(ops[0].action).toBe('delete')
    expect(ops[0].table).toBe('bookmarks')
    expect(ops[0].itemId).toBe('bm-del')
    expect(ops[0].data).toBeNull()
    expect(__testPendingSync.has('bm-del')).toBe(true) // deleted 也标 pending
  })

  it('非 dirty 项（localByType 遍历但 dirty.has=false）→ continue 跳过不入队', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm() as any)
    ds._dirtyIds.clear() // 有 bookmark 但不 dirty

    await enqueueDirtyAsOps()
    expect(await syncOpsCount()).toBe(0) // bookmark 非脏被跳过
  })

  it('group 表 dirty → 入 sibling_groups upsert op', async () => {
    const ds = useDataStore()
    ds.siblingGroups = [makeGroup() as any]
    ds._dirtyIds.add('sg-sp-1')

    await enqueueDirtyAsOps()
    const ops = await drainSyncOps()
    expect(ops[0].table).toBe('sibling_groups')
    expect(ops[0].action).toBe('upsert')
  })
})

describe('pushFromQueue 离线守门', () => {
  it('navigator.onLine=false → setSyncError("网络离线") 返 false 不推', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const syncStore = useSyncStore()

    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'b1',
      data: { ...makeBm(), _userId: 'user-sp', _isNew: true, _changedFields: null }, ts: 1,
    }])

    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(false)
    expect(port.upserts.length).toBe(0)
    expect(syncStore.syncError).toBe('网络离线')
  })
})

describe('pushFromQueue 加密失败一条龙（E2E 锁定 + changedFields 绕 lockedItemKeys）', () => {
  // 锁：E2E 启用锁定态下，changedFields 指向非敏感字段（如 title）让 _opNeedsUnlock 返 false
  // 绕过 lockedItemKeys 早退，但 data 含非空敏感字段（notes）触发 encryptItem needsEnc throw
  // 「E2E 已启用但未解锁无法加密」。该 op 走 encFailedOps → retry+1 链路（非误判成功出队），
  // 失败 warn 经 _redactOpData 脱敏（password 明文不打控制台）。锁住「加密失败不丢本地变更 +
  // 失败经重试链路不死信过早/过晚 + 敏感字段不落 warn 明文」三重契约。

  beforeEach(() => {
    const e2e = useE2EStore()
    e2e.setEnabled(true)
    e2e.setUnlocked(false) // 锁定：isLocked=true，但 key=null → encryptItem 遇 needsEnc throw
  })

  it('加密失败 op 未达 MAX → 留队 retries+1 + 状态 error + warn 脱敏不含明文', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-enc', notes: '敏感备注' }) as any) // existing 命中走 history encrypt
    ds._dirtyIds.clear()
    ds._newIds.clear()

    // changedFields=['title'] 非敏感 → _opNeedsUnlock=false → 不进 lockedItemKeys；
    // notes 非空 → encryptItem needsEnc=true → 锁定态 !key → throw → encFailedOps。
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-enc',
      data: {
        ...makeBm({ id: 'bm-enc', notes: '敏感备注', password: '明文密码-plain' }),
        _userId: 'user-sp', _isNew: false, _changedFields: ['title'],
      },
      ts: 1,
    }])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(false) // 有失败 → 返 false
    expect(await syncOpsCount()).toBe(1) // 留队未出队（防丢本地变更）
    const ops = await drainSyncOps()
    expect(ops[0].retries).toBe(1) // retry+1 未达 MAX=3
    expect(useSyncStore().syncStatus).toBe('error')
    expect(useSyncStore().syncError).toMatch(/加密\/序列化失败/)

    // 锁：warn 经 _redactOpData 脱敏，password 明文绝不出现在控制台
    const warnArgs = warnSpy.mock.calls.map(c => JSON.stringify(c)).join('\n')
    expect(warnArgs).not.toContain('明文密码-plain')
    expect(warnArgs).toContain('[redacted]') // 脱敏标记可见
    warnSpy.mockRestore()
  })

  it('加密失败 op 已达 retries=MAX-1 → 再失败一次死信出队 + clearPending', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-enc2', notes: '敏感备注' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-enc2',
      data: {
        ...makeBm({ id: 'bm-enc2', notes: '敏感备注' }),
        _userId: 'user-sp', _isNew: false, _changedFields: ['title'],
      },
      ts: 1,
    }])
    // 手工把 retries 写到 MAX-1=2，再失败一次 nextRetry=3≥MAX → 死信
    const ops0 = await drainSyncOps()
    await (await import('../../stores/storage.js')).updateSyncOpRetry(ops0[0]!.id as number, MAX_PUSH_RETRIES - 1)
    __testPendingSync.add('bm-enc2')

    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await useCloudSync().pushToCloud()

    expect(await syncOpsCount()).toBe(0) // 死信出队
    expect(__testPendingSync.has('bm-enc2')).toBe(false) // clearPending
    vi.mocked(console.warn).mockClear?.()
  })
})

describe('pushFromQueue delete op catch', () => {
  it('delete 失败（deleteError）→ 留队 + syncError + retries+1', async () => {
    const port = createMemorySyncPort({ deleteError: () => ({ message: 'delete rpc fail' }) })
    setSyncRemotePort(port)

    await enqueueSyncOps([{
      action: 'delete', table: 'bookmarks', itemId: 'bm-del',
      data: null, ts: 1,
    }])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(false)
    expect(await syncOpsCount()).toBe(1) // 留队
    const ops = await drainSyncOps()
    expect(ops[0].retries).toBe(1) // retry+1
    expect(useSyncStore().syncStatus).toBe('error')
    expect(useSyncStore().syncError).toMatch(/delete rpc fail/)
    // port 有 err 时 createMemorySyncPort 刻意不 pushes（deletes 数组只在成功时累积），
    // 但 delete 确实被调用且失败 → op 走 retry 链路留队（已由 syncOpsCount=1 锁定）。
    warnSpy.mockRestore()
  })

  it('delete 成功 → 出队 + count 不参与无匹配判定（delete 无 count 字段）', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)

    await enqueueSyncOps([{
      action: 'delete', table: 'bookmarks', itemId: 'bm-del-ok',
      data: null, ts: 1,
    }])

    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(true)
    expect(await syncOpsCount()).toBe(0) // 出队
    expect(port.deletes.length).toBe(1)
  })
})

describe('pushFromQueue 锁定全跳过 idle 分支', () => {
  // 锁：E2E 锁定态且全部 op 都因敏感字段被 lockedItemKeys 跳过（tasks 空）→
  // setSyncStatus('idle') + setPendingLockedCount(lockedItemKeys.size) + return true。
  // （无 _changedFields 绕过，sens 字段非空让 _opNeedsUnlock=true 全进 lockedItemKeys。）

  it('全部敏感 op 被锁定跳过 + 无非敏感 op → tasks 空 → idle + 返 true', async () => {
    const e2e = useE2EStore()
    e2e.setEnabled(true)
    e2e.setUnlocked(false)
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const syncStore = useSyncStore()

    // 无 _changedFields → _opNeedsUnlock 走全字段扫描，username 非空 → true → 进 lockedItemKeys
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-lock',
      data: {
        ...makeBm({ id: 'bm-lock', username: 'secret-user' }),
        _userId: 'user-sp', _isNew: false, _changedFields: null,
      },
      ts: 1,
    }])

    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(true) // idle 返 true（非 error，因未尝试推送）
    expect(port.upserts.length).toBe(0)
    expect(port.updates.length).toBe(0)
    expect(await syncOpsCount()).toBe(1) // 留队待解锁重推
    expect(syncStore.syncStatus).toBe('idle')
    expect(syncStore.pendingLockedCount).toBe(1)
  })
})

describe('pushFromQueue 部分锁定跳过 + success', () => {
  // 锁：锁定态 + 有非敏感 op 成功推送 + 有敏感 op 跳过 →
  // 跳过的计入 pendingLockedCount，成功的设 lastSyncAt + success。

  it('锁定态：非敏感 op（无敏感字段）成功推 + 敏感 op 跳过 → success + pendingLockedCount=1', async () => {
    const e2e = useE2EStore()
    e2e.setEnabled(true)
    e2e.setUnlocked(false)
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const syncStore = useSyncStore()
    syncStore.setLastSyncAt(0)

    // 非敏感 op：bookmark 但敏感字段全空 + changedFields 指向非敏感 → 可锁定态推
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-ok',
      data: {
        ...makeBm({ id: 'bm-ok', username: '', notes: '' }),
        _userId: 'user-sp', _isNew: false, _changedFields: ['title'],
      },
      ts: 1000,
    }])
    // 敏感 op：无 changedFields + username 非空 → 进 lockedItemKeys 跳过
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-skip',
      data: {
        ...makeBm({ id: 'bm-skip', username: 'secret' }),
        _userId: 'user-sp', _isNew: false, _changedFields: null,
      },
      ts: 1001,
    }])

    const before = Date.now()
    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(true)
    expect(port.updates.length).toBe(1) // 非敏感 op 走 update 推成功
    // 非敏感 op 出队，敏感 op 留队
    expect(await syncOpsCount()).toBe(1)
    const remain = await drainSyncOps()
    expect(remain[0].itemId).toBe('bm-skip')
    expect(syncStore.syncStatus).toBe('success')
    expect(syncStore.pendingLockedCount).toBe(1) // 1 个敏感被跳过
    expect(syncStore.lastSyncAt).toBeGreaterThanOrEqual(before) // tasks>0 设 lastSyncAt
  })
})

describe('pushFromQueue 队列空早返', () => {
  it('drainSyncOps 空队列 → 返 true 不副作用', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(true)
    expect(port.upserts.length).toBe(0)
  })
})

describe('pushFromQueue 未登录早返', () => {
  // 锁：pushFromQueue line 158 `if (!userId) return false` 早返——不读 navigator、不读
  // e2eGuard、不 drain 队列，静默返 false 不设 syncError（与未登录 pushErr falsy 短路语义对齐：
  // 无具体错误信息不向用户报失败）。领此分支防未来误把早返改成 throw/标 error。

  it('无 userId → 返 false 不副作用队列不 drain', async () => {
    const auth = useAuthStore()
    ;(auth as any).user = null
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'b1',
      data: { ...makeBm(), _userId: 'user-sp', _isNew: true, _changedFields: null }, ts: 1,
    }])
    const before = await syncOpsCount()

    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(false)
    expect(await syncOpsCount()).toBe(before) // 队列未 drain（早返在 drainSyncOps 之前）
    expect(useSyncStore().syncError).toBe(null) // 不设 error
  })
})

describe('pushFromQueue upsert/update 失败达死信（非加密路径）', () => {
  // 锁：upsert 失败 retries 累到 MAX_PUSH_RETRIES → nextRetry≥MAX → 死信 warn(line 305-306)
  // + deadIds 出队(line 306) + releasedIds 达死信分支(line 342) clearPending。与 encFailed 死信
  // （line 318-319）区分锁定：upsert 业务失败死信经 results 循环（line 290-314），加密失败死信
  // 经 encFailedOps 循环（line 315-323），两条独立死信链路都须锁。（syncPushPull.test.ts 的
  // it3 用 upsertError 触过该分支，本文件独立锁防重构时拆测文件丢契约。）

  it('upsert 失败 retries=MAX-1 → 再失败死信出队 + warn + clearPending', async () => {
    const port = createMemorySyncPort({
      upsertError: () => ({ message: 'always upsert fail' }),
    })
    setSyncRemotePort(port)

    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-dead-up',
      data: { ...makeBm({ id: 'bm-dead-up' }), _userId: 'user-sp', _isNew: true, _changedFields: null },
      ts: 1,
    }])
    const ops0 = await drainSyncOps()
    await (await import('../../stores/storage.js')).updateSyncOpRetry(ops0[0]!.id as number, MAX_PUSH_RETRIES - 1)
    __testPendingSync.add('bm-dead-up')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await useCloudSync().pushToCloud()

    expect(await syncOpsCount()).toBe(0) // 死信出队
    expect(__testPendingSync.has('bm-dead-up')).toBe(false) // clearPending（达死信分支）
    const warnText = warnSpy.mock.calls.map(c => JSON.stringify(c)).join('\n')
    expect(warnText).toMatch(/达到重试上限/) // line 305 warn 锁定
    warnSpy.mockRestore()
  })

  it('update 失败 retries=MAX-1 → 死信经 retry+1≥MAX 出队（partial update 路径死信）', async () => {
    const port = createMemorySyncPort({
      updateError: () => ({ message: 'always update fail' }),
    })
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-dead-up2' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-dead-up2',
      data: { ...makeBm({ id: 'bm-dead-up2' }), _userId: 'user-sp', _isNew: false, _changedFields: ['title'] },
      ts: 1,
    }])
    const ops0 = await drainSyncOps()
    await (await import('../../stores/storage.js')).updateSyncOpRetry(ops0[0]!.id as number, MAX_PUSH_RETRIES - 1)
    __testPendingSync.add('bm-dead-up2')

    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await useCloudSync().pushToCloud()

    expect(await syncOpsCount()).toBe(0) // 死信出队
    expect(__testPendingSync.has('bm-dead-up2')).toBe(false) // clearPending
  })

  it('upsert 失败未达 MAX → retry+1 留队不进死信', async () => {
    const port = createMemorySyncPort({
      upsertError: () => ({ message: 'fail' }),
    })
    setSyncRemotePort(port)

    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-retry',
      data: { ...makeBm({ id: 'bm-retry' }), _userId: 'user-sp', _isNew: true, _changedFields: null },
      ts: 1,
    }])

    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await useCloudSync().pushToCloud()

    expect(await syncOpsCount()).toBe(1) // 留队
    const ops = await drainSyncOps()
    expect(ops[0].retries).toBe(1) // retry+1=1 未达 MAX=3
    expect(__testPendingSync.has('bm-retry')).toBe(false) // 失败未死信 → releasedIds 空不 clear
  })
})

describe('pushFromQueue 顶层 catch 非 Error 兜底', () => {
  // 锁：pushFromQueue try 块内某行抛**未被内层 catch 兜住**的非 Error 值（如 throw 'plain
  // string'）→ 顶层 catch 走 `e instanceof Error ? e.message : '同步失败'` 非 Error 侧（msg='同步失败'）
  // + setSyncStatus('error') + setSyncError('同步失败') + 返 false。锁住「意外非 Error 兜底不崩 +
  // 用通用『同步失败』文案」契约。触发点：临时桩 drainSyncOps reject 一个非 Error 值（唯一
  // 在 drainSyncOps await 处可外泄的注入点，storage mock 工厂返回闭包我们经 setSyncRemotePort
  // 无关，改用临时覆盖模块的 _ops 抛错不可行——故改桩 useDataStore.drainDeletedIds 之类不可，
  // 选用最外层 synchronic 抛错：让 existing 查询的 bookmarkMap 抛——不可控）。
  //
  // 实际触达策略：drainSyncOps 是 vi.mock 工厂内联闭包，测内不可 override。改用
  // 锁：pushFromQueue line 324 `await updateSyncOpRetry(...)` 在 try 内不在任何内层 catch 里，
  // 是唯一生产可外泄非 Error 注入点。桩使其抛 plain string（非 Error 实例）→ 顶层 catch 走
  // `e instanceof Error ? e.message : '同步失败'` 非 Error 侧（msg='同步失败'）+ setSyncStatus('error')
  // + setSyncError('同步失败') + 返 false。锁住「意外非 Error 兜底不崩 + 用通用『同步失败』文案」契约。
  it('顶层 catch 非 Error 兜底：updateSyncOpRetry 抛 plain string → msg=「同步失败」返 false', async () => {
    const port = createMemorySyncPort({
      upsertError: () => ({ message: 'fail' }),
    })
    setSyncRemotePort(port)

    // 一条新 upsert（retries=0），推送失败 → nextRetry=1<MAX → 走 retryUpdateOps.push
    // → line 324 `await updateSyncOpRetry(id, 1)`。桩该调用抛 plain string 'boom'（非 Error）
    // → 顶层 catch 接住 → 非 Error 侧 → setSyncError('同步失败') + 返 false。
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-top',
      data: { ...makeBm({ id: 'bm-top' }), _userId: 'user-sp', _isNew: true, _changedFields: null },
      ts: 1,
    }])
    const storage = await import('../../stores/storage.js')
    vi.mocked(storage.updateSyncOpRetry).mockImplementationOnce(async () => {
      throw 'boom' as unknown as Error
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(false)
    // 非 Error 兜底用通用文案『同步失败』（非原始 'boom' 串，证明走到了 instanceof false 侧）
    expect(useSyncStore().syncStatus).toBe('error')
    expect(useSyncStore().syncError).toBe('同步失败')
    warnSpy.mockRestore()
  })
})

describe('pushFromQueue 未知表 / 空 op.data 早退 + 未知 itemType continue', () => {
  // 锁：upsert op 路径两道防御守门 —— line 215 delete 分支先判 action（非 delete 进下），
  // line 223 `if (!op.data) continue`（upsert 但 data=null 跳过不推，防后续 _changedFields 读 null），
  // line 233-234 `if (!itemType) continue`（tableToEntityType 未映射到 EntityType 的非法表名跳过）。
  // 防御早退不报错、不副作用、保留队列待重试（因不走 port 也不出队）。锁住「非法/缺数据 op
  // 不崩也不误推」契约。

  it('upsert 但 data=null → line 223 continue 不副作用（队列保留不爆）', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)

    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-nodata',
      data: null, ts: 1,
    }])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = await useCloudSync().pushToCloud()
    // 走 success 末尾（无 tasks）→ tasks.length===0 但 lockedItemKeys 空 不进 idle 早返 →
    // line 372 setPendingLockedCount(0) + tasks 0 跳 lastSyncAt + success
    expect(ok).toBe(true)
    expect(port.upserts.length).toBe(0)
    expect(port.updates.length).toBe(0)
    expect(await syncOpsCount()).toBe(1) // 保留队列未出队（未推远端）
    warnSpy.mockRestore()
  })

  it('未知表名（tableToEntityType 无映）→ line 234 continue 不副作用', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)

    await enqueueSyncOps([{
      action: 'upsert', table: 'bad_table' as any, itemId: 'bm-bad',
      data: { id: 'bm-bad', title: 't' } as any, ts: 1,
    }])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(true)
    expect(port.upserts.length).toBe(0)
    expect(port.updates.length).toBe(0)
    expect(await syncOpsCount()).toBe(1) // 未出队
    warnSpy.mockRestore()
  })
})

describe('pushFromQueue history encrypt 块（bookmark/group 的历史快照）', () => {
  // 锁：line 187-203 history encrypt 块仅对 type 为 bookmark/group 且已在本地存在（existingByType）
  // 的 upsert op 调 histE2e.encryptItem 加密后入 historyItems，最终 _saveHistory 推云端版本历史。
  // line 189-190：type 非 bookmark/group 的 op（如 category/attribute）直接 continue 不进 history。
  // line 192 isLocked + lockedItemKeys 命中前已 continue（锁定项不入历史）。line 195-200：
  // existing 命中才调 encryptItem；抛错被 line 199 catch warn（history 失败不阻断主推送）。

  let _origEncrypt: typeof crypto.subtle.encrypt | null = null

  afterEach(() => {
    if (_origEncrypt) crypto.subtle.encrypt = _origEncrypt
    _origEncrypt = null
  })

  it('category upsert type!==bookmark && !==group → line 190 continue 不入历史', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.categories = [{ id: 'c1', name: 'cat', icon: '', color: '', order: 0, updatedAt: 3000 } as any]
    ds._dirtyIds.clear()
    ds._newIds.clear()

    // category upsert（updates 主路径成功）。注意 ENCRYPT_FIELDS.category=[]，
    // 故 line 238 encryptItem 对 category 不加密（原样返回），主推送仍成功。
    await enqueueSyncOps([{
      action: 'upsert', table: 'categories', itemId: 'c1',
      data: { id: 'c1', name: 'cat', icon: '', color: '', order: 0, updatedAt: 3000, _userId: 'user-sp', _isNew: false, _changedFields: ['name'] },
      ts: 1,
    }])

    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(true)
    // category update 主路径成功出队
    expect(await syncOpsCount()).toBe(0)
    expect(port.updates.length).toBe(1)
  })

  it('解锁态 existing bookmark（notes 非空）→ history encrypt 成功入 historyItems（line 196-197）', async () => {
    const e2e = useE2EStore()
    e2e.setEnabled(true)
    e2e.setUnlocked(true)
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    e2e.setKey(key as any)

    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ds = useDataStore()
    // 已存在书签（notes 含敏感内容，命中 ENCRYPT_FIELDS.bookmark）
    ds.addBookmark(makeBm({ id: 'bm-hist', notes: '历史快照原文' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    // changedFields=['title'] 非敏感 → _opNeedsUnlock=false（绕锁定）；但本测解锁态无需绕.
    // history 块：type==='bookmark' + existing 命中 + 不锁定 → line 193 existing + 196 encryptItem
    // 成功 + 197 push historyItems。主推送 line 238 encryptItem（真 key）成功 → port.update 成功。
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-hist',
      data: { ...makeBm({ id: 'bm-hist', notes: '历史快照原文' }), _userId: 'user-sp', _isNew: false, _changedFields: ['title'] },
      ts: 1,
    }])

    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(true)
    expect(await syncOpsCount()).toBe(0) // 出队
    expect(port.updates.length).toBe(1) // 主 update 成功
    // history 走 _saveHistory → nullQ supabase.from('data_history').insert 安全返。
    // 历史快照成功：encryption 跑过不抛（subtle.encrypt 未被桩），主推送同步成
  })

  it('解锁态 history encrypt 抛错 → line 199 catch warn 不阻断主推送', async () => {
    const e2e = useE2EStore()
    e2e.setEnabled(true)
    e2e.setUnlocked(true)
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    e2e.setKey(key as any)

    // stub subtle.encrypt：仅首次（history encrypt 触发）抛错；之后恢复真加密供主推送。
    // history 块 line 196 在主推送 line 238 之前跑，故首次抛被 line 199 catch（history 跳过 warn）。
    let _calls = 0
    _origEncrypt = crypto.subtle.encrypt.bind(crypto.subtle)
    crypto.subtle.encrypt = (async (...args: any[]) => {
      _calls++
      if (_calls === 1) throw new Error('hist-text-encrypt-fail')
      return _origEncrypt!.apply(crypto.subtle, args as any)
    }) as any

    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-hist-fail', notes: '会触发 hist encrypt 抛错' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-hist-fail',
      data: { ...makeBm({ id: 'bm-hist-fail', notes: '会触发 hist encrypt 抛错' }), _userId: 'user-sp', _isNew: false, _changedFields: ['title'] },
      ts: 1,
    }])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = await useCloudSync().pushToCloud()
    // history 失败被 catch warn，但主推送仍走（后续 subtle.encrypt 恢复真加密）→ success
    expect(ok).toBe(true)
    expect(await syncOpsCount()).toBe(0)
    expect(port.updates.length).toBe(1)
    // line 199 warn 含 'history encrypt skipped'（history 失败专用 warn，区分主加密失败）
    const warnText = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(warnText).toMatch(/history encrypt skipped/)
    warnSpy.mockRestore()
  })
})

describe('pushFromQueue port reject catch（upsert/update/delete 的 .catch 兜底）', () => {
  // 锁：port.upsert/update/delete 返回的 Promise 由 syncPush line 247-219/250/264/262 包了
  // `.catch(e => ({op, result:{data:null,error:{message:String(e?.message||e)}}}))`——把 port reject
  // 统一转成 result.error 格式（防 unhandled rejection + 让失败走重试链路而非崩）。createMemorySyncPort
  // 默认不 reject 只返 {error}，故该 .catch 路径既有测零触。这里自定义 port 抛 reject 验真。

  it('port.upsert reject → line 250 catch 转 result.error 走重试链路', async () => {
    // 自定义 port：upsert 抛 reject 一个 Error
    const port = {
      ...createMemorySyncPort(),
      upsert: vi.fn(async () => Promise.reject(new Error('port upsert reject'))),
    }
    setSyncRemotePort(port as any)

    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-rej-up',
      data: { ...makeBm({ id: 'bm-rej-up' }), _userId: 'user-sp', _isNew: true, _changedFields: null },
      ts: 1,
    }])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(false)
    expect(await syncOpsCount()).toBe(1) // 留队重试
    expect(useSyncStore().syncStatus).toBe('error')
    expect(useSyncStore().syncError).toMatch(/port upsert reject/)
    warnSpy.mockRestore()
  })

  it('port.update reject → line 264 catch 转 result.error 走重试链路', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-rej-upd' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    const port = {
      ...createMemorySyncPort(),
      update: vi.fn(async () => Promise.reject(new Error('port update reject'))),
    }
    setSyncRemotePort(port as any)

    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-rej-upd',
      data: { ...makeBm({ id: 'bm-rej-upd' }), _userId: 'user-sp', _isNew: false, _changedFields: ['title'] },
      ts: 1,
    }])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(false)
    expect(await syncOpsCount()).toBe(1)
    expect(useSyncStore().syncError).toMatch(/port update reject/)
    warnSpy.mockRestore()
  })

  it('port.delete reject → line 219 catch 转 result.error 走重试链路', async () => {
    const port = {
      ...createMemorySyncPort(),
      delete: vi.fn(async () => Promise.reject(new Error('port delete reject'))),
    }
    setSyncRemotePort(port as any)

    await enqueueSyncOps([{
      action: 'delete', table: 'bookmarks', itemId: 'bm-rej-del',
      data: null, ts: 1,
    }])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(false)
    expect(await syncOpsCount()).toBe(1) // 留队
    expect(useSyncStore().syncError).toMatch(/port delete reject/)
    warnSpy.mockRestore()
  })
})

describe('pushFromQueue partial update 字段过滤（line 254-258 snakeKey 守门）', () => {
  // 锁：partial update 路径 line 253 初始化 `partial = { id: op.itemId, user_id: userId, updated_at_num }`
  // 后 line 254-258 `for (const f of changedFields)` 把每字段 camelToSnake 后经
  // `snakeKey !== 'id' && snakeKey !== 'user_id' && snakeKey in row` 三守门写入 partial：
  //   - id / user_id 蛇形名守门排除（防 changedFields 覆盖主键/账号关联）——partial 初始已含二者故
  //     守门只是「不覆盖」非「移除」，保留 line 253 初始 id/user_id 不被子段覆盖。
  //   - 不在 row 的字段（snakeKey in row false）跳过即不入 partial（防写入不存在的列超 RLS）。
  // 最后 `const { id, ...updateData } = partial` 析出 id（id 由 port.update 单独传参），updateData
  // 残留 user_id/updated_at_num/已守门字段。锁住「changedFields 不越权改主键 + 不写缺字段」契约。

  it('changedFields 含 id/user_id → 守门排除不覆盖（partial id 析构出 + user_id 保留初始值）', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-pf' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    const port = createMemorySyncPort()
    setSyncRemotePort(port)

    // changedFields 故意含 'id' + 'user_id' + 'title'：line 256 守门对 id/user_id 跳过
    // （不动 partial 初始值），'title' 守门通过写入。验证 update 不因 changedFields id 漂移主键。
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-pf',
      data: { ...makeBm({ id: 'bm-pf' }), _userId: 'user-sp', _isNew: false, _changedFields: ['id', 'user_id', 'title'] },
      ts: 1,
    }])

    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(true)
    expect(port.updates.length).toBe(1)
    const patch = port.updates[0].patch
    // id 被析构出来当 update 的主键入参，patch 不含 id
    expect(patch.id).toBeUndefined()
    // user_id 守门保留 partial 初始值（=登录 userId 'user-sp'），不被 changedFields 覆盖漂移
    expect(patch.user_id).toBe('user-sp')
    // 正常字段 'title' 通过守门写入
    expect(patch.title).toBeDefined()
    expect(patch.updated_at_num).toBeDefined() // 初始字段保留
  })

  it('changedFields 含 row 不存在的字段 → snakeKey in row false 守门跳过不入 partial', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-nf' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    const port = createMemorySyncPort()
    setSyncRemotePort(port)

    // changedFields 含一个 row 里没有的字段（不是真实 Bookmark 字段名）+ 'notes'（正常）
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-nf',
      data: { ...makeBm({ id: 'bm-nf', notes: '改了' }), _userId: 'user-sp', _isNew: false, _changedFields: ['totally_nonexistent_field', 'notes'] },
      ts: 1,
    }])

    const ok = await useCloudSync().pushToCloud()
    expect(ok).toBe(true)
    const patch = port.updates[0].patch
    // 缺字段守门跳过：该字段蛇形名不在 patch
    expect(patch.totally_nonexistent_field).toBeUndefined()
    expect(patch.totallynonexistentfield).toBeUndefined()
    // 但 notes 正常通过守门入 patch
    expect(patch.notes).toBeDefined()
  })
})

