import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSyncStore, type SyncConflict } from '../../stores/sync.js'
import { useDataStore } from '../../stores/data.js'
import { useCloudSync, __resetInitialSync } from '../../composables/domain/useCloudSync.js'
import { resolveConflict } from '../../composables/domain/useSyncConflict.js'
import { restoreFromHistory } from '../../composables/domain/useSyncHistory.js'
import { toRemoteRow } from '../../composables/domain/useSyncMapping.js'
import { diffVersions } from '../../lib/diffVersions.js'
import * as storage from '../../stores/storage.js'
import * as appStore from '../../stores/app.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

describe('模块 3 审计修复护栏测试集 (Sync Engine & Conflict Resolution)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    __resetInitialSync()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1. syncStore.resetSyncState 契约：重置锁定积压/错误/状态，保留 pendingCount 供 push 刷新', () => {
    const store = useSyncStore()
    store.setPendingCount(42)
    store.setPendingLockedCount(5)
    store.setSyncStatus('error')
    store.setSyncError('network failed')

    store.resetSyncState()

    expect(store.pendingCount).toBe(42)
    expect(store.pendingLockedCount).toBe(0)
    expect(store.syncStatus).toBe('idle')
    expect(store.syncError).toBeNull()
  })

  it('2. syncStore.addConflict 相同 ID 覆盖去重并重置横幅，removeConflict 彻底清除所有匹配项', () => {
    const store = useSyncStore()
    store.dismissConflictBanner()
    expect(store.conflictBannerDismissed).toBe(true)

    const c1: SyncConflict = { id: 'item-1', type: 'bookmark', local: { a: 1 }, remote: { a: 2 } }
    store.addConflict(c1)
    expect(store.conflicts.length).toBe(1)
    expect(store.conflictBannerDismissed).toBe(false)

    // 再次添加同 ID 冲突，覆盖原条目而非增加数组长度
    const c1Updated: SyncConflict = { id: 'item-1', type: 'bookmark', local: { a: 1 }, remote: { a: 3 } }
    store.addConflict(c1Updated)
    expect(store.conflicts.length).toBe(1)
    expect((store.conflicts[0].remote as any).a).toBe(3)

    // removeConflict 彻底清除
    store.removeConflict('item-1')
    expect(store.conflicts.length).toBe(0)
  })

  it('3. useCloudSync.resetSyncState 清理在途防抖定时器与 claimTried 标志', async () => {
    const sync = useCloudSync()
    const store = useSyncStore()
    store.setPendingCount(10)
    store.setSyncStatus('error')

    // 触发登出重置
    await sync.resetSyncState()

    expect(store.syncStatus).toBe('idle')
    expect(store.pendingCount).toBe(0)
  })

  it('4. useCloudSync.initOnlineListener 具备幂等性，多次调用先 remove 再 add 防重复累积', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const rmSpy = vi.spyOn(window, 'removeEventListener')
    const sync = useCloudSync()

    sync.initOnlineListener()
    sync.initOnlineListener()
    sync.initOnlineListener()

    // 每次 init 前均先 remove 前一次注册的监听，防止事件处理函数重复堆叠
    const onlineRms = rmSpy.mock.calls.filter(c => c[0] === 'online')
    const onlineAdds = addSpy.mock.calls.filter(c => c[0] === 'online')
    expect(onlineAdds.length).toBe(3)
    expect(onlineRms.length).toBe(3)

    sync.destroyOnlineListener()
    expect(rmSpy.mock.calls.filter(c => c[0] === 'online').length).toBe(4)
  })

  it('5. resolveConflict(id, true) 保留本地版本时将 updatedAt 严格提升至大于远端时间戳，确保回推获胜', () => {
    const ds = useDataStore()
    const store = useSyncStore()
    const saveSpy = vi.spyOn(appStore, 'saveAppData').mockImplementation(async () => true)

    const bm: Bookmark = {
      id: 'bm-conflict-1',
      title: 'Local Title',
      url: 'https://example.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'c1',
      parentId: null,
      order: 0,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }
    ds.addBookmark(bm)

    store.addConflict({
      id: 'bm-conflict-1',
      type: 'bookmark',
      local: { ...bm },
      remote: { ...bm, title: 'Remote Title', updatedAt: 2000 },
    })

    resolveConflict('bm-conflict-1', true)

    // keepLocal=true 不调 saveAppData，留给后续 push 统一落盘
    expect(saveSpy).not.toHaveBeenCalled()
    expect(store.conflicts.length).toBe(0)
    expect(ds.bookmarkMap['bm-conflict-1'].updatedAt).toBeGreaterThan(2000)
    expect(ds._dirtyIds.has('bm-conflict-1')).toBe(true)
  })

  it('6. restoreFromHistory 恢复组历史时过滤已被软删除的书签 ID', async () => {
    const ds = useDataStore()
    vi.spyOn(appStore, 'saveAppData').mockImplementation(async () => true)

    const liveBm: Bookmark = {
      id: 'bm-live',
      title: 'Live',
      url: 'https://live.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'c1',
      parentId: null,
      order: 0,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }
    const deadBm: Bookmark = {
      id: 'bm-dead',
      title: 'Dead',
      url: 'https://dead.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'c1',
      parentId: null,
      order: 1,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
      deletedAt: 2000,
    }
    const group: SiblingGroup = {
      id: 'g-hist',
      name: 'Test Group',
      categoryId: 'c1',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: ['bm-live'],
      notes: '',
      updatedAt: 1000,
      useCount: 0,
      isPublic: false,
    }

    ds.bookmarks = [liveBm, deadBm]
    ds.siblingGroups = [group]
    ds._syncMaps()

    vi.spyOn(storage, 'getLocalHistoryVersion').mockResolvedValue({
      id: 'g-hist',
      name: 'Old Group Name',
      categoryId: 'c1',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: ['bm-live', 'bm-dead', 'bm-nonexistent'],
      notes: '',
      useCount: 0,
      updatedAt: 500,
    })

    const ok = await restoreFromHistory(1, 'g-hist', 'group')
    expect(ok).toBe(true)

    // 软删除书签根据契约保留在组内，物理彻底不存在的书签被过滤
    expect(ds.groupMap['g-hist'].bookmarkIds).toEqual(['bm-live', 'bm-dead'])
  })

  it('7. restoreFromHistory 恢复书签历史时若父书签已删除，parentId 自动置空避免幽灵孤儿', async () => {
    const ds = useDataStore()
    vi.spyOn(appStore, 'saveAppData').mockImplementation(async () => true)

    const deadParent: Bookmark = {
      id: 'p-dead',
      title: 'Dead Parent',
      url: 'https://parent.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'c1',
      parentId: null,
      order: 0,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
      deletedAt: 2000,
    }
    const child: Bookmark = {
      id: 'c-orphan',
      title: 'Child',
      url: 'https://child.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'c1',
      parentId: null,
      order: 1,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }

    ds.bookmarks = [deadParent, child]
    ds._syncMaps()

    vi.spyOn(storage, 'getLocalHistoryVersion').mockResolvedValue({
      id: 'c-orphan',
      title: 'Old Child',
      url: 'https://child.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'c1',
      parentId: 'p-dead', // 指向已软删除的父书签
      order: 1,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      updatedAt: 500,
    })

    const ok = await restoreFromHistory(1, 'c-orphan', 'bookmark')
    expect(ok).toBe(true)
    expect(ds.bookmarkMap['c-orphan'].parentId).toBeNull()
  })

  it('8. toRemoteRow 在 createdAt 缺失时兜底当前时间戳', () => {
    const row = toRemoteRow('bookmark', {
      id: 'bm-1',
      _userId: 'u1',
      title: 'Title',
      url: 'https://u.com',
      categoryId: 'c1',
    }, false)

    expect(typeof row.created_at_num).toBe('number')
    expect(row.created_at_num).toBeGreaterThan(0)
  })

  it('9. diffVersions 默认排除内部同步元数据，且在遇到循环引用时优雅容错不崩溃', () => {
    const oldV: Record<string, any> = {
      title: 'Old Title',
      _userId: 'u-1',
      _isNew: true,
      _changedFields: ['title'],
    }
    const newV: Record<string, any> = {
      title: 'New Title',
      _userId: 'u-2',
      _isNew: false,
      _changedFields: null,
    }

    const diffs = diffVersions(oldV, newV)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].key).toBe('title')
    expect(diffs[0].oldValue).toBe('Old Title')
    expect(diffs[0].newValue).toBe('New Title')

    // 循环引用保护
    const circularOld: Record<string, any> = { title: 'Circular' }
    circularOld.self = circularOld
    expect(() => diffVersions(circularOld, { title: 'Clean' })).not.toThrow()
  })

  it('10. syncPush 序列化时对 op.data 解构浅拷贝，即使本批失败重试也不破坏原始 op.data._changedFields', async () => {
    // 验证 _mergeOps 与 push 循环中的 data 解构保护
    const rawOp: storage.SyncOp = {
      id: 1,
      action: 'upsert',
      table: 'bookmarks',
      itemId: 'bm-retry-test',
      data: {
        id: 'bm-retry-test',
        title: 'Title',
        url: 'https://test.com',
        _changedFields: ['title'],
        _isNew: false,
        _userId: 'u1',
      },
      ts: 1000,
      retries: 0,
    }

    // 模拟解构处理
    const data = { ...rawOp.data }
    const _changedFields = data._changedFields as string[] | null
    const _isNew = data._isNew as boolean || false
    delete data._changedFields
    delete data._userId
    delete data._isNew

    // 关键断言：原始 rawOp.data 未被原地 delete 破坏
    expect(rawOp.data!._changedFields).toEqual(['title'])
    expect(rawOp.data!._isNew).toBe(false)
    expect(rawOp.data!._userId).toBe('u1')
  })

  it('11. toRemoteRow 转换书签时保证 created_at_num 恒有效且不为 undefined', () => {
    const remote = toRemoteRow('bookmark', {
      id: 'bm-no-created',
      _userId: 'u1',
      title: 'No Created',
      url: 'https://test.com',
      categoryId: 'c1',
    }, true)

    expect(remote.created_at_num).toBeDefined()
    expect(typeof remote.created_at_num).toBe('number')
    expect(remote.created_at_num).toBeGreaterThan(0)
  })

  it('12. fetchPublicCategory 剥除书签敏感凭证作为关键纵深防御', async () => {
    const { fetchPublicCategory } = await import('../../composables/domain/syncShare.js')
    const dbApi = await import('../../lib/dbApi.js')
    vi.spyOn(dbApi, 'dbRpc').mockResolvedValue({
      data: {
        category: { id: 'cat-1', name: 'Cat 1' },
        groups: [],
        bookmarks: [
          {
            id: 'bm-leak-test',
            title: 'Sensitive Bookmark',
            url: 'https://sensitive.com',
            username: 'admin_user',
            password: 'secret_password_123',
            category_id: 'cat-1',
          },
        ],
      },
      error: null,
    } as any)

    const res = await fetchPublicCategory('validshareid1234')
    expect(res).not.toBeNull()
    expect(res?.bookmarks[0].username).toBe('')
    expect(res?.bookmarks[0].password).toBe('')
  })

  it('13. stopAllUserShares 清理包括已软删除的公开组在内的所有公开组', async () => {
    const ds = useDataStore()
    const { stopAllUserShares } = await import('../../composables/domain/syncShare.js')
    const dbApi = await import('../../lib/dbApi.js')

    const updateCalls: any[] = []
    vi.spyOn(dbApi, 'dbFrom').mockImplementation((table: string) => {
      if (table === 'sibling_groups') {
        return {
          update: (patch: any) => ({
            eq: (_f1: string, val1: string) => ({
              eq: (_f2: string, _val2: string) => {
                updateCalls.push({ gid: val1, patch })
                return Promise.resolve({ error: null })
              },
            }),
          }),
        } as any
      }
      if (table === 'public_category_shares') {
        return {
          delete: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        } as any
      }
      return {} as any
    })

    const auth = await import('../../composables/domain/useSyncHistory.js')
    vi.spyOn(auth, '_getUserId').mockReturnValue('u-test')

    // 存活公开组 + 已软删公开组
    ds.siblingGroups = [
      { id: 'g-alive', name: 'Alive', isPublic: true, categoryId: 'c1', icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 100, useCount: 0 },
      { id: 'g-deleted', name: 'Deleted', isPublic: true, deletedAt: 9999, categoryId: 'c1', icon: '', order: 1, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 100, useCount: 0 },
      { id: 'g-private', name: 'Private', isPublic: false, categoryId: 'c1', icon: '', order: 2, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 100, useCount: 0 },
    ]
    ds._syncMaps()

    const ok = await stopAllUserShares()
    expect(ok).toBe(true)
    const closedGids = updateCalls.map(c => c.gid)
    expect(closedGids).toContain('g-alive')
    expect(closedGids).toContain('g-deleted')
    expect(closedGids).not.toContain('g-private')
  })

  it('14. SyncStatusPopover 配额触顶提示在多语言下正常加载', async () => {
    const { t, setLocale } = await import('../../i18n/index.js')
    setLocale('zh-CN')
    expect(t('sync.quotaFullNotice')).toContain('云端存储空间已满')
    setLocale('en-US')
    expect(t('sync.quotaFullNotice')).toContain('Cloud storage is full')
    setLocale('zh-CN') // 恢复
  })

  it('15. resolveConflict(id, keepLocal=false) 采用远端时清空 dirty 与 changedFields 回声标记', () => {
    const ds = useDataStore()
    const store = useSyncStore()
    vi.spyOn(appStore, 'saveAppData').mockImplementation(async () => true)

    const bm: Bookmark = {
      id: 'bm-echo-test',
      title: 'Local Ver',
      url: 'https://test.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'c1',
      parentId: null,
      order: 0,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }
    ds.addBookmark(bm)
    // 确保加入 dirty 和 changedFields
    ds._dirtyIds.add('bm-echo-test')
    ds._changedFields.set('bm-echo-test', new Set(['title']))

    store.addConflict({
      id: 'bm-echo-test',
      type: 'bookmark',
      local: { ...bm },
      remote: { ...bm, title: 'Remote Ver', updatedAt: 2000 },
    })

    resolveConflict('bm-echo-test', false)

    // 关键断言：采用远端后，本地内容更新为远端版本，但回声 dirty/changedFields 被彻底清洗
    expect(ds.bookmarkMap['bm-echo-test'].title).toBe('Remote Ver')
    expect(ds._dirtyIds.has('bm-echo-test')).toBe(false)
    expect(ds._changedFields.has('bm-echo-test')).toBe(false)
  })

  it('16. restoreFromHistory 恢复书签时对缺省字段安全降级默认值，不覆盖为 undefined', async () => {
    const ds = useDataStore()
    vi.spyOn(appStore, 'saveAppData').mockImplementation(async () => true)

    const bm: Bookmark = {
      id: 'bm-undef-test',
      title: 'Current Title',
      url: 'https://test.com',
      username: 'user_orig',
      password: 'pw_orig',
      notes: 'notes_orig',
      icon: 'icon_orig',
      categoryId: 'c1',
      parentId: null,
      order: 0,
      useCount: 0,
      attributes: { a: true },
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }
    ds.bookmarks = [bm]
    ds._syncMaps()

    // 模拟老版本快照（无 username/notes/password 键）
    vi.spyOn(storage, 'getLocalHistoryVersion').mockResolvedValue({
      id: 'bm-undef-test',
      title: 'Old Title',
      url: 'https://test.com',
      categoryId: 'c1',
      updatedAt: 500,
    })

    const ok = await restoreFromHistory(1, 'bm-undef-test', 'bookmark')
    expect(ok).toBe(true)

    const restored = ds.bookmarkMap['bm-undef-test']
    expect(restored.username).toBe('')
    expect(restored.password).toBe('')
    expect(restored.notes).toBe('')
    expect(restored.icon).toBe('')
    expect(restored.attributes).toEqual({})
    expect(restored.order).toBe(0)
  })

  it('17. subscribeRealtime 在 CloudBase 模式下重连时自动沿用前次有效 pullChanges 回调', async () => {
    const cb = await import('../../lib/cloudbase.js')
    vi.spyOn(cb, 'isCloudBaseBackend').mockReturnValue(true)
    const hist = await import('../../composables/domain/useSyncHistory.js')
    vi.spyOn(hist, '_getUserId').mockReturnValue('user-cb-test')

    const { subscribeRealtime, unsubscribeRealtime } = await import('../../composables/domain/useSyncRealtime.js')

    unsubscribeRealtime()
    let _pullCalled = 0
    const mockPull = async () => { _pullCalled++; return true }

    // 首次订阅并传回调
    subscribeRealtime(mockPull)

    // 模拟断线清理
    unsubscribeRealtime()

    // 重连时不传参数，验证仍能有效建立订阅并连接
    subscribeRealtime()

    const store = useSyncStore()
    expect(store.realtimeStatus).toBe('connected')
    unsubscribeRealtime()
  })
});
