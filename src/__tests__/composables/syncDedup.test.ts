/**
 * syncDedup — 离线重复创建项的内容级同步去重
 *
 * 事故：在线保存「腾讯云」已上云（行 X）→ 离线又保存一次（本地新 ID，行 Y）→
 * 登录后 initialSync pull 把 X 按 ID 对账不到 Y 而 insert、push 又把 Y 上云 →
 * 云端/本地各留一份重复。修复：pull/realtime 的 insert 分支对「同内容键 + 本地
 * 未上云」的碰撞跳过插入并入队远端行软删墓碑，全设备收敛为一份。
 *
 * 覆盖：normalizeSyncUrl / _dupKeyOf 纯函数；_partitionRemoteDuplicates 候选拆分；
 * _findContentDuplicate 快判；pull 集成（dirty 本地项去重 / 已上云合法重复不去重 /
 * 探测失败 fail-closed / 组同名同分类去重）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import {
  normalizeSyncUrl, _dupKeyOf, _partitionRemoteDuplicates, _findContentDuplicate,
} from '../../composables/domain/syncDedup.js'

// ── 纯函数 ──────────────────────────────────────────────────────

describe('normalizeSyncUrl', () => {
  it('同址不同写法归一为同键（尾斜杠 / host 大小写）', () => {
    expect(normalizeSyncUrl('https://Cloud.Tencent.com/'))
      .toBe(normalizeSyncUrl('https://cloud.tencent.com'))
  })
  it('保留 search / hash / 协议差异（保守不误杀）', () => {
    expect(normalizeSyncUrl('https://a.com/x')).not.toBe(normalizeSyncUrl('https://a.com/x?q=1'))
    expect(normalizeSyncUrl('http://a.com')).not.toBe(normalizeSyncUrl('https://a.com'))
  })
  it('非法 URL 小写 + 去尾斜杠兜底；空值返回空串', () => {
    expect(normalizeSyncUrl('cloud.tencent.com/')).toBe('cloud.tencent.com')
    expect(normalizeSyncUrl('')).toBe('')
    expect(normalizeSyncUrl('  ')).toBe('')
  })
})

describe('_dupKeyOf', () => {
  it('bookmark 按 URL，空 URL 无键', () => {
    expect(_dupKeyOf('bookmark', { url: 'https://a.com' })).toBe('bm:https://a.com')
    expect(_dupKeyOf('bookmark', { url: '' })).toBeNull()
  })
  it('group 按分类+组名（trim），category/attribute 不参与', () => {
    expect(_dupKeyOf('group', { name: ' 腾讯云 ', categoryId: 'c1' }))
      .toBe('grp:c1|腾讯云')
    expect(_dupKeyOf('group', { name: '  ', categoryId: 'c1' })).toBeNull()
    expect(_dupKeyOf('category', { name: '工具' })).toBeNull()
    expect(_dupKeyOf('attribute', { name: '需要登录' })).toBeNull()
  })
})

type DedupItem = { id: string; deletedAt?: number; url?: string; name?: string; categoryId?: string }

describe('_partitionRemoteDuplicates / _findContentDuplicate', () => {
  const local: DedupItem[] = [
    { id: 'bm-offline', url: 'https://cloud.tencent.com' },
    { id: 'bm-dead', url: 'https://dead.com', deletedAt: 5 },
  ]

  it('远端同键行进 candidates（是否真去重由调用方云端 ID 探测裁定）', () => {
    const { clean, candidates } = _partitionRemoteDuplicates(
      local,
      [{ id: 'bm-online', url: 'https://cloud.tencent.com/' }, { id: 'bm-other', url: 'https://b.com' }],
      'bookmark',
    )
    expect(candidates).toEqual([{ remote: { id: 'bm-online', url: 'https://cloud.tencent.com/' }, localId: 'bm-offline' }])
    expect(clean).toEqual([{ id: 'bm-other', url: 'https://b.com' }])
  })
  it('同 ID 不算碰撞；软删本地/远端行不参与', () => {
    const { candidates } = _partitionRemoteDuplicates(local, [{ id: 'bm-offline', url: 'https://cloud.tencent.com' }], 'bookmark')
    expect(candidates).toEqual([])
    const r2 = _partitionRemoteDuplicates(local, [{ id: 'bm-x', url: 'https://dead.com' }], 'bookmark')
    expect(r2.candidates).toEqual([])
    const r3 = _partitionRemoteDuplicates(local, [{ id: 'bm-y', url: 'https://a.com', deletedAt: 9 }], 'bookmark')
    expect(r3.candidates).toEqual([])
  })
  it('category/attribute 整类跳过', () => {
    const { candidates, clean } = _partitionRemoteDuplicates(local, [{ id: 'c1', name: '工具' }], 'category')
    expect(candidates).toEqual([])
    expect(clean).toEqual([{ id: 'c1', name: '工具' }])
  })
  it('_findContentDuplicate 快判只命中未上云（dirty）同键项', () => {
    const unsynced = (l: DedupItem) => l.id === 'bm-offline'
    const dup = _findContentDuplicate('bookmark', { id: 'bm-online', url: 'https://cloud.tencent.com' }, local, unsynced)
    expect(dup?.id).toBe('bm-offline')
    expect(_findContentDuplicate('bookmark', { id: 'bm-online', url: 'https://cloud.tencent.com' }, local, () => false)).toBeNull()
  })
})

// ── pull 集成（内存 port + 内存 syncOps 队列，桩与 syncPull.branches 同构）──

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
import { useAuthStore } from '../../stores/auth.js'
import { clearAllSyncOps } from '../../stores/storage.js'
import { useCloudSync, setSyncRemotePort, createMemorySyncPort } from '../../composables/domain/useCloudSync.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

function makeBm(partial: Record<string, unknown> = {}) {
  return {
    id: 'bm-base', title: 't', url: 'https://x.example',
    username: '', password: '', notes: '', icon: '',
    categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0, useCount: 0,
    attributes: {}, isExpanded: false, createdAt: 1000, updatedAt: 2000,
    ...partial,
  }
}

function makeGroup(partial: Record<string, unknown> = {}) {
  return {
    id: 'grp-base', name: '默认组', categoryId: CAT_UNCATEGORIZED, icon: '', order: 0,
    isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', useCount: 0, updatedAt: 2000,
    ...partial,
  }
}

function remoteBmRow(partial: Record<string, unknown> = {}) {
  return {
    id: 'bm-online', user_id: 'user-pp', title: '腾讯云', url: 'https://cloud.tencent.com',
    username: '', password: '', notes: '', icon: '',
    category_id: CAT_UNCATEGORIZED, parent_id: null,
    order: 0, use_count: 0, attributes: {}, is_expanded: false,
    created_at_num: 1000, updated_at_num: 9000, deleted_at: null,
    ...partial,
  }
}

function remoteGroupRow(partial: Record<string, unknown> = {}) {
  return {
    id: 'grp-online', user_id: 'user-pp', name: '腾讯云', category_id: CAT_UNCATEGORIZED,
    icon: '', order: 0, is_expanded: false, attributes: {}, bookmark_ids: [],
    notes: '', use_count: 0, is_public: false, updated_at_num: 9000, deleted_at: null,
    ...partial,
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
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
  await clearAllSyncOps()
})

describe('syncPull 离线重复去重集成', () => {
  it('离线重建的书签（dirty）撞远端同 URL 行 → 跳过插入 + 远端行墓碑入队，本地项保留并标脏', async () => {
    const ds = useDataStore()
    // 离线保存：本地新 ID、自动 dirty/_newIds（addBookmark 副作用）
    ds.addBookmark(makeBm({ id: 'bm-offline', title: '腾讯云(离线)', url: 'https://cloud.tencent.com/' }) as any)
    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [remoteBmRow()],
        sibling_groups: [], categories: [], custom_attributes: [],
      },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(true)
    // 远端行未插入：本地只有离线那份
    expect(ds.bookmarks.find(b => b.id === 'bm-online')).toBeUndefined()
    expect(ds.bookmarks.find(b => b.id === 'bm-offline')?.deletedAt).toBeUndefined()
    // 远端行以软删墓碑入队（其余设备收敛为一份）
    const tomb = _ops.find(o => o.table === 'bookmarks' && o.itemId === 'bm-online')
    expect(tomb).toBeTruthy()
    expect(tomb!.action).toBe('upsert')
    expect(typeof tomb!.data!.deletedAt).toBe('number')
    // 本地留存项保持 dirty，后续 push 一定上云
    expect(ds._dirtyIds.has('bm-offline')).toBe(true)
  })

  it('本地项已上云（allIds 命中）→ 远端同 URL insert 是合法重复，不去重', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-synced', url: 'https://cloud.tencent.com' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()
    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [remoteBmRow()],
        sibling_groups: [], categories: [], custom_attributes: [],
      },
      allIds: { bookmarks: [{ id: 'bm-synced' }], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(true)
    expect(ds.bookmarks.find(b => b.id === 'bm-online')).toBeTruthy()
    expect(_ops.find(o => o.itemId === 'bm-online')).toBeUndefined()
  })

  it('刷新后内存 dirty 丢失但本地项未上云 → 仍去重，且本地项被标脏保证上云', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-offline-reload', url: 'https://cloud.tencent.com' }) as any)
    ds._dirtyIds.clear()
    ds._newIds.clear()
    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [remoteBmRow()],
        sibling_groups: [], categories: [], custom_attributes: [],
      },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(true)
    expect(ds.bookmarks.find(b => b.id === 'bm-online')).toBeUndefined()
    expect(_ops.find(o => o.table === 'bookmarks' && o.itemId === 'bm-online')).toBeTruthy()
    // 关键：本地留存项被标脏，否则它永远留在本地不上云
    expect(ds._dirtyIds.has('bm-offline-reload')).toBe(true)
  })

  it('组：同名同分类的离线重建组去重，不同分类不去重', async () => {
    const ds = useDataStore()
    ds.addGroup(makeGroup({ id: 'grp-offline', name: '腾讯云', categoryId: CAT_UNCATEGORIZED }) as any)
    // 不同分类的同名组：合法重复
    ds.addGroup(makeGroup({ id: 'grp-other-cat', name: '腾讯云', categoryId: 'cat-x' }) as any)
    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [],
        sibling_groups: [
          remoteGroupRow(),
          remoteGroupRow({ id: 'grp-online-x', category_id: 'cat-x' }),
        ],
        categories: [], custom_attributes: [],
      },
      allIds: {
        bookmarks: [],
        // grp-other-cat 已上云：不同分类的同名组是合法重复，探测放行
        sibling_groups: [{ id: 'grp-other-cat' }],
        categories: [], custom_attributes: [],
      },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(true)
    // 同分类同名 → 去重；不同分类 → 正常插入
    expect(ds.groupMap['grp-online']).toBeUndefined()
    expect(ds.groupMap['grp-online-x']).toBeTruthy()
    expect(_ops.find(o => o.table === 'sibling_groups' && o.itemId === 'grp-online')).toBeTruthy()
  })

  it('云端 ID 探测失败 → fail-closed 不去重（远端行照常插入）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ds = useDataStore()
    ds.addBookmark(makeBm({ id: 'bm-offline-err', url: 'https://cloud.tencent.com' }) as any)
    const port = createMemorySyncPort({
      sinceRows: {
        bookmarks: [remoteBmRow()],
        sibling_groups: [], categories: [], custom_attributes: [],
      },
      allIds: { bookmarks: [], sibling_groups: [], categories: [], custom_attributes: [] },
      allIdsError: { bookmarks: { message: 'probe failed' } },
    })
    setSyncRemotePort(port)

    const ok = await useCloudSync().pullFromCloud(false)
    expect(ok).toBe(true)
    expect(ds.bookmarks.find(b => b.id === 'bm-online')).toBeTruthy()
    expect(_ops.find(o => o.itemId === 'bm-online')).toBeUndefined()
    const warns = warnSpy.mock.calls.map(c => String(c[0]))
    expect(warns.some(c => c.includes('去重探测'))).toBe(true)
    warnSpy.mockRestore()
  })
})
