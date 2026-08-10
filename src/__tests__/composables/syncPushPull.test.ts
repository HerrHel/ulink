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
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

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
      username: 'salt.iv.data', password: '', notes: '', icon: '',
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
