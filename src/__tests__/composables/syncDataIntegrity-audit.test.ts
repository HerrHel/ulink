/**
 * 「同步与数据完整性」批次（第二轮审计 #10/#12/#13/#24/#27）定向回归测试。
 *
 * 复用 syncPushPull.test.ts 同构桩：内存 syncOps 队列 + supabase import 桩 +
 * createMemorySyncPort 注入，Pinia 每用例重置。覆盖：
 *  - #10 非 delete 死信持久化 + clearAllSyncOps 后分叉补推
 *  - #12 enqueueSyncOps 返回 false 三处（基线补推 / 去重墓碑 / 墓碑重申）中止本轮
 *  - #13 基线补推行用当前时间（不改坏本地真实 updatedAt）
 *  - #24 解孤儿保留后代原本已存在的 dirty/changedFields
 *  - #27 upsert count=0 与 update 同口径判失败、不静默出队
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

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
/** 模拟 enqueueSyncOps 的 IDB 写失败（配额满 / 隐私模式） */
const _ctl = vi.hoisted(() => ({ enqueueFail: false }))

vi.mock('../../stores/storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/storage.js')>()
  return {
    ...actual,
    enqueueSyncOps: async (ops: Array<Omit<MemOp, 'id' | 'retries'>>) => {
      if (_ctl.enqueueFail) return false
      for (const op of ops) {
        _ops.push({
          ...op,
          data: op.data ? JSON.parse(JSON.stringify(op.data)) : null,
          id: _nextId++,
          retries: 0,
        })
      }
      return true
    },
    drainSyncOps: async () => [..._ops],
    removeSyncOps: async (ids: number[]) => {
      const set = new Set(ids)
      _ops = _ops.filter(o => o.id == null || !set.has(o.id))
    },
    removeSyncOpsByItemId: async (id: string) => {
      _ops = _ops.filter(o => o.itemId !== id)
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
import { enqueueSyncOps } from '../../stores/storage.js'
import {
  useCloudSync, __testPendingSync, __resetInitialSync,
  setSyncRemotePort, createMemorySyncPort,
} from '../../composables/domain/useCloudSync.js'
import {
  pushFromQueue, rememberDeadUpsert, forgetDeadUpsert, isDeadUpsert,
  __resetDeadUpserts, MAX_PUSH_RETRIES,
} from '../../composables/domain/syncPush.js'
import { _deleteWithoutEcho } from '../../composables/domain/syncLocalMerge.js'
import { __resetSyncCircuit } from '../../composables/domain/syncCircuit.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

function makeBm(partial: Record<string, unknown> = {}) {
  return {
    id: 'bm-base', title: 't', url: 'https://x.example', username: '', password: '',
    notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0,
    useCount: 0, attributes: {}, isExpanded: false, createdAt: 1000, updatedAt: 2000,
    ...partial,
  }
}

/** snake_case 远端行（供 FROM_REMOTE 映射） */
function remoteBm(partial: Record<string, unknown> = {}) {
  return {
    id: 'bm-r', user_id: 'user-audit', title: '远端', url: 'https://r.example',
    username: '', password: '', notes: '', icon: '', category_id: CAT_UNCATEGORIZED,
    parent_id: null, order: 0, use_count: 0, attributes: {}, is_expanded: false,
    created_at_num: 1000, updated_at_num: 5000, deleted_at: null,
    ...partial,
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  __testPendingSync.clear()
  __resetSyncCircuit()
  __resetDeadUpserts()
  __resetInitialSync()
  _ctl.enqueueFail = false
  _ops = []
  _nextId = 1
  setSyncRemotePort(null)
  const auth = useAuthStore()
  ;(auth as any).user = { id: 'user-audit', email: 'audit@test.com' }
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

afterEach(() => {
  setSyncRemotePort(null)
  __testPendingSync.clear()
  __resetDeadUpserts()
})

// ───────────────────────────────────────────────────────────────
// #10 非 delete 死信
// ───────────────────────────────────────────────────────────────
describe('#10 非 delete 死信记录（dead-letter upsert）', () => {
  it('remember → isDeadUpsert → forget 全链路；本地值更旧时不误补推', () => {
    expect(isDeadUpsert('bookmarks', 'b1', 100)).toBe(false)
    rememberDeadUpsert('bookmarks', 'b1', 100)
    expect(isDeadUpsert('bookmarks', 'b1', 100)).toBe(true)
    expect(isDeadUpsert('bookmarks', 'b1', 200)).toBe(true) // 本地之后又编辑 → 仍应补推
    expect(isDeadUpsert('bookmarks', 'b1', 50)).toBe(false) // 本地回滚到更旧 → 不补推
    forgetDeadUpsert('bookmarks', 'b1')
    expect(isDeadUpsert('bookmarks', 'b1', 100)).toBe(false)
  })

  it('upsert op 重试耗尽出队 → 写入非 delete 死信（不再无痕出队）', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-dead', updatedAt: 7777 }) as any)
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-dead',
      data: { ...makeBm({ id: 'bm-dead', updatedAt: 7777 }), _userId: 'user-audit' },
      ts: 7777,
    }])
    _ops[0].retries = MAX_PUSH_RETRIES - 1 // 下一次失败即达上限
    setSyncRemotePort(createMemorySyncPort({ upsertError: () => ({ message: 'rls denied' }) }))

    const ok = await pushFromQueue()

    expect(ok).toBe(false)
    expect(_ops.some(o => o.itemId === 'bm-dead')).toBe(false) // 出队
    expect(isDeadUpsert('bookmarks', 'bm-dead', 7777)).toBe(true) // 死信已持久化
  })

  it('clearAllSyncOps（resync）后：云端已有该 id、本地非 dirty 的死信项仍被补推（分叉愈合）', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-fork', title: '本地新值', updatedAt: 5000 }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()
    // 死信：本地值领先云端却推送失败、dirty 已被 drain
    rememberDeadUpsert('bookmarks', 'bm-fork', 5000)
    // 云端已有该 id（旧值）；sinceRows 无新变更
    const port = createMemorySyncPort({
      allIds: { bookmarks: [{ id: 'bm-fork' }] },
      sinceRows: { bookmarks: [] },
    })
    setSyncRemotePort(port)

    await useCloudSync().resyncAllToCloud()

    // 旧 shouldPush 见「云端已有该 id」+ 本地非 dirty 会判 false → 永久分叉；
    // 修复后靠 isDeadUpsert 把本地新值重新推上云。
    const row = port.upserts.find(u => u.row.id === 'bm-fork')?.row
    expect(row).toBeTruthy()
    expect(row!.title).toBe('本地新值')
  })
})

