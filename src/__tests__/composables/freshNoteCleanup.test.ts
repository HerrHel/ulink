/**
 * 新建笔记「什么都没写就离开 → 自动彻底删除」护栏。
 * 锁住：① 只清理 createNoteAndFocus 刚新建的那一张，已有空笔记不碰；② 任何离开途径都生效
 * （直接改 focusedGroupId 模拟侧栏/后退）；③ 有标题/正文/书签/图片任一内容就保留；
 * ④ 标题已输入未落库时以界面实时内容为准：保留并补存标题；⑤ 不进回收站。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { createNoteAndFocus, createGroup, isEmptyNote } from '../../composables/domain/useGroup.js'
import type { SiblingGroup } from '../../types.js'

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn().mockResolvedValue(true),
}))

afterEach(() => {
  document.body.innerHTML = ''
})

const exists = (id: string) => useDataStore().siblingGroups.some(g => g.id === id)

describe('isEmptyNote', () => {
  const base = { name: '', notes: '', bookmarkIds: [], icon: '' } as unknown as SiblingGroup
  it.each([
    ['全空', {}, true],
    ['默认名「未命名」', { name: '未命名' }, true],
    ['只有空段落和 &nbsp;', { notes: '<p></p><p>&nbsp;</p>' }, true],
    ['有标题', { name: '读书' }, false],
    ['有正文文字', { notes: '<p>hi</p>' }, false],
    ['正文只有图片', { notes: '<p><img src="x.png"></p>' }, false],
    ['正文只有书签卡片', { notes: '<p><span data-bm-id="b1"></span></p>' }, false],
    ['有成员书签', { bookmarkIds: ['b1'] }, false],
    ['有图标', { icon: 'https://x/i.png' }, false],
  ])('%s', (_n, patch, expected) => {
    expect(isEmptyNote({ ...base, ...patch } as SiblingGroup)).toBe(expected)
  })
})

describe('新建后离开的空笔记自动删除', () => {
  it('什么都没写就离开：彻底删除，不进回收站', () => {
    const ui = useUIStore()
    const id = createNoteAndFocus()
    expect(ui.focusedGroupId).toBe(id)
    ui.focusedGroupId = null
    expect(exists(id)).toBe(false)
  })

  it('写了标题再离开：保留', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const id = createNoteAndFocus()
    ds.updateGroup(id, { name: '周末计划' })
    ui.focusedGroupId = null
    expect(exists(id)).toBe(true)
  })

  it('写了正文再离开：保留', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const id = createNoteAndFocus()
    ds.updateGroup(id, { notes: '<p>要点</p>' })
    ui.focusedGroupId = null
    expect(exists(id)).toBe(true)
  })

  it('标题已在输入框里但还没落库：以界面内容为准，保留并补存标题', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const id = createNoteAndFocus()
    const title = document.createElement('span')
    title.className = 'focus-title-input'
    title.textContent = '临时想法'
    document.body.appendChild(title)
    ui.focusedGroupId = null
    expect(exists(id)).toBe(true)
    expect(ds.groupMap[id].name).toBe('临时想法')
  })

  it('不是刚新建的空笔记：离开时不碰', () => {
    const ui = useUIStore()
    const id = createGroup()
    ui.focusedGroupId = id
    ui.focusedGroupId = null
    expect(exists(id)).toBe(true)
  })

  it('只判一次：离开后再回来再离开，不再被当作新笔记清理', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const id = createNoteAndFocus()
    ds.updateGroup(id, { name: '保留' })
    ui.focusedGroupId = null
    ds.updateGroup(id, { name: '' })
    ui.focusedGroupId = id
    ui.focusedGroupId = null
    expect(exists(id)).toBe(true)
  })
})
