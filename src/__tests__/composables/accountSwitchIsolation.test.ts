/**
 * 跨账号串号回归：切换账号时，上一个账号的本地书签绝不能进入新账号的云端
 *
 * 旧缺陷：登出不清本地数据，一次性的「刚切换账号」标记只挡住一次补推；之后刷新、
 * 强制重传、熔断恢复、断线遗留队列，都会把 A 的本地书签推进 B 的云端。
 *
 * 覆盖路径（对应方案推演表）：
 *  1. A 会话异常断掉、队列里留着 A 的 op，随后登录 B → 一条都不推，整体换仓并重载
 *  2. 登录 B 后、换仓前的窗口：入队 / 即时推送 / 全量同步 / 强制重传 / 拉取 全部停手
 *  3. 重载后以 B 身份首轮同步：只有 B 自己的数据，A 的条目一个不出现
 *  4. 切回 A：A 离线期间的修改（脏标记跨刷新落盘）推给 A
 *  5. 退出后离线改了「云端已有」的条目并刷新，重新登录仍会补推（旧实现会永久分叉）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../../lib/supabase.js', () => {
  const nullQ = (): any => ({
    then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ data: null, error: null }),
    select: () => nullQ(),
    eq: () => nullQ(),
    update: () => nullQ(),
    delete: () => nullQ(),
  })
  const chan = (): any => ({ on: () => chan(), subscribe: () => ({ unsubscribe: () => {} }) })
  return {
    supabase: {
      from: () => nullQ(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      channel: () => chan(),
      removeChannel: () => {},
    },
  }
})

import { useDataStore } from '../../stores/data.js'
import { useAuthStore } from '../../stores/auth.js'
import { saveAppData } from '../../stores/app.js'
import { loadData } from '../../stores/persist.js'
import { restoreDirty } from '../../stores/dirtyPersist.js'
import {
  useCloudSync, setSyncRemotePort, createMemorySyncPort, __resetInitialSync,
} from '../../composables/domain/useCloudSync.js'
import { enqueueSyncOps, clearAllSyncOps, drainSyncOps, idbSet } from '../../stores/storage.js'
import { pushFromQueue } from '../../composables/domain/syncPush.js'
import { pullChanges } from '../../composables/domain/syncPull.js'
import {
  getDataOwner, initDataOwner, __resetDataOwnerForTest, __setReloadHandlerForTest, K_DATA_OWNER, STASH_PREFIX,
} from '../../lib/dataOwner.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

const A = 'user-a'
const B = 'user-b'

function bm(id: string, p: Record<string, unknown> = {}) {
  return {
    id, title: id, url: `https://${id}.example`, username: '', password: '', notes: '', icon: '',
    categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0, useCount: 0,
    attributes: {} as Record<string, boolean>, isExpanded: false, createdAt: 1000, updatedAt: 2000, ...p,
  }
}

function remoteRow(id: string, userId: string) {
  return {
    id, user_id: userId, title: id, url: `https://${id}.example`, username: '', password: '', notes: '',
    icon: '', category_id: CAT_UNCATEGORIZED, parent_id: null, order: 0, use_count: 0, attributes: {},
    is_expanded: false, created_at_num: 1000, updated_at_num: 5000, deleted_at: null,
  }
}

function login(id: string | null) {
  ;(useAuthStore() as any).user = id ? { id, email: `${id}@t.com` } : null
}

/** 模拟整页重载：新 Pinia、新实例归属、从 IDB 载入主数据并并回脏标记 */
async function reloadPage(user: string | null) {
  setActivePinia(createPinia())
  __resetDataOwnerForTest()
  __setReloadHandlerForTest(reload)
  __resetInitialSync()
  await initDataOwner()
  const ds = useDataStore()
  const loaded = await loadData('main')
  ds.categories = loaded.categories
  ds.bookmarks = loaded.bookmarks
  ds.customAttributes = loaded.customAttributes
  ds.siblingGroups = loaded.siblingGroups
  ds._syncMaps()
  restoreDirty(ds)
  login(user)
  return ds
}

/** A 在本机登录过、本地有 a1/a2，且最近一次推送断线失败，队列里还留着 a2 的 op */
async function seedDeviceOwnedByA() {
  localStorage.setItem(K_DATA_OWNER, A)
  __resetDataOwnerForTest()
  __setReloadHandlerForTest(reload)
  const ds = useDataStore()
  ds.bookmarks.push(bm('a1') as any, bm('a2') as any)
  ds._syncMaps()
  await saveAppData()
  await enqueueSyncOps([{ action: 'upsert', table: 'bookmarks', itemId: 'a2', data: { ...bm('a2'), _userId: A }, ts: 2000 }])
  return ds
}

const upsertIds = (port: ReturnType<typeof createMemorySyncPort>) => port.upserts.map(u => u.row.id)

let reload: ReturnType<typeof vi.fn<() => void>>

beforeEach(async () => {
  setActivePinia(createPinia())
  __resetInitialSync()
  await clearAllSyncOps()
  await idbSet('linkvault_v2', null)
  await idbSet('linkvault_vault_v1', null)
  await idbSet(STASH_PREFIX + A, null)
  await idbSet(STASH_PREFIX + B, null)
  setSyncRemotePort(null)
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  reload = vi.fn<() => void>()
  __setReloadHandlerForTest(reload)
})

