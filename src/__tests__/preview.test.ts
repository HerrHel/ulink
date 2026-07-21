import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { bookmarkPreview, groupPreview } from '../lib/preview.js'
import { useDataStore } from '../stores/data.js'
import type { Bookmark, SiblingGroup } from '../types.js'

function bm(partial: Partial<Bookmark> & { id: string }): Bookmark {
  return {
    title: '', url: '', notes: '', username: '', password: '', icon: '',
    categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0,
    attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0,
    ...partial,
  }
}

function grp(partial: Partial<SiblingGroup> & { id: string }): SiblingGroup {
  return {
    name: '', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
    attributes: {}, bookmarkIds: [], notes: '', updatedAt: 0, useCount: 0,
    ...partial,
  }
}

describe('preview', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('bookmarkPreview 抽 notes HTML 为纯文本', () => {
    expect(bookmarkPreview(bm({
      id: 'b1',
      notes: '<p>hello <strong>world</strong></p>',
    }))).toBe('hello world')
  })

  it('bookmarkPreview 空 notes 返回空串', () => {
    expect(bookmarkPreview(bm({ id: 'b1', notes: '' }))).toBe('')
  })

  it('bookmarkPreview 长文本截断到 160 + …', () => {
    const long = '字'.repeat(200)
    const out = bookmarkPreview(bm({ id: 'b1', notes: long }))
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBe(161)
  })

  it('groupPreview 拼接 notes 与成员【标题】', () => {
    const ds = useDataStore()
    ds.addBookmark(bm({ id: 'b1', title: 'GitHub', url: 'https://github.com' }))
    ds.addGroup(grp({ id: 'g1', name: '工具', notes: '<p>备注</p>', bookmarkIds: ['b1'] }))
    const g = ds.groupMap['g1']
    expect(groupPreview(g)).toBe('备注 【GitHub】')
  })

  it('groupPreview 成员可以是嵌套组', () => {
    const ds = useDataStore()
    ds.addGroup(grp({ id: 'inner', name: '内组' }))
    ds.addGroup(grp({ id: 'outer', name: '外组', bookmarkIds: ['inner'] }))
    expect(groupPreview(ds.groupMap['outer'])).toBe('【内组】')
  })

  it('groupPreview 未知 id 跳过', () => {
    const ds = useDataStore()
    ds.addGroup(grp({ id: 'g1', bookmarkIds: ['ghost'] }))
    expect(groupPreview(ds.groupMap['g1'])).toBe('')
  })
})
