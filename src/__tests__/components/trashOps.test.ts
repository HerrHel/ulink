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
