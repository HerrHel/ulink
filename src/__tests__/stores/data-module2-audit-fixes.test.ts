/**
 * 模块 2（数据层与 Pinia Stores 核心数据流）深度补漏与审计修复回归测试
 *
 * 覆盖重点：
 * 1. 内置分类保护：deleteCategory / permanentDeleteCategory 坚决拦截 'all' 与 'uncategorized'
 * 2. 异步历史防抖保护：_saveLocalHistory 在异步脱离 Pinia 上下文时优雅降级，不抛全局异常
 * 3. 分类空值归一化：cardCounts、filteredBookmarks、filteredGroups 对 categoryId: '' 安全兼容
 * 4. 父子书签防自环死循环：updateBookmark 拦截 parentId === id 并归一为 null
 * 5. 空间切换双语名称：switchSpace 面对英文环境生成 'All' 与 'Uncategorized' 基础分类
 * 6. 纯函数排序健壮性：_sortItems 面对缺失 useCount 或 order 时稳定排序，不产生 NaN
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useUndoStore } from '../../stores/undo.js'
import { CAT_ALL, CAT_UNCATEGORIZED, ATTR_IS_GROUP } from '../../config/constants.js'
import { _sortItems } from '../../lib/dataQuery.js'
import { setLocale } from '../../i18n/index.js'
import type { Bookmark } from '../../types.js'

describe('模块 2 补漏：内置分类防删保护', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('deleteCategory 禁止软删除内置分类 CAT_ALL 与 CAT_UNCATEGORIZED', () => {
    const ds = useDataStore()
    ds.categories = [
      { id: CAT_ALL, name: '全部', icon: 'grid', color: '#122E8A', order: 0 },
      { id: CAT_UNCATEGORIZED, name: '未分类', icon: 'bookmark', color: '#6E6860', order: 1 },
      { id: 'custom_cat', name: '自定义', icon: 'tool', color: '#ff0000', order: 2 },
    ]
    ds._syncMaps()

    // 尝试删除内置分类
    ds.deleteCategory(CAT_ALL)
    ds.deleteCategory(CAT_UNCATEGORIZED)

    // 内置分类必须依然未被软删
    expect(ds._catMap[CAT_ALL].deletedAt).toBeUndefined()
    expect(ds._catMap[CAT_UNCATEGORIZED].deletedAt).toBeUndefined()

    // 自定义分类允许删除
    ds.deleteCategory('custom_cat')
    expect(ds._catMap['custom_cat'].deletedAt).toBeDefined()
  })

  it('permanentDeleteCategory 禁止永久物理删除内置分类', () => {
    const ds = useDataStore()
    ds.categories = [
      { id: CAT_ALL, name: '全部', icon: 'grid', color: '#122E8A', order: 0 },
      { id: CAT_UNCATEGORIZED, name: '未分类', icon: 'bookmark', color: '#6E6860', order: 1 },
      { id: 'custom_cat', name: '自定义', icon: 'tool', color: '#ff0000', order: 2 },
    ]
    ds._syncMaps()

    ds.permanentDeleteCategory(CAT_ALL)
    ds.permanentDeleteCategory(CAT_UNCATEGORIZED)

    expect(ds.categories.some(c => c.id === CAT_ALL)).toBe(true)
    expect(ds.categories.some(c => c.id === CAT_UNCATEGORIZED)).toBe(true)
  })
})

describe('模块 2 补漏：分类空值归一化与计数准确性', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('cardCounts 将 categoryId 为空串的书签与组正确计入未分类，消除计数偏差', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      { id: 'b1', title: '有分类', url: 'https://b1.com', categoryId: 'cat1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'b2', title: '空分类', url: 'https://b2.com', categoryId: '', order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
      { id: 'b3', title: '未分类', url: 'https://b3.com', categoryId: CAT_UNCATEGORIZED, order: 2, useCount: 0, createdAt: 3, updatedAt: 3, attributes: {} },
    ] as any
    ds.siblingGroups = [
      { id: 'g1', name: '空分类组', categoryId: '', order: 0, useCount: 0, bookmarkIds: [], updatedAt: 1, attributes: {} },
    ] as any

    const counts = ds.cardCounts
    expect(counts[CAT_ALL]).toBe(4)
    expect(counts['cat1']).toBe(1)
    // 两个空分类 + 一个显式 uncategorized = 3
    expect(counts[CAT_UNCATEGORIZED]).toBe(3)
    expect(counts['']).toBeUndefined()
  })

  it('filteredBookmarks 在选中未分类时能正确展示 categoryId 为空串的书签', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ds.bookmarks = [
      { id: 'b_empty', title: '空串书签', url: 'https://empty.com', categoryId: '', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'b_uncat', title: '显式未分类', url: 'https://uncat.com', categoryId: CAT_UNCATEGORIZED, order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
      { id: 'b_other', title: '其它', url: 'https://other.com', categoryId: 'other', order: 2, useCount: 0, createdAt: 3, updatedAt: 3, attributes: {} },
    ] as any

    ui.curCat = CAT_UNCATEGORIZED
    const filtered = ds.filteredBookmarks
    expect(filtered.map(b => b.id).sort()).toEqual(['b_empty', 'b_uncat'].sort())
  })
})

describe('模块 2 补漏：父子书签防自环死循环', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('updateBookmark 拦截 parentId === id，自动归一为 parentId: null', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      { id: 'bm_self', title: '自引用测试', url: 'https://self.com', categoryId: 'cat1', parentId: null, order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
    ] as Bookmark[]
    ds._syncMaps()

    // 试图把自己的 parentId 指向自己
    ds.updateBookmark('bm_self', { parentId: 'bm_self' })

    const updated = ds.bookmarkMap['bm_self']
    expect(updated.parentId).toBeNull()
    // 索引中绝不能包含自身作为自己的子书签
    expect(ds._childrenIdx['bm_self']).toBeUndefined()
  })
})

describe('模块 2 补漏：空间切换与双语分类名称', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('switchSpace 在英文环境下生成 All 与 Uncategorized 分类', async () => {
    setLocale('en-US')
    const ds = useDataStore()
    await ds.switchSpace('vault')

    expect(ds.categories.some(c => c.id === CAT_ALL && c.name === 'All')).toBe(true)
    expect(ds.categories.some(c => c.id === CAT_UNCATEGORIZED && c.name === 'Uncategorized')).toBe(true)

    // 切回中文环境恢复
    setLocale('zh-CN')
    await ds.switchSpace('main')
  })
})

describe('模块 2 补漏：纯函数排序健壮性', () => {
  it('_sortItems 面对缺失 useCount 或 order 时稳定排序不产生 NaN', () => {
    const items = [
      { id: '1', title: 'B', useCount: undefined as any, order: undefined as any, updatedAt: 100 },
      { id: '2', title: 'A', useCount: 10, order: 5, updatedAt: 200 },
      { id: '3', title: 'C', useCount: 20, order: 1, updatedAt: 300 },
    ]

    // 按 useCount 排序
    expect(() => {
      _sortItems(items, { sortMode: 'useCount', sortDir: 'asc' }, 'title', 'updatedAt')
    }).not.toThrow()
    // undefined useCount 兜底为 0，排在最前
    expect(items[0].id).toBe('1')

    // 按 order 排序
    expect(() => {
      _sortItems(items, { sortMode: 'order', sortDir: 'asc' }, 'title', 'updatedAt')
    }).not.toThrow()
    // undefined order 兜底为 0，排在最前
    expect(items[0].id).toBe('1')
  })
})

describe('模块 2 补漏第二阶段：_masterCanary 快照与指纹防漏写', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('_dataSnapshot 提取与 importFromData 还原 _masterCanary 契约', () => {
    const ds = useDataStore()
    ds._masterCanary = 'canary_hash_test_123'
    const snap = ds._dataSnapshot()
    expect(snap._masterCanary).toBe('canary_hash_test_123')

    // 重新 import 时保持 canary
    const ds2 = useDataStore()
    ds2.importFromData(snap)
    expect(ds2._masterCanary).toBe('canary_hash_test_123')
  })

  it('_fingerprint 在 canary 变化时生成不同指纹以打断保存早退', async () => {
    const { _fingerprint } = await import('../../stores/app.js')
    const appDataNoCanary = {
      bookmarks: [],
      siblingGroups: [],
      categories: [],
      customAttributes: [],
    }
    const fp1 = _fingerprint(appDataNoCanary)

    const appDataWithCanary = {
      ...appDataNoCanary,
      _masterCanary: 'canary_v1',
    }
    const fp2 = _fingerprint(appDataWithCanary)
    expect(fp1).not.toBe(fp2)

    const appDataWithEncryptedCanary = {
      ...appDataNoCanary,
      _masterCanary: { encrypted: true, data: 'ciphertext', iv: 'iv123', salt: 'salt123' },
    }
    const fp3 = _fingerprint(appDataWithEncryptedCanary as any)
    expect(fp2).not.toBe(fp3)
  })
})

describe('模块 2 补漏第二阶段：删除时 batchSelected 幽灵 ID 清理与状态同步', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('deleteBookmark 与 permanentDeleteBookmark 自动剔除 batchSelected', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ds.bookmarks = [
      { id: 'b1', title: 'B1', url: 'https://b1.com', categoryId: 'c1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'b2', title: 'B2', url: 'https://b2.com', categoryId: 'c1', order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
    ] as any
    ds._syncMaps()

    ui.batchSelected = ['b1', 'b2']
    ds.deleteBookmark('b1')
    expect(ui.batchSelected).toEqual(['b2'])

    ds.permanentDeleteBookmark('b2')
    expect(ui.batchSelected).toEqual([])
  })

  it('deleteGroup 与 permanentDeleteGroup 自动剔除 batchSelected 并联动 shareModal 与 undoStack', async () => {
    const { useUndoStore } = await import('../../stores/undo.js')
    const ds = useDataStore()
    const ui = useUIStore()
    const undo = useUndoStore()

    ds.siblingGroups = [
      { id: 'g1', name: 'G1', categoryId: 'c1', order: 0, useCount: 0, bookmarkIds: [], updatedAt: 1, attributes: {} },
      { id: 'g2', name: 'G2', categoryId: 'c1', order: 1, useCount: 0, bookmarkIds: [], updatedAt: 2, attributes: {} },
    ] as any
    ds._syncMaps()

    // 模拟 undo stack 挂载与 shareModalTarget 打开
    undo.ensureStack('g1')
    ui.shareModalTarget = { type: 'group', id: 'g1' }
    ui.batchSelected = ['group:g1', 'group:g2']

    ds.deleteGroup('g1')
    expect(ui.batchSelected).toEqual(['group:g2'])
    expect(ui.shareModalTarget).toBeNull()

    // permanentDeleteGroup 清理剩余 batchSelected 与 undo 栈
    undo.ensureStack('g2')
    expect(undo.stacks['g2']).toBeDefined()
    ds.permanentDeleteGroup('g2')
    expect(ui.batchSelected).toEqual([])
    expect(undo.stacks['g2']).toBeUndefined()
  })

  it('deleteCategory 与 permanentDeleteCategory 联动关闭 shareModalTarget', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ds.categories = [
      { id: 'cat1', name: 'Cat1', icon: 'tool', color: '#fff', order: 0 },
      { id: 'cat2', name: 'Cat2', icon: 'tool', color: '#fff', order: 1 },
    ]
    ds._syncMaps()

    ui.shareModalTarget = { type: 'category', id: 'cat1' }
    ds.deleteCategory('cat1')
    expect(ui.shareModalTarget).toBeNull()

    ui.shareModalTarget = { type: 'category', id: 'cat2' }
    ds.permanentDeleteCategory('cat2')
    expect(ui.shareModalTarget).toBeNull()
  })

  it('_syncMaps 与 childrenMap 面对脏数据 parentId === id 时的防自环防御', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      { id: 'self_loop', title: 'Self Loop', url: 'https://test.com', categoryId: 'c1', parentId: 'self_loop', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
    ] as any
    ds._syncMaps()

    // _childrenIdx 绝不能把自身放进自身子级
    expect(ds._childrenIdx['self_loop']).toBeUndefined()

    // childrenMap getter 回退分支也同样防御自环
    const map = ds.childrenMap
    expect(map['self_loop']).toBeUndefined()
  })
})

describe('模块 2 补漏第三阶段：历史清理、空间隔离、间接防环与类型健壮性', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('permanentDeleteBookmark 清理本地历史 localStorage 并注销未入库防抖', async () => {
    const { localHistoryKey } = await import('../../stores/storage.js')
    const { safeSetItem, safeGetItem } = await import('../../lib/storageSafe.js')
    const ds = useDataStore()

    const bId = 'bm_perm_del_test'
    ds.bookmarks = [
      { id: bId, title: 'To Delete', url: 'https://del.com', categoryId: 'c1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
    ] as any
    ds._syncMaps()

    // 预先写入本地历史版本
    const histKey = localHistoryKey(bId)
    safeSetItem(histKey, JSON.stringify([{ id: 1, data: { title: 'old' }, created_at: '' }]))
    expect(safeGetItem(histKey)).toBeTruthy()

    // 执行物理删除
    ds.permanentDeleteBookmark(bId)
    // 本地历史必须被彻底移除，不留垃圾与隐私隐患
    expect(safeGetItem(histKey)).toBeNull()
  })

  it('switchSpace 切换数据空间时彻底清空 UI 选区、详情卡片与搜索过滤上下文', async () => {
    const ds = useDataStore()
    const ui = useUIStore()

    ui.curSpace = 'main'
    ui.curCat = 'custom_cat'
    ui.batchMode = true
    ui.batchSelected = ['b1', 'b2']
    ui.detailCards = ['b1']
    ui.editingId = 'b1'
    ui.activeAttrs = ['attr1']
    ui.excludedAttrs = ['attr2']
    ui.searchQuery = 'keyword'

    await ds.switchSpace('vault')

    expect(ui.curSpace).toBe('vault')
    expect(ui.curCat).toBe('all')
    expect(ui.batchMode).toBe(false)
    expect(ui.batchSelected).toEqual([])
    expect(ui.detailCards).toEqual([])
    expect(ui.editingId).toBeNull()
    expect(ui.activeAttrs).toEqual([])
    expect(ui.excludedAttrs).toEqual([])
    expect(ui.searchQuery).toBe('')

    // 切回 main 恢复初始环境
    await ds.switchSpace('main')
  })

  it('updateBookmark 深度防御间接循环引用（A -> B -> A）及孤儿父节点', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      { id: 'b_a', title: 'A', url: 'https://a.com', categoryId: 'c1', parentId: null, order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'b_b', title: 'B', url: 'https://b.com', categoryId: 'c1', parentId: 'b_a', order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
    ] as any
    ds._syncMaps()

    // 此时 A 是 B 的父节点。现在试图把 A 的 parentId 改为 B（制造 A -> B -> A 循环）
    ds.updateBookmark('b_a', { parentId: 'b_b' })
    // 间接环路被阻断，强制收敛为 null，避免双双隐身失踪
    expect(ds._bmMap['b_a'].parentId).toBeNull()

    // 试图把 parentId 设为一个不存在的孤儿 ID，_syncMaps 重建索引时自愈收敛为 null
    ds.updateBookmark('b_a', { parentId: 'ghost_parent' })
    ds._syncMaps()
    expect(ds._bmMap['b_a'].parentId).toBeNull()
  })

  it('restoreBookmark 恢复父书签时立即为其重建 _childrenIdx，子书签即时可见', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      { id: 'p1', title: 'Parent', url: 'https://p.com', categoryId: 'c1', deletedAt: 12345, order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'c1', title: 'Child', url: 'https://c.com', categoryId: 'c1', parentId: 'p1', order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
    ] as any
    ds._syncMaps()

    // 初始状态下由于父被删，父没有 _childrenIdx
    expect(ds._childrenIdx['p1']).toBeUndefined()

    // 恢复父书签
    ds.restoreBookmark('p1')
    // _childrenIdx 必须立即被恢复，使子书签在展开时即刻可见
    expect(ds._childrenIdx['p1']).toEqual(['c1'])
  })

  it('addGroup 与 updateGroup 对非数组 bookmarkIds 容错归一为真数组', () => {
    const ds = useDataStore()
    ds.addGroup({
      id: 'g_safe',
      name: 'Safe Group',
      categoryId: 'c1',
      icon: 'folder',
      isExpanded: false,
      order: 0,
      useCount: 0,
      bookmarkIds: undefined as any,
      attributes: {},
      notes: '',
      updatedAt: 1,
    })

    const added = ds._grpMap['g_safe']
    expect(Array.isArray(added.bookmarkIds)).toBe(true)
    expect(added.bookmarkIds).toEqual([])

    ds.updateGroup('g_safe', { bookmarkIds: null as any })
    expect(Array.isArray(ds._grpMap['g_safe'].bookmarkIds)).toBe(true)
  })
})

describe('模块 2 补漏第四阶段：分类改名防篡改、关系快照隔离、回收站健壮性与展开态清理', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renameCategory 坚决拦截对系统内置虚拟分类 CAT_ALL 与 CAT_UNCATEGORIZED 的改名', () => {
    const ds = useDataStore()
    ds.categories = [
      { id: CAT_ALL, name: '全部', icon: 'grid', color: '#122E8A', order: 0 },
      { id: CAT_UNCATEGORIZED, name: '未分类', icon: 'bookmark', color: '#6E6860', order: 1 },
      { id: 'custom_cat', name: '原名', icon: 'tool', color: '#fff', order: 2 },
    ]
    ds._syncMaps()

    ds.renameCategory(CAT_ALL, '被篡改全部')
    ds.renameCategory(CAT_UNCATEGORIZED, '被篡改未分类')
    expect(ds._catMap[CAT_ALL].name).toBe('全部')
    expect(ds._catMap[CAT_UNCATEGORIZED].name).toBe('未分类')

    ds.renameCategory('custom_cat', '新名')
    expect(ds._catMap['custom_cat'].name).toBe('新名')
  })

  it('switchSpace 切换空间时清空 _deletedGroupMemberships 与 _deletedAttrMemberships 保证空间物理隔离', async () => {
    const ds = useDataStore()
    ds._deletedGroupMemberships.set('bm_main_del', ['g1'])
    ds._deletedAttrMemberships.set('attr_main', [{ entityId: 'bm1', kind: 'bookmark' }])

    await ds.switchSpace('vault')
    expect(ds._deletedGroupMemberships.size).toBe(0)
    expect(ds._deletedAttrMemberships.size).toBe(0)

    // 切回 main 恢复初始环境
    await ds.switchSpace('main')
  })

  it('回收站 Getters 健壮性：时间倒序、排除内置分类与内置笔记属性', async () => {
    const { ATTR_IS_GROUP } = await import('../../config/constants.js')
    const ds = useDataStore()

    // 注入包含内置实体被污染带有 deletedAt 的脏数据
    ds.categories = [
      { id: CAT_ALL, name: '全部', icon: 'grid', color: '#122E8A', order: 0, deletedAt: 100 } as any,
      { id: 'cat1', name: 'Cat1', icon: 'tool', color: '#fff', order: 1, deletedAt: 200 },
      { id: 'cat2', name: 'Cat2', icon: 'tool', color: '#fff', order: 2, deletedAt: 300 },
    ]
    ds.customAttributes = [
      { id: ATTR_IS_GROUP, name: 'Note', type: 'boolean', deletedAt: 100 } as any,
      { id: 'attr1', name: 'Attr1', type: 'boolean', deletedAt: 200 },
      { id: 'attr2', name: 'Attr2', type: 'boolean', deletedAt: 400 },
    ]

    const trashedCats = ds.trashedCategories
    expect(trashedCats.some(c => c.id === CAT_ALL)).toBe(false)
    // 按时间倒序
    expect(trashedCats.map(c => c.id)).toEqual(['cat2', 'cat1'])

    const trashedAttrs = ds.trashedAttributes
    expect(trashedAttrs.some(a => a.id === ATTR_IS_GROUP)).toBe(false)
    // 按时间倒序
    expect(trashedAttrs.map(a => a.id)).toEqual(['attr2', 'attr1'])
  })

  it('删除书签与组时即时清理 ui.expandedIds 幽灵展开状态', () => {
    const ds = useDataStore()
    const ui = useUIStore()

    ds.bookmarks = [
      { id: 'bm_exp1', title: 'BM1', url: 'https://1.com', categoryId: 'c1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'bm_exp2', title: 'BM2', url: 'https://2.com', categoryId: 'c1', order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
    ] as any
    ds.siblingGroups = [
      { id: 'grp_exp1', name: 'G1', categoryId: 'c1', order: 0, useCount: 0, bookmarkIds: [], updatedAt: 1, attributes: {} },
      { id: 'grp_exp2', name: 'G2', categoryId: 'c1', order: 1, useCount: 0, bookmarkIds: [], updatedAt: 2, attributes: {} },
    ] as any
    ds._syncMaps()

    ui.expandedIds = ['bm_exp1', 'bm_exp2', 'grp_exp1', 'grp_exp2']

    // 软删书签与组
    ds.deleteBookmark('bm_exp1')
    expect(ui.expandedIds).toEqual(['bm_exp2', 'grp_exp1', 'grp_exp2'])

    ds.deleteGroup('grp_exp1')
    expect(ui.expandedIds).toEqual(['bm_exp2', 'grp_exp2'])

    // 物理删除书签与组
    ds.permanentDeleteBookmark('bm_exp2')
    expect(ui.expandedIds).toEqual(['grp_exp2'])

    ds.permanentDeleteGroup('grp_exp2')
    expect(ui.expandedIds).toEqual([])
  })
})

describe('模块 2 补漏第五阶段：QuickLook 联动关闭、历史栈清理与防抖序列化安全隔离', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('删除组与书签时联动关闭 QuickLook 抽屉并从 quickLookHistory 历史栈中移除', () => {
    const ds = useDataStore()
    const ui = useUIStore()

    ds.siblingGroups = [
      { id: 'g_ql1', name: 'G1', categoryId: 'c1', order: 0, useCount: 0, bookmarkIds: [], updatedAt: 1, attributes: {} },
      { id: 'g_ql2', name: 'G2', categoryId: 'c1', order: 1, useCount: 0, bookmarkIds: [], updatedAt: 2, attributes: {} },
    ] as any
    ds.bookmarks = [
      { id: 'b_ql1', title: 'B1', url: 'https://1.com', categoryId: 'c1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
    ] as any
    ds._syncMaps()

    // 1. 测试组删除联动关闭当前 QuickLook
    ui.openQuickLook('group:g_ql1')
    expect(ui.quickLookBmId).toBe('group:g_ql1')
    expect(ui.modals.quickLook).toBe(true)

    ds.deleteGroup('g_ql1')
    // 当前速览已删组应自动关闭
    expect(ui.quickLookBmId).toBeNull()
    expect(ui.modals.quickLook).toBe(false)

    // 2. 测试组永久删除从 quickLookHistory 历史栈中移除
    ui.openQuickLook('b_ql1')
    ui.openQuickLook('group:g_ql2')
    expect(ui.quickLookHistory).toContain('b_ql1')

    // 再看历史栈包含 group:g_ql2 的场景
    ui.openQuickLook('other_card')
    expect(ui.quickLookHistory).toContain('group:g_ql2')

    ds.permanentDeleteGroup('g_ql2')
    expect(ui.quickLookHistory.includes('group:g_ql2')).toBe(false)

    // 3. 测试书签删除从 quickLookHistory 移除
    ds.deleteBookmark('b_ql1')
    expect(ui.quickLookHistory.includes('b_ql1')).toBe(false)
  })

  it('_flushPendingHist 在单项数据序列化异常时安全隔离，不中断其它项落库', async () => {
    const { _flushPendingHist, _histDebounceData, _histDebounceTimers } = await import('../../stores/dataShared.js')
    const { localHistoryKey } = await import('../../stores/storage.js')
    const { safeGetItem } = await import('../../lib/storageSafe.js')

    // 构造一个包含循环引用的不可序列化异常对象
    const circularData: Record<string, unknown> = { name: 'circular' }
    circularData.self = circularData

    const validData: Record<string, unknown> = { name: 'valid_data' }

    _histDebounceData.set('item_bad', circularData)
    _histDebounceTimers.set('item_bad', setTimeout(() => {}, 10000))

    _histDebounceData.set('item_good', validData)
    _histDebounceTimers.set('item_good', setTimeout(() => {}, 10000))

    // 预期：_flushPendingHist 不向外抛异常，且 item_good 正常写入
    expect(() => _flushPendingHist()).not.toThrow()

    const goodHist = safeGetItem(localHistoryKey('item_good'))
    expect(goodHist).toContain('valid_data')
  })

  it('getSpaceSnapshot 在 IDB 返回 null 时平滑回退到 localStorage，防止无意覆写', async () => {
    const ds = useDataStore()
    const { safeSetItem } = await import('../../lib/storageSafe.js')
    const persist = await import('../../stores/persist.js')
    const { vi } = await import('vitest')

    // 模拟 localStorage 中存在 vault 数据，而 IDB 尚未持久化（如首次离线或隐私模式）
    const localVaultData = {
      bookmarks: [{ id: 'b_vault_local', title: 'Local Vault Bm', url: 'https://v.local', categoryId: 'c1', order: 0, useCount: 0, attributes: {} }],
      siblingGroups: [],
      categories: [{ id: 'c1', name: 'Cat 1', icon: 'grid', color: '#000', order: 0 }],
      customAttributes: [],
    }
    safeSetItem('linkvault_vault_v1', JSON.stringify(localVaultData))

    // Mock loadFromIDB 返回 null（模拟 IDB 无数据或隐私模式）
    const idbSpy = vi.spyOn(persist, 'loadFromIDB').mockResolvedValue(null)

    const snapshot = await ds.getSpaceSnapshot('vault')
    expect(snapshot).not.toBeNull()
    expect(snapshot?.bookmarks?.length).toBe(1)
    expect(snapshot?.bookmarks?.[0]?.id).toBe('b_vault_local')

    idbSpy.mockRestore()
  })

  it('_syncMaps 自动自愈悬空孤儿书签与自环书签', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      // 1. 悬空孤儿（父节点不存在）
      { id: 'b_orphan', title: 'Orphan', url: 'https://orphan.com', categoryId: 'c1', parentId: 'ghost_parent', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      // 2. 自环书签
      { id: 'b_self', title: 'Self Loop', url: 'https://self.com', categoryId: 'c1', parentId: 'b_self', order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
      // 3. 正常书签
      { id: 'b_normal', title: 'Normal', url: 'https://normal.com', categoryId: 'c1', parentId: null, order: 2, useCount: 0, createdAt: 3, updatedAt: 3, attributes: {} },
    ] as any

    ds._syncMaps()

    // 悬空孤儿与自环在 _syncMaps 中自动将 parentId 纠偏为 null
    expect(ds._bmMap['b_orphan'].parentId).toBeNull()
    expect(ds._bmMap['b_self'].parentId).toBeNull()
    expect(ds._bmMap['b_normal'].parentId).toBeNull()
  })

  it('nextBookmarkOrder 面对超界历史时间戳 order 能够安全忽略并收敛为合法序号', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      { id: 'b_normal_1', title: 'B1', url: 'https://1.com', categoryId: 'c1', order: 10, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'b_normal_2', title: 'B2', url: 'https://2.com', categoryId: 'c1', order: 25, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
      // 存量历史超大时间戳 order（毫秒级，超过 PG int4 上限 2147483647）
      { id: 'b_ts_overflow', title: 'B_TS', url: 'https://ts.com', categoryId: 'c1', order: 1731000000000, useCount: 0, createdAt: 3, updatedAt: 3, attributes: {} },
    ] as any

    const nextOrder = ds.nextBookmarkOrder()
    // 应该忽略 > 2147483647 的时间戳，取正常项最大值 25 + 1 = 26
    expect(nextOrder).toBe(26)
  })

  it('batchPatchBookmarkAttributes 严格跳过已软删除书签，保护同步墓碑', () => {
    const ds = useDataStore()
    const now = 100000
    ds.bookmarks = [
      { id: 'bm_active', title: 'Active', url: 'https://a.com', categoryId: 'c1', order: 0, useCount: 0, attributes: {}, createdAt: 1, updatedAt: now },
      { id: 'bm_deleted', title: 'Deleted', url: 'https://d.com', categoryId: 'c1', order: 1, useCount: 0, attributes: {}, createdAt: 2, updatedAt: now, deletedAt: now },
    ] as any
    ds._syncMaps()
    ds._dirtyIds.clear()

    ds.batchPatchBookmarkAttributes({
      bm_active: { attr_dead: true },
      bm_deleted: { attr_dead: true },
    })

    // 活动书签应被打标且 updatedAt 被更新、标脏
    expect(ds._bmMap['bm_active'].attributes['attr_dead']).toBe(true)
    expect(ds._bmMap['bm_active'].updatedAt).toBeGreaterThan(now)
    expect(ds._dirtyIds.has('bm_active')).toBe(true)

    // 已软删除书签必须被严格跳过，属性不变、updatedAt 不变、不进入 _dirtyIds 避免复活
    expect(ds._bmMap['bm_deleted'].attributes['attr_dead']).toBeUndefined()
    expect(ds._bmMap['bm_deleted'].updatedAt).toBe(now)
    expect(ds._dirtyIds.has('bm_deleted')).toBe(false)
  })

  it('_normalizeCategoryOrders 面对 NaN、非有限数值及负数 order 能平滑自愈收敛', () => {
    const ds = useDataStore()
    ds.categories = [
      { id: 'cat_nan', name: 'NaN Cat', icon: 'folder', color: '#000', order: NaN },
      { id: 'cat_neg', name: 'Neg Cat', icon: 'folder', color: '#000', order: -5 },
      { id: 'cat_valid_1', name: 'Valid 1', icon: 'folder', color: '#000', order: 2 },
      { id: 'cat_valid_2', name: 'Valid 2', icon: 'folder', color: '#000', order: 3 },
    ] as any
    ds._syncMaps()

    ds._normalizeCategoryOrders()

    // 所有分类的 order 都应自愈为从 0 开始的非负有限整数
    for (let i = 0; i < ds.categories.length; i++) {
      const ord = ds.categories[i].order
      expect(Number.isFinite(ord)).toBe(true)
      expect(ord).toBeGreaterThanOrEqual(0)
    }
    // 归一化后 order 必须单调递增连续 [0, 1, 2, 3]
    expect(ds.categories.map(c => c.order)).toEqual([0, 1, 2, 3])
  })

  it('updateBookmark 面对脏数据中已存在的间接死循环能安全跳出，不造成主线程假死', () => {
    const ds = useDataStore()
    // 构造一个现存的 B <-> C 互相引用的死循环脏数据
    ds.bookmarks = [
      { id: 'b_root', title: 'Root', url: 'https://r.com', categoryId: 'c1', parentId: null, order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'b_loop_1', title: 'L1', url: 'https://l1.com', categoryId: 'c1', parentId: 'b_loop_2', order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
      { id: 'b_loop_2', title: 'L2', url: 'https://l2.com', categoryId: 'c1', parentId: 'b_loop_1', order: 2, useCount: 0, createdAt: 3, updatedAt: 3, attributes: {} },
    ] as any
    ds._syncMaps()

    // 将 b_root 的 parentId 改为 b_loop_1。由于 b_loop_1 和 b_loop_2 形成循环且不包含 b_root，
    // 旧实现 ancestorId while 循环将永远无法遇到 b_root 也无法归 null，导致无限死循环假死。
    // 修复后 visited 集合拦截死循环，安全跳出
    expect(() => {
      ds.updateBookmark('b_root', { parentId: 'b_loop_1' })
    }).not.toThrow()
  })

  it('permanentDeleteBookmark 在父书签处于回收站时，能联合扫描全表将所有子孙书签的 parentId 提升为 null', () => {
    const ds = useDataStore()
    // 父节点已在回收站（deletedAt 存在），子节点在正常列表中，孙节点在正常列表中
    ds.bookmarks = [
      { id: 'p_trash', title: 'Parent In Trash', url: 'https://p.com', categoryId: 'c1', deletedAt: 12345, order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'c_child', title: 'Child', url: 'https://c.com', categoryId: 'c1', parentId: 'p_trash', order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
      { id: 'c_grandchild', title: 'Grandchild', url: 'https://gc.com', categoryId: 'c1', parentId: 'c_child', order: 2, useCount: 0, createdAt: 3, updatedAt: 3, attributes: {} },
    ] as any
    ds._syncMaps()

    // 此时因为 p_trash 已软删，_childrenIdx['p_trash'] 为空
    expect(ds._childrenIdx['p_trash']).toBeUndefined()

    // 永久删除 p_trash
    ds.permanentDeleteBookmark('p_trash')

    // 联合扫描机制应成功找到 c_child 并将其 parentId 提升为 null，避免沦为悬空孤儿
    expect(ds._bmMap['c_child'].parentId).toBeNull()
    expect(ds._bmMap['p_trash']).toBeUndefined()
  })

  it('permanentDeleteGroup 清除 _deletedGroupMemberships 中残留的已销毁组 ID', () => {
    const ds = useDataStore()
    ds.siblingGroups = [
      { id: 'g_to_delete', name: 'G Delete', categoryId: 'c1', icon: 'folder', isExpanded: false, order: 0, useCount: 0, bookmarkIds: ['bm_1'], updatedAt: 1, attributes: {} },
      { id: 'g_survive', name: 'G Survive', categoryId: 'c1', icon: 'folder', isExpanded: false, order: 1, useCount: 0, bookmarkIds: ['bm_1'], updatedAt: 1, attributes: {} },
    ] as any
    ds.bookmarks = [
      { id: 'bm_1', title: 'B1', url: 'https://1.com', categoryId: 'c1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
    ] as any
    ds._syncMaps()

    // 软删除书签，记录组关联
    ds.deleteBookmark('bm_1')
    expect(ds._deletedGroupMemberships.get('bm_1')).toContain('g_to_delete')
    expect(ds._deletedGroupMemberships.get('bm_1')).toContain('g_survive')

    // 永久删除 g_to_delete 组
    ds.permanentDeleteGroup('g_to_delete')

    // _deletedGroupMemberships 必须剔除 g_to_delete，只保留 g_survive
    const remainingGids = ds._deletedGroupMemberships.get('bm_1')
    expect(remainingGids).toBeDefined()
    expect(remainingGids?.includes('g_to_delete')).toBe(false)
    expect(remainingGids?.includes('g_survive')).toBe(true)
  })

  it('permanentDeleteCategory 级联将残留书签与组平滑归入未分类', () => {
    const ds = useDataStore()
    ds.categories = [
      { id: CAT_ALL, name: '全部', icon: 'grid', color: '#000', order: 0 },
      { id: CAT_UNCATEGORIZED, name: '未分类', icon: 'bookmark', color: '#000', order: 1 },
      { id: 'cat_custom', name: 'Custom Cat', icon: 'folder', color: '#ff0', order: 2, deletedAt: 9999 },
    ]
    ds.bookmarks = [
      { id: 'b_in_cat', title: 'In Cat', url: 'https://incat.com', categoryId: 'cat_custom', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
    ] as any
    ds.siblingGroups = [
      { id: 'g_in_cat', name: 'Group In Cat', categoryId: 'cat_custom', icon: 'folder', isExpanded: false, order: 0, useCount: 0, bookmarkIds: [], updatedAt: 1, attributes: {} },
    ] as any
    ds._syncMaps()

    // 直接永久物理删除 cat_custom
    ds.permanentDeleteCategory('cat_custom')

    // 书签与组必须平滑被改挂为 CAT_UNCATEGORIZED
    expect(ds._bmMap['b_in_cat'].categoryId).toBe(CAT_UNCATEGORIZED)
    expect(ds._grpMap['g_in_cat'].categoryId).toBe(CAT_UNCATEGORIZED)
  })

  it('addCategory 坚决拦截注入 CAT_ALL 与 CAT_UNCATEGORIZED', () => {
    const ds = useDataStore()
    ds.categories = [
      { id: CAT_ALL, name: '全部', icon: 'grid', color: '#000', order: 0 },
      { id: CAT_UNCATEGORIZED, name: '未分类', icon: 'bookmark', color: '#000', order: 1 },
    ]
    ds._syncMaps()

    ds.addCategory({ id: CAT_ALL, name: '恶意全部', icon: 'evil', color: '#f00', order: 99 })
    ds.addCategory({ id: CAT_UNCATEGORIZED, name: '恶意未分类', icon: 'evil', color: '#f00', order: 99 })

    expect(ds.categories.length).toBe(2)
    expect(ds.categories[0].name).toBe('全部')
    expect(ds.categories[1].name).toBe('未分类')
  })

  it('_syncMaps 面对悬空不存在的 categoryId 能自动平滑自愈为未分类', () => {
    const ds = useDataStore()
    ds.categories = [
      { id: CAT_ALL, name: '全部', icon: 'grid', color: '#000', order: 0 },
      { id: CAT_UNCATEGORIZED, name: '未分类', icon: 'bookmark', color: '#000', order: 1 },
    ]
    ds.bookmarks = [
      { id: 'b_dangling_cat', title: 'Dangling', url: 'https://d.com', categoryId: 'ghost_cat_id', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
    ] as any
    ds.siblingGroups = [
      { id: 'g_dangling_cat', name: 'Dangling Group', categoryId: 'ghost_cat_id', icon: 'folder', isExpanded: false, order: 0, useCount: 0, bookmarkIds: [], updatedAt: 1, attributes: {} },
    ] as any

    ds._syncMaps()

    // 自动自愈为 CAT_UNCATEGORIZED
    expect(ds.bookmarks[0].categoryId).toBe(CAT_UNCATEGORIZED)
    expect(ds.siblingGroups[0].categoryId).toBe(CAT_UNCATEGORIZED)
  })

  it('switchSpace 切换空间时彻底重置 expandedIds、quickLook 以及临时编辑上下文', async () => {
    const ds = useDataStore()
    const ui = useUIStore()

    ui.expandedIds = ['b1', 'g1']
    ui.openQuickLook('b1')
    ui.editingGeId = 'ge_1'
    ui.addToGid = 'add_1'
    ui.saveToGroup = 'save_1'
    ui.ctxGid = 'ctx_1'

    await ds.switchSpace('vault')

    expect(ui.expandedIds).toEqual([])
    expect(ui.quickLookBmId).toBeNull()
    expect(ui.quickLookHistory).toEqual([])
    expect(ui.editingGeId).toBeNull()
    expect(ui.addToGid).toBeNull()
    expect(ui.saveToGroup).toBeNull()
    expect(ui.ctxGid).toBeNull()
  })

  it('addBookmark 与 addGroup 针对非法父引用与组属性具有自愈容错能力', () => {
    const ds = useDataStore()
    // 1. addBookmark 面对自环 parentId 或已软删 parentId
    ds.addBookmark({
      id: 'b_resilient',
      title: 'Resilient',
      url: 'https://resilient.com',
      parentId: 'b_resilient',
      createdAt: 1,
      updatedAt: 1,
    } as any)

    const bm = ds._bmMap['b_resilient']
    expect(bm.parentId).toBeNull()

    // 2. addGroup 面对非数组 bookmarkIds 以及缺失 attributes
    ds.addGroup({
      id: 'g_resilient',
      name: 'Resilient Group',
      bookmarkIds: null as any,
      attributes: undefined as any,
    } as any)

    const grp = ds._grpMap['g_resilient']
    expect(grp.attributes[ATTR_IS_GROUP]).toBe(true)
    expect(Array.isArray(grp.bookmarkIds)).toBe(true)
  })

  it('_sortItems 在 dateDesc 与 dateAsc 模式下面对 NaN 或非法时间戳时稳定排序', () => {
    const items: Array<{ id: string; order: number; useCount: number; updatedAt: number }> = [
      { id: '1', order: 0, useCount: 0, updatedAt: NaN },
      { id: '2', order: 1, useCount: 0, updatedAt: 200 },
      { id: '3', order: 2, useCount: 0, updatedAt: 100 },
    ]

    // dateDesc
    _sortItems(items, { sortMode: 'dateDesc', sortDir: 'desc' }, 'id', 'updatedAt')
    expect(items.map((i: { id: string }) => i.id)).toEqual(['2', '3', '1'])

    // dateAsc
    _sortItems(items, { sortMode: 'dateAsc', sortDir: 'asc' }, 'id', 'updatedAt')
    expect(items.map((i: { id: string }) => i.id)).toEqual(['1', '3', '2'])
  })

  it('deleteBookmark 软删父书签时立即移除 _childrenIdx，且 childrenMap 自动屏蔽软删父节点', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      { id: 'p_active', title: 'Parent', url: 'https://p.com', categoryId: 'c1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'c_active', title: 'Child', url: 'https://c.com', categoryId: 'c1', parentId: 'p_active', order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
    ] as any
    ds._syncMaps()

    expect(ds._childrenIdx['p_active']).toEqual(['c_active'])
    expect(ds.childrenMap['p_active']).toHaveLength(1)

    // 删除父书签
    ds.deleteBookmark('p_active')

    // _childrenIdx 中的父索引必须立即被移除，且 childrenMap 不再暴露已软删除的父节点
    expect(ds._childrenIdx['p_active']).toBeUndefined()
    expect(ds.childrenMap['p_active']).toBeUndefined()
  })

  it('删除与永久删除书签/组时联动清理 ui.editingId 与 ui.aiEnrichTargetBmId', () => {
    const ds = useDataStore()
    const ui = useUIStore()

    ds.bookmarks = [
      { id: 'b_edit', title: 'B Edit', url: 'https://b.com', categoryId: 'c1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
    ] as any
    ds.siblingGroups = [
      { id: 'g_edit', name: 'G Edit', categoryId: 'c1', order: 0, useCount: 0, bookmarkIds: [], updatedAt: 1, attributes: {} },
    ] as any
    ds._syncMaps()

    // 1. 删除正在编辑/AI 补齐的书签
    ui.editingId = 'b_edit'
    ui.openAiEnrich('b_edit')
    expect(ui.modals.aiEnrich).toBe(true)

    ds.deleteBookmark('b_edit')
    expect(ui.editingId).toBeNull()
    expect(ui.aiEnrichTargetBmId).toBeNull()
    expect(ui.modals.aiEnrich).toBe(false)

    // 2. 永久删除正在编辑的组
    ui.editingId = 'group:g_edit'
    ui.editingGeId = 'g_edit'
    ds.permanentDeleteGroup('g_edit')
    expect(ui.editingId).toBeNull()
    expect(ui.editingGeId).toBeNull()
  })

  it('cardCounts 与 filtered* 对软删除分类或孤儿分类自愈归入未分类', () => {
    const ds = useDataStore()
    const ui = useUIStore()

    ds.categories = [
      { id: CAT_ALL, name: '全部', icon: 'grid', color: '#000', order: 0 },
      { id: CAT_UNCATEGORIZED, name: '未分类', icon: 'bookmark', color: '#000', order: 1 },
      { id: 'cat_soft_deleted', name: 'Deleted Cat', icon: 'folder', color: '#000', order: 2, deletedAt: 9999 },
    ]
    ds.bookmarks = [
      { id: 'b_deleted_cat', title: 'Bm In Deleted Cat', url: 'https://1.com', categoryId: 'cat_soft_deleted', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'b_ghost_cat', title: 'Bm In Ghost Cat', url: 'https://2.com', categoryId: 'ghost_non_existent', order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
    ] as any
    ds.siblingGroups = [
      { id: 'g_deleted_cat', name: 'G In Deleted Cat', categoryId: 'cat_soft_deleted', order: 0, useCount: 0, bookmarkIds: [], updatedAt: 1, attributes: {} },
    ] as any
    ds._syncMaps()

    // cardCounts 中必须计入未分类，消除偏差
    const counts = ds.cardCounts
    expect(counts[CAT_UNCATEGORIZED]).toBe(3)
    expect(counts[CAT_ALL]).toBe(3)

    // filteredBookmarks 与 filteredGroups 选中未分类时应能看见这些项
    ui.curCat = CAT_UNCATEGORIZED
    expect(ds.filteredBookmarks.map(b => b.id).sort()).toEqual(['b_deleted_cat', 'b_ghost_cat'])
    expect(ds.filteredGroups.map(g => g.id)).toEqual(['g_deleted_cat'])
  })

  it('appStore.importFromData 彻底清理 UI 选区、速览、批量模式与 _customCardOrder', async () => {
    const { useAppStore } = await import('../../stores/app.js')
    const app = useAppStore()
    const ds = useDataStore()
    const ui = useUIStore()

    ui.batchMode = true
    ui.batchSelected = ['b_old_1', 'group:g_old_1']
    ui.expandedIds = ['b_old_1']
    ui.searchQuery = 'keyword'
    ui.editingId = 'b_old_1'
    ui.editingGeId = 'g_old_1'
    ui.addToGid = 'g_old_1'
    ui.saveToGroup = 'g_old_1'
    ui.ctxGid = 'g_old_1'
    ui.openQuickLook('b_old_1')
    ds._customCardOrder = [{ t: 'b', id: 'b_old_1' }]

    app.importFromData({
      bookmarks: [{ id: 'b_new_1', title: 'New', url: 'https://new.com', categoryId: 'c1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} }],
      siblingGroups: [],
      categories: [{ id: 'c1', name: 'C1', icon: 'grid', color: '#000', order: 0 }],
      customAttributes: [],
    } as any)

    expect(ui.batchMode).toBe(false)
    expect(ui.batchSelected).toEqual([])
    expect(ui.expandedIds).toEqual([])
    expect(ui.searchQuery).toBe('')
    expect(ui.editingId).toBeNull()
    expect(ui.editingGeId).toBeNull()
    expect(ui.addToGid).toBeNull()
    expect(ui.saveToGroup).toBeNull()
    expect(ui.ctxGid).toBeNull()
    expect(ui.quickLookBmId).toBeNull()
    expect(ui.quickLookHistory).toEqual([])
    expect(ds._customCardOrder).toBeNull()
  })

  it('openQuickLook 对历史栈数量做上限封顶（最多 50 项），防止内存泄漏', () => {
    const ui = useUIStore()
    ui.quickLookHistory = []

    for (let i = 0; i < 70; i++) {
      ui.openQuickLook(`bm_${i}`)
    }

    expect(ui.quickLookHistory.length).toBeLessThanOrEqual(50)
  })

  it('cleanStale 自动清理已软删除组在内存中的 undo 栈', () => {
    const ds = useDataStore()
    const undo = useUndoStore()

    ds.siblingGroups = [
      { id: 'g_alive', name: 'Alive', categoryId: 'c1', order: 0, useCount: 0, bookmarkIds: [], updatedAt: 1, attributes: {} },
      { id: 'g_deleted', name: 'Deleted', categoryId: 'c1', order: 1, useCount: 0, bookmarkIds: [], updatedAt: 1, attributes: {}, deletedAt: 9999 },
    ] as any
    ds._syncMaps()

    undo.ensureStack('g_alive')
    undo.ensureStack('g_deleted')

    undo.cleanStale()

    expect(undo.stacks['g_alive']).toBeDefined()
    // 已软删除组的 undo 栈应被自动回收释放内存
    expect(undo.stacks['g_deleted']).toBeUndefined()
  })

  it('permanentDeleteAttribute 级联从书签和组中物理清除残留属性键，杜绝幽灵属性', () => {
    const ds = useDataStore()
    ds.customAttributes = [
      { id: 'attr_ghost', name: 'Ghost Attr', type: 'boolean' },
      { id: 'attr_stay', name: 'Stay Attr', type: 'boolean' },
    ]
    ds.bookmarks = [
      { id: 'b_attr', title: 'B', url: 'https://b.com', categoryId: 'c1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: { attr_ghost: true, attr_stay: true } },
    ] as any
    ds.siblingGroups = [
      { id: 'g_attr', name: 'G', categoryId: 'c1', order: 0, useCount: 0, bookmarkIds: [], updatedAt: 1, attributes: { attr_ghost: true } },
    ] as any
    ds._syncMaps()

    ds.permanentDeleteAttribute('attr_ghost')

    expect(ds.customAttributes.some(a => a.id === 'attr_ghost')).toBe(false)
    expect(ds._bmMap['b_attr'].attributes['attr_ghost']).toBeUndefined()
    expect(ds._bmMap['b_attr'].attributes['attr_stay']).toBe(true)
    expect(ds._grpMap['g_attr'].attributes['attr_ghost']).toBeUndefined()
  })

  it('switchSpace 切换空间时彻底重置 aiAttachedCards、shareModalTarget、aiEnrich 与 shareMode', async () => {
    const ds = useDataStore()
    const ui = useUIStore()

    ui.aiAttachedCards = [{ type: 'bm', id: 'b_secret' }]
    ui.openShareModal('group', 'g_secret')
    ui.openAiEnrich('b_secret')
    ui.shareMode = { kind: 'group', id: 'g_share' }

    await ds.switchSpace('vault')

    expect(ui.aiAttachedCards).toEqual([])
    expect(ui.shareModalTarget).toBeNull()
    expect(ui.aiEnrichTargetBmId).toBeNull()
    expect(ui.modals.aiEnrich).toBe(false)
    expect(ui.shareMode).toBeNull()
  })

  it('saveUIState 在私密空间下严禁将私密搜索词持久化至 localStorage UI_STATE_KEY', async () => {
    const ui = useUIStore()
    const { safeGetItem, safeJsonParse } = await import('../../lib/storageSafe.js')
    const { UI_STATE_KEY } = await import('../../config/constants.js')

    ui.curSpace = 'vault'
    ui.searchQuery = 'top secret bank account password'
    ui.saveUIState()

    const raw = safeGetItem(UI_STATE_KEY)
    const parsed = safeJsonParse<{ searchQuery?: string } | null>(raw, null)
    expect(parsed?.searchQuery).toBe('')

    // 切回 main 空间后，正常允许保存公共搜索词
    ui.curSpace = 'main'
    ui.searchQuery = 'public dev tools'
    ui.saveUIState()

    const parsedMain = safeJsonParse<{ searchQuery?: string } | null>(safeGetItem(UI_STATE_KEY), null)
    expect(parsedMain?.searchQuery).toBe('public dev tools')
  })

  it('appStore.save 立即清理在途的 _saveTimer 避免无意义重复执行', async () => {
    const { useAppStore } = await import('../../stores/app.js')
    const app = useAppStore()
    const ds = useDataStore()

    app.debouncedSave(1000)
    expect(ds._saveTimer).not.toBeNull()

    await app.save()
    expect(ds._saveTimer).toBeNull()
  })

  it('_syncMaps 面对深层间接循环引用（b1 -> b2 -> b3 -> b1）能自愈破环并将环上节点提升为顶层', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      { id: 'b_cycle_1', title: 'Cycle 1', url: 'https://1.com', parentId: 'b_cycle_3', categoryId: 'c1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {} },
      { id: 'b_cycle_2', title: 'Cycle 2', url: 'https://2.com', parentId: 'b_cycle_1', categoryId: 'c1', order: 1, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
      { id: 'b_cycle_3', title: 'Cycle 3', url: 'https://3.com', parentId: 'b_cycle_2', categoryId: 'c1', order: 2, useCount: 0, createdAt: 3, updatedAt: 3, attributes: {} },
    ] as any

    // 调用 _syncMaps，应检测到循环并打破，避免主线程假死与渲染孤儿
    ds._syncMaps()

    // 至少应有一个节点的 parentId 被置空以打破闭环
    const hasTopLevel = ds.bookmarks.some(b => b.parentId === null)
    expect(hasTopLevel).toBe(true)
    // 且 _childrenIdx 不存在自环映射
    expect(ds._childrenIdx['b_cycle_1']?.includes('b_cycle_1')).toBeFalsy()
  })

  it('_syncMaps 与 childrenMap 面对软删父节点时屏蔽子节点索引，永久删除时才提升子节点', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      { id: 'b_parent_soft_deleted', title: 'Parent', url: 'https://p.com', parentId: null, categoryId: 'c1', order: 0, useCount: 0, createdAt: 1, updatedAt: 1, attributes: {}, deletedAt: 99999 },
      { id: 'b_child_alive', title: 'Child Alive', url: 'https://c.com', parentId: 'b_parent_soft_deleted', categoryId: 'c1', order: 0, useCount: 0, createdAt: 2, updatedAt: 2, attributes: {} },
    ] as any

    ds._syncMaps()

    // 软删状态下：父不在 _childrenIdx 中，childrenMap 不展示软删父节点的子项
    expect(ds._childrenIdx['b_parent_soft_deleted']).toBeUndefined()
    expect(ds.childrenMap['b_parent_soft_deleted']).toBeUndefined()

    // 恢复父节点：子节点索引即时恢复
    ds.restoreBookmark('b_parent_soft_deleted')
    expect(ds._childrenIdx['b_parent_soft_deleted']).toEqual(['b_child_alive'])

    // 软删父节点再次删除
    ds.deleteBookmark('b_parent_soft_deleted')
    // 永久删除父节点：全量提升子孙书签为顶层书签
    ds.permanentDeleteBookmark('b_parent_soft_deleted')
    expect(ds._bmMap['b_child_alive'].parentId).toBeNull()
  })
})
