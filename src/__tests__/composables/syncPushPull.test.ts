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
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import { _redactOpData } from '../../composables/domain/syncPush.js'

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

  it('3.5 无匹配 update 不判成功：op 留队、retries 自增、状态 error（防丢本地变更）', async () => {
    // 真实 Supabase update().eq('id',..).eq('user_id',..) 不命中行时返 { data:null, error:null }，
    // 与成功更新同形。port 层透传 count:0 区分；syncPush 必须把它当失败走重试链路，
    // 而非误判成功 removeSyncOps 永久出队——后者会让本地变更永久丢失（远端从未写入）。
    const port = createMemorySyncPort({
      updateCount: () => 0, // 模拟无匹配 update
    })
    setSyncRemotePort(port)

    await enqueueSyncOps([{
      action: 'upsert',
      table: 'bookmarks',
      itemId: 'bm-noMatch',
      data: {
        ...makeBm({ id: 'bm-noMatch' }),
        _userId: 'user-pp',
        _isNew: false,
        _changedFields: ['title'],
      },
      ts: Date.now(),
    }])

    const sync = useCloudSync()
    const ok = await sync.pushToCloud()
    // 失败：pushToCloud 返 false，op 未出队（仍在队列待重试）
    expect(ok).toBe(false)
    expect(await syncOpsCount()).toBe(1)
    const ops = await drainSyncOps()
    expect(ops[0].retries).toBe(1)
    // port 确实调过 update（说明走到了 update 分支而非误判跳过）
    expect(port.updates.length).toBe(1)
    expect(port.updates[0].id).toBe('bm-noMatch')
    // 状态标 error（非 success），给用户可见反馈
    expect(useSyncStore().syncStatus).toBe('error')
    expect(useSyncStore().syncError).toMatch(/未匹配远端/)
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

  it('9 fullSync pushed=true 正路径：push 全成功→fullSync 返 true + pull 仍执行拉远端 + syncStatus=success 不被 error 污染（D1-37）', async () => {
    // 锁 fullSync line 104-105 分支：pushFromQueue 返 true（队列无 op 或全成功）时
    // 走 `await pullChanges()` 正路径、return pushed(=true)，不进 `if (!pushed)` error 恢复分支。
    // 该分支此前零直测（it8 只测 push 失败的 !pushed 分支），若未来误把 error 恢复逻辑
    // 提到 if 分支外（无条件设 error），push 全成功也误显失败态——本护栏锁定正路径。
    const ds = useDataStore()
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds._deletedIds.clear()
    // 队列无 op + store 无脏项 → fullSync line86 enqueueDirtyAsOps 入 0 条 →
    // pushFromQueue drainSyncOps 返空 → line136 `if (!rawOps.length) return true` → pushed=true
    expect(await syncOpsCount()).toBe(0)

    // 远端预置一条书签供 pull merge 进本地（验证正路径 pull 真执行）
    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [{
          id: 'bm-clean-arrived', user_id: 'user-pp',
          title: '正路径远端', url: 'https://clean.example', username: '', password: '',
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

    // 正路径：fullSync 返 true（push 成功），pull 执行拉进本地
    expect(ok).toBe(true)
    expect(ds.bookmarks.some(b => b.id === 'bm-clean-arrived')).toBe(true)
    // 正路径不设 error：syncStatus=success（pull 成功置位）、syncError=null
    expect(useSyncStore().syncStatus).toBe('success')
    expect(useSyncStore().syncError).toBe(null)
  })

  it('10 fullSync pushErr-falsy 边界：push 因未登录返 false 但 syncError 空→pull 后 `if (pushErr)` falsy 短路不恢复 error，syncStatus 不被强设失败（D1-37）', async () => {
    // 锁 fullSync line 95-103 `if (!pushed)` 内 `if (pushErr)` 的 falsy 短路分支：
    // pushFromQueue line129 `if (!userId) return false` 早返不设 syncError，
    // fullSync 读到 pushErr=null → 不恢复 error 状态。锁定「仅在真有 push 错误信息时
    // 才向用户报失败」语义——防未来误把 `if (pushErr)` 改成无条件 setSyncStatus('error')，
    // 让无具体错误信息的 push 失败（如未登录早返）也误显失败态误导用户。该分支此前零直测。
    const ds = useDataStore()
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds._deletedIds.clear()
    // 显式预置 success 态：模拟「之前同步成功」，验证不会被 fullSync 强设 error
    useSyncStore().setSyncStatus('success')
    useSyncStore().setSyncError(null)
    useSyncStore().setLastSyncAt(0)

    // 清掉登录 userId → enqueueDirtyAsOps line80-81 早返不入队 + pushFromQueue line129 早返 false 不设 error
    const auth = useAuthStore()
    ;(auth as any).user = null
    // port 仍预置一条远端（验证 pull 虽同样 userId 空早返不跑——net effect 状态不被污染）
    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [{
          id: 'bm-anon', user_id: 'user-pp', title: '匿名不达', url: 'https://anon.example',
          username: '', password: '', notes: '', icon: '', category_id: CAT_UNCATEGORIZED,
          parent_id: null, order: 0, use_count: 0, attributes: {}, is_expanded: false,
          created_at_num: 1000, updated_at_num: 9000, deleted_at: null,
        }],
        sibling_groups: [], categories: [], custom_attributes: [],
      },
    })
    setSyncRemotePort(port)

    const sync = useCloudSync()
    const ok = await sync.fullSync()

    // push 未登录返 false（pushed=false）→ fullSync 返 false
    expect(ok).toBe(false)
    // 关键不变量：未登录 push 早返无错误信息，fullSync 不向用户报失败
    expect(useSyncStore().syncError).toBe(null)
    expect(useSyncStore().syncStatus).not.toBe('error')
    // pull 因同样 userId 空早返不跑 → 远端书签未进本地（佐证整体是干净的早返 no-op）
    expect(ds.bookmarks.some(b => b.id === 'bm-anon')).toBe(false)
  })

  it('11 虚拟分类 order 被云端毫秒戳 assign 覆盖后 pull 立即归一化回序号（首登乱序复现）', async () => {
    // 复现用户症状：B-12 修复前的存量云端数据里 all/uncategorized 的 order 是毫秒戳
    // （超界），首登 pull 时本地 DEFAULTS 注入的分类 updatedAt=undefined →
    // isRemoteNewer 恒真 → assign 把毫秒戳 order 就地覆盖本地 0/1 → 侧栏排序乱。
    // pull 末尾 _normalizeCategoryOrders 必须把它立即打回数组序号，且 markDirty 回推。
    const ds = useDataStore()
    ds.categories = [
      { id: CAT_ALL, name: '全部', icon: '', color: '', order: 0, updatedAt: 100 },
      { id: CAT_UNCATEGORIZED, name: '未分类', icon: '', color: '', order: 1, updatedAt: 100 },
      { id: 'c-real', name: '真实分类', icon: '', color: '', order: 2, updatedAt: 100 },
    ] as any

    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [], sibling_groups: [], custom_attributes: [],
        // 云端存量：虚拟分类 order 是 B-12 前的毫秒戳（13 位超界），updatedAt 更新
        categories: [
          { id: CAT_ALL, user_id: 'user-pp', name: '全部', icon: 'grid', color: '', order: 1786356540753, updated_at_num: 9000, deleted_at: null },
          { id: CAT_UNCATEGORIZED, user_id: 'user-pp', name: '未分类', icon: 'bookmark', color: '', order: 1786356540754, updated_at_num: 9001, deleted_at: null },
          { id: 'c-real', user_id: 'user-pp', name: '真实分类', icon: '', color: '', order: 1786356540755, updated_at_num: 9002, deleted_at: null },
        ],
      },
      allIds: {
        bookmarks: [], sibling_groups: [], custom_attributes: [],
        categories: [{ id: CAT_ALL }, { id: CAT_UNCATEGORIZED }, { id: 'c-real' }],
      },
    })
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(0)

    const sync = useCloudSync()
    const ok = await sync.pullFromCloud(false)
    expect(ok).toBe(true)

    // assign 后本地 order 一度是毫秒戳 → pull 归一化必须打回数组序号（虚拟分类恒 0/1）
    expect(ds.categories.find(c => c.id === CAT_ALL)!.order).toBe(0)
    expect(ds.categories.find(c => c.id === CAT_UNCATEGORIZED)!.order).toBe(1)
    expect(ds.categories.find(c => c.id === 'c-real')!.order).toBe(2)
    // 归一化重写的项 markDirty → 后续 push 把序号回推云端，闭环
    expect(ds._dirtyIds.has(CAT_ALL)).toBe(true)
    expect(ds._dirtyIds.has(CAT_UNCATEGORIZED)).toBe(true)
    expect(ds._dirtyIds.has('c-real')).toBe(true)
  })

  it('12 全量对账不软删虚拟分类：云端 categories 无 all/uncategorized 记录时本地保留（首登后消失复现）', async () => {
    // 未重排过分类的用户云端从未推送过虚拟分类 → 对账 selectAllIds 云端无它们 →
    // 旧实现 reconcileDelete 把本地 all/uncategorized 软删，侧栏两项消失。
    // 注：全量 ID 对账（selectAllIds × 4）已在 pull 降频——仅 full=true 跑（常规增量
    // pull 走 selectSince + selectSoftDeleted 足够，物理删除兜底延迟到 fullSync）。
    // 故本用例改调 pullFromCloud(true) 验证 full 对账仍正确豁免虚拟分类、软删 c-gone。
    const ds = useDataStore()
    ds.categories = [
      { id: CAT_ALL, name: '全部', icon: '', color: '', order: 0, updatedAt: 100 },
      { id: CAT_UNCATEGORIZED, name: '未分类', icon: '', color: '', order: 1, updatedAt: 100 },
      { id: 'c-keep', name: '云端有', icon: '', color: '', order: 2, updatedAt: 100 },
      { id: 'c-gone', name: '云端无', icon: '', color: '', order: 3, updatedAt: 100 },
    ] as any

    const port = createMemorySyncPort({
      // full pull since=0 应拉回远端全部存活行；c-keep 存活须在 sinceRows 出现
      // 才不被 _mergeIntoLocal 的 full-absent-delete 对账误删（真实 since=0 必拉回它）。
      // c-gone 远端确无它（both sinceRows 与 allIds 都不含）→ 两条对账路径都判 absent → 软删。
      sinceRows: {
        bookmarks: [], sibling_groups: [], custom_attributes: [],
        categories: [{
          id: 'c-keep', user_id: 'u1', name: '云端有', icon: '', color: '',
          order: 2, updated_at_num: 100, deleted_at: null,
        }],
      },
      // allIds 仅供 selectAllIds reconcile 兜底（c-keep 在远端，c-gone 不在）
      allIds: {
        bookmarks: [], sibling_groups: [], custom_attributes: [],
        categories: [{ id: 'c-keep' }],
      },
    })
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(5000) // lastSyncAt>0 满足 full-absent-delete 前提

    const sync = useCloudSync()
    const ok = await sync.pullFromCloud(true) // full pull 触发全量 ID 对账
    expect(ok).toBe(true)

    const cat = (id: string) => ds.categories.find(c => c.id === id)
    // 虚拟分类保留且存活
    expect(cat(CAT_ALL)?.deletedAt).toBeFalsy()
    expect(cat(CAT_UNCATEGORIZED)?.deletedAt).toBeFalsy()
    expect(cat(CAT_ALL)).toBeTruthy()
    expect(cat(CAT_UNCATEGORIZED)).toBeTruthy()
    // 真实分类按原语义对账软删（证明豁免只针对虚拟分类）
    expect(cat('c-gone')?.deletedAt).toBeTruthy()
    expect(cat('c-keep')?.deletedAt).toBeFalsy()
  })
})

