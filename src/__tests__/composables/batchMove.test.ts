/**
 * batchMove.test.ts — 批量移动分类回归测试
 *
 * 锁定已修复 bug：batchMoveToCat 原本只改选中 bookmark 自身 categoryId，
 * 不递归处理子书签（collectSubIds）。导致父移到新分类、子留在原分类后，
 * 子书签因 !b.parentId 过滤无法在原分类顶层显示，又因父不在原分类而无从
 * 展开访问，分类归属与可见性分裂。修复后 batchMoveToCat 对 bookmark 调
 * collectSubIds 把父及所有子孙的 categoryId 一并改，与 batchDelete 语义对称。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// mock 轻量外部依赖，避免触发真实数据初始化链
vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))
vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../../stores/overlay.js', () => ({
  useBatchMoveStore: () => ({ show: vi.fn(), hide: vi.fn() }),
}))

import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { batchMoveToCat } from '../../composables/domain/useBatch.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

describe('batchMoveToCat 子书签跟随父移动', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('移动含子书签的父书签时，子孙 categoryId 应一并改到目标分类', () => {
    const ds = useDataStore()
    const ui = useUIStore()

    // 构造父子链：P → C1 → C2（三层嵌套），全在 uncategorized
    ds.addBookmark({ id: 'P', title: 'P', url: 'https://p.x', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0, attributes: {} } as any)
    ds.addBookmark({ id: 'C1', title: 'C1', url: 'https://c1.x', categoryId: CAT_UNCATEGORIZED, parentId: 'P', order: 0, attributes: {} } as any)
    ds.addBookmark({ id: 'C2', title: 'C2', url: 'https://c2.x', categoryId: CAT_UNCATEGORIZED, parentId: 'C1', order: 0, attributes: {} } as any)

    // 新建一个目标分类
    ds.categories = [{ id: 'catB', name: 'B', icon: 'bookmark', color: '' }, ...ds.categories]
    ui.batchSelected = ['P']
    ui.batchMode = true

    batchMoveToCat('catB')

    expect(ds.bookmarkMap['P'].categoryId).toBe('catB')
    // 关键：子书签跟随父移动，而非留 uncategorized
    expect(ds.bookmarkMap['C1'].categoryId).toBe('catB')
    expect(ds.bookmarkMap['C2'].categoryId).toBe('catB')
  })

  it('移动 group 时不应触发 bookmark 递归', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ds.addBookmark({ id: 'B1', title: 'B1', url: 'https://b1.x', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0, attributes: {} } as any)
    ds.addGroup({ id: 'g1', name: 'G1', categoryId: CAT_UNCATEGORIZED, icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', useCount: 0, isPublic: false, updatedAt: 0 } as any)

    ui.batchSelected = ['group:g1']
    ui.batchMode = true
    batchMoveToCat('catOther')

    expect(ds.groupMap['g1'].categoryId).toBe('catOther')
    // 无关书签不应被改
    expect(ds.bookmarkMap['B1'].categoryId).toBe(CAT_UNCATEGORIZED)
  })

  it('空选列表应直接返回，不报错', () => {
    const ui = useUIStore()
    ui.batchSelected = []
    expect(() => batchMoveToCat('catX')).not.toThrow()
  })
})
