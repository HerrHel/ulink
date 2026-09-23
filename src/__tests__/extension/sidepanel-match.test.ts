import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('extension/sidepanel-match.js', () => {
  let api: any

  beforeAll(() => {
    const code = fs.readFileSync(path.resolve(__dirname, '../../../extension/sidepanel-match.js'), 'utf-8')
    const sandbox: any = { globalThis: {} }
    const fn = new Function('globalThis', 'window', code)
    fn(sandbox.globalThis, sandbox.globalThis)
    api = sandbox.globalThis.LinkVaultSidepanelMatch
  })

  it('normalizeUrl standardizes url protocol and trailing slashes', () => {
    expect(api.normalizeUrl('http://example.com/')).toBe('https://example.com')
    expect(api.normalizeUrl('https://example.com/app///')).toBe('https://example.com/app')
    expect(api.normalizeUrl('')).toBe('')
  })

  it('extractDomain correctly parses hostnames and strips www.', () => {
    expect(api.extractDomain('https://www.example.com/path')).toBe('example.com')
    expect(api.extractDomain('http://sub.domain.org:8080/')).toBe('sub.domain.org')
    expect(api.extractDomain('not-a-url')).toBe('')
  })

  it('getNotesPreviewText strips HTML tags, replaces breaks with spaces, and limits length', () => {
    const htmlNotes = '<p>第一行账号：<strong>user123</strong></p><p>第二行密码：&quot;pass&quot;</p>'
    const preview = api.getNotesPreviewText(htmlNotes, 50)
    expect(preview).toBe('第一行账号：user123 第二行密码："pass"')

    const longNotes = 'a'.repeat(120)
    expect(api.getNotesPreviewText(longNotes, 20)).toBe('a'.repeat(20) + '…')
  })

  it('findBookmarkMatch matches exact URL or domain parent', () => {
    const bookmarks = [
      { id: 'b_root', title: '主站', url: 'https://example.com/', parent_id: null },
      { id: 'b_sub', title: '子页面', url: 'https://example.com/sub', parent_id: 'b_root' },
      { id: 'b_other', title: '其他', url: 'https://other.org/', parent_id: null },
    ]

    // 1. 精准匹配根
    const m1 = api.findBookmarkMatch(bookmarks, 'https://example.com')
    expect(m1.exactMatch?.id).toBe('b_root')

    // 2. 精准匹配子
    const m2 = api.findBookmarkMatch(bookmarks, 'https://example.com/sub/')
    expect(m2.exactMatch?.id).toBe('b_sub')

    // 3. 域名匹配主站（内页未被收藏，但主站存在）
    const m3 = api.findBookmarkMatch(bookmarks, 'https://example.com/unregistered/deep/path')
    expect(m3.exactMatch).toBeNull()
    expect(m3.domainParent?.id).toBe('b_root')
  })

  it('resolveSiteHierarchy correctly extracts mainSiteNotes and pageNotes for child bookmarks', () => {
    const bookmarks = [
      { id: 'b_root', title: '主站', url: 'https://example.com/', notes: '主站核心备注：API Key = 123456', password: 'root_password', parent_id: null },
      { id: 'b_sub', title: '子页面', url: 'https://example.com/app', notes: '本页特别说明', password: '', parent_id: 'b_root' },
    ]

    // 访问子书签
    const hierarchy = api.resolveSiteHierarchy(bookmarks, bookmarks[1], 'https://example.com/app')
    expect(hierarchy.isSub).toBe(true)
    expect(hierarchy.parentBm?.id).toBe('b_root')
    expect(hierarchy.mainSiteNotes).toBe('主站核心备注：API Key = 123456')
    expect(hierarchy.pageNotes).toBe('本页特别说明')
    expect(hierarchy.subBookmarks).toHaveLength(1)
    // 密码继承自父级
    expect(hierarchy.effectivePasswordBm?.password).toBe('root_password')
  })

  it('resolveSiteHierarchy handles domain matched unbookmarked pages', () => {
    const bookmarks = [
      { id: 'b_root', title: '主站', url: 'https://example.com/', notes: '主站全局说明', parent_id: null },
    ]

    const hierarchy = api.resolveSiteHierarchy(bookmarks, null, 'https://example.com/unknown-page')
    expect(hierarchy.isDomainMatched).toBe(true)
    expect(hierarchy.parentBm?.id).toBe('b_root')
    expect(hierarchy.mainSiteNotes).toBe('主站全局说明')
  })

  it('filterRootBookmarks never returns child bookmarks as top-level cards', () => {
    const bookmarks = [
      { id: 'b1', title: '主站1', url: 'https://site1.com', category_id: 'dev', parent_id: null },
      { id: 'b1_sub1', title: '子书签1', url: 'https://site1.com/docs', category_id: 'dev', parent_id: 'b1' },
      { id: 'b1_sub2', title: '子书签2', url: 'https://site1.com/api', category_id: 'dev', parent_id: 'b1' },
      { id: 'b2', title: '主站2', url: 'https://site2.com', category_id: 'design', parent_id: null },
    ]

    // 默认列表：仅返回 2 个主站，子书签被严格过滤
    const roots = api.filterRootBookmarks(bookmarks, 'all', '')
    expect(roots.map((r: any) => r.id)).toEqual(['b1', 'b2'])

    // 分类过滤
    const devRoots = api.filterRootBookmarks(bookmarks, 'dev', '')
    expect(devRoots.map((r: any) => r.id)).toEqual(['b1'])

    // 搜索子书签标题 "docs"：主站 b1 命中并返回，子书签自身不作为单独项出现
    const searchSub = api.filterRootBookmarks(bookmarks, 'all', 'docs')
    expect(searchSub.map((r: any) => r.id)).toEqual(['b1'])
  })

  it('isThreePartCipher accurately identifies 3-part base64 ciphers and excludes regular texts', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    expect(api.isThreePartCipher(cipher)).toBe(true)

    expect(api.isThreePartCipher('www.example.com')).toBe(false)
    expect(api.isThreePartCipher('v1.2.3')).toBe(false)
    expect(api.isThreePartCipher('')).toBe(false)
    expect(api.isThreePartCipher(null)).toBe(false)
  })

  it('getNotesPreviewText returns empty string for cipher notes (guarding UI against garbled text)', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    expect(api.getNotesPreviewText(cipher)).toBe('')
  })

  it('filterRootBookmarks ignores cipher notes and titles during keyword search to avoid accidental matches', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    const bookmarks = [
      { id: 'b_cipher', title: 'Normal Title', url: 'https://example.com', notes: cipher, parent_id: null },
      { id: 'b_normal', title: 'Match Target', url: 'https://normal.com', notes: 'AAA target', parent_id: null },
    ]

    // Searching 'AAA' should match b_normal whose note actually has 'AAA', but NOT b_cipher whose note is a cipher string
    const res = api.filterRootBookmarks(bookmarks, 'all', 'AAA')
    expect(res.map((r: any) => r.id)).toEqual(['b_normal'])
  })
})

