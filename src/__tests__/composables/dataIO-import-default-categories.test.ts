/**
 * dataIO-import-default-categories — 导入不应把默认分类塞回用户的库
 *
 * 锁定缺陷：importFromDataInternal 对导入载荷跑 runMigrations，后者会「确保默认分类存在」，
 * 于是导入任何浏览器书签 / Raindrop 文件都会把默认分类（邮箱、工具、游戏平台…，含用户已删的）
 * 作为空分类合并进库，提示里还多出「N 个分类」。
 * 验收点：只带入文件自带的分类，以及被导入书签/组实际引用到的默认分类。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mocks = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('../../lib/toast.js', () => ({ toast: mocks.toast, toastWithUndo: vi.fn(), showConfirm: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../../lib/search.js', () => ({ clearSearchCache: vi.fn() }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))

import { useDataStore } from '../../stores/data.js'
import { importFromDataInternal } from '../../composables/domain/useDataIO.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

/** 用户自己的分类体系：已把默认的 邮箱/工具/AI/娱乐/游戏平台 全删掉，只留自建的「视频」 */
function seedUserLibrary() {
  const ds = useDataStore()
  ds.categories = [
    { id: 'all', name: '全部', icon: 'grid', color: '', order: 0 },
    { id: CAT_UNCATEGORIZED, name: '未分类', icon: 'bookmark', color: '', order: 1 },
    { id: 'video', name: '视频', icon: 'star', color: '', order: 2 },
  ] as any
  ds.bookmarks = []
  ds.siblingGroups = []
  ds.customAttributes = []
  ;(ds as any)._syncMaps()
  return ds
}

const catIds = (ds: ReturnType<typeof useDataStore>) => ds.categories.filter((c: any) => !c.deletedAt).map((c: any) => c.id).sort()

describe('importFromDataInternal — 不把默认分类塞回库', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('导入不带分类的书签（浏览器书签 HTML 的形态）：分类体系不变，提示里不出现分类', () => {
    const ds = seedUserLibrary()
    importFromDataInternal({
      categories: [],
      bookmarks: [
        { id: 'i1', title: '热门', url: 'https://www.bilibili.com/v/popular/all', categoryId: CAT_UNCATEGORIZED } as any,
        { id: 'i2', title: '番剧', url: 'https://www.bilibili.com/anime/', categoryId: CAT_UNCATEGORIZED } as any,
      ],
      customAttributes: [],
      siblingGroups: [],
    }, '浏览器书签')

    expect(catIds(ds)).toEqual(['all', 'uncategorized', 'video'])
    expect(ds.bookmarks.filter((b: any) => !b.deletedAt)).toHaveLength(2)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    const msg = String(mocks.toast.mock.calls[0][0])
    expect(msg).toContain('2')
    expect(msg).not.toMatch(/分类|categor/i)
  })

  it('文件自带的分类照常带入', () => {
    const ds = seedUserLibrary()
    importFromDataInternal({
      categories: [{ id: 'reading', name: '阅读', icon: 'star', color: '', order: 0 }] as any,
      bookmarks: [{ id: 'i1', title: '书', url: 'https://book.example/', categoryId: 'reading' } as any],
      customAttributes: [],
      siblingGroups: [],
    }, 'test')

    expect(catIds(ds)).toEqual(['all', 'reading', 'uncategorized', 'video'])
    expect(ds.bookmarkMap['i1'].categoryId).toBe('reading')
  })

  it('旧版备份：书签引用了默认分类但文件没带分类表，只补回被引用到的那一个', () => {
    const ds = seedUserLibrary()
    importFromDataInternal({
      categories: [],
      bookmarks: [{ id: 'i1', title: 'DeepSeek', url: 'https://www.deepseek.com/', categoryId: 'ai' } as any],
      customAttributes: [],
      siblingGroups: [],
    }, 'test')

    expect(catIds(ds)).toEqual(['ai', 'all', 'uncategorized', 'video'])
    expect(ds.bookmarkMap['i1'].categoryId).toBe('ai')
  })

  it('组引用到的默认分类同样补回，其余默认分类不补', () => {
    const ds = seedUserLibrary()
    importFromDataInternal({
      categories: [],
      bookmarks: [],
      customAttributes: [],
      siblingGroups: [{ id: 'g1', name: '工具清单', categoryId: 'tools', bookmarkIds: [], notes: '' } as any],
    }, 'test')

    expect(catIds(ds)).toEqual(['all', 'tools', 'uncategorized', 'video'])
    expect(ds.groupMap['g1'].categoryId).toBe('tools')
  })
})