describe('syncPush 同 key 多 raw op 清理（F1 orphan + F2 maxRetries 不对称）', () => {
  // 复现 Explore 扫出的两条同根源真 bug——cleanup 用单值 rawOpsMap（`new Map(后写覆盖)`）
  // 只取末条 raw 进行 success/retry 处理：
  // F1（orphan 留队）：同 key 的多条 raw 经 _mergeOps 合并为 1 条 merged 推送成功后，
  //   `succeededIds.push(rawMatch.id)` 只删末条 raw，其余成 orphan 留 IDB 队列 →
  //   下次任意 sync drain 又拉回 orphan 重推（Supabase upsert 幂等不报错但浪费 RPC/带宽/
  //   updated_at_num bump）+ badge syncLabel 永驻「N 项待同步」永远清不掉。
  // F2（maxRetries 不对称）：_mergeOps 死信判定用 maxRetries（max），cleanup retry+1 写回
  //   用末条 raw.retries。若同 key 有 op5(retries=2)+op6(retries=0)，merge 用 2 判「未达 MAX(3)」，
  //   cleanup 写 op6 retries=0+1=1（不是 2），下轮 drain max(2,1)=2 又未达 → 多绕几轮才进死信。
  // 修复：cleanup 用 rawsByKey（多值 Map）同 key 全部 raw 一起处理 + 用 merged.retries (=max)
  //   做死信判定，与 _mergeOps 对称。

  it('F1：同 key 2 条 raw op push 成功后全部出队，无 orphan 留队（旧实现只剩末条 → 队列剩 1）', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm() as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    // 同 key（bookmarks:bm-dup）入 2 条 raw op：模拟 3s debounce 窗口内两次编辑同书签
    // （drainDirtyIds 每轮清空后用户又编辑重新 dirty 入队 → 同 key 多条 raw 入队）。
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-dup',
      data: { ...makeBm({ id: 'bm-dup', title: '第一版' }), _userId: 'user-pp', _isNew: false, _changedFields: ['title'] },
      ts: 1000,
    }])
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-dup',
      data: { ...makeBm({ id: 'bm-dup', title: '第二版' }), _userId: 'user-pp', _isNew: false, _changedFields: ['title'] },
      ts: 1001,
    }])

    const sync = useCloudSync()
    const ok = await sync.pushToCloud()
    expect(ok).toBe(true)

    // _mergeOps 把同 key 2 条合并为 1 条 merged → port 只收到 1 次 update
    // （_isNew:false+_changedFields:['title'] 走 partial update 分支非全行 upsert）。
    // 同 key 多条 raw 应被 removeSyncOps 一次性清出 IDB 队列。
    expect(port.updates.length).toBe(1)
    // 关键断言：全部 raw 出队，队列清零。旧实现 cleanup 只删末条 raw → 队列剩 1 条 orphan。
    expect(await syncOpsCount()).toBe(0)
    const remaining = await drainSyncOps()
    expect(remaining.length).toBe(0)
  })

  it('F1 链式：3 条同 key raw push 成功后全部出队', async () => {
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-tri' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    for (let i = 0; i < 3; i++) {
      await enqueueSyncOps([{
        action: 'upsert', table: 'bookmarks', itemId: 'bm-tri',
        data: { ...makeBm({ id: 'bm-tri', title: `v${i}` }), _userId: 'user-pp', _isNew: false, _changedFields: ['title'] },
        ts: 2000 + i,
      }])
    }
    expect(await syncOpsCount()).toBe(3)

    const sync = useCloudSync()
    const ok = await sync.pushToCloud()
    expect(ok).toBe(true)
    // 合并成 1 条 → 1 次 update（partial）；3 条 raw 全部出队
    expect(port.updates.length).toBe(1)
    expect(await syncOpsCount()).toBe(0)
  })

  it('F1 累积：用户连编辑产生新 op + 旧 orphan 还在队时，本轮 push 不再留下新 orphan', async () => {
    // 模拟场景：上轮 push 后理论上应清空同 key 全部 raw，但旧实留下 orphan。
    // 修复后即便队里已有遗留 orphan（手动注入一条），新一轮同 key push 成功后
    // cleanup 也把新入的所有 raw 都出队（这条断言锁定不再生成新 orphan 的属性）。
    const port = createMemorySyncPort()
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-accum' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-accum',
      data: { ...makeBm({ id: 'bm-accum', title: 'v1' }), _userId: 'user-pp', _isNew: false, _changedFields: ['title'] },
      ts: 3000,
    }])
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-accum',
      data: { ...makeBm({ id: 'bm-accum', title: 'v2' }), _userId: 'user-pp', _isNew: false, _changedFields: ['title'] },
      ts: 3001,
    }])

    const sync = useCloudSync()
    const ok = await sync.pushToCloud()
    expect(ok).toBe(true)
    // 2 条同 key raw 全部出队
    expect(await syncOpsCount()).toBe(0)
  })

  it('F2：同 key op5(retries=2)+op6(retries=0) push 失败 → 用 max=2 走死信一次到位（maxRetries+1=3）', async () => {
    // 旧实现 cleanup 用末条 raw.retries=0 → nextRetry=1（没死信），下轮又 max(2,1)=2 未达 MAX，
    // 需多绕几轮才进死信。修复用 merged.retries(=max=2) → nextRetry=3 直接达 MAX 进死信。
    const port = createMemorySyncPort({
      updateError: () => ({ message: 'always fail' }),
    })
    setSyncRemotePort(port)
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-asym' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()

    // 入两条同 key raw（潮：同 key 多 raw 与 retry 同时影响死信判定）
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-asym',
      data: { ...makeBm({ id: 'bm-asym' }), _userId: 'user-pp', _isNew: false, _changedFields: ['title'] },
      ts: 4000,
    }])
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-asym',
      data: { ...makeBm({ id: 'bm-asym' }), _userId: 'user-pp', _isNew: false, _changedFields: ['title'] },
      ts: 4001,
    }])
    // 手工把首条 raw.retries 写到 2（模拟历史失败过的 op），末条保持 0
    const ops = await drainSyncOps()
    expect(ops.length).toBe(2)
    const firstRaw = ops[0]!, secondRaw = ops[1]!
    expect(firstRaw.id).toBeDefined()
    expect(secondRaw.id).toBeDefined()
    await updateSyncOpRetry(firstRaw.id!, 2)
    __testPendingSync.add('bm-asym')

    const sync = useCloudSync()
    await sync.pushToCloud()

    // 修复后：merged.reties=max(2,0)=2，nextRetry=3≥MAX_PUSH_RETRIES(3) → 死信 →
    // 同 key 两条 raw 全部 removeSyncOps（出队）+ clearPendingSync('bm-asym')。
    expect(await syncOpsCount()).toBe(0)
    expect(_isPendingSync('bm-asym')).toBe(false)
  })

  it('cleanup 用 merged.retries 而非末条 raw.retries：单条 raw（retries=2）失败应一次进死信', async () => {
    // 退化护栏：单条 raw 场景，merged 就是该 raw 本身，merged.retries=raw.retries=2，
    // nextRetry=3 正好达 MAX → 死信。这锁定「同 key 单 raw 时不退化」（修复不能让单 raw
    // 死信判定也漂移）。对照 syncPushPull.test.ts 的 it3 死信测，这里构造同形 +retries=2。
    const port = createMemorySyncPort({
      upsertError: () => ({ message: 'always fail' }),
    })
    setSyncRemotePort(port)

    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-single',
      data: { ...makeBm({ id: 'bm-single' }), _userId: 'user-pp', _isNew: true, _changedFields: null },
      ts: Date.now(),
    }])
    const ops = await drainSyncOps()
    const id = ops[0]?.id
    expect(id).toBeDefined()
    await updateSyncOpRetry(id!, 2)
    __testPendingSync.add('bm-single')

    const sync = useCloudSync()
    await sync.pushToCloud()

    expect(await syncOpsCount()).toBe(0)
    expect(_isPendingSync('bm-single')).toBe(false)
  })
})