// ───────────────────────────────────────────────────────────────
// #12 enqueueSyncOps 返回 false 中止本轮
// ───────────────────────────────────────────────────────────────
describe('#12 enqueueSyncOps 返回 false → 中止本轮、保留游标', () => {
  it('基线补推（_enqueueMissingToCloud）入队失败 → resync 返回 false、不推进 pull 游标', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-base' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()
    const syncStore = useSyncStore()
    syncStore.setLastSyncAt(1111)
    setSyncRemotePort(createMemorySyncPort({
      allIds: { bookmarks: [] }, sinceRows: { bookmarks: [] },
    }))
    _ctl.enqueueFail = true

    const ok = await useCloudSync().resyncAllToCloud()

    expect(ok).toBe(false)
    expect(syncStore.lastSyncAt).toBe(1111) // 未继续 pullChanges → 游标不推进
    expect(syncStore.syncStatus).not.toBe('success') // 不假绿报成功
  })

  it('去重墓碑（syncPull dupTombstoneOps）入队失败 → pull 中止、游标不推进', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'local-1', url: 'https://dup.example' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()
    const syncStore = useSyncStore()
    syncStore.setLastSyncAt(1111)
    setSyncRemotePort(createMemorySyncPort({
      sinceRows: { bookmarks: [remoteBm({ id: 'remote-1', url: 'https://dup.example' })] },
      allIds: { bookmarks: [] }, // 云端无 local-1 → 确认去重候选
    }))
    _ctl.enqueueFail = true

    const ok = await useCloudSync().pullFromCloud(false)

    expect(ok).toBe(false)
    expect(syncStore.lastSyncAt).toBe(1111)
    expect(syncStore.syncStatus).not.toBe('success')
  })

  it('墓碑重申（syncPull reassertOps）入队失败 → full pull 中止、游标不推进', async () => {
    const ds = useDataStore()
    // 本地墓碑时间(9500)晚于远端存活行(5000) → decideRemoteApply 判 skip 不复活 → 触发重申
    ds.addBookmark(makeBm({ id: 'bm-tomb', deletedAt: 9000, updatedAt: 9500 }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds._deletedIds.clear()
    const syncStore = useSyncStore()
    syncStore.setLastSyncAt(1111)
    setSyncRemotePort(createMemorySyncPort({
      sinceRows: { bookmarks: [remoteBm({ id: 'bm-tomb', updated_at_num: 5000 })] },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    }))
    _ctl.enqueueFail = true

    const ok = await useCloudSync().pullFromCloud(true)

    expect(ok).toBe(false)
    expect(syncStore.lastSyncAt).toBe(1111)
    expect(syncStore.syncStatus).not.toBe('success')
  })
})

