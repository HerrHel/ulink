/**
 * QUAL-03：useSyncConflict 解决路径
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { resolveConflict, resolveAllConflicts, _remoteSnapshots } from '../../composables/domain/useSyncConflict.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))

// #26: useSyncConflict 静态 import useCloudSync 触发同步调度；用 spy 隔离门控/队列副作用
const _sync = vi.hoisted(() => ({ debouncedSync: vi.fn() }))
vi.mock('../../composables/domain/useCloudSync.js', () => ({
  useCloudSync: () => ({ debouncedSync: _sync.debouncedSync }),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  _remoteSnapshots.clear()
  _sync.debouncedSync.mockClear()
})

describe('resolveConflict', () => {
  it('keepLocal=true：只移除冲突，不改本地 title', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    ds.addBookmark({
      id: 'bm-1', title: '本地', url: 'https://a.com', username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 2,
    } as any)
    ds._dirtyIds.add('bm-1')
    sync.addConflict({
      id: 'bm-1', type: 'bookmark',
      local: { title: '本地' },
      remote: { title: '远端' },
    })
    _remoteSnapshots.set('bookmark:bm-1', { title: '远端' })

    resolveConflict('bm-1', true)

    expect(ds.bookmarkMap['bm-1']?.title).toBe('本地')
    expect(sync.conflicts).toHaveLength(0)
    expect(_remoteSnapshots.has('bookmark:bm-1')).toBe(false)
    // keepLocal 后 local dirty 仍在，供后续 push 推送本地版本
    expect(ds._dirtyIds.has('bm-1')).toBe(true)
  })

  it('keepLocal=false：用 remote 覆盖本地 bookmark', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    ds.addBookmark({
      id: 'bm-1', title: '本地', url: 'https://a.com', username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 2,
    } as any)
    sync.addConflict({
      id: 'bm-1', type: 'bookmark',
      local: { title: '本地' },
      remote: { title: '远端' },
    })

    resolveConflict('bm-1', false)

    expect(ds.bookmarkMap['bm-1']?.title).toBe('远端')
    expect(sync.conflicts).toHaveLength(0)
  })

  it('不存在的 id：no-op', () => {
    const sync = useSyncStore()
    resolveConflict('missing', false)
    expect(sync.conflicts).toHaveLength(0)
  })
})

describe('resolveAllConflicts', () => {
  it('批量 keepLocal 清空全部冲突', () => {
    const sync = useSyncStore()
    sync.addConflict({ id: 'a', type: 'bookmark', local: {}, remote: {} })
    sync.addConflict({ id: 'b', type: 'group', local: {}, remote: {} })
    resolveAllConflicts(true)
    expect(sync.conflicts).toHaveLength(0)
  })
})

// ── D2 行为契约：_applyRemoteToLocal 四实体类型 dispatch + resolveConflict 编排护栏 ──
// 上半段 QUAL-03 仅测 bookmark 单类型 keepLocal true/false + no-op + keepLocal 批量清空，
// 编排层真缺口：① _applyRemoteToLocal 四 EntityType 分支（bookmark/group/category/attribute）
// 各自 dispatch 到 update* 的路由零直测（回归让某分支误 dispatch 错走不会被抓）；② 未知
// EntityType `apply[type]?.()` 可选链短路无远端写入；③ resolveConflict keepLocal=false 调
// saveAppData 一次 + keepLocal=true 不调（持久化触发契约未锁）；④ resolveAllConflicts 用
// .slice() 遍历防 removeConflict 改长度跳项（若误改直接遍历会让中途项被跳过）；⑤ 批量
// keepLocal=false 混合四类型各走自身 update 分支。补护栏纯加测试，仅给 _applyRemoteToLocal
// 增 export 关键字供 import，函数体逐字未动（同 D1-28/D1-30 口径）。
import { _applyRemoteToLocal } from '../../composables/domain/useSyncConflict.js'
import { saveAppData } from '../../stores/app.js'

describe('_applyRemoteToLocal dispatch 路由', () => {
  it('bookmark：经 updateBookmark 写入 remote 字段 + markDirty', () => {
    const ds = useDataStore()
    ds.addBookmark({
      id: 'bm-d', title: '本地', url: 'https://a.com', username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    _applyRemoteToLocal('bookmark', 'bm-d', { title: '远端', url: 'https://b.com' })
    expect(ds.bookmarkMap['bm-d']?.title).toBe('远端')
    expect(ds.bookmarkMap['bm-d']?.url).toBe('https://b.com')
    expect(ds._dirtyIds.has('bm-d')).toBe(true)
  })

  it('group：经 updateGroup 写入 remote 字段 + markDirty', () => {
    const ds = useDataStore()
    ds.addGroup({
      id: 'grp-d', name: '本地组', categoryId: CAT_UNCATEGORIZED, icon: '', order: 0,
      isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', useCount: 0, updatedAt: 1,
    } as any)
    _applyRemoteToLocal('group', 'grp-d', { name: '远端组' })
    expect(ds.groupMap['grp-d']?.name).toBe('远端组')
    expect(ds._dirtyIds.has('grp-d')).toBe(true)
  })

  it('category：经 updateCategory 写入 remote 字段 + markDirty', () => {
    const ds = useDataStore()
    ds.addCategory({ id: 'cat-d', name: '本地分类', icon: '', color: '', order: 0 })
    _applyRemoteToLocal('category', 'cat-d', { name: '远端分类' })
    expect(ds.categoryMap['cat-d']?.name).toBe('远端分类')
    expect(ds._dirtyIds.has('cat-d')).toBe(true)
  })

  it('attribute：经 updateAttribute 写入 remote 字段 + markDirty', () => {
    const ds = useDataStore()
    ds.addAttribute({ id: 'attr-d', name: '本地属性', type: 'boolean' })
    _applyRemoteToLocal('attribute', 'attr-d', { name: '远端属性' })
    expect(ds.attributeMap['attr-d']?.name).toBe('远端属性')
    expect(ds._dirtyIds.has('attr-d')).toBe(true)
  })

  it('未知 EntityType：可选链短路 no-op 不抛', () => {
    const ds = useDataStore()
    // 无任何实体被错误写入——传非法 type 不应 mutate 任何 store 数组
    expect(() => _applyRemoteToLocal('unknown' as any, 'x', { name: 'noop' })).not.toThrow()
    expect(ds.bookmarks).toHaveLength(0)
    expect(ds.siblingGroups).toHaveLength(0)
  })

  it('id 不存在：update* idx<0 no-op 不抛', () => {
    const ds = useDataStore()
    expect(() => _applyRemoteToLocal('bookmark', 'missing-bm', { title: '远端' })).not.toThrow()
    expect(ds.bookmarkMap['missing-bm']).toBeUndefined()
  })
})

describe('resolveConflict 持久化与快照编排', () => {
  beforeEach(() => {
    vi.mocked(saveAppData).mockClear()
  })

  it('keepLocal=false：调 saveAppData 一次（落盘远端版本）', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    ds.addBookmark({
      id: 'bm-p', title: '本地', url: 'https://a.com', username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    sync.addConflict({ id: 'bm-p', type: 'bookmark', local: { title: '本地' }, remote: { title: '远端' } })
    _remoteSnapshots.set('bookmark:bm-p', { title: '远端' })

    resolveConflict('bm-p', false)

    expect(saveAppData).toHaveBeenCalledTimes(1)
  })

  // #26: keepLocal 分支必须补落盘 + 同步调度，否则选择刷新回退 / 本地版本永不上云
  it('keepLocal=true：补 saveAppData 落盘 + 触发 debouncedSync 同步调度', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    ds.addBookmark({
      id: 'bm-p2', title: '本地', url: 'https://a.com', username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    sync.addConflict({ id: 'bm-p2', type: 'bookmark', local: { title: '本地' }, remote: { title: '远端' } })

    resolveConflict('bm-p2', true)

    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(_sync.debouncedSync).toHaveBeenCalledTimes(1)
    // 保留本地内容与 dirty（既有冲突语义不破坏）
    expect(ds.bookmarkMap['bm-p2']?.title).toBe('本地')
    expect(ds._dirtyIds.has('bm-p2')).toBe(true)
  })

  // #26: 远端时钟超前时，updateBookmark 内的 Date.now() 会把传入的 now 覆盖回本机时间，
  // 小于他端 → keepLocal 选择被后续 pull 静默覆盖。修复后直接写 item.updatedAt = now。
  it('远端时钟超前 → keepLocal 后 updatedAt 严格大于远端（不被 Date.now() 覆盖）', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    const remoteTs = Date.now() + 100_000 // 远端超前
    ds.addBookmark({
      id: 'bm-clock', title: '本地', url: 'https://a.com', username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    sync.addConflict({
      id: 'bm-clock', type: 'bookmark',
      local: { title: '本地' }, remote: { title: '远端', updatedAt: remoteTs },
    })

    resolveConflict('bm-clock', true)

    expect(ds.bookmarkMap['bm-clock']!.updatedAt).toBe(remoteTs + 1)
    expect(ds.bookmarkMap['bm-clock']!.updatedAt).toBeGreaterThan(Date.now() - 1000)
  })

  it('keepLocal=false group 分支：走 updateGroup + saveAppData + 删快照', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    ds.addGroup({
      id: 'grp-p', name: '本地组', categoryId: CAT_UNCATEGORIZED, icon: '', order: 0,
      isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', useCount: 0, updatedAt: 1,
    } as any)
    sync.addConflict({ id: 'grp-p', type: 'group', local: { name: '本地组' }, remote: { name: '远端组' } })
    _remoteSnapshots.set('group:grp-p', { name: '远端组' })

    resolveConflict('grp-p', false)

    expect(ds.groupMap['grp-p']?.name).toBe('远端组')
    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(_remoteSnapshots.has('group:grp-p')).toBe(false)
    expect(sync.conflicts).toHaveLength(0)
  })

  it('keepLocal=false category 分支：走 updateCategory + saveAppData', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    ds.addCategory({ id: 'cat-p', name: '本地分类', icon: '', color: '', order: 0 })
    sync.addConflict({ id: 'cat-p', type: 'category', local: { name: '本地分类' }, remote: { name: '远端分类' } })

    resolveConflict('cat-p', false)

    expect(ds.categoryMap['cat-p']?.name).toBe('远端分类')
    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(sync.conflicts).toHaveLength(0)
  })

  it('keepLocal=false attribute 分支：走 updateAttribute + saveAppData', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    ds.addAttribute({ id: 'attr-p', name: '本地属性', type: 'boolean' })
    sync.addConflict({ id: 'attr-p', type: 'attribute', local: { name: '本地属性' }, remote: { name: '远端属性' } })

    resolveConflict('attr-p', false)

    expect(ds.attributeMap['attr-p']?.name).toBe('远端属性')
    expect(saveAppData).toHaveBeenCalledTimes(1)
    expect(sync.conflicts).toHaveLength(0)
  })

  it('keepLocal=true 也删 _remoteSnapshots（L35 delete 在两分支之外均执行）', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    ds.addBookmark({
      id: 'bm-snap', title: '本地', url: 'https://a.com', username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    sync.addConflict({ id: 'bm-snap', type: 'bookmark', local: {}, remote: {} })
    _remoteSnapshots.set('bookmark:bm-snap', {})

    resolveConflict('bm-snap', true)

    expect(_remoteSnapshots.has('bookmark:bm-snap')).toBe(false)
  })
})

describe('resolveAllConflicts slice 防跳项编排', () => {
  beforeEach(() => {
    vi.mocked(saveAppData).mockClear()
  })

  it('keepLocal=false 批量四类型混合各走自身 update 分支全部清空', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    ds.addBookmark({
      id: 'all-bm', title: '本地', url: 'https://a.com', username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    ds.addGroup({
      id: 'all-grp', name: '本地组', categoryId: CAT_UNCATEGORIZED, icon: '', order: 0,
      isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', useCount: 0, updatedAt: 1,
    } as any)
    ds.addCategory({ id: 'all-cat', name: '本地分类', icon: '', color: '', order: 0 })
    ds.addAttribute({ id: 'all-attr', name: '本地属性', type: 'boolean' })
    sync.addConflict({ id: 'all-bm', type: 'bookmark', local: {}, remote: { title: '远端Bm' } })
    sync.addConflict({ id: 'all-grp', type: 'group', local: {}, remote: { name: '远端组' } })
    sync.addConflict({ id: 'all-cat', type: 'category', local: {}, remote: { name: '远端分类' } })
    sync.addConflict({ id: 'all-attr', type: 'attribute', local: {}, remote: { name: '远端属性' } })

    resolveAllConflicts(false)

    expect(ds.bookmarkMap['all-bm']?.title).toBe('远端Bm')
    expect(ds.groupMap['all-grp']?.name).toBe('远端组')
    expect(ds.categoryMap['all-cat']?.name).toBe('远端分类')
    expect(ds.attributeMap['all-attr']?.name).toBe('远端属性')
    expect(sync.conflicts).toHaveLength(0)
    // 每个冲突 keepLocal=false 调一次 saveAppData → 4 次
    expect(saveAppData).toHaveBeenCalledTimes(4)
  })

  it('防跳项不可漏：多个冲突逐个移除不跳过任一项（若误用直接遍历会跳中途项）', () => {
    const sync = useSyncStore()
    // 连续 5 个冲突，逐个 removeConflict 改长度——若遍历不 slice 会跳项残留
    for (let i = 0; i < 5; i++) {
      sync.addConflict({ id: `c${i}`, type: 'bookmark' as const, local: {}, remote: {} })
    }
    resolveAllConflicts(true)
    expect(sync.conflicts).toHaveLength(0)
  })
})