describe('syncPull 解锁态竞态（D1-4）', () => {
  // pullChanges 在 isUnlocked=true 时对远端逐条 decryptItem；其内 async decryptField
  // 对三段密文字段 await crypto.subtle.decrypt（真异步让出点）。若解密中途被撤销锁（如
  // 另一路径触发 lock）：decryptList 循环下一条前 `if (!isUnlocked.value) break` 命中，
  // 随后 `if (!e2e.isUnlocked.value) setSyncStatus('idle'); return false` 中止本轮 merge。
  // 本用例靠 stub subtle.decrypt 在首条解密结束时撤锁，锁定该竞态边界：
  // 部分解密不污染本地（merge 未执行）、pull 返回 false、状态置 idle。
  let _origDecrypt: typeof crypto.subtle.decrypt | null = null
  let _withdrawCalls = 0

  beforeEach(async () => {
    _withdrawCalls = 0
    const e2e = useE2EStore()
    e2e.setEnabled(true)
    e2e.setUnlocked(true)
    // 真实 AES-GCM CryptoKey（jsdom/node 有 webcrypto），让 decryptItem 走 decryptField
    // 对三段密文字段真 await subtle.decrypt —— 此 await 是模拟竞态的唯一让出点。
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    )
    e2e.setKey(key as any)
    // stub subtle.decrypt：首条解密成功后立即撤锁模拟并发竞态；之后原样返回空解密结果。
    _origDecrypt = crypto.subtle.decrypt.bind(crypto.subtle)
    _withdrawCalls = 0
    crypto.subtle.decrypt = (async (_alg: any, _k: any, _data: any) => {
      _withdrawCalls++
      if (_withdrawCalls === 1) e2e.setUnlocked(false) // 首条解密结束即撤锁
      return new ArrayBuffer(0)
    }) as any
  })

  afterEach(() => {
    if (_origDecrypt) crypto.subtle.decrypt = _origDecrypt
    _origDecrypt = null
  })

  it('解锁态中途撤锁 → 中止 pull、远端项不进本地、状态 idle', async () => {
    // 远端两条 bookmark，username 填三段密文让 decryptItem 走真 await subtle.decrypt
    // （bookmark 的 ENCRYPT_FIELDS 是 username/notes，三段策略触发 decryptField）
    const remoteBm = (id: string) => ({
      id, user_id: 'user-pp', title: '远端书签 ' + id, url: 'https://race.example/' + id,
      username: 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24), password: '', notes: '', icon: '',
      category_id: CAT_UNCATEGORIZED, parent_id: null,
      order: 0, use_count: 0, attributes: {}, is_expanded: false,
      created_at_num: 1000, updated_at_num: 9000, deleted_at: null,
    })
    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [remoteBm('bm-race-1'), remoteBm('bm-race-2')],
        sibling_groups: [], categories: [], custom_attributes: [],
      },
    })
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(0)

    const sync = useCloudSync()
    const ok = await sync.pullFromCloud(false)

    // 撤锁竞态确被触发：至少调到一次 subtle.decrypt（首条解密中）
    expect(_withdrawCalls).toBeGreaterThanOrEqual(1)
    // 中止：pull 返回 false
    expect(ok).toBe(false)
    // 状态置 idle（非 error、非 success），表明这是主动中止而非崩溃
    expect(useSyncStore().syncStatus).toBe('idle')
    // 远端项未 merge 进本地 —— 中断发生在 decrypt 阶段、merge 之前
    const ds = useDataStore()
    expect(ds.bookmarkMap['bm-race-1']).toBeUndefined()
    expect(ds.bookmarkMap['bm-race-2']).toBeUndefined()
  })
})

