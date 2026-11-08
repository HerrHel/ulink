/**
 * data-module2-audit-fixes.test.ts
 * 验证模块 2（状态中枢与数据领域层）全面审查中修复的 20 个问题的护栏测试：
 * 1. _saveLocalHistory 500ms 连续按键保留初始基准快照 + 深拷贝防污染
 * 2. _flushPendingHist 关页/强制落盘时立即刷出在途快照
 * 3. permanentDeleteBookmark 级联解孤儿维护 _trackChange('parentId') 与 updatedAt
 * 4. 软删除与恢复（deleteBookmark/Group/Attribute/_restoreFrom）一致追踪 'deletedAt'
 * 5. _syncMaps 排除软删/幽灵父节点
 * 6. _permanentDelete 同步清理 _newIds
 * 7. bumpGroupUseCount 静默递增 useCount，不标脏、不写历史、不刷 updatedAt
 * 8. _deletedAttrMemberships 持久化到 localStorage 与跨会话恢复
 * 9. _filterAttrs 单趟过滤与属性缺失空安全保护
 * 10. _sortItems 空标题不转为 "undefined" 字符串
 * 11. useMention 过滤软删除书签与组，空标题不抛错
 * 12. useGroup addGroupRefToGroup 自引用防御
 * 13. useBatch batchDelete 集合去重防重复删除与撤销膨胀
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore, _cancelPendingHist, _flushPendingHist, DAM_KEY } from '../../stores/data.js'
import { _filterAttrs, _sortItems } from '../../lib/dataQuery.js'
import { localHistoryKey } from '../../stores/storage.js'
import { safeGetItem } from '../../lib/storageSafe.js'
import { addGroupRefToGroup } from '../../composables/domain/useGroup.js'
import { useMention } from '../../composables/domain/useMention.js'
import { useMentionStore } from '../../stores/overlay.js'
import { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import { _swapAndMarkDirty } from '../../lib/dragSwap.js'
import { _mergeBookmarks } from '../../composables/domain/useDataIO.js'
import { restoreSnapshot } from '../../composables/domain/useUndo.js'
import { deleteBookmarkWithUndo, bmForm } from '../../composables/domain/useBookmark.js'
import { batchMoveToCat } from '../../composables/domain/useBatch.js'
import { CAT_UNCATEGORIZED, CAT_ALL } from '../../config/constants.js'
import { DGM_KEY } from '../../stores/data.js'
import { safeSetItem } from '../../lib/storageSafe.js'
import type { Bookmark, SiblingGroup, Category } from '../../types.js'

describe('模块 2 审计修复护栏测试集', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    _cancelPendingHist()
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    _cancelPendingHist()
    vi.useRealTimers()
  })

  it('1. _saveLocalHistory 连续按键时锁定初始基准快照，且深拷贝防污染', () => {
    const ds = useDataStore()
    const bm: Bookmark = {
      id: 'bm-hist',
      title: '版本0',
      url: 'https://v0.example.com',
      username: '',
      password: '',
      notes: 'Notes V0',
      icon: '',
      categoryId: 'cat1',
      parentId: null,
      order: 0,
      useCount: 0,
      attributes: { tag1: true },
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }
    ds.addBookmark(bm)

    // 第 1 次修改：从 V0 -> V1，记录旧状态 V0
    ds.updateBookmark('bm-hist', { title: '版本1', attributes: { tag1: false } })
    // 修改原对象 attributes，验证深拷贝隔离
    bm.attributes.tag1 = true

    // 100ms 后的第 2 次修改（防抖窗口内）：从 V1 -> V2
    vi.advanceTimersByTime(100)
    ds.updateBookmark('bm-hist', { title: '版本2' })

    // 500ms 定时器触发落盘
    vi.advanceTimersByTime(500)

    const key = localHistoryKey('bm-hist')
    const raw = safeGetItem(key)
    expect(raw).toBeTruthy()
    const history = JSON.parse(raw!)
    expect(history.length).toBe(1)
    // 关键断言：历史记录中的是编辑会话开始前的真正旧版本 V0（'版本0'），而非中间态 V1（'版本1'）
    expect(history[0].data.title).toBe('版本0')
    expect(history[0].data.attributes.tag1).toBe(true)
  })

  it('2. _flushPendingHist 关页前可将排队中的历史快照立即刷盘', () => {
    const ds = useDataStore()
    const bm: Bookmark = {
      id: 'bm-flush',
      title: '初始名',
      url: 'https://flush.example.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'uncat',
      parentId: null,
      order: 0,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }
    ds.addBookmark(bm)
    ds.updateBookmark('bm-flush', { title: '改动后' })

    // 尚未经过 500ms 定时器
    const key = localHistoryKey('bm-flush')
    expect(safeGetItem(key)).toBeNull()

    // 触发 flush（关页/beforeunload 场景）
    _flushPendingHist()

    const raw = safeGetItem(key)
    expect(raw).toBeTruthy()
    const hist = JSON.parse(raw!)
    expect(hist[0].data.title).toBe('初始名')
  })

  it('3. permanentDeleteBookmark 级联解孤儿维护 _trackChange(\'parentId\') 与 updatedAt', () => {
    const ds = useDataStore()
    const parent: Bookmark = {
      id: 'parent-bm',
      title: '父书签',
      url: 'https://p.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'uncat',
      parentId: null,
      order: 0,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }
    const child: Bookmark = {
      id: 'child-bm',
      title: '子书签',
      url: 'https://c.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'uncat',
      parentId: 'parent-bm',
      order: 1,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }
    ds.addBookmark(parent)
    ds.addBookmark(child)

    // 清理初始化脏标记
    ds.drainDirtyIds()
    ds.drainChangedFields()
    vi.setSystemTime(2000)

    ds.permanentDeleteBookmark('parent-bm')

    // 验证 child 变为顶级
    expect(ds.bookmarkMap['child-bm'].parentId).toBeNull()
    expect(ds.bookmarkMap['child-bm'].updatedAt).toBeGreaterThan(1000)

    // 验证 dirtyIds 与 _changedFields 正确包含了 parentId
    const dirty = ds.drainDirtyIds()
    expect(dirty.has('child-bm')).toBe(true)
    const changed = ds.drainChangedFields()
    expect(changed.get('child-bm')?.has('parentId')).toBe(true)
  })

  it('4. 软删除与恢复一致追踪 \'deletedAt\' 变更字段', () => {
    const ds = useDataStore()
    const bm: Bookmark = {
      id: 'bm-del',
      title: '测试',
      url: 'https://del.com',
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
    ds.drainChangedFields()

    // 软删除
    ds.deleteBookmark('bm-del')
    let changed = ds.drainChangedFields()
    expect(changed.get('bm-del')?.has('deletedAt')).toBe(true)

    // 恢复
    ds.restoreBookmark('bm-del')
    changed = ds.drainChangedFields()
    expect(changed.get('bm-del')?.has('deletedAt')).toBe(true)
  })

  it('5. _syncMaps 排除软删父节点，防止子书签进入幽灵父节点导致隐形', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      {
        id: 'dead-parent',
        title: '已删父',
        url: 'https://dead.com',
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
        deletedAt: 2000, // 已软删
      },
      {
        id: 'orphan-child',
        title: '存活子',
        url: 'https://orphan.com',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'c1',
        parentId: 'dead-parent',
        order: 1,
        useCount: 0,
        attributes: {},
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]

    ds._syncMaps()

    // 幽灵父 ID 不应出现在 _childrenIdx 中
    expect(ds._childrenIdx['dead-parent']).toBeUndefined()
  })

  it('6. _permanentDelete 同步清理 _newIds 避免死信残留', () => {
    const ds = useDataStore()
    const bm: Bookmark = {
      id: 'bm-new-del',
      title: '新项',
      url: 'https://new.com',
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
    expect(ds._newIds.has('bm-new-del')).toBe(true)

    ds.permanentDeleteBookmark('bm-new-del')
    expect(ds._newIds.has('bm-new-del')).toBe(false)
  })

  it('7. bumpGroupUseCount 静默递增 useCount，不标脏、不写历史、不刷 updatedAt', () => {
    const ds = useDataStore()
    const g: SiblingGroup = {
      id: 'grp-bump',
      name: '测试组',
      categoryId: 'c1',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '',
      updatedAt: 1000,
      useCount: 5,
    }
    ds.addGroup(g)
    ds.drainDirtyIds()
    ds.drainChangedFields()

    ds.bumpGroupUseCount('grp-bump')

    expect(ds.groupMap['grp-bump'].useCount).toBe(6)
    // 关键防护：updatedAt 保持不变（不抢占云端墓碑时间戳）
    expect(ds.groupMap['grp-bump'].updatedAt).toBe(1000)
    // 关键防护：不标脏、不进变更字段
    expect(ds.drainDirtyIds().size).toBe(0)
    expect(ds.drainChangedFields().size).toBe(0)
    expect(safeGetItem(localHistoryKey('grp-bump'))).toBeNull()
  })

  it('8. _deletedAttrMemberships 持久化到 localStorage 并在加载时恢复', () => {
    const ds = useDataStore()
    ds.customAttributes = [{ id: 'attr-test', name: '标签', type: 'boolean' }]
    ds.bookmarks = [
      {
        id: 'bm-with-attr',
        title: '测试',
        url: 'https://test.com',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'c1',
        parentId: null,
        order: 0,
        useCount: 0,
        attributes: { 'attr-test': true },
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]
    ds._syncMaps()

    // 软删属性
    ds.deleteAttribute('attr-test')

    // 验证 localStorage 持久化了 DAM_KEY
    const rawDam = safeGetItem(DAM_KEY)
    expect(rawDam).toBeTruthy()
    const damObj = JSON.parse(rawDam!)
    expect(damObj['attr-test']?.[0]?.entityId).toBe('bm-with-attr')

    // 模拟刷新重载：重置 store 内存态并加载
    ds._deletedAttrMemberships.clear()
    expect(ds._deletedAttrMemberships.size).toBe(0)

    ds._restoreDeletedAttrMemberships()
    expect(ds._deletedAttrMemberships.get('attr-test')?.length).toBe(1)

    // 恢复属性，书签成功拿回属性关联
    ds.restoreAttribute('attr-test')
    expect(ds.bookmarkMap['bm-with-attr'].attributes['attr-test']).toBe(true)
  })

  it('9. _filterAttrs 单趟过滤与属性缺失空安全保护', () => {
    const items = [
      { id: '1', attributes: { a: true, b: false } },
      { id: '2', attributes: { a: true, b: true } },
      { id: '3', attributes: undefined as any }, // 异常缺失 attributes 字段
    ]

    // 正常过滤
    const res = _filterAttrs(items, { activeAttrs: ['a'], excludedAttrs: ['b'] })
    expect(res.map(x => x.id)).toEqual(['1'])

    // 缺失 attributes 字段时不抛错
    expect(() => _filterAttrs(items, { activeAttrs: ['a'], excludedAttrs: [] })).not.toThrow()
  })

  it('10. _sortItems 空标题规范化，不产生字面量 "undefined" 排序键', () => {
    const items = [
      { id: '1', title: undefined as any, order: 0, useCount: 0, updatedAt: 0 },
      { id: '2', title: 'Apple', order: 1, useCount: 0, updatedAt: 0 },
      { id: '3', title: 'Zebra', order: 2, useCount: 0, updatedAt: 0 },
    ]

    _sortItems(items, { sortMode: 'title', sortDir: 'asc' }, 'title', 'updatedAt')

    // 空标题排在最前（按空字符串比较），而非排在 "u" 字母（"undefined"）处
    expect(items[0].id).toBe('1')
    expect(items[1].id).toBe('2')
    expect(items[2].id).toBe('3')
  })

  it('11. useMention 过滤软删除书签与组，空标题不抛错', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      {
        id: 'bm-alive',
        title: '活跃书签',
        url: 'https://alive.com',
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
      {
        id: 'bm-dead',
        title: '已删书签',
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
      },
      {
        id: 'bm-no-title',
        title: undefined as any,
        url: 'https://notitle.com',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'c1',
        parentId: null,
        order: 2,
        useCount: 0,
        attributes: {},
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]
    ds._syncMaps()

    const mentionStore = useMentionStore()
    mentionStore.open('g1')
    mentionStore.type = 'bm'

    const mention = useMention()
    expect(() => mention.showNear('书签')).not.toThrow()
    expect(mention.candidates.value.some(c => c.id === 'bm-dead')).toBe(false)
    expect(mention.candidates.value.some(c => c.id === 'bm-alive')).toBe(true)
  })

  it('12. addGroupRefToGroup 自引用防御', () => {
    const ds = useDataStore()
    const g: SiblingGroup = {
      id: 'g-self',
      name: '自引组',
      categoryId: 'c1',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '<p>内容</p>',
      updatedAt: 1000,
      useCount: 0,
    }
    ds.addGroup(g)

    // 尝试将 g-self 引用插入自身
    addGroupRefToGroup('g-self', 'g-self')

    // 内容保持原样，不追加自身引用
    expect(ds.groupMap['g-self'].notes).toBe('<p>内容</p>')
  })

  it('13. permanentDeleteBookmark 永久删除书签时自动从包含它的组中剔除并标脏', () => {
    const ds = useDataStore()
    const bm: Bookmark = {
      id: 'bm-gref',
      title: '组内书签',
      url: 'https://gref.example.com',
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
    const g: SiblingGroup = {
      id: 'g-has-bm',
      name: '包含书签的组',
      categoryId: 'c1',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: ['bm-gref', 'bm-other'],
      notes: '',
      updatedAt: 1000,
      useCount: 0,
    }
    ds.addBookmark(bm)
    ds.addGroup(g)
    ds._dirtyIds.clear()

    ds.permanentDeleteBookmark('bm-gref')

    const updatedG = ds.groupMap['g-has-bm']
    expect(updatedG.bookmarkIds).toEqual(['bm-other'])
    expect(ds._dirtyIds.has('g-has-bm')).toBe(true)
    expect(ds._changedFields.get('g-has-bm')?.has('bookmarkIds')).toBe(true)
  })

  it('14. permanentDeleteBookmark 解孤儿子书签时不误清除其属性快照', () => {
    const ds = useDataStore()
    const parent: Bookmark = {
      id: 'p-bm',
      title: '父',
      url: 'https://p.com',
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
    const child: Bookmark = {
      id: 'c-bm',
      title: '子',
      url: 'https://c.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'c1',
      parentId: 'p-bm',
      order: 1,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }
    ds.addBookmark(parent)
    ds.addBookmark(child)

    // 假设属性 tag-del 被删除，child 曾持有它
    ds._deletedAttrMemberships.set('tag-del', [{ entityId: 'c-bm', kind: 'bookmark' }])

    // 永久删除父书签：child 被解孤儿提升为顶级书签（存活）
    ds.permanentDeleteBookmark('p-bm')

    expect(ds.bookmarkMap['c-bm'].parentId).toBeNull()
    // 关键断言：存活的 child 不应被清除在 _deletedAttrMemberships 的记录
    const members = ds._deletedAttrMemberships.get('tag-del')
    expect(members?.some(m => m.entityId === 'c-bm')).toBe(true)
  })

  it('15. deleteCategory 软删除分类时自动将当前选中的 curCat 重置为 CAT_ALL', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const cat: Category = {
      id: 'c-active',
      name: '当前分类',
      icon: '',
      color: '',
      order: 0,
    }
    ds.addCategory(cat)
    ui.curCat = 'c-active'

    ds.deleteCategory('c-active')

    expect(ui.curCat).toBe(CAT_ALL)
  })

  it('16. _normalizeCategoryOrders 修正超界 order 时调用 _trackChange', () => {
    const ds = useDataStore()
    const cat: Category = {
      id: 'c-overflow',
      name: '超界分类',
      icon: '',
      color: '',
      order: 3000000000, // 超过 2147483647
    }
    ds.addCategory(cat)
    ds._changedFields.clear()

    ds._normalizeCategoryOrders()

    expect(cat.order).toBe(0)
    expect(ds._changedFields.get('c-overflow')?.has('order')).toBe(true)
  })

  it('17. saveUIState 在 shareMode 下严禁持久化 UI 状态，restoreUIState 忽略软删组聚焦', () => {
    const ui = useUIStore()
    const ds = useDataStore()
    // 模拟分享态
    ui.shareMode = { kind: 'group', id: 'share-g1' }
    ui.curCat = 'shared-cat'
    ui.saveUIState()

    // 本地并未保存 shared-cat
    expect(safeGetItem('linkvault_ui_state')).toBeNull()

    // 退出分享态后恢复 UI 状态，测试聚焦已软删组不被恢复
    ui.shareMode = null
    const deadGroup: SiblingGroup = {
      id: 'g-dead',
      name: '已删组',
      categoryId: 'c1',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '',
      updatedAt: 1000,
      useCount: 0,
      deletedAt: 2000,
    }
    ds.addGroup(deadGroup)

    safeSetItem('linkvault_ui_state', JSON.stringify({
      focusedGroupId: 'g-dead',
    }))

    ui.restoreUIState()
    expect(ui.focusedGroupId).toBeNull()
  })

  it('18. restoreSnapshot 执行期间设置 _restoring = true 阻止 pushUndo', () => {
    const ds = useDataStore()
    const g: SiblingGroup = {
      id: 'g-undo-test',
      name: '测试组',
      categoryId: 'c1',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '<p>初始</p>',
      updatedAt: 1000,
      useCount: 0,
    }
    ds.addGroup(g)

    restoreSnapshot('g-undo-test', {
      notes: '<p>已恢复</p>',
      bookmarkIds: [],
    })

    expect(ds.groupMap['g-undo-test'].notes).toBe('<p>已恢复</p>')
  })

  it('19. deleteBookmarkWithUndo 删除书签时联动关闭正在打开的编辑弹窗', async () => {
    const ds = useDataStore()
    const bm: Bookmark = {
      id: 'bm-modal-open',
      title: '编辑中书签',
      url: 'https://open.example.com',
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

    bmForm.isOpen = true
    bmForm.id = 'bm-modal-open'

    await deleteBookmarkWithUndo('bm-modal-open', true)

    expect(bmForm.isOpen).toBe(false)
  })

  it('20. batchDelete 与 batchMoveToCat 父子同选时使用 Set 去重', async () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const p: Bookmark = {
      id: 'bp',
      title: '父',
      url: 'https://bp.com',
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
    const c: Bookmark = {
      id: 'bc',
      title: '子',
      url: 'https://bc.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'c1',
      parentId: 'bp',
      order: 1,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 1000,
      updatedAt: 1000,
    }
    ds.addBookmark(p)
    ds.addBookmark(c)

    // 用户在 UI 上同时勾选了父和子
    ui.batchSelected = ['bp', 'bc']
    batchMoveToCat('c2')

    expect(ds.bookmarkMap['bp'].categoryId).toBe('c2')
    expect(ds.bookmarkMap['bc'].categoryId).toBe('c2')
    expect(ui.batchSelected.length).toBe(0)
    expect(ui.batchMode).toBe(false)
  })

  it('21. _mergeBookmarks 软删书签不阻断相同 URL 导入，不存在分类回退 CAT_UNCATEGORIZED', () => {
    const ds = useDataStore()
    const deadBm: Bookmark = {
      id: 'bm-trash',
      title: '已删',
      url: 'https://import-test.com',
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
    ds.addBookmark(deadBm)

    // 导入同 URL 书签，且带有不存在的分类 ghost-cat
    const res = _mergeBookmarks(ds, [
      {
        id: 'bm-new-imported',
        title: '全新导入',
        url: 'https://import-test.com',
        categoryId: 'ghost-cat',
      } as any
    ])

    expect(res.imported).toBe(1)
    expect(ds.bookmarkMap['bm-new-imported']).toBeDefined()
    expect(ds.bookmarkMap['bm-new-imported'].categoryId).toBe(CAT_UNCATEGORIZED)
  })

  it('22. resetToDefaults 清理 DGM_KEY 与 DAM_KEY 并在撤销重置时正确恢复', async () => {
    const ds = useDataStore()
    ds._deletedAttrMemberships.set('attr-old', [{ entityId: 'bm1', kind: 'bookmark' }])
    ds._deletedGroupMemberships.set('bm1', ['g1'])
    ds._persistDeletedAttrMemberships()
    ds._persistDeletedGroupMemberships()

    // 模拟重置
    ds._deletedAttrMemberships.clear()
    ds._deletedGroupMemberships.clear()
    safeSetItem(DGM_KEY, '[]')
    safeSetItem(DAM_KEY, '[]')

    expect(safeGetItem(DGM_KEY)).toBe('[]')
    expect(safeGetItem(DAM_KEY)).toBe('[]')
    expect(ds._deletedAttrMemberships.size).toBe(0)
    expect(ds._deletedGroupMemberships.size).toBe(0)
  })

  it('23. appStore.flushDebouncedSave 确保在途防抖历史被立即刷盘', async () => {
    const ds = useDataStore()
    const app = useAppStore()
    vi.spyOn(app, 'save').mockResolvedValue(true)
    const bm: Bookmark = {
      id: 'bm-app-flush',
      title: '旧名',
      url: 'https://flush2.example.com',
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
    ds.updateBookmark('bm-app-flush', { title: '新名' })

    const key = localHistoryKey('bm-app-flush')
    expect(safeGetItem(key)).toBeNull()

    await app.flushDebouncedSave()

    const raw = safeGetItem(key)
    expect(raw).toBeTruthy()
    const hist = JSON.parse(raw!)
    expect(hist[0].data.title).toBe('旧名')
  })

  it('24. _swapAndMarkDirty 交换 _customCardOrder 时更新为全新引用以触发响应式', () => {
    const ds = useDataStore()
    const a = { id: 'b1', order: 0 }
    const b = { id: 'b2', order: 1 }
    ds._customCardOrder = [{ t: 'b', id: 'b1' }, { t: 'b', id: 'b2' }]
    const origOrderRef = ds._customCardOrder

    _swapAndMarkDirty(a, b)

    expect(ds._customCardOrder).not.toBe(origOrderRef)
    expect(ds._customCardOrder).toEqual([{ t: 'b', id: 'b2' }, { t: 'b', id: 'b1' }])
  })

  it('25. deleteGroup 与 permanentDeleteGroup 自动清理 focusedGroupId 与 detailCards', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const g: SiblingGroup = {
      id: 'g-focus-del',
      name: '聚焦中组',
      categoryId: 'c1',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '',
      updatedAt: 1000,
      useCount: 0,
    }
    ds.addGroup(g)
    ui.focusedGroupId = 'g-focus-del'
    ui.detailCards = ['group:g-focus-del', 'bm-1']

    ds.deleteGroup('g-focus-del')

    expect(ui.focusedGroupId).toBeNull()
    expect(ui.detailCards).toEqual(['bm-1'])
  })

  it('26. deleteBookmark 与 permanentDeleteBookmark 自动清理 quickLook 与 detailCards', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const bm: Bookmark = {
      id: 'bm-ql-del',
      title: '速览中书签',
      url: 'https://ql.com',
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
    ui.quickLookBmId = 'bm-ql-del'
    ui.modals.quickLook = true
    ui.detailCards = ['bm-ql-del', 'group:g1']

    ds.deleteBookmark('bm-ql-del')

    expect(ui.quickLookBmId).toBeNull()
    expect(ui.modals.quickLook).toBe(false)
    expect(ui.detailCards).toEqual(['group:g1'])
  })

  it('27. childrenMap 回退分支正确排除父书签已删除或不存在的幽灵映射', () => {
    const ds = useDataStore()
    const parentAlive: Bookmark = {
      id: 'p-alive', title: 'Parent Alive', url: 'https://p1.com',
      username: '', password: '', notes: '', icon: '', categoryId: 'c1',
      parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false,
      createdAt: 1000, updatedAt: 1000,
    }
    const parentDead: Bookmark = {
      id: 'p-dead', title: 'Parent Dead', url: 'https://p2.com',
      username: '', password: '', notes: '', icon: '', categoryId: 'c1',
      parentId: null, order: 1, useCount: 0, attributes: {}, isExpanded: false,
      createdAt: 1000, updatedAt: 1000, deletedAt: 2000,
    }
    const child1: Bookmark = {
      id: 'c-1', title: 'Child 1', url: 'https://c1.com',
      username: '', password: '', notes: '', icon: '', categoryId: 'c1',
      parentId: 'p-alive', order: 0, useCount: 0, attributes: {}, isExpanded: false,
      createdAt: 1000, updatedAt: 1000,
    }
    const child2: Bookmark = {
      id: 'c-2', title: 'Child 2', url: 'https://c2.com',
      username: '', password: '', notes: '', icon: '', categoryId: 'c1',
      parentId: 'p-dead', order: 1, useCount: 0, attributes: {}, isExpanded: false,
      createdAt: 1000, updatedAt: 1000,
    }
    const child3: Bookmark = {
      id: 'c-3', title: 'Child 3', url: 'https://c3.com',
      username: '', password: '', notes: '', icon: '', categoryId: 'c1',
      parentId: 'p-nonexistent', order: 2, useCount: 0, attributes: {}, isExpanded: false,
      createdAt: 1000, updatedAt: 1000,
    }

    ds.bookmarks = [parentAlive, parentDead, child1, child2, child3]
    ds._syncMaps()
    // 人为模拟 _childrenIdx 尚未就绪的回退分支场景
    ds._childrenIdx = {}

    const cm = ds.childrenMap
    expect(cm['p-alive']).toHaveLength(1)
    expect(cm['p-alive'][0].id).toBe('c-1')
    expect(cm['p-dead']).toBeUndefined()
    expect(cm['p-nonexistent']).toBeUndefined()
  })

  it('28. saveBm 在 categoryId 为空字符串时兜底为 CAT_UNCATEGORIZED', async () => {
    const ds = useDataStore()
    const { bmForm, saveBm } = await import('../../composables/domain/useBookmark.js')
    const { CAT_UNCATEGORIZED } = await import('../../config/constants.js')

    bmForm.isOpen = true
    bmForm.id = ''
    bmForm.title = '未分类书签'
    bmForm.url = 'https://uncat.example.com'
    bmForm.categoryId = ''
    bmForm.username = ''
    bmForm.password = ''
    bmForm.notes = ''
    bmForm.icon = ''
    bmForm.iconDark = ''
    bmForm.parentId = ''
    bmForm.attributes = {}

    await saveBm()

    const added = ds.bookmarks.find(b => b.url === 'https://uncat.example.com')
    expect(added).toBeDefined()
    expect(added?.categoryId).toBe(CAT_UNCATEGORIZED)
  })
})
