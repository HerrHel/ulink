/**
 * trashOps — 回收站多选纯函数护栏
 * trashKey/splitTrashKey 编码往返 + restoreItems/permanentDeleteItems 按 type 分发到正确 store 方法。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { trashKey, splitTrashKey, restoreItems, permanentDeleteItems, type TrashType } from '../../components/modals/trashOps.js'

const ALL_TYPES: TrashType[] = ['bookmark', 'group', 'category', 'attribute']

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('trashKey / splitTrashKey', () => {
  it('往返一致', () => {
    for (const t of ALL_TYPES) {
      const k = trashKey(t, 'abc123')
      expect(splitTrashKey(k)).toEqual({ type: t, id: 'abc123' })
    }
  })

  it('id 含冒号时只切第一个冒号', () => {
    const k = trashKey('bookmark', 'a:b:c')
    expect(splitTrashKey(k)).toEqual({ type: 'bookmark', id: 'a:b:c' })
  })
})

describe('restoreItems', () => {
  it('按 type 分发到对应单 id 恢复方法', () => {
    const ds = useDataStore()
    const spies = {
      bookmark: vi.spyOn(ds, 'restoreBookmark'),
      group: vi.spyOn(ds, 'restoreGroup'),
      category: vi.spyOn(ds, 'restoreCategory'),
      attribute: vi.spyOn(ds, 'restoreAttribute'),
    }
    restoreItems(ds, [
      { type: 'bookmark', id: 'b1' },
      { type: 'group', id: 'g1' },
      { type: 'category', id: 'c1' },
      { type: 'attribute', id: 'a1' },
    ])
    expect(spies.bookmark).toHaveBeenCalledExactlyOnceWith('b1')
    expect(spies.group).toHaveBeenCalledExactlyOnceWith('g1')
    expect(spies.category).toHaveBeenCalledExactlyOnceWith('c1')
    expect(spies.attribute).toHaveBeenCalledExactlyOnceWith('a1')
  })

  it('书签按深度升序恢复：父书签先于子书签恢复，防止子书签的 parentId 被误重置为 null', () => {
    const ds = useDataStore()
    const callOrder: string[] = []
    ds.addBookmark({ id: 'p1', title: 'Parent', url: 'https://p.com' } as any)
    ds.addBookmark({ id: 'c1', title: 'Child', url: 'https://c.com', parentId: 'p1' } as any)
    ds.deleteBookmark('p1')
    ds.deleteBookmark('c1')
    vi.spyOn(ds, 'restoreBookmark').mockImplementation((id: string) => {
      callOrder.push(id)
    })

    // 子书签排在数组前面
    restoreItems(ds, [
      { type: 'bookmark', id: 'c1' },
      { type: 'bookmark', id: 'p1' },
    ])

    expect(callOrder).toEqual(['p1', 'c1'])
  })

  it('端到端测试：批量恢复时子书签排在父书签前面，恢复后子书签的 parentId 依然保留指向父书签', () => {
    const ds = useDataStore()
    ds.addBookmark({ id: 'p1', title: 'Parent', url: 'https://p.com' } as any)
    ds.addBookmark({ id: 'c1', title: 'Child', url: 'https://c.com', parentId: 'p1' } as any)
    ds.deleteBookmark('p1')
    ds.deleteBookmark('c1')

    // 两个都处于回收站
    expect(ds.bookmarkMap['p1'].deletedAt).toBeTruthy()
    expect(ds.bookmarkMap['c1'].deletedAt).toBeTruthy()
    expect(ds.bookmarkMap['c1'].parentId).toBe('p1')

    // 批量恢复（故意把子书签排在前面）
    restoreItems(ds, [
      { type: 'bookmark', id: 'c1' },
      { type: 'bookmark', id: 'p1' },
    ])

    // 恢复后父子状态均正常，且关系完整保留
    expect(ds.bookmarkMap['p1'].deletedAt).toBeUndefined()
    expect(ds.bookmarkMap['c1'].deletedAt).toBeUndefined()
    expect(ds.bookmarkMap['c1'].parentId).toBe('p1')
  })
})

describe('permanentDeleteItems', () => {
  it('按 type 分发到对应单 id 永久删除方法', () => {
    const ds = useDataStore()
    const spies = {
      bookmark: vi.spyOn(ds, 'permanentDeleteBookmark'),
      group: vi.spyOn(ds, 'permanentDeleteGroup'),
      category: vi.spyOn(ds, 'permanentDeleteCategory'),
      attribute: vi.spyOn(ds, 'permanentDeleteAttribute'),
    }
    permanentDeleteItems(ds, [
      { type: 'bookmark', id: 'b1' },
      { type: 'group', id: 'g1' },
      { type: 'category', id: 'c1' },
      { type: 'attribute', id: 'a1' },
    ])
    expect(spies.bookmark).toHaveBeenCalledExactlyOnceWith('b1')
    expect(spies.group).toHaveBeenCalledExactlyOnceWith('g1')
    expect(spies.category).toHaveBeenCalledExactlyOnceWith('c1')
    expect(spies.attribute).toHaveBeenCalledExactlyOnceWith('a1')
  })
})