describe('syncPull — 远端软删批次 dirty/pending guard', () => {
  it('本地 dirty 项不被远端软删批次静默删除（in-flight 编辑不被抹掉）', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-dirty' }) as any)
    ds._dirtyIds.add('bm-dirty')
    const port = createMemorySyncPort({
      softDeleted: { bookmarks: [{ id: 'bm-dirty', updated_at_num: 9999 }] },
    })
    setSyncRemotePort(port)
    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(true)
    expect(ds.bookmarkMap['bm-dirty'].deletedAt).toBeUndefined()
    expect(ds._dirtyIds.has('bm-dirty')).toBe(true)
  })

  it('本地 pending 项不被远端软删批次静默删除', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-pending' }) as any)
    __testPendingSync.add('bm-pending')
    const port = createMemorySyncPort({
      softDeleted: { bookmarks: [{ id: 'bm-pending', updated_at_num: 9999 }] },
    })
    setSyncRemotePort(port)
    await useCloudSync().pullFromCloud(false)
    expect(ds.bookmarkMap['bm-pending'].deletedAt).toBeUndefined()
  })

  it('非 dirty/pending 的活跃项被远端软删批次正常软删（guard 不误伤）', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-clean' }) as any)
    ds._dirtyIds.clear()
    const port = createMemorySyncPort({
      softDeleted: { bookmarks: [{ id: 'bm-clean', updated_at_num: 9999 }] },
    })
    setSyncRemotePort(port)
    await useCloudSync().pullFromCloud(false)
    expect(ds.bookmarkMap['bm-clean'].deletedAt).toBeDefined()
  })
})

