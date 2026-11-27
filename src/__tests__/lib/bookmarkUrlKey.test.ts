/**
 * bookmarkUrlKey —— 「是不是同一个网站页面」的比对键（2026-11-27，修从分享保存出现重复书签）
 * 只抹掉不改变指向的写法差异；路径与查询参数不同必须仍是不同键。
 */
import { describe, it, expect } from 'vitest'
import { bookmarkUrlKey } from '../../lib/bookmarkDedup.js'

describe('bookmarkUrlKey', () => {
  it.each([
    ['https://vert.sh', 'https://vert.sh/'],
    ['http://vert.sh', 'https://vert.sh'],
    ['https://www.ilovepdf.com', 'https://ilovepdf.com/'],
    ['https://Tools.PDF24.org/', 'https://tools.pdf24.org'],
    ['https://cloudconvert.com/#top', 'https://cloudconvert.com/'],
    ['  https://vert.sh  ', 'https://vert.sh'],
    ['https://example.com/docs/', 'https://example.com/docs'],
    ['https://example.com:443/a', 'https://example.com/a'],
    ['vert.sh/a', 'https://vert.sh/a'],
    // 沿用原有口径：路径大小写不敏感
    ['https://case.example.com/PATH', 'https://Case.Example.com/path'],
  ])('%s ≡ %s', (a, b) => {
    expect(bookmarkUrlKey(a)).toBe(bookmarkUrlKey(b))
    expect(bookmarkUrlKey(a)).not.toBe('')
  })

  it.each([
    ['https://example.com/a', 'https://example.com/b'],
    ['https://example.com/?q=1', 'https://example.com/?q=2'],
    ['https://a.example.com', 'https://b.example.com'],
    ['https://example.com:8080/', 'https://example.com/'],
  ])('%s ≠ %s', (a, b) => {
    expect(bookmarkUrlKey(a)).not.toBe(bookmarkUrlKey(b))
  })

  it('空值返回空串（调用方视为无法比对）', () => {
    expect(bookmarkUrlKey('')).toBe('')
    expect(bookmarkUrlKey('   ')).toBe('')
    expect(bookmarkUrlKey(null)).toBe('')
    expect(bookmarkUrlKey(undefined)).toBe('')
  })

  it('非 http(s) 协议原样比较', () => {
    expect(bookmarkUrlKey('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(bookmarkUrlKey('mailto:a@b.com')).not.toBe(bookmarkUrlKey('mailto:c@d.com'))
  })
})