// ───────────────────────────────────────────────────────────────
// #13 基线补推行用当前时间
// ───────────────────────────────────────────────────────────────
describe('#13 基线补推行用 now（避免 gt(since) 漏拉）', () => {
  it('历史旧时间戳补推 → updated_at_num=now，且本地真实 updatedAt 不被改坏', async () => {
    const ds = useDataStore()
    const oldTs = Date.now() - 30 * 24 * 3600 * 1000 // 一个月前
    ds.addBookmark(makeBm({ id: 'bm-old', updatedAt: oldTs }) as any)
    ds.bookmarks.find(b => b.id === 'bm-old')!.updatedAt = oldTs
    ds._dirtyIds.clear()
    ds._newIds.clear()
    const port = createMemorySyncPort({
      allIds: { bookmarks: [] }, sinceRows: { bookmarks: [] },
    })
    setSyncRemotePort(port)
    const before = Date.now()

    await useCloudSync().resyncAllToCloud()
    const after = Date.now()

    const row = port.upserts.find(u => u.row.id === 'bm-old')?.row
    expect(row).toBeTruthy()
    // 旧实现用 item.updatedAt（一个月前）→ 落在另一设备 selectSince 的 gt(since) 之外
    expect(row!.updated_at_num as number).toBeGreaterThanOrEqual(before)
    expect(row!.updated_at_num as number).toBeLessThanOrEqual(after)
    // 只在「推云的行」副本上用 now，绝不回写 ds 里的真实时间戳
    expect(ds.bookmarks.find(b => b.id === 'bm-old')!.updatedAt).toBe(oldTs)
  })
})

// ───────────────────────────────────────────────────────────────
// #24 解孤儿保留后代原本已存在的 dirty/changedFields
// ───────────────────────────────────────────────────────────────
describe('#24 解孤儿只清衍生 dirty，保留用户未推编辑', () => {
  it('后代原本 dirty/changedFields 保留，衍生 dirty（父/孙）仍被清', () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'parent' }) as any)
    ds.addBookmark(makeBm({ id: 'child', parentId: 'parent' }) as any)
    ds.addBookmark(makeBm({ id: 'grand', parentId: 'child' }) as any)
    ds._syncMaps() // 建立 childrenMap / _bmMap
    ds._dirtyIds.clear()
    ds._changedFields.clear()
    ds._newIds.clear()
    // 后代 child 原本就有未推编辑
    ds._dirtyIds.add('child')
    ds._changedFields.set('child', new Set(['title']))

    _deleteWithoutEcho(ds, 'bookmark', 'parent')

    expect(ds.bookmarkMap['parent']?.deletedAt).toBeTruthy()
    // 解孤儿：子/孙 parentId 置 null
    expect(ds.bookmarkMap['child']?.parentId).toBeNull()
    expect(ds.bookmarkMap['grand']?.parentId).toBeNull()
    // 关键修复：后代原本已存在的未推编辑被保留（旧实现 affectedIds 连带清掉）
    expect(ds._dirtyIds.has('child')).toBe(true)
    expect(ds._changedFields.has('child')).toBe(true)
    // 衍生 dirty（父删除 / 孙解孤儿 updateBookmark 自身）仍被回声清理
    expect(ds._dirtyIds.has('grand')).toBe(false)
    expect(ds._dirtyIds.has('parent')).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────
// #27 upsert count=0 与 update 同口径判失败
// ───────────────────────────────────────────────────────────────
describe('#27 upsert 静默 0 行不假绿出队', () => {
  it('upsert 返回 count=0 → push 判失败、op 留队重试（不静默出队丢数据）', async () => {
    const ds = useDataStore()
    const syncStore = useSyncStore()
    ds.addBookmark(makeBm({ id: 'bm-zero' }) as any)
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-zero',
      data: { ...makeBm({ id: 'bm-zero' }), _userId: 'user-audit' },
      ts: 2000,
    }])
    setSyncRemotePort(createMemorySyncPort({ upsertCount: () => 0 }))

    const ok = await pushFromQueue()

    expect(ok).toBe(false)
    // 旧实现 upsert 不带 count → count===0 恒 false → 误判成功永久出队
    expect(_ops.some(o => o.itemId === 'bm-zero')).toBe(true) // 留队
    expect(_ops.find(o => o.itemId === 'bm-zero')!.retries).toBe(1) // retry+1
    expect(syncStore.syncStatus).toBe('error')
  })

  it('正常 upsert（count=1）→ 成功出队（#27 不破坏既有幂等）', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-ok' }) as any)
    await enqueueSyncOps([{
      action: 'upsert', table: 'bookmarks', itemId: 'bm-ok',
      data: { ...makeBm({ id: 'bm-ok' }), _userId: 'user-audit' },
      ts: 2000,
    }])
    setSyncRemotePort(createMemorySyncPort())

    const ok = await pushFromQueue()

    expect(ok).toBe(true)
    expect(_ops.some(o => o.itemId === 'bm-ok')).toBe(false)
  })
})
