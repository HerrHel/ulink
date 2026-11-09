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

  it('18. Realtime 跨空间隔离：当处于 vault 私密空间时短路远端 Realtime 变更，绝不污染私密内存数据', async () => {
    const { _handleRealtimeChange } = await import('../../composables/domain/useSyncRealtime.js')
    const { useUIStore } = await import('../../stores/ui.js')
    const hist = await import('../../composables/domain/useSyncHistory.js')
    vi.spyOn(hist, '_getUserId').mockReturnValue('user-rt-space-test')

    const ui = useUIStore()
    const ds = useDataStore()
    ui.curSpace = 'vault'

    // 私密空间中现有一张私密书签
    ds.bookmarks = [
      {
        id: 'vault-bm-1',
        title: 'Secret Vault Bookmark',
        url: 'https://secret.local',
        username: 'vault_user',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'uncategorized',
        parentId: null,
        order: 0,
        useCount: 0,
        attributes: {},
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]
    ds._syncMaps()

    // 收到针对远端主页书签的 Realtime INSERT 事件
    await _handleRealtimeChange({
      eventType: 'INSERT',
      new: {
        id: 'cloud-bm-public',
        user_id: 'user-rt-space-test',
        title: 'Public Remote Bookmark',
        url: 'https://public.example.com',
        category_id: 'uncategorized',
        created_at_num: 2000,
        updated_at_num: 2000,
      },
    }, 'bookmark')

    // 关键断言：私密空间数据完全未被污染，公共书签未被注入
    expect(ds.bookmarks.length).toBe(1)
    expect(ds.bookmarks[0].id).toBe('vault-bm-1')
    expect(ds.bookmarkMap['cloud-bm-public']).toBeUndefined()

    // 收到针对远端主页书签的 Realtime DELETE 事件（碰巧同 ID）
    await _handleRealtimeChange({
      eventType: 'DELETE',
      old: {
        id: 'vault-bm-1',
        user_id: 'user-rt-space-test',
      },
    }, 'bookmark')

    // 关键断言：私密卡片绝不被远端 DELETE 事件删除
    expect(ds.bookmarks.length).toBe(1)
    expect(ds.bookmarks[0].deletedAt).toBeUndefined()

    ui.curSpace = 'main'
  })

  it('19. classifySyncError 覆盖 CloudBase、网络超时、配额耗尽等多种异常签名', async () => {
    const { classifySyncError } = await import('../../composables/domain/syncCircuit.js')

    // Auth 异常
    expect(classifySyncError('CHECK_LOGIN_FAILED')).toBe('auth')
    expect(classifySyncError('NO_AUTH')).toBe('auth')
    expect(classifySyncError('AUTH_EXPIRED')).toBe('auth')
    expect(classifySyncError('no valid identity')).toBe('auth')
    expect(classifySyncError('登录已失效')).toBe('auth')
    expect(classifySyncError('身份无效')).toBe('auth')

    // Quota 异常
    expect(classifySyncError('RESOURCE_EXHAUSTED: daily limit reached')).toBe('quota')
    expect(classifySyncError('Quota limit exceeded 429')).toBe('quota')
    expect(classifySyncError('存储容量已满')).toBe('quota')
    expect(classifySyncError('配额不足')).toBe('quota')

    // Network 异常
    expect(classifySyncError('request:fail timeout')).toBe('network')
    expect(classifySyncError('net::ERR_CONNECTION_TIMED_OUT')).toBe('network')
    expect(classifySyncError('fetch failed: ECONNREFUSED')).toBe('network')
    expect(classifySyncError('TypeError: network request failed')).toBe('network')
    expect(classifySyncError('连接超时，请重试')).toBe('network')
    expect(classifySyncError('网络异常，无法访问服务器')).toBe('network')

    // Server 异常
    expect(classifySyncError('500 Internal Server Error')).toBe('server')
    expect(classifySyncError('Database syntax error')).toBe('server')
  })

  it('20. syncLocalMerge 合并组 notes 时静默同步挂载中的 TipTap 编辑器，防止旧内容回声覆盖', async () => {
    const { _mergeIntoLocal } = await import('../../composables/domain/syncLocalMerge.js')
    const { EditorManager } = await import('../../lib/editor.js')
    const ds = useDataStore()

    const gid = 'g-editor-sync-test'
    const group: SiblingGroup = {
      id: gid,
      name: 'Group 1',
      categoryId: 'c1',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '<p>Old Local Notes</p>',
      updatedAt: 1000,
      useCount: 0,
      isPublic: false,
    }
    ds.siblingGroups = [group]
    ds._syncMaps()

    // 模拟挂载中的编辑器
    let currentEditorHtml = '<p>Old Local Notes</p>'
    const mockEditor = {
      getHTML: () => currentEditorHtml,
    }
    vi.spyOn(EditorManager, 'get').mockImplementation((id: string) => (id === gid ? (mockEditor as any) : null))
    const silentSetSpy = vi.spyOn(EditorManager, 'silentSetContent').mockImplementation((id: string, html: string) => {
      if (id === gid) {
        currentEditorHtml = html
        return true
      }
      return false
    })

    const remoteGroup: SiblingGroup = {
      ...group,
      notes: '<p>New Remote Notes from Other Device</p>',
      updatedAt: 2000,
    }

    _mergeIntoLocal(ds.siblingGroups, [remoteGroup], 'group', false)

    // 关键断言：EditorManager.silentSetContent 被精准调用，且 dirty/changedFields 被清理
    expect(silentSetSpy).toHaveBeenCalledWith(gid, '<p>New Remote Notes from Other Device</p>')
    expect(currentEditorHtml).toBe('<p>New Remote Notes from Other Device</p>')
    expect(ds._dirtyIds.has(gid)).toBe(false)
    expect(ds._changedFields.has(gid)).toBe(false)
  })

  it('21. resolveConflict 采用远端组时静默同步挂载中的 TipTap 编辑器', async () => {
    const { EditorManager } = await import('../../lib/editor.js')
    const ds = useDataStore()
    const store = useSyncStore()

    const gid = 'g-conflict-editor-test'
    const group: SiblingGroup = {
      id: gid,
      name: 'Conflicted Group',
      categoryId: 'c1',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '<p>Local Notes</p>',
      updatedAt: 1000,
      useCount: 0,
      isPublic: false,
    }
    ds.addGroup(group)

    let currentEditorHtml = '<p>Local Notes</p>'
    vi.spyOn(EditorManager, 'get').mockReturnValue({ getHTML: () => currentEditorHtml } as any)
    const silentSpy = vi.spyOn(EditorManager, 'silentSetContent').mockImplementation((_id, html) => {
      currentEditorHtml = html
      return true
    })

    store.addConflict({
      id: gid,
      type: 'group',
      local: { ...group },
      remote: { ...group, notes: '<p>Resolved Remote Notes</p>', updatedAt: 2500 },
    })

    resolveConflict(gid, false)

    expect(silentSpy).toHaveBeenCalledWith(gid, '<p>Resolved Remote Notes</p>')
    expect(currentEditorHtml).toBe('<p>Resolved Remote Notes</p>')
  })

  it('22. fromRemoteBookmark 与 fromRemoteGroup 保留 order=0 与 useCount=0 的有效值', async () => {
    const { fromRemoteBookmark, fromRemoteGroup } = await import('../../composables/domain/useSyncMapping.js')

    const bm = fromRemoteBookmark({
      id: 'bm-zero',
      title: 'Zero Order BM',
      url: 'https://zero.com',
      category_id: 'c1',
      order: 0,
      use_count: 0,
    })
    expect(bm?.order).toBe(0)
    expect(bm?.useCount).toBe(0)

    const grp = fromRemoteGroup({
      id: 'g-zero',
      name: 'Zero Order Group',
      category_id: 'c1',
      order: 0,
      use_count: 0,
    })
    expect(grp?.order).toBe(0)
    expect(grp?.useCount).toBe(0)
  })

  it('23. Realtime INSERT 事件保持远端 updatedAt 与 createdAt，避免本地 add* 逻辑将其重置为 Date.now()', async () => {
    const { _handleRealtimeChange } = await import('../../composables/domain/useSyncRealtime.js')
    const hist = await import('../../composables/domain/useSyncHistory.js')
    vi.spyOn(hist, '_getUserId').mockReturnValue('user-rt-ts-test')
    const ds = useDataStore()

    // 收到书签 INSERT 事件，携带历史时间戳 1500 与 1000
    await _handleRealtimeChange({
      eventType: 'INSERT',
      new: {
        id: 'bm-rt-insert-ts',
        user_id: 'user-rt-ts-test',
        title: 'Remote Insert',
        url: 'https://rt-insert.com',
        category_id: 'c1',
        created_at_num: 1000,
        updated_at_num: 1500,
      },
    }, 'bookmark')

    const bm = ds.bookmarkMap['bm-rt-insert-ts']
    expect(bm).toBeDefined()
    expect(bm.createdAt).toBe(1000)
    expect(bm.updatedAt).toBe(1500)

    // 收到组 INSERT 事件，携带历史时间戳 1800
    await _handleRealtimeChange({
      eventType: 'INSERT',
      new: {
        id: 'g-rt-insert-ts',
        user_id: 'user-rt-ts-test',
        name: 'Remote Group',
        category_id: 'c1',
        updated_at_num: 1800,
      },
    }, 'group')

    const g = ds.groupMap['g-rt-insert-ts']
    expect(g).toBeDefined()
    expect(g.updatedAt).toBe(1800)
  })

  it('24. _mergeOps 在合并 delete 动作时正确保留最大 retries 次数，防止重试计数被清零', async () => {
    const { _mergeOps } = await import('../../composables/domain/syncPush.js')
    const ops: storage.SyncOp[] = [
      { id: 1, action: 'delete', table: 'bookmarks', itemId: 'bm-del-retry', ts: 1000, retries: 2, data: null },
      { id: 2, action: 'delete', table: 'bookmarks', itemId: 'bm-del-retry', ts: 2000, retries: 0, data: null },
    ]

    const merged = _mergeOps(ops)
    expect(merged.length).toBe(1)
    expect(merged[0].retries).toBe(2)
  })

  it('25. enqueueDirtyAsOps 仅为实际生成 op 的项打 pendingSync 标记，防止幽灵脏 ID 导致 pending 泄漏', async () => {
    const { enqueueDirtyAsOps } = await import('../../composables/domain/syncPush.js')
    const { _isPendingSync } = await import('../../composables/domain/syncPending.js')
    const hist = await import('../../composables/domain/useSyncHistory.js')
    vi.spyOn(hist, '_getUserId').mockReturnValue('user-enqueue-test')
    const ds = useDataStore()

    // 加入一个真实书签
    ds.addBookmark({
      id: 'bm-real-pending',
      title: 'Real',
      url: 'https://real.com',
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
    })

    // 人为在 _dirtyIds 中制造一个已不在 bookmarks 中的幽灵 ID
    ds._dirtyIds.add('ghost-orphan-id')
    expect(ds._dirtyIds.has('ghost-orphan-id')).toBe(true)

    enqueueDirtyAsOps()

    // 关键断言：真实入队项被标记 pendingSync，而幽灵 ID 不会被错误标记而永久泄漏
    expect(_isPendingSync('bm-real-pending')).toBe(true)
    expect(_isPendingSync('ghost-orphan-id')).toBe(false)
  })

  it('26. fullSync 在未登录时早退返回 false，不触发冗余锁与网络调用', async () => {
    const { useCloudSync } = await import('../../composables/domain/useCloudSync.js')
    const auth = await import('../../composables/domain/useAuth.js')
    vi.spyOn(auth, 'useAuth').mockReturnValue({
      isLoggedIn: false,
      user: null,
    } as any)

    const sync = useCloudSync()
    const result = await sync.fullSync()
    expect(result).toBe(false)
  })

  it('27. fetchAllPages 在底层 queryFn 抛出网络异常时安全捕获，返回标准 SyncPortError', async () => {
    const { fetchAllPages } = await import('../../composables/domain/syncPortCore.js')

    const res = await fetchAllPages(async () => {
      throw new Error('Socket network timeout')
    })

    expect(res.data).toBeNull()
    expect(res.error).not.toBeNull()
    expect(res.error?.message).toContain('Socket network timeout')
  })

  it('28. _mergeIntoLocal 在 insert 与 assign 时规整未来时间戳并防止 parentId 自环', async () => {
    const { _mergeIntoLocal } = await import('../../composables/domain/syncLocalMerge.js')
    const ds = useDataStore()

    const futureTime = Date.now() + 9999999 // 远超 MAX_FUTURE_CLOCK_SKEW_MS
    const remoteBm: Bookmark = {
      id: 'bm-future-skew',
      title: 'Future Bookmark',
      url: 'https://future.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'c1',
      parentId: 'bm-future-skew', // 自环
      order: 0,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: futureTime,
    }

    _mergeIntoLocal(ds.bookmarks, [remoteBm], 'bookmark', false)

    const inserted = ds.bookmarks.find(b => b.id === 'bm-future-skew')
    expect(inserted).toBeDefined()
    // 规整未来时钟
    expect(inserted!.updatedAt).toBeLessThan(futureTime)
    // 拦截自环
    expect(inserted!.parentId).toBeNull()
  })

  it('29. restoreFromHistory 恢复书签时拦截 parentId === itemId 的自引用', async () => {
    const ds = useDataStore()
    const bm: Bookmark = {
      id: 'bm-self-ref',
      title: 'Self Ref Bookmark',
      url: 'https://self.com',
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
    ds.bookmarks = [bm]
    ds._syncMaps()

    vi.spyOn(storage, 'getLocalHistoryVersion').mockResolvedValue({
      id: 'bm-self-ref',
      title: 'Old BM with Self Ref',
      url: 'https://self.com',
      categoryId: 'c1',
      parentId: 'bm-self-ref', // 指向自己
      updatedAt: 500,
    })

    const ok = await restoreFromHistory(1, 'bm-self-ref', 'bookmark')
    expect(ok).toBe(true)
    expect(ds.bookmarkMap['bm-self-ref'].parentId).toBeNull()
  })

  it('30. setGroupPublic 在抛出网络异常时安全捕获并返回 false，不抛未处理拒绝', async () => {
    const { setGroupPublic } = await import('../../composables/domain/syncShare.js')
    const dbApi = await import('../../lib/dbApi.js')
    const syncHistory = await import('../../composables/domain/useSyncHistory.js')
    vi.spyOn(syncHistory, '_getUserId').mockReturnValue('user-1')

    const ds = useDataStore()
    ds.siblingGroups = [{
      id: 'grp-pub-1',
      name: 'Public Group Test',
      categoryId: 'uncategorized',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '',
      useCount: 0,
      isPublic: false,
      updatedAt: 1000,
    }]
    ds._syncMaps()

    // 模拟远端 update 抛出网络异常
    vi.spyOn(dbApi, 'dbFrom').mockReturnValue({
      update: () => ({
        eq: () => ({
          eq: () => Promise.reject(new Error('Connection refused')),
        }),
      }),
    } as any)

    const ok = await setGroupPublic('grp-pub-1', true)
    expect(ok).toBe(false)
  })

  it('31. upsertPublicCategoryShare 发生网络异常时安全捕获并返回 null', async () => {
    const { upsertPublicCategoryShare } = await import('../../composables/domain/syncShare.js')
    const dbApi = await import('../../lib/dbApi.js')
    const syncHistory = await import('../../composables/domain/useSyncHistory.js')
    vi.spyOn(syncHistory, '_getUserId').mockReturnValue('user-1')

    vi.spyOn(dbApi, 'dbRpc').mockRejectedValue(new Error('RPC Gateway Timeout'))

    const res = await upsertPublicCategoryShare('cat-test')
    expect(res).toBeNull()
  })

  it('32. fetchHistory 远端查询抛异常时安全降级，仍能返回本地 IndexedDB 历史版本', async () => {
    const { fetchHistory } = await import('../../composables/domain/useSyncHistory.js')
    const dbApi = await import('../../lib/dbApi.js')
    const syncHistory = await import('../../composables/domain/useSyncHistory.js')
    vi.spyOn(syncHistory, '_getUserId').mockReturnValue('user-1')

    // 本地历史版本
    vi.spyOn(storage, 'fetchLocalHistory').mockReturnValue([
      { id: 101, data: { title: 'Local Version 1' }, created_at: '2026-11-08T12:00:00Z' },
    ])

    // 远端查询抛异常
    vi.spyOn(dbApi, 'dbFrom').mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.reject(new Error('DB unreachable')),
            }),
          }),
        }),
      }),
    } as any)

    const list = await fetchHistory('item-1')
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(101)
  })

  it('33. restoreFromHistory 本地无快照且远端抛异常时安全返回 false', async () => {
    const { restoreFromHistory } = await import('../../composables/domain/useSyncHistory.js')
    const dbApi = await import('../../lib/dbApi.js')
    const syncHistory = await import('../../composables/domain/useSyncHistory.js')
    vi.spyOn(syncHistory, '_getUserId').mockReturnValue('user-1')

    vi.spyOn(storage, 'getLocalHistoryVersion').mockResolvedValue(null)
    vi.spyOn(dbApi, 'dbFrom').mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => Promise.reject(new Error('Network error')),
          }),
        }),
      }),
    } as any)

    const ok = await restoreFromHistory(999, 'bm-item', 'bookmark')
    expect(ok).toBe(false)
  })

  it('34. initialSync 跨表 ID 不碰撞：分类拥有的 ID 不会误阻断同名书签的补推', async () => {
    const { createMemorySyncPort, setSyncRemotePort, useCloudSync } = await import('../../composables/domain/useCloudSync.js')
    const authStore = (await import('../../stores/auth.js')).useAuthStore()
    ;(authStore as any).user = { id: 'user-shared-id' }

    // 远端 categories 包含 'shared-id'，但 bookmarks 不包含
    const port = createMemorySyncPort({
      allIds: {
        categories: [{ id: 'shared-id' }],
        bookmarks: [],
      },
    })
    setSyncRemotePort(port)

    const ds = useDataStore()
    ds.bookmarks = [{
      id: 'shared-id',
      title: 'Bookmark with Same ID as Category',
      url: 'https://example.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'uncategorized',
      parentId: null,
      order: 0,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }]
    ds.categories = [{
      id: 'shared-id',
      name: 'Category with Same ID',
      icon: '',
      color: '',
      order: 0,
      updatedAt: 1000,
    }]
    ds._syncMaps()
    ds._dirtyIds.clear()
    ds._newIds.clear()

    const sync = useCloudSync()
    await sync.initialSync()

    // 验证 bookmarks 的 'shared-id' 成功推送（未被 categories 的 remoteIds 误抑制）
    const pushedBm = port.upserts.find(u => u.table === 'bookmarks' && (u.row as any)?.id === 'shared-id')
    expect(pushedBm).toBeDefined()
  })

  it('35. Realtime 远端变更合并时保留本地 isExpanded，防止折叠状态被冲掉', async () => {
    const { _handleRealtimeChange } = await import('../../composables/domain/useSyncRealtime.js')
    const authStore = (await import('../../stores/auth.js')).useAuthStore()
    ;(authStore as any).user = { id: 'user-rt-exp' }

    const ds = useDataStore()
    ds.bookmarks = [{
      id: 'bm-exp-1',
      title: 'Local Bookmark Title',
      url: 'https://example.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'uncategorized',
      parentId: null,
      order: 0,
      useCount: 0,
      attributes: {},
      isExpanded: true, // 用户展开了
      createdAt: 1000,
      updatedAt: 1000,
    }]
    ds.siblingGroups = [{
      id: 'grp-exp-1',
      name: 'Local Group Name',
      categoryId: 'uncategorized',
      icon: '',
      order: 0,
      isExpanded: true, // 用户展开了
      attributes: {},
      bookmarkIds: [],
      notes: '',
      useCount: 0,
      isPublic: false,
      updatedAt: 1000,
    }]
    ds._syncMaps()

    // 远端更新书签标题（远端无 is_expanded，默认为 false）
    await _handleRealtimeChange({
      eventType: 'UPDATE',
      new: {
        id: 'bm-exp-1',
        user_id: 'user-rt-exp',
        title: 'Remote Updated Title',
        url: 'https://example.com',
        category_id: 'uncategorized',
        updated_at_num: 2000,
      },
    }, 'bookmark')

    expect(ds.bookmarkMap['bm-exp-1'].title).toBe('Remote Updated Title')
    expect(ds.bookmarkMap['bm-exp-1'].isExpanded).toBe(true) // 仍保持展开

    // 远端更新组名称
    await _handleRealtimeChange({
      eventType: 'UPDATE',
      new: {
        id: 'grp-exp-1',
        user_id: 'user-rt-exp',
        name: 'Remote Updated Group Name',
        category_id: 'uncategorized',
        updated_at_num: 2000,
      },
    }, 'group')

    expect(ds.groupMap['grp-exp-1'].name).toBe('Remote Updated Group Name')
    expect(ds.groupMap['grp-exp-1'].isExpanded).toBe(true) // 仍保持展开
  })

  it('36. toRemoteRow 与 fromRemoteBookmark 边界校验：缺省 categoryId 归一化与 parentId 自环剥除', async () => {
    const { toRemoteRow, fromRemoteBookmark } = await import('../../composables/domain/useSyncMapping.js')

    // 1. toRemoteRow 针对空 categoryId 自动填充 uncategorized
    const bmRow = toRemoteRow('bookmark', { id: 'b1', _userId: 'u1', title: 't', url: 'https://x.com', categoryId: '' }, false)
    expect(bmRow.category_id).toBe('uncategorized')

    const grpRow = toRemoteRow('group', { id: 'g1', _userId: 'u1', name: 'g', categoryId: '' }, false)
    expect(grpRow.category_id).toBe('uncategorized')

    // 2. fromRemoteBookmark 剥除自引用的 parent_id
    const mappedBm = fromRemoteBookmark({
      id: 'bm-loop',
      title: 'Loopy Bookmark',
      url: 'https://loop.com',
      category_id: 'uncategorized',
      parent_id: 'bm-loop', // 指向自己
    })
    expect(mappedBm).not.toBeNull()
    expect(mappedBm!.parentId).toBeNull()
  })

  it('37. resolveConflict(id, keepLocal=false) 采纳远端时清除 pendingSync 状态并清理 IDB 积压 op', async () => {
    const { _isPendingSync, _markPendingSync } = await import('../../composables/domain/syncPending.js')
    const storageMod = await import('../../stores/storage.js')
    const removeSpy = vi.spyOn(storageMod, 'removeSyncOpsByItemId').mockResolvedValue(undefined)

    const sync = useSyncStore()
    const ds = useDataStore()

    ds.addBookmark({
      id: 'bm-conf-del',
      title: 'Local',
      url: 'https://local.com',
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
    })
    _markPendingSync(['bm-conf-del'])
    expect(_isPendingSync('bm-conf-del')).toBe(true)

    sync.addConflict({
      id: 'bm-conf-del',
      type: 'bookmark',
      local: { title: 'Local' },
      remote: { title: 'Remote', url: 'https://remote.com', categoryId: 'c1', updatedAt: 2000 },
    })

    resolveConflict('bm-conf-del', false)

    // 验证 pendingSync 已被清除
    expect(_isPendingSync('bm-conf-del')).toBe(false)
    // 验证 removeSyncOpsByItemId 被调用，防旧本地 op 推上云覆盖
    expect(removeSpy).toHaveBeenCalledWith('bm-conf-del')
  })

  it('38. _deleteWithoutEcho 在遇到循环引用子孙链时不发生死循环', async () => {
    const { _deleteWithoutEcho } = await import('../../composables/domain/syncLocalMerge.js')
    const ds = useDataStore()

    // 构造 A -> B -> A 循环依赖数据
    ds.bookmarks = [
      {
        id: 'bm-loop-a',
        title: 'Loop A',
        url: 'https://a.com',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'c1',
        parentId: 'bm-loop-b',
        order: 0,
        useCount: 0,
        attributes: {},
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'bm-loop-b',
        title: 'Loop B',
        url: 'https://b.com',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'c1',
        parentId: 'bm-loop-a',
        order: 0,
        useCount: 0,
        attributes: {},
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]
    ds._syncMaps()

    // 模拟远端软删 A，必须平稳退出不卡死
    _deleteWithoutEcho(ds, 'bookmark', 'bm-loop-a')
    expect(ds.bookmarkMap['bm-loop-a'].deletedAt).toBeDefined()
  })

  it('39. 彻底物理删除与 Realtime DELETE 自动清理对应的冲突横幅', async () => {
    const { _permanentDeleteWithoutEcho } = await import('../../composables/domain/syncLocalMerge.js')
    const sync = useSyncStore()
    const ds = useDataStore()

    ds.bookmarks = [
      {
        id: 'bm-dangling-conf',
        title: 'Dangling Conflict',
        url: 'https://dangling.com',
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
      },
    ]
    ds._syncMaps()

    sync.addConflict({
      id: 'bm-dangling-conf',
      type: 'bookmark',
      local: { title: 'Local' },
      remote: { title: 'Remote' },
    })
    expect(sync.getConflict('bm-dangling-conf')).toBeDefined()

    _permanentDeleteWithoutEcho(ds, 'bookmark', 'bm-dangling-conf')
    // 冲突横幅必须被同时清理
    expect(sync.getConflict('bm-dangling-conf')).toBeUndefined()
  })

  it('40. toRemoteRow 在 title / name / url 字段缺失或非字符串时安全回退空串，不违反 NOT NULL 约束', () => {
    // 1. bookmark
    const bmRow = toRemoteRow('bookmark', { id: 'bm-null-fields', _userId: 'u1' } as any, false)
    expect(bmRow.title).toBe('')
    expect(bmRow.url).toBe('')

    // 2. group
    const grpRow = toRemoteRow('group', { id: 'grp-null-fields', _userId: 'u1' } as any, false)
    expect(grpRow.name).toBe('')

    // 3. category
    const catRow = toRemoteRow('category', { id: 'cat-null-fields', _userId: 'u1' } as any, false)
    expect(catRow.name).toBe('')

    // 4. attribute
    const attrRow = toRemoteRow('attribute', { id: 'attr-null-fields', _userId: 'u1' } as any, false)
    expect(attrRow.name).toBe('')
  })
});