afterEach(async () => {
  setSyncRemotePort(null)
  await clearAllSyncOps()
})

describe('跨账号隔离', () => {
  it('1 A 会话异常断掉后登录 B：断线遗留队列与本地存量一条不推，整体换仓并重载', async () => {
    await seedDeviceOwnedByA()
    login(B) // 没走 signOutAndReset：队列未清
    const port = createMemorySyncPort()
    setSyncRemotePort(port)

    await useCloudSync().initialSync()

    expect(port.upserts).toEqual([])
    expect(port.deletes).toEqual([])
    expect(reload).toHaveBeenCalledTimes(1)
    expect(getDataOwner()).toBe(B)
    expect(await drainSyncOps()).toEqual([]) // A 的 op 随 A 入仓
  })

  it('2 换仓前的窗口：入队 / 即时推送 / 全量同步 / 强制重传 / 拉取 全部停手', async () => {
    const ds = await seedDeviceOwnedByA()
    login(B)
    ds._markDirty('a1')
    const port = createMemorySyncPort({
      sinceRows: { bookmarks: [remoteRow('b-remote', B)] },
    })
    setSyncRemotePort(port)
    const sync = useCloudSync()

    await sync.debouncedSync()
    await sync.syncImmediate()
    await sync.fullSync()
    await sync.resyncAllToCloud()
    expect(await pushFromQueue()).toBe(false)
    expect(await pullChanges(true)).toBe(false)

    expect(port.upserts).toEqual([])
    expect(port.deletes).toEqual([])
    // B 的云端数据也没有被合并进 A 的本地（否则切回 A 时会被推给 A）
    expect(ds.bookmarks.map(b => b.id)).toEqual(['a1', 'a2'])
    // A 的脏标记保留，没有被 drain 成 B 的 op
    expect(ds._dirtyIds.has('a1')).toBe(true)
    expect((await drainSyncOps()).map(o => o.itemId)).toEqual(['a2'])
  })

  it('3 重载后以 B 身份首轮同步：只有 B 自己的数据，A 的条目一个不出现', async () => {
    await seedDeviceOwnedByA()
    login(B)
    setSyncRemotePort(createMemorySyncPort())
    await useCloudSync().initialSync() // 换仓 → 请求重载

    const ds = await reloadPage(B)
    expect(ds.bookmarks).toEqual([])
    const port = createMemorySyncPort({
      sinceRows: { bookmarks: [remoteRow('b1', B)] },
      allIds: { bookmarks: [{ id: 'b1' }] },
    })
    setSyncRemotePort(port)
    await useCloudSync().initialSync()

    expect(reload).toHaveBeenCalledTimes(1) // 第二轮不再换仓
    expect(ds.bookmarks.map(b => b.id)).toEqual(['b1'])
    // 推给 B 的只能是 B 自己的数据（空白基底的默认分类/属性），A 的书签一条都不能有
    expect(upsertIds(port)).not.toContain('a1')
    expect(upsertIds(port)).not.toContain('a2')
  })

  it('4 切回 A：A 的本地数据与断线遗留 op 原样回来，并推给 A', async () => {
    await seedDeviceOwnedByA()
    login(B)
    setSyncRemotePort(createMemorySyncPort())
    await useCloudSync().initialSync()
    await reloadPage(B)

    // B 用了一会儿后登回 A
    login(A)
    setSyncRemotePort(createMemorySyncPort())
    await useCloudSync().initialSync()
    expect(reload).toHaveBeenCalledTimes(2)
    expect(getDataOwner()).toBe(A)

    const ds = await reloadPage(A)
    expect(ds.bookmarks.map(b => b.id).sort()).toEqual(['a1', 'a2'])
    const port = createMemorySyncPort({ allIds: { bookmarks: [{ id: 'a1' }] } })
    setSyncRemotePort(port)
    await useCloudSync().initialSync()
    expect(upsertIds(port)).toContain('a2') // 断线遗留 op
  })

  it('5 退出后离线修改「云端已有」的条目并刷新，重新登录仍补推（脏标记跨刷新落盘）', async () => {
    await seedDeviceOwnedByA()
    await clearAllSyncOps()
    login(null) // 已退出
    const ds = useDataStore()
    const a1 = ds.bookmarks.find(b => b.id === 'a1')!
    a1.title = 'edited offline'
    a1.updatedAt = 9000
    ds._markDirty('a1')
    await saveAppData()

    const ds2 = await reloadPage(A)
    expect(ds2._dirtyIds.has('a1')).toBe(true)
    const port = createMemorySyncPort({ allIds: { bookmarks: [{ id: 'a1' }, { id: 'a2' }] } })
    setSyncRemotePort(port)
    await useCloudSync().initialSync()

    const pushed = port.upserts.find(u => u.row.id === 'a1')
    expect(pushed?.row.title).toBe('edited offline')
    expect(reload).not.toHaveBeenCalled()
  })
})
