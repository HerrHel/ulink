/**
 * siteRecall — 本站回想匹配与排序
 */
import { describe, it, expect } from 'vitest'
import { siteHost, isSameSite, notesSnippet, findSiteBookmarks } from '../../lib/siteRecall'
import type { Bookmark } from '../../types'

function bm(id: string, url: string, extra: Partial<Bookmark> = {}): Bookmark {
  return { id, url, title: id, notes: '', useCount: 0, updatedAt: 1, ...extra } as Bookmark
}

describe('siteHost', () => {
  it('小写、去 www.、去末尾点号', () => {
    expect(siteHost('https://WWW.GitHub.com/a')).toBe('github.com')
    expect(siteHost('http://example.com./x')).toBe('example.com')
  })
  it('非 http(s)、非法串、空值返回空', () => {
    expect(siteHost('javascript:alert(1)')).toBe('')
    expect(siteHost('chrome://extensions')).toBe('')
    expect(siteHost('abc.def.ghi')).toBe('')
    expect(siteHost('')).toBe('')
    expect(siteHost(null)).toBe('')
  })
})

describe('isSameSite', () => {
  it('相同主机与父子域名互相匹配', () => {
    expect(isSameSite('github.com', 'github.com')).toBe(true)
    expect(isSameSite('docs.github.com', 'github.com')).toBe(true)
    expect(isSameSite('github.com', 'gist.github.com')).toBe(true)
  })
  it('兄弟子域不匹配（a.github.io 与 b.github.io 是两个站）', () => {
    expect(isSameSite('a.github.io', 'b.github.io')).toBe(false)
  })
  it('按点号边界匹配，不把 notgithub.com 当成 github.com', () => {
    expect(isSameSite('notgithub.com', 'github.com')).toBe(false)
  })
  it('单段主机（localhost）只认完全相同', () => {
    expect(isSameSite('a.localhost', 'localhost')).toBe(false)
    expect(isSameSite('localhost', 'localhost')).toBe(true)
    expect(isSameSite('', '')).toBe(false)
  })
})

describe('notesSnippet', () => {
  it('去标签、合并空白、解常见实体', () => {
    expect(notesSnippet('<p>用法：</p><p>a &amp; b&nbsp;&lt;c&gt;</p>')).toBe('用法： a & b <c>')
  })
  it('超长截断加省略号，按字符而非 UTF-16 截', () => {
    expect(notesSnippet('一二三四五', 3)).toBe('一二三…')
    expect(notesSnippet('😀😀😀😀', 2)).toBe('😀😀…')
  })
  it('空值返回空串', () => {
    expect(notesSnippet(undefined)).toBe('')
  })
})

describe('findSiteBookmarks', () => {
  const list = [
    bm('a', 'https://github.com/vuejs/core', { useCount: 1, updatedAt: 5 }),
    bm('b', 'https://docs.github.com/en', { useCount: 9 }),
    bm('c', 'https://github.com/x', { pinnedAt: 100 }),
    bm('d', 'https://github.com/deleted', { deletedAt: 10, useCount: 99 }),
    bm('e', 'https://gitlab.com/', { useCount: 50 }),
    bm('f', 'https://github.com/y', { useCount: 1, updatedAt: 9 }),
  ]
  it('只取同站、排除已删除与当前已收藏项，置顶 → 常用 → 最近更新排序', () => {
    const ids = findSiteBookmarks(list, 'https://www.github.com/current', 'a').map(b => b.id)
    expect(ids).toEqual(['c', 'b', 'f'])
  })
  it('不传 excludeId 时全部同站项都返回', () => {
    expect(findSiteBookmarks(list, 'https://github.com/').map(b => b.id)).toEqual(['c', 'b', 'f', 'a'])
  })
  it('当前网址无效时返回空', () => {
    expect(findSiteBookmarks(list, 'chrome://newtab')).toEqual([])
    expect(findSiteBookmarks(list, null)).toEqual([])
  })
  it('不修改入参数组', () => {
    const copy = list.map(b => b.id)
    findSiteBookmarks(list, 'https://github.com/')
    expect(list.map(b => b.id)).toEqual(copy)
  })
})
