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

beforeEach(() => {
  setActivePinia(createPinia())
  _remoteSnapshots.clear()
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
