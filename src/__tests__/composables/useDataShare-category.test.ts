/**
 * useDataShare 分类分享 — shareCategory / forkPublicCategory / parseCategoryShareRoute 护栏
 *
 * shareCategory：
 * - 分类不存在/软删 → toast 错误 + 不 copy
 * - upsert_public_category_share 返回 share_id → copy `${SHARE_BASE}/c/<share_id>`
 * - upsert 失败（未登录等）→ toast「分享需登录」+ 不 copy
 *
 * forkPublicCategory：
 * - 复制分类（同名复用/新建）+ 书签（URL 去重，不复制密码/用户名）+ 组（bookmarkIds 映射）
 * - 组引用被去重跳过的书签 → 从组 bookmarkIds 剔除，避免悬空
 *
 * parseCategoryShareRoute：cat: 前缀解析（见 useDataShare-detectShareRoute-shareGroup.test.ts）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const _copy = vi.hoisted(() => ({ copySpy: vi.fn() }))
vi.mock('../../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils.js')>('../../utils.js')
  return { ...actual, copyToClipboard: _copy.copySpy }
})

const _toast = vi.hoisted(() => ({ toastSpy: vi.fn() }))
vi.mock('../../lib/toast.js', () => ({ toast: _toast.toastSpy, toastWithUndo: vi.fn(), showConfirm: vi.fn(async () => true) }))

const _share = vi.hoisted(() => ({
  upsertResult: null as string | null,
  upsertSpy: vi.fn(async (_cid: string) => _share.upsertResult),
  fetchCategorySpy: vi.fn(),
}))
vi.mock('../../composables/domain/syncShare.js', () => ({
  setGroupPublic: vi.fn(async () => true),
  fetchPublicGroup: vi.fn(),
  upsertPublicCategoryShare: _share.upsertSpy,
  fetchPublicCategory: _share.fetchCategorySpy,
  CATEGORY_SHARE_PATH: 'c',
  CATEGORY_SHARE_PREFIX: 'cat:',
}))

const __csMocks = vi.hoisted(() => ({ fullSyncSpy: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../../composables/domain/useCloudSync.js', () => ({
  useCloudSync: () => ({ fullSync: __csMocks.fullSyncSpy, initOnlineListener: vi.fn(), initialSync: vi.fn(() => Promise.resolve()) }),
  _isPendingSync: () => false,
  _deleteWithoutEcho: vi.fn(),
  __testPendingSync: { add: () => {}, clear: () => {} },
}))

import { useDataStore } from '../../stores/data.js'

function seedCat() {
  const ds = useDataStore()
  ds.categories = [
    { id: 'all', name: '全部', icon: 'grid', color: '', order: 0, updatedAt: 1 },
    { id: 'uncategorized', name: '未分类', icon: 'bookmark', color: '', order: 1, updatedAt: 1 },
    // 注意：本地分类名不与 fork 数据的「工具」同名，避免干扰「同名复用」断言
    { id: 'c-tools', name: '本地工具', icon: 'tool', color: '#d97706', order: 2, updatedAt: 1 },
  ]
  ds.bookmarks = []
  ds.siblingGroups = []
  ds.customAttributes = []
  ds._syncMaps()
  return ds
}

beforeEach(() => {
  setActivePinia(createPinia())
  _copy.copySpy.mockClear()
  _toast.toastSpy.mockClear()
  _share.upsertSpy.mockClear()
  _share.fetchCategorySpy.mockClear()
  _share.upsertResult = 'cat_share_abc'
  __csMocks.fullSyncSpy.mockClear()
})

describe('shareCategory', () => {
  it('分类不存在 → toast 错误 + 不 copy 不调 upsert', async () => {
    const { shareCategory } = await import('../../composables/domain/useDataShare.js')
    seedCat()
    await shareCategory('c-missing')
    expect(_share.upsertSpy).not.toHaveBeenCalled()
    expect(_copy.copySpy).not.toHaveBeenCalled()
    expect(_toast.toastSpy).toHaveBeenCalled()
  })

  it('upsert 成功 → copy 同域分类分享链接 /s/c/<share_id>', async () => {
    const { shareCategory } = await import('../../composables/domain/useDataShare.js')
    seedCat()
    _share.upsertResult = 'cat_share_xyz'
    await shareCategory('c-tools')
    expect(_share.upsertSpy).toHaveBeenCalledWith('c-tools')
    expect(_copy.copySpy).toHaveBeenCalledTimes(1)
    expect(_copy.copySpy.mock.calls[0][0]).toBe('https://ulink.ren/s/c/cat_share_xyz')
  })

  it('upsert 失败（未登录）→ toast 分享需登录 + 不 copy', async () => {
    const { shareCategory } = await import('../../composables/domain/useDataShare.js')
    seedCat()
    _share.upsertResult = null
    await shareCategory('c-tools')
    expect(_copy.copySpy).not.toHaveBeenCalled()
    expect(_toast.toastSpy).toHaveBeenCalled()
  })
})

describe('forkPublicCategory', () => {
  const catData = () => ({
    category: { id: 'c-tools', name: '工具', icon: 'tool', color: '#d97706' },
    groups: [
      { id: 'g1', name: '开发组', categoryId: 'c-tools', icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: ['b1', 'b2'], notes: '<p>hi</p>', useCount: 0, updatedAt: 1, isPublic: false },
    ],
    bookmarks: [
      { id: 'b1', title: 'GitHub', url: 'https://github.com', username: 'u1', password: 'p1', notes: '', icon: '', categoryId: 'c-tools', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 },
      { id: 'b2', title: '子站', url: 'https://github.com/foo', username: 'u2', password: 'p2', notes: '', icon: '', categoryId: 'c-tools', parentId: 'b1', order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 },
    ],
  })

  it('复制分类 + 书签 + 组到本地（同名分类不存在 → 新建；不复制密码/用户名）', async () => {
    const { forkPublicCategory } = await import('../../composables/domain/useDataShare.js')
    seedCat()
    await forkPublicCategory(catData() as any)

    const ds = useDataStore()
    const cat = ds.categories.find(c => c.name === '工具' && c.id !== 'c-tools')
    expect(cat).toBeTruthy()
    expect(cat!.icon).toBe('tool')
    expect(cat!.color).toBe('#d97706')
    // 书签：2 条新 id，无密码/用户名
    const bms = ds.bookmarks
    expect(bms.length).toBe(2)
    for (const b of bms) {
      expect(b.username).toBe('')
      expect(b.password).toBe('')
      expect(b.categoryId).toBe(cat!.id)
    }
    // 组：复制到新分类，bookmarkIds 指向新书签 id
    expect(ds.siblingGroups.length).toBe(1)
    const g = ds.siblingGroups[0]
    expect(g.categoryId).toBe(cat!.id)
    expect(g.bookmarkIds.length).toBe(2)
    const newIds = new Set(bms.map(b => b.id))
    expect(g.bookmarkIds.every(id => newIds.has(id))).toBe(true)
  })

  it('本地存在同名分类 → 归入已有分类，不新建', async () => {
    const { forkPublicCategory } = await import('../../composables/domain/useDataShare.js')
    const ds = seedCat()
    ds.categories.push({ id: 'c-existing-tools', name: '工具', icon: 'star', color: '', order: 9, updatedAt: 1 })
    ds._syncMaps()
    await forkPublicCategory(catData() as any)

    const after = useDataStore()
    // 同名「工具」仅 c-existing-tools 一个，且分类总数不变（不新建）
    expect(after.categories.filter(c => c.name === '工具').length).toBe(1)
    expect(after.categories.length).toBe(4) // all + uncategorized + c-tools + c-existing-tools
    expect(after.bookmarks.every(b => b.categoryId === 'c-existing-tools')).toBe(true)
    expect(after.siblingGroups[0].categoryId).toBe('c-existing-tools')
  })

  it('组引用的书签被 URL 去重跳过 → 组 bookmarkIds 剔除悬空引用', async () => {
    const { forkPublicCategory } = await import('../../composables/domain/useDataShare.js')
    const ds = seedCat()
    // 本地已存在同 URL 书签
    ds.bookmarks = [{ id: 'local-b1', title: 'GitHub', url: 'https://github.com', username: '', password: '', notes: '', icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 }]
    ds._syncMaps()
    await forkPublicCategory(catData() as any)

    const after = useDataStore()
    // b1 被去重（同 URL），只新增 b2
    expect(after.bookmarks.length).toBe(2)
    const g = after.siblingGroups[0]
    expect(g.bookmarkIds.length).toBe(1) // 仅 b2 的新 id
  })

  it('fork 后触发云同步 fullSync', async () => {
    const { forkPublicCategory } = await import('../../composables/domain/useDataShare.js')
    seedCat()
    await forkPublicCategory(catData() as any)
    expect(__csMocks.fullSyncSpy).toHaveBeenCalled()
  })
})
