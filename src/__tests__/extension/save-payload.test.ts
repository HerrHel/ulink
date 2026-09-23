/**
 * extension/save-payload.js 纯函数测试
 */
import { describe, it, expect } from 'vitest'
import '../../../extension/save-payload.js'

function getWindowApi() {
  const api = window.LinkVaultSavePayload
  expect(api, 'extension/save-payload.js 应挂载 window.LinkVaultSavePayload').toBeDefined()
  return api!
}

describe('extension/save-payload.js — isSafeHttpUrl', () => {
  it('仅放行 http 与 https', () => {
    expect(getWindowApi().isSafeHttpUrl('https://example.com')).toBe(true)
    expect(getWindowApi().isSafeHttpUrl('http://localhost:5173')).toBe(true)
    expect(getWindowApi().isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(getWindowApi().isSafeHttpUrl('data:text/html,abc')).toBe(false)
    expect(getWindowApi().isSafeHttpUrl('chrome://extensions')).toBe(false)
    expect(getWindowApi().isSafeHttpUrl('')).toBe(false)
    expect(getWindowApi().isSafeHttpUrl(null as any)).toBe(false)
  })
})

describe('extension/save-payload.js — normalizeUrlForMatch', () => {
  it('规整末尾斜杠与 http/https', () => {
    expect(getWindowApi().normalizeUrlForMatch('http://example.com/')).toBe('https://example.com')
    expect(getWindowApi().normalizeUrlForMatch('https://example.com///')).toBe('https://example.com')
    expect(getWindowApi().normalizeUrlForMatch('https://example.com/path/')).toBe('https://example.com/path')
  })
})

describe('extension/save-payload.js — extractHostname', () => {
  it('提取安全域名', () => {
    expect(getWindowApi().extractHostname('https://news.ycombinator.com/item?id=123')).toBe('news.ycombinator.com')
    expect(getWindowApi().extractHostname('example.com/foo')).toBe('example.com')
    expect(getWindowApi().extractHostname('')).toBe('')
  })
})

describe('extension/save-payload.js — newBookmarkId & nextBookmarkOrder', () => {
  it('生成合法 b 开头 id', () => {
    const id = getWindowApi().newBookmarkId()
    expect(id).toMatch(/^b[a-z0-9]+$/)
  })

  it('正确计算 order (现存最大+1 或 兜底 1)', () => {
    expect(getWindowApi().nextBookmarkOrder([])).toBe(1)
    expect(getWindowApi().nextBookmarkOrder([{ order: 10 }, { order: 25 }, { order: 3 }] as any)).toBe(26)
  })
})

describe('extension/save-payload.js — buildBookmarkPayload', () => {
  it('成功组装完整合规的 Bookmark Row', () => {
    const payload = getWindowApi().buildBookmarkPayload({
      url: 'https://news.ycombinator.com/',
      title: 'Hacker News',
      categoryId: 'cat_read',
      notes: '每日阅读',
      favIconUrl: 'https://news.ycombinator.com/favicon.ico',
      userId: 'uuid-1234',
      existingBookmarks: [{ order: 5 }] as any,
    })

    expect(payload.id).toMatch(/^b/)
    expect(payload.user_id).toBe('uuid-1234')
    expect(payload.title).toBe('Hacker News')
    expect(payload.url).toBe('https://news.ycombinator.com/')
    expect(payload.category_id).toBe('cat_read')
    expect(payload.notes).toBe('每日阅读')
    expect(payload.icon).toBe('https://news.ycombinator.com/favicon.ico')
    expect(payload.order).toBe(6)
    expect(payload.deleted_at).toBeNull()
    expect(payload.parent_id).toBeNull()
    expect(payload.created_at_num).toBeGreaterThan(0)
    expect(payload.updated_at_num).toBe(payload.created_at_num)
  })

  it('支持传入 parentId 构建子书签', () => {
    const payload = getWindowApi().buildBookmarkPayload({
      url: 'https://docs.github.com/en',
      title: 'GitHub Docs',
      parentId: 'bm_github_root',
      userId: 'uuid-1234',
    })

    expect(payload.parent_id).toBe('bm_github_root')
    expect(payload.title).toBe('GitHub Docs')
  })


  it('缺省值兜底（分类默认为 uncategorized，标题默认为域名）', () => {
    const payload = getWindowApi().buildBookmarkPayload({
      url: 'https://vite.dev',
      userId: 'uuid-1234',
    })

    expect(payload.category_id).toBe('uncategorized')
    expect(payload.title).toBe('vite.dev')
    expect(payload.notes).toBe('')
    expect(payload.icon).toContain('google.com/s2/favicons?domain=vite.dev')
    expect(payload.order).toBe(1)
  })

  it('不安全或非法 URL 抛出异常', () => {
    expect(() => getWindowApi().buildBookmarkPayload({ url: 'javascript:void(0)' })).toThrow('UNSAFE_OR_INVALID_URL')
  })

  it('window 挂载对象正常工作', () => {
    const api = getWindowApi()
    expect(typeof api.buildBookmarkPayload).toBe('function')
  })
})
