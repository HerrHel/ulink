/**
 * QUAL-03：_mergeIntoLocal / _deleteWithoutEcho 核心合并语义
 * 锁定：软删走 delete* 副作用、复活清 deletedAt、脏冲突、full 对账、回声清 dirty
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { _mergeIntoLocal, _deleteWithoutEcho } from '../../composables/domain/useCloudSync.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

function makeBm(partial: Record<string, unknown> = {}) {
  return {
    id: 'bm-1',
    title: 't',
    url: 'https://x.com',
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: CAT_UNCATEGORIZED,
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 1000,
    updatedAt: 2000,
    ...partial,
  }
}

function makeGroup(partial: Record<string, unknown> = {}) {
  return {
    id: 'g-1',
    name: '组',
    categoryId: CAT_UNCATEGORIZED,
    icon: '',
    order: 0,
    isExpanded: false,
    attributes: {},
    bookmarkIds: [] as string[],
    notes: '',
    useCount: 0,
    updatedAt: 2000,
    isPublic: false,
    ...partial,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('_mergeIntoLocal 软删 / 复活 / 冲突', () => {
  it('远端软删本地存活 → deleteBookmark + 清 dirty（不 Object.assign 跳过副作用）', () => {
    const ds = useDataStore()
    const g = makeGroup({ bookmarkIds: ['bm-1'] })
    ds.addGroup(g as any)
    ds.addBookmark(makeBm() as any)
    // 挂进组：模拟已在组内
    ds.updateGroup('g-1', { bookmarkIds: ['bm-1'] })
    ds._dirtyIds.clear()
    ds._newIds.clear()

    const local = ds.bookmarks
    const remote = [makeBm({ updatedAt: 9000, deletedAt: 9000 }) as any]
    _mergeIntoLocal(local, remote, 'bookmark', false)

    expect(ds.bookmarkMap['bm-1']?.deletedAt).toBeTruthy()
    // 组引用应被剔（deleteBookmark 副作用）
    expect(ds.groupMap['g-1']?.bookmarkIds).not.toContain('bm-1')
    // 回声：衍生 dirty 应被 _deleteWithoutEcho 清掉
    expect(ds._dirtyIds.has('bm-1')).toBe(false)
    expect(ds._dirtyIds.has('g-1')).toBe(false)
  })

  it('远端复活（无 deletedAt、本地有）→ 清本地 deletedAt 并合并字段', () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ deletedAt: 5000, title: '旧' }) as any)
    ds._dirtyIds.clear()

    const remote = [makeBm({ updatedAt: 9000, title: '新标题' }) as any]
    _mergeIntoLocal(ds.bookmarks, remote, 'bookmark', false)

    const bm = ds.bookmarkMap['bm-1']
    expect(bm?.deletedAt).toBeUndefined()
    expect(bm?.title).toBe('新标题')
  })

  it('本地脏且远端更新更晚且 lastSyncAt>0 → 登记冲突、不覆盖本地', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    sync.setLastSyncAt(Date.now())
    ds.addBookmark(makeBm({ title: '本地改', updatedAt: 3000 }) as any)
    ds._dirtyIds.add('bm-1')

    const remote = [makeBm({ title: '远端改', updatedAt: 9000 }) as any]
    _mergeIntoLocal(ds.bookmarks, remote, 'bookmark', false)

    expect(ds.bookmarkMap['bm-1']?.title).toBe('本地改')
    expect(sync.conflicts.some(c => c.id === 'bm-1' && c.type === 'bookmark')).toBe(true)
  })

  it('本地非脏且远端更新更晚 → Object.assign 覆盖', () => {
    const ds = useDataStore()
    ds.addBookmark(makeBm({ title: '旧', updatedAt: 3000 }) as any)
    ds._dirtyIds.clear()

    _mergeIntoLocal(ds.bookmarks, [makeBm({ title: '新', updatedAt: 9000 }) as any], 'bookmark', false)
    expect(ds.bookmarkMap['bm-1']?.title).toBe('新')
  })

  it('远端有本地无 → push 进数组（含软删项，供回收站）', () => {
    const ds = useDataStore()
    const remote = [makeBm({ id: 'bm-remote', deletedAt: 8000, updatedAt: 8000 }) as any]
    _mergeIntoLocal(ds.bookmarks, remote, 'bookmark', false)
    expect(ds.bookmarks.find(b => b.id === 'bm-remote')?.deletedAt).toBe(8000)
  })

  it('full=true 且 lastSyncAt>0：远端无 + 本地非脏 → 软删本地', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    sync.setLastSyncAt(Date.now())
    ds.addBookmark(makeBm({ id: 'bm-only-local' }) as any)
    ds._dirtyIds.clear()

    _mergeIntoLocal(ds.bookmarks, [], 'bookmark', true)
    expect(ds.bookmarkMap['bm-only-local']?.deletedAt).toBeTruthy()
    expect(ds._dirtyIds.has('bm-only-local')).toBe(false)
  })

  it('full=true 但本地脏：远端无 → 不删（保护未推送编辑）', () => {
    const ds = useDataStore()
    const sync = useSyncStore()
    sync.setLastSyncAt(Date.now())
    ds.addBookmark(makeBm({ id: 'bm-dirty' }) as any)
    ds._dirtyIds.add('bm-dirty')

    _mergeIntoLocal(ds.bookmarks, [], 'bookmark', true)
    expect(ds.bookmarkMap['bm-dirty']?.deletedAt).toBeUndefined()
  })
})

describe('_deleteWithoutEcho', () => {
  it('删除书签后不把组衍生 dirty 留在 _dirtyIds', () => {
    const ds = useDataStore()
    ds.addGroup(makeGroup({ bookmarkIds: ['bm-1'] }) as any)
    ds.addBookmark(makeBm() as any)
    ds.updateGroup('g-1', { bookmarkIds: ['bm-1'] })
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds._changedFields.clear()

    _deleteWithoutEcho(ds, 'bookmark', 'bm-1')

    expect(ds.bookmarkMap['bm-1']?.deletedAt).toBeTruthy()
    expect(ds.groupMap['g-1']?.bookmarkIds).not.toContain('bm-1')
    expect(ds._dirtyIds.size).toBe(0)
    expect(ds._changedFields.size).toBe(0)
  })
})