describe('sync 逆回归（81e926a3 降频把对账入口关死 + redact 漏 password）', () => {
  // 背景：81e926a3 perf(sync) 把全量 ID 对账（selectAllIds + reconcileDelete +
  // full-absent-delete）从「每次 lastSyncAt>0 常规 pull 都跑」改成仅 full=true 跑，
  // 但对账入口从此变成不可达死代码——生产无任何调用方传 pullChanges(true)：
  //   useCloudSync.fullSync 调 pullChanges() 无参(false)、initialSync/_onOnline/
  //   _onVisibilityChange/subscribeRealtime 全部 false。于是远端物理删除本机残留行
  //   永远对不掉（常规增量 selectSince/selectSoftDeleted 都拉不到被整行删掉的 id）。
  // 修复：fullSync 补传 full=true，让「手动全量同步」真正跑对账（回归 entry 点在
  //  SyncStatusPopover/CommandPalette 调用的 fullSync，非测试直调 pullFromCloud(true)）。

  it('fullSync 走 full=true：本地残留书签因远端 selectAllIds 无它而被 reconcile 软删', async () => {
    const ds = useDataStore()
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds._deletedIds.clear()
    // 已同步账号（lastSyncAt>0）：本地有一条远端已被物理删除的残留书签 bm-ghost
    ds.addBookmark(makeBm({ id: 'bm-ghost', title: '幽灵残留' }) as any)
    useSyncStore().setLastSyncAt(9000)

    // 远端任何查询都没有 bm-ghost：sinceRows 无（增量拉不回）、allIds 无（对账判它远端已删）
    const port = createMemorySyncPort({
      sinceRows: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().fullSync()
    expect(ok).toBe(true)
    // 回归断言：fullSync 若仍按旧 bug 调 pullChanges(false)，reconcile 死代码不跑，
    // bm-ghost 不会软删（增量增量查不到它）→ 本断言失败。修复后 full=true 对账软删它。
    expect(ds.bookmarkMap['bm-ghost'].deletedAt).toBeDefined()
  })

  it('fullSync 用 full=true 但不误删仍在重试(pending)的本地项', async () => {
    const ds = useDataStore()
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds._deletedIds.clear()
    ds.addBookmark(makeBm({ id: 'bm-editing', title: '编辑中' }) as any)
    useSyncStore().setLastSyncAt(9000)
    ds._dirtyIds.add('bm-editing')

    // 让 bm-editing 的 upsert push 失败——fullSync 前置推失败 → 它留在队列并标记 pending
    //（_markPendingSync），full 对账（selectAllIds 无它）也不能把它当「远端已删」软删，
    // 必须由 syncMergeCore full-absent-delete 守卫（!isDirty && !isPending && lastSyncAt>0）拦下，
    // 否则待重试的本地项被灭，排队 upsert 永远 revive 不回来。
    const port = createMemorySyncPort({
      upsertError: (_t, row) => (row.id === 'bm-editing' ? { message: 'simulated network fail' } : null),
      sinceRows: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      softDeleted: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    setSyncRemotePort(port)

    await useCloudSync().fullSync()
    // full-absent-delete 守卫：pending 项不被全量灭（其待重试 upsert 会 revive 回来）
    expect(ds.bookmarkMap['bm-editing'].deletedAt).toBeUndefined()
    // 且确实还被标记 pending（守卫判断依据成立，非误删后侥幸）
    expect(_isPendingSync('bm-editing')).toBe(true)
  })

  // 背景：81e926a3 ④ _redactOpData 复用 ENCRYPT_FIELDS 单一来源做日志脱敏，但 ENCRYPT_FIELDS
  // 刻意排除 password（它走 EncryptedPassword 独立链路）。E2E 关闭时 op.data.password 是纯明文
  // 字符串，push 失败 warn（syncPush:348 console.warn('首条失败 op 原始 data')）会把明文密码打到
  // 控制台，与 commit 声称「避免 password 明文落控制台」直接矛盾。修复：日志脱敏独立于加密，
  // 在 ENCRYPT_FIELDS 基础上补 password。
  it('_redactOpData 对 bookmark 明文 password 也脱敏（不只是 username/notes）', () => {
    const redacted = _redactOpData({
      id: 1, action: 'upsert', table: 'bookmarks', itemId: 'bm-1', ts: 1, retries: 0,
      data: {
        id: 'bm-1', title: 't', url: 'https://x.example',
        username: 'alice', password: 'super-secret-plaintext', notes: 'note',
      },
    })
    expect(redacted).not.toBeNull()
    expect((redacted as Record<string, unknown>)['password']).toBe('[redacted]')
    expect((redacted as Record<string, unknown>)['username']).toBe('[redacted]')
    expect((redacted as Record<string, unknown>)['notes']).toBe('[redacted]')
    // 非敏感字段保留原值（排障仍可定位）→ 脱敏不整条丢
    expect((redacted as Record<string, unknown>)['title']).toBe('t')
    expect((redacted as Record<string, unknown>)['url']).toBe('https://x.example')
  })
})
