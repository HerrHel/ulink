/**
 * syncPull — 写路径行为契约锁现状补测（不改 sync 写路径逻辑，只锁当前行为）
 *
 * 覆盖 syncPull.ts 既有 syncPushPull.test.ts 17 测未触达的分支：
 *  ① 远端软删批次按 EntityType 分流（isLocalAlive group/category/attribute 三个闭包，
 *     既有测只触达 bookmark 分支；group/category/attribute 分支全未触）
 *  ② 远端软删批次对 dirty/pending 的 group/category 项守门不删（与 bookmark same guard 对齐，
 *     锁 reconcileDelete/merge/Realtime 一致守门的完整四类覆盖）
 *  ③ 全量对账 reconcileQueries 部分表的 warn 分支（anyReconcileError=true 但非全 error，
 *     进 console.warn 循环 + 直接跳过对账不软删——既有测只覆盖「全部 allIds 正常」正路径
 *     或「单表 error 但 full=false 不可达对账块」，129-130 warn 循环从未触达）
 *  ④ catch 非 Error 的 msg='同步失败' 兜底分支（既有测所有 throw 走 `throw new Error(...)`
 *     均是 Error 实例，e instanceof Error 恒真走 e.message 侧；非 Error 抛值侧零覆盖）
 *  ⑤ 解锁态正常解密 push 路径（decryptItem 解密成功 + 仍 unlocked → 行 57 out.push，
 *     既有 D1-4 竞态测首条解密即撤锁 break 不 push；正常解密成功 push 路径零覆盖）
 *
 * 守则：sync 写路径只锁现状不改逻辑，本文件纯补测不碰 syncPull.ts 源码。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── 内存 syncOps 队列（与 syncPushPull.test.ts 同构桩，代替 Dexie）──
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
import { clearAllSyncOps } from '../../stores/storage.js'
import {
  useCloudSync, __testPendingSync, setSyncRemotePort, createMemorySyncPort,
} from '../../composables/domain/useCloudSync.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import { encrypt } from '../../crypto.js'

// ── 本地 fixture 工厂（对齐 schemas.ts 必须字段）──
function makeBm(partial: Record<string, unknown> = {}) {
  return {
    id: 'bm-base',
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
    id: 'grp-base',
    name: '默认组',
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

function makeCategory(partial: Record<string, unknown> = {}) {
  return {
    id: 'cat-base',
    name: '分类',
    icon: '',
    color: '',
    order: 0,
    updatedAt: 2000,
    ...partial,
  }
}

function makeAttr(partial: Record<string, unknown> = {}) {
  return {
    id: 'attr-base',
    name: '属性',
    type: 'boolean' as const,
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

// ───────────────────────────────────────────────────────────────
// ① + ② 远端软删批次按 EntityType 分流（group/category/attribute 三个闭包）
//   既有 syncPushPull dirty/pending guard 测只 softDeleted.bookmarks 触达
//   isLocalAlive.bookmark 闭包；group/category/attribute 三闭包全未触达。
//   守则只锁现状：每类正常活跃项被正常软删、dirty/pending 项被守门保留。
// ───────────────────────────────────────────────────────────────
describe('syncPull 远端软删批次 group/category/attribute 分流（isLocalAlive 三闭包）', () => {
  it('group 正常活跃项被远端软删批次正常软删（isLocalAlive.group 命中真侧）', async () => {
    const ds = useDataStore()
    ds.addGroup(makeGroup({ id: 'grp-clean' }) as any)
    ds._dirtyIds.clear()
    const port = createMemorySyncPort({
      softDeleted: { sibling_groups: [{ id: 'grp-clean', updated_at_num: 9999 }] },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(true)
    // 软删成功：group 被 _deleteWithoutEcho 软删，deletedAt 被置
    expect(ds.groupMap['grp-clean']?.deletedAt).toBeDefined()
  })

  it('group dirty 项不被远端软删批次静默删除（isLocalAlive.group 守门不删 in-flight 编辑）', async () => {
    const ds = useDataStore()
    ds.addGroup(makeGroup({ id: 'grp-dirty' }) as any)
    ds._dirtyIds.add('grp-dirty')
    const port = createMemorySyncPort({
      softDeleted: { sibling_groups: [{ id: 'grp-dirty', updated_at_num: 9999 }] },
    })
    setSyncRemotePort(port)

    await useCloudSync().pullFromCloud(false)
    // dirty 守门：远端软删不覆盖本地正在编辑的 group
    expect(ds.groupMap['grp-dirty']?.deletedAt).toBeUndefined()
    expect(ds._dirtyIds.has('grp-dirty')).toBe(true)
  })

  it('category 正常活跃项被远端软删批次正常软删（isLocalAlive.category 命中真侧）', async () => {
    const ds = useDataStore()
    const cat = makeCategory({ id: 'cat-real', name: '真分类' })
    ds.addCategory(cat as any)
    ds._dirtyIds.clear()
    const port = createMemorySyncPort({
      softDeleted: { categories: [{ id: 'cat-real', updated_at_num: 9999 }] },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(true)
    expect(ds.categoryMap['cat-real']?.deletedAt).toBeDefined()
  })

  it('category dirty 项不被远端软删批次静默删除（isLocalAlive.category 守门）', async () => {
    const ds = useDataStore()
    ds.addCategory(makeCategory({ id: 'cat-dirty', name: '编辑中分类' }) as any)
    ds._dirtyIds.add('cat-dirty')
    const port = createMemorySyncPort({
      softDeleted: { categories: [{ id: 'cat-dirty', updated_at_num: 9999 }] },
    })
    setSyncRemotePort(port)

    await useCloudSync().pullFromCloud(false)
    expect(ds.categoryMap['cat-dirty']?.deletedAt).toBeUndefined()
  })

  it('attribute 正常活跃项被远端软删批次正常软删（isLocalAlive.attribute 命中真侧）', async () => {
    const ds = useDataStore()
    ds.addAttribute(makeAttr({ id: 'attr-clean', name: '存活属性' }) as any)
    ds._dirtyIds.clear()
    const port = createMemorySyncPort({
      softDeleted: { custom_attributes: [{ id: 'attr-clean', updated_at_num: 9999 }] },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(true)
    expect(ds.attributeMap['attr-clean']?.deletedAt).toBeDefined()
  })

  it('attribute pending 项不被远端软删批次静默删除（isLocalAlive.attribute pending 守门）', async () => {
    const ds = useDataStore()
    ds.addAttribute(makeAttr({ id: 'attr-pending', name: '待推送属性' }) as any)
    __testPendingSync.add('attr-pending')
    const port = createMemorySyncPort({
      softDeleted: { custom_attributes: [{ id: 'attr-pending', updated_at_num: 9999 }] },
    })
    setSyncRemotePort(port)

    await useCloudSync().pullFromCloud(false)
    expect(ds.attributeMap['attr-pending']?.deletedAt).toBeUndefined()
  })

  it('远端软删批次行无 id 跳过（row.id 缺失早退，不副作用本地）', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-stays' }) as any)
    ds._dirtyIds.clear()
    // softDeleted 行 id 缺失（空字符串会被 syncPull 的 `if (id && ...)` 早退）
    const port = createMemorySyncPort({
      softDeleted: { bookmarks: [{ id: '', updated_at_num: 9999 }] },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(true)
    // 空 id 早退：本地 bm-stays 不被软删
    expect(ds.bookmarkMap['bm-stays']?.deletedAt).toBeUndefined()
  })
})

// ───────────────────────────────────────────────────────────────
// ③ 全量对账 reconcileQueries 部分表的 warn 分支（anyReconcileError=true 进
//    console.warn 循环 + 跳过对账不软删）。既有测 it5 allIdsError 用 full=false
//    致对账块不可达；it12 full=true 但 allIds 全正常走 else 对账分支——
//    129-130 warn 循环分支从未触达。
// ───────────────────────────────────────────────────────────────
describe('syncPull 全量对账 reconcile 部分查询失败 warn 跳过（anyReconcileError 分支）', () => {
  it('full pull + 部分表 allIdsError → warn 后跳过对账，本地残留项不被误软删', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ds = useDataStore()
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds._deletedIds.clear()
    // 本地残留一条 bookmarks（若对账误跑会因 allIds 无它而软删）
    ds.addBookmark(makeBm({ id: 'bm-residue-dont-delete', title: '残留不可误删' }) as any)
    useSyncStore().setLastSyncAt(9000) // 已同步账号，满足 full-absent-delete 前提

    // bookmarks 表 reconcile 查询失败，其余表 allIds 正常空
    const port = createMemorySyncPort({
      sinceRows: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIdsError: { bookmarks: { message: 'reconcile probe failed' } },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(true)
    expect(ok).toBe(true)
    // 关键契约：anyReconcileError=true → 跳过整轮对账，本地残留项不软删
    // 旧实现若不跳过会因 allIds 无 bm-residue-dont-delete 把它当远端已删软删
    expect(ds.bookmarkMap['bm-residue-dont-delete']?.deletedAt).toBeUndefined()
    // warn 被调（对失败表的 warn 日志，排障可见）
    const warnCalls = warnSpy.mock.calls.map(c => String(c[0]))
    expect(warnCalls.some(c => c.includes('reconcile id query failed'))).toBe(true)
    warnSpy.mockRestore()
  })
})

// ───────────────────────────────────────────────────────────────
// ④ catch 非 Error 的 msg='同步失败' 兜底分支
//   既有测 throw 全走 `throw new Error(r.error.message)` 均是 Error 实例，
//   e instanceof Error 恒真走 e.message 侧；非 Error 抛值侧（如 port reject
//   抛字符串）走 msg='同步失败' 侧零覆盖。
// ───────────────────────────────────────────────────────────────
describe('syncPull catch 兜底（非 Error 抛值 → msg="同步失败"）', () => {
  it('远端查询 reject 抛字符串 → catch 走 msg="同步失败" 分支 setSyncError', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const syncStore = useSyncStore()
    // 自建 fake port：selectSince reject 抛裸字符串（非 Error 实例）
    const port = {
      async upsert() { return { data: null, error: null } },
      async update() { return { data: null, error: null, count: 1 } },
      async delete() { return { data: null, error: null } },
      async selectSince() { throw 'plain string failure' },
      async selectSoftDeleted() { return { data: [], error: null } },
      async selectAllIds() { return { data: [], error: null } },
    }
    setSyncRemotePort(port as any)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(false)
    // 非 Error 兜底：msg='同步失败' 而非 e.message
    expect(syncStore.syncError).toBe('同步失败')
    expect(syncStore.syncStatus).toBe('error')
    warnSpy.mockRestore()
  })

  it('远端查询 reject 抛 Error → catch 走 e.message 分支 setSyncError', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const syncStore = useSyncStore()
    const port = {
      async upsert() { return { data: null, error: null } },
      async update() { return { data: null, error: null, count: 1 } },
      async delete() { return { data: null, error: null } },
      async selectSince() { throw new Error('selectSince boom') },
      async selectSoftDeleted() { return { data: [], error: null } },
      async selectAllIds() { return { data: [], error: null } },
    }
    setSyncRemotePort(port as any)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(false)
    // Error 分支：msg=e.message
    expect(syncStore.syncError).toBe('selectSince boom')
    expect(syncStore.syncStatus).toBe('error')
    warnSpy.mockRestore()
  })
})

// ───────────────────────────────────────────────────────────────
// ⑤ 解锁态正常解密 push 路径（decryptItem 解密成功 + 仍 unlocked → 行 57 out.push）
//   既有 D1-4 竞态测首条解密即撤锁 break 不 push；正常解密成功 push 路径零覆盖。
//   jsdom/node 有 webcrypto，用真实 AES-GCM key + crypto.encrypt 造真三段密文，
//   decryptItem 解密成功回明文 push 进 out，merge 后本地 username 是解出的明文。
// ───────────────────────────────────────────────────────────────
describe('syncPull 解锁态正常解密路径（解密成功 push，不撤锁）', () => {
  let _key: CryptoKey | null = null

  beforeEach(async () => {
    const e2e = useE2EStore()
    e2e.setEnabled(true)
    e2e.setUnlocked(true)
    _key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    )
    e2e.setKey(_key as any)
  })

  it('解锁态远端加密 username 被正常解密进本地明文（push 路径不走 break）', async () => {
    // 用真 key 加密一段明文 username 成三段密文，放远端 sinceRows
    const cipher = await encrypt('明文用户名-正常', _key!)
    const remoteBm = {
      id: 'bm-decrypt-ok', user_id: 'user-pp', title: '解密成功书签',
      url: 'https://decrypt.example', username: cipher, password: '', notes: '', icon: '',
      category_id: CAT_UNCATEGORIZED, parent_id: null,
      order: 0, use_count: 0, attributes: {}, is_expanded: false,
      created_at_num: 1000, updated_at_num: 9000, deleted_at: null,
    }
    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [remoteBm],
        sibling_groups: [], categories: [], custom_attributes: [],
      },
    })
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(0)

    const sync = useCloudSync()
    const ok = await sync.pullFromCloud(false)
    expect(ok).toBe(true)

    const ds = useDataStore()
    const bm = ds.bookmarks.find(b => b.id === 'bm-decrypt-ok')
    expect(bm).toBeTruthy()
    // 关键契约：解密成功 push 路径 → 本地 username 是解出的明文，非三段密文
    expect(bm!.username).toBe('明文用户名-正常')
    expect(bm!.username).not.toBe(cipher)
  })

  it('解锁态全程不撤锁 → pull 返回 true 且 syncStatus=success（不走 idle 中止）', async () => {
    const cipher = await encrypt('保持解锁明文', _key!)
    const remoteBm = {
      id: 'bm-no-withdraw', user_id: 'user-pp', title: '不撤锁书签',
      url: 'https://nowithdraw.example', username: cipher, password: '', notes: '', icon: '',
      category_id: CAT_UNCATEGORIZED, parent_id: null,
      order: 0, use_count: 0, attributes: {}, is_expanded: false,
      created_at_num: 1000, updated_at_num: 9000, deleted_at: null,
    }
    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [remoteBm],
        sibling_groups: [], categories: [], custom_attributes: [],
      },
    })
    setSyncRemotePort(port)
    useSyncStore().setLastSyncAt(0)

    const sync = useCloudSync()
    const ok = await sync.pullFromCloud(false)
    // 正常路径：不撤锁 → 不走 idle 中止 return false → return true
    expect(ok).toBe(true)
    expect(useSyncStore().syncStatus).toBe('success')
  })
})

// ───────────────────────────────────────────────────────────────
// 补充：其余写路径守门分支（离线守门 / softDeleted query error / reconcileDelete
//   dirty/pending 早退）。锁当前真实行为不改动源码。
// ───────────────────────────────────────────────────────────────
describe('syncPull 其余守门分支', () => {
  it('离线 → setSyncError("网络离线") + return false，不进同步', async () => {
    const syncStore = useSyncStore()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const port = createMemorySyncPort({ sinceRows: { bookmarks: [] } })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(false)
    expect(syncStore.syncError).toBe('网络离线')
  })

  it('远端 softDeleted 查询失败 → warn 后 continue 不软删该类，不阻断 pull', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-alive' }) as any)
    ds._dirtyIds.clear()
    // 自建 fake port：selectSoftDeleted 返 error，其余正常
    const port = {
      async upsert() { return { data: null, error: null } },
      async update() { return { data: null, error: null, count: 1 } },
      async delete() { return { data: null, error: null } },
      async selectSince() { return { data: [], error: null } },
      async selectSoftDeleted() { return { data: null, error: { message: 'softDeleted probe failed' } } },
      async selectAllIds() { return { data: [], error: null } },
    }
    setSyncRemotePort(port as any)

    const ok = await useCloudSync().pullFromCloud(false)
    // softDeleted 查询失败不阻断（continue 跳过该表软删），pull 仍成功
    expect(ok).toBe(true)
    expect(ds.bookmarkMap['bm-alive']?.deletedAt).toBeUndefined()
    const warns = warnSpy.mock.calls.map(c => String(c[0]))
    expect(warns.some(c => c.includes('deletion sync query failed'))).toBe(true)
    warnSpy.mockRestore()
  })

  it('full 对账 reconcileDelete 对本地 alive 项遇 dirty 守门早退不软删', async () => {
    const ds = useDataStore()
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds._deletedIds.clear()
    // 本地一条远端无 + 标 dirty 的书签：reconcileDelete 内 `if (ds._dirtyIds.has(id) || _isPendingSync(id)) return` 早退
    ds.addBookmark(makeBm({ id: 'bm-reconcile-dirty', title: '对账中编辑' }) as any)
    ds._dirtyIds.add('bm-reconcile-dirty')
    useSyncStore().setLastSyncAt(9000)

    const port = createMemorySyncPort({
      sinceRows: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(true)
    expect(ok).toBe(true)
    // reconcileDelete dirty 守门早退：dirty 项即使远端无也不被对账软删，待重试推回 revive
    expect(ds.bookmarkMap['bm-reconcile-dirty']?.deletedAt).toBeUndefined()
    expect(ds._dirtyIds.has('bm-reconcile-dirty')).toBe(true)
  })
})
