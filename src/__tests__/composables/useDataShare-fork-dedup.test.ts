/**
 * 从分享保存时的书签去重（2026-11-27）
 *
 * 问题：fork 的去重只拿「原始 URL 转小写」做字符串比较，库里已有的书签只要写法略有不同
 * （结尾斜杠、http/https、www.、主机名大小写、#锚点、首尾空格）就判不出是同一个，
 * 保存分享后库里出现重复书签。应用自己新建书签时的查重（isExactDuplicate）会先规范化 URL，
 * 两条路径口径不一致。
 *
 * 锁住的契约：这些写法差异都视为同一书签——不新增，笔记引用与收录指向库里已有那条。
 * 同时路径/查询参数不同的仍是不同书签（不能误杀）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const _newId = vi.hoisted(() => ({ g: 0 }))
vi.mock('../../lib/newId.js', () => ({
  newId: (prefix: string, hint?: number | string) =>
    prefix === 'g' ? 'g-new-' + (++_newId.g) : `${prefix}-new-${hint ?? 'x'}`,
}))
vi.mock('../../lib/toast.js', () => ({ toast: vi.fn() }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))
vi.mock('../../composables/domain/useCloudSync.js', () => ({
  useCloudSync: () => ({ fullSync: vi.fn(async () => {}), fetchPublicGroup: vi.fn() }),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  _newId.g = 0
})

const bm = (id: string, url: string, over: Record<string, unknown> = {}) => ({
  id, title: id, url, username: '', password: '', notes: '', icon: '',
  categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {},
  isExpanded: false, createdAt: 1, updatedAt: 1, ...over,
}) as any

const shareGroup = (ids: string[], notes = '') => ({
  id: 'g-src', name: '分享笔记', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
  attributes: {}, bookmarkIds: ids, notes, useCount: 0, updatedAt: 1, isPublic: true,
}) as any

async function setup(localUrls: string[]) {
  const { useDataStore } = await import('../../stores/data.js')
  const ds = useDataStore()
  localUrls.forEach((u, i) => ds.addBookmark(bm(`b-local-${i}`, u)))
  const { forkPublicGroup } = await import('../../composables/domain/useDataShare.js')
  return { ds, forkPublicGroup }
}

describe('从分享保存：库里已有的书签不重复保存', () => {
  it.each([
    ['结尾斜杠', 'https://vert.sh/', 'https://vert.sh'],
    ['路径结尾斜杠', 'https://example.com/docs', 'https://example.com/docs/'],
    ['http 与 https', 'http://vert.sh', 'https://vert.sh'],
    ['www 前缀', 'https://www.ilovepdf.com', 'https://ilovepdf.com/'],
    ['主机名大小写', 'https://Tools.PDF24.org/', 'https://tools.pdf24.org/'],
    ['#锚点', 'https://cloudconvert.com/#top', 'https://cloudconvert.com/'],
    ['首尾空格', '  https://vert.sh  ', 'https://vert.sh'],
  ])('%s：本地 %s，分享 %s → 不新增', async (_label, local, shared) => {
    const { ds, forkPublicGroup } = await setup([local])
    const before = ds.bookmarks.length
    const card = '<span class="group-inline-card" data-bm-id="s1"></span>'

    await forkPublicGroup(shareGroup(['s1'], `<p>${card}</p>`), [bm('s1', shared)])

    expect(ds.bookmarks.length).toBe(before)
    const g = ds.siblingGroups.find((x: any) => x.name === '分享笔记') as any
    expect(g.notes).toContain('data-bm-id="b-local-0"')
  })

  it('路径或查询参数不同：仍是不同书签，照常新增', async () => {
    const { ds, forkPublicGroup } = await setup(['https://example.com/a', 'https://example.com/?q=1'])
    const before = ds.bookmarks.length
    await forkPublicGroup(shareGroup(['s1', 's2']), [bm('s1', 'https://example.com/b'), bm('s2', 'https://example.com/?q=2')])
    expect(ds.bookmarks.length).toBe(before + 2)
  })

  it('部分已有：只新增库里没有的那几条', async () => {
    const { ds, forkPublicGroup } = await setup(['https://vert.sh/', 'https://www.ilovepdf.com'])
    const before = ds.bookmarks.length
    await forkPublicGroup(shareGroup(['s1', 's2', 's3']), [
      bm('s1', 'https://vert.sh'),
      bm('s2', 'https://ilovepdf.com/'),
      bm('s3', 'https://cloudconvert.com'),
    ])
    expect(ds.bookmarks.length).toBe(before + 1)
    expect(ds.bookmarks.filter((b: any) => b.url.includes('vert.sh'))).toHaveLength(1)
    expect(ds.bookmarks.filter((b: any) => b.url.includes('ilovepdf'))).toHaveLength(1)
  })
})
