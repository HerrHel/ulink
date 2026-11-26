/**
 * dataOwner — 本地数据归属账号与按账号分仓（跨账号串号修复）
 *
 * 锁定的不变量：
 *  1. 迁移：无 owner 键时按旧 lv_last_user_id 推断；旧「刚切换账号」标记挂着 → 归属不明
 *  2. 同步总闸：只允许归属账号（或从未登录过的游客数据）同步
 *  3. 换仓：现场（主数据/私密空间/队列/账号相关 localStorage）整体入原账号分仓，
 *     载入目标账号分仓或空白；与账号无关的键（主题/语言）不动；从不删除数据
 *  4. 换回：原账号的数据、待推队列（含 retries）、校验值原样回来
 *  5. 写入围栏：换仓后旧实例的任何落盘都被拒绝
 *  6. 崩溃恢复：按 journal 阶段回退或重做
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getDataOwner, isSyncAllowedFor, isWriteAllowed, ensureOwnerFor, initDataOwner,
  readStash, readStashIndex, ambiguousStashes, acknowledgeStash, watchOwnerChanges,
  __resetDataOwnerForTest, __setReloadHandlerForTest,
  K_DATA_OWNER, K_OWNER_JOURNAL, STASH_PREFIX, UNKNOWN_OWNER, GUEST_OWNER, ACCOUNT_SCOPED_KEYS,
} from '../../lib/dataOwner.js'
import {
  idbGet, idbSet, drainSyncOps, enqueueSyncOps, clearAllSyncOps, updateSyncOpRetry, clearAllLocalData,
} from '../../stores/storage.js'
import { saveData, loadData } from '../../stores/persist.js'

const A = 'user-a'
const B = 'user-b'

function mainWith(ids: string[]) {
  return {
    bookmarks: ids.map((id, i) => ({
      id, title: id, url: `https://${id}.example`, username: '', password: '', notes: '', icon: '',
      categoryId: 'uncategorized', parentId: null, order: i, useCount: 0, attributes: {},
      isExpanded: false, createdAt: 1, updatedAt: 1,
    })),
    siblingGroups: [],
    categories: [{ id: 'all', name: '全部', icon: 'grid', color: '#122E8A', order: 0 }],
    customAttributes: [],
  }
}

beforeEach(async () => {
  await clearAllSyncOps()
  await idbSet('linkvault_v2', null)
  await idbSet('linkvault_vault_v1', null)
  for (const o of [A, B, UNKNOWN_OWNER]) await idbSet(STASH_PREFIX + o, null)
  __resetDataOwnerForTest()
})

describe('迁移与总闸', () => {
  it('无 owner 键 + 旧 lv_last_user_id → 归属该账号', () => {
    localStorage.setItem('lv_last_user_id', A)
    expect(getDataOwner()).toBe(A)
    expect(localStorage.getItem(K_DATA_OWNER)).toBe(A)
  })

  it('旧「刚切换账号」标记仍挂着 → 归属不明，且旧标记被清除', () => {
    localStorage.setItem('lv_last_user_id', B)
    localStorage.setItem('lv_account_switched', '1')
    expect(getDataOwner()).toBe(UNKNOWN_OWNER)
    expect(localStorage.getItem('lv_account_switched')).toBeNull()
  })

  it('从未登录过 → 游客数据，可并入任意首个登录账号', () => {
    expect(getDataOwner()).toBe(GUEST_OWNER)
    expect(isSyncAllowedFor(A)).toBe(true)
    expect(isSyncAllowedFor(null)).toBe(false)
  })

  it('归属 A：A 可同步，B 不可', () => {
    localStorage.setItem(K_DATA_OWNER, A)
    expect(isSyncAllowedFor(A)).toBe(true)
    expect(isSyncAllowedFor(B)).toBe(false)
    expect(isSyncAllowedFor(UNKNOWN_OWNER)).toBe(false)
  })

  it('游客数据首次登录 → adopted，之后其他账号不可同步', async () => {
    expect(await ensureOwnerFor(A)).toBe('adopted')
    expect(getDataOwner()).toBe(A)
    expect(isSyncAllowedFor(B)).toBe(false)
  })
})

describe('整体换仓', () => {
  async function seedA() {
    localStorage.setItem(K_DATA_OWNER, A)
    await idbSet('linkvault_v2', mainWith(['a1', 'a2']))
    await idbSet('linkvault_vault_v1', mainWith(['secret-a']))
    localStorage.setItem('lv_e2e_canary', 'canary-of-a')
    localStorage.setItem('lv_ai_profile', 'profile-of-a')
    localStorage.setItem('lv_hist:a1', '[1]')
    localStorage.setItem('lv_sync_dirty_v1', JSON.stringify({ dirty: ['a1'], added: [], deleted: [], fields: [] }))
    localStorage.setItem('lv_theme', 'dark') // 与账号无关
    await enqueueSyncOps([{ action: 'upsert', table: 'bookmarks', itemId: 'a1', data: { id: 'a1' }, ts: 1 }])
    const [op] = await drainSyncOps()
    await updateSyncOpRetry(op.id!, 2)
  }

  it('A → B：A 的全部本地状态入仓，现场换成空白，围栏关闭，B 拿不到 A 的任何东西', async () => {
    await seedA()
    expect(await ensureOwnerFor(B)).toBe('switched')

    expect(getDataOwner()).toBe(B)
    // 本实例内存仍是 A 的数据 → 写入与同步一律拒绝，直到重载
    expect(isWriteAllowed()).toBe(false)
    expect(isSyncAllowedFor(B)).toBe(false)

    // 现场：空白主数据（无示例书签）、无私密空间、空队列、账号键已清，无关键保留
    const live = await idbGet('linkvault_v2')
    expect(live.bookmarks).toEqual([])
    expect(await idbGet('linkvault_vault_v1')).toBeNull()
    expect(await drainSyncOps()).toEqual([])
    expect(localStorage.getItem('lv_e2e_canary')).toBeNull()
    expect(localStorage.getItem('lv_ai_profile')).toBeNull()
    expect(localStorage.getItem('lv_hist:a1')).toBeNull()
    expect(localStorage.getItem('lv_sync_dirty_v1')).toBeNull()
    expect(localStorage.getItem('lv_theme')).toBe('dark')

    // A 的分仓完整
    const stash = await readStash(A)
    expect(stash?.main).toMatchObject({ bookmarks: [{ id: 'a1' }, { id: 'a2' }] })
    expect(stash?.vault).toMatchObject({ bookmarks: [{ id: 'secret-a' }] })
    expect(stash?.ops.map(o => o.itemId)).toEqual(['a1'])
    expect(stash?.ls['lv_e2e_canary']).toBe('canary-of-a')
    expect(readStashIndex()[A]?.count).toBe(2)
  })

  it('换仓后重载（新实例）：B 的现场载入为空白，不含示例数据', async () => {
    await seedA()
    await ensureOwnerFor(B)
    __resetDataOwnerForTest()
    await initDataOwner()
    expect(isSyncAllowedFor(B)).toBe(true)
    const loaded = await loadData('main')
    expect(loaded.bookmarks).toEqual([])
  })

  it('B → A：A 的数据、待推队列（retries 保留）、校验值原样回来；B 入仓', async () => {
    await seedA()
    await ensureOwnerFor(B)
    __resetDataOwnerForTest()
    await initDataOwner()
    await saveData(mainWith(['b1']) as never, 'main')
    localStorage.setItem('lv_e2e_canary', 'canary-of-b')

    expect(await ensureOwnerFor(A)).toBe('switched')
    const live = await idbGet('linkvault_v2')
    expect(live.bookmarks.map((b: { id: string }) => b.id)).toEqual(['a1', 'a2'])
    expect((await idbGet('linkvault_vault_v1')).bookmarks[0].id).toBe('secret-a')
    const ops = await drainSyncOps()
    expect(ops.map(o => [o.itemId, o.retries])).toEqual([['a1', 2]])
    expect(localStorage.getItem('lv_e2e_canary')).toBe('canary-of-a')
    expect(localStorage.getItem('lv_sync_dirty_v1')).toContain('a1')
    // A 的分仓已搬回现场即删除；B 入仓
    expect(await readStash(A)).toBeNull()
    expect((await readStash(B))?.ls['lv_e2e_canary']).toBe('canary-of-b')
    expect(readStashIndex()[A]).toBeUndefined()
  })

  it('旧实例（换仓前载入）不能再落盘，也不能以新账号身份同步', async () => {
    await seedA()
    await ensureOwnerFor(B)
    const ok = await saveData(mainWith(['a1', 'a2', 'a3']) as never, 'main')
    expect(ok).toBe(false)
    expect((await idbGet('linkvault_v2')).bookmarks).toEqual([])
  })

  it('别的实例已换仓 → ensureOwnerFor 返回 stale（本实例须重载，不得再换一次）', async () => {
    localStorage.setItem(K_DATA_OWNER, A)
    expect(isWriteAllowed()).toBe(true) // 本实例以 A 载入
    localStorage.setItem(K_DATA_OWNER, B) // 另一个标签页完成了换仓
    expect(await ensureOwnerFor(B)).toBe('stale')
    expect(isWriteAllowed()).toBe(false)
  })
})

describe('崩溃恢复', () => {
  it('stashing 阶段中断：现场仍是原账号数据 → 回退归属', async () => {
    await idbSet('linkvault_v2', mainWith(['a1']))
    localStorage.setItem(K_DATA_OWNER, '__switching__')
    localStorage.setItem(K_OWNER_JOURNAL, JSON.stringify({ from: A, to: B, stage: 'stashing' }))
    await initDataOwner()
    expect(getDataOwner()).toBe(A)
    expect(localStorage.getItem(K_OWNER_JOURNAL)).toBeNull()
    expect((await idbGet('linkvault_v2')).bookmarks[0].id).toBe('a1')
  })

  it('loading 阶段中断：原账号已入仓 → 重做目标账号载入', async () => {
    await idbSet('linkvault_v2', mainWith(['a1'])) // 现场仍残留 A
    await idbSet(STASH_PREFIX + A, { v: 1, owner: A, savedAt: 1, main: mainWith(['a1']), vault: null, ops: [], ls: {} })
    localStorage.setItem(K_DATA_OWNER, '__switching__')
    localStorage.setItem(K_OWNER_JOURNAL, JSON.stringify({ from: A, to: B, stage: 'loading' }))
    await initDataOwner()
    expect(getDataOwner()).toBe(B)
    expect((await idbGet('linkvault_v2')).bookmarks).toEqual([])
    expect(isSyncAllowedFor(B)).toBe(true)
  })
})

describe('不明归属分仓与多实例', () => {
  it('只有归属不明 / 旧 uuid 身份的分仓需要询问；确认后不再询问', () => {
    localStorage.setItem('lv_acct_stash_index', JSON.stringify({
      [UNKNOWN_OWNER]: { savedAt: 1, count: 3 },
      '6f1c2a40-1111-4222-8333-944455556666': { savedAt: 1, count: 2 },
      [A]: { savedAt: 1, count: 5 },
      empty: { savedAt: 1, count: 0 },
    }))
    const owners = ambiguousStashes('cb-sub-123').map(s => s.owner).sort()
    expect(owners).toEqual(['6f1c2a40-1111-4222-8333-944455556666', UNKNOWN_OWNER].sort())
    acknowledgeStash(UNKNOWN_OWNER)
    expect(ambiguousStashes('cb-sub-123').map(s => s.owner)).not.toContain(UNKNOWN_OWNER)
  })

  it('其他实例改了归属 → 本实例重载；换仓中途不重载', () => {
    localStorage.setItem(K_DATA_OWNER, A)
    expect(isWriteAllowed()).toBe(true)
    const reload = vi.fn()
    __setReloadHandlerForTest(reload)
    const stop = watchOwnerChanges()
    window.dispatchEvent(new StorageEvent('storage', { key: K_DATA_OWNER, newValue: '__switching__' }))
    expect(reload).not.toHaveBeenCalled()
    window.dispatchEvent(new StorageEvent('storage', { key: K_DATA_OWNER, newValue: B }))
    expect(reload).toHaveBeenCalledTimes(1)
    stop()
  })

  it('注销当前账号不抹掉本机其他账号的分仓', async () => {
    await idbSet(STASH_PREFIX + A, { v: 1, owner: A, savedAt: 1, main: mainWith(['a1']), vault: null, ops: [], ls: {} })
    localStorage.setItem('lv_acct_stash_index', JSON.stringify({ [A]: { savedAt: 1, count: 1 } }))
    await idbSet('linkvault_v2', mainWith(['b1']))
    await clearAllLocalData()
    expect(await idbGet('linkvault_v2')).toBeNull()
    expect((await readStash(A))?.main).toBeTruthy()
    expect(readStashIndex()[A]).toBeTruthy()
  })

  it('账号相关键清单覆盖同步 / 加密 / AI 个人数据', () => {
    for (const k of ['lv_sync_dead_deletes', 'lv_sync_dirty_v1', 'lv_e2e_canary', 'lv_vault_canary', 'lv_ai_profile', 'lv_ai_habits']) {
      expect(ACCOUNT_SCOPED_KEYS).toContain(k)
    }
    for (const k of ['lv_theme', 'lv_locale', 'lv_uiState', K_DATA_OWNER, 'lv_acct_stash_index']) {
      expect(ACCOUNT_SCOPED_KEYS).not.toContain(k)
    }
  })
})
