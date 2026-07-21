import { describe, it, expect, vi } from 'vitest'
import { esc, domain, fixUrl, cleanZeroWidth, isMobile, favicon, gid, copyToClipboard, getTagNames } from '../utils.js'
import { safeAtob } from '../crypto.js'

describe('utils', () => {
  describe('esc', () => {
    it('should escape HTML entities', () => {
      expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    })
    it('should handle normal text', () => {
      expect(esc('hello world')).toBe('hello world')
    })
    it('should handle empty string', () => {
      expect(esc('')).toBe('')
    })
    it('should escape ampersands', () => {
      expect(esc('a & b')).toBe('a &amp; b')
    })
    it('should escape double quotes (S1: attribute-context safe)', () => {
      expect(esc('"hello"')).toBe('&quot;hello&quot;')
    })
    it('should escape single quotes (S1: attribute-context safe)', () => {
      expect(esc("'hello'")).toBe('&#39;hello&#39;')
    })
    it('should escape an attribute-injection XSS payload (S1)', () => {
      // payload 意在闭合 src="..." 后注入 onerror；esc 必须转义 " 使其无法闭合属性
      const payload = 'x" onerror="alert(1)'
      const out = esc(payload)
      expect(out).toBe('x&quot; onerror=&quot;alert(1)')
      expect(out).not.toContain('"')
    })
    it('should escape angle brackets and ampersand together', () => {
      expect(esc('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;')
    })
  })

  describe('domain', () => {
    it('should extract domain from URL', () => {
      expect(domain('https://www.example.com/path')).toBe('example.com')
    })
    it('should handle URLs without www', () => {
      expect(domain('https://example.com')).toBe('example.com')
    })
    it('should return original string for invalid URLs', () => {
      expect(domain('not-a-url')).toBe('not-a-url')
    })
  })

  describe('fixUrl', () => {
    it('should add https:// if missing', () => {
      expect(fixUrl('example.com')).toBe('https://example.com')
    })
    it('should not modify URLs with http://', () => {
      expect(fixUrl('http://example.com')).toBe('http://example.com')
    })
    it('should not modify URLs with https://', () => {
      expect(fixUrl('https://example.com')).toBe('https://example.com')
    })
    it('should handle empty string', () => {
      expect(fixUrl('')).toBe('')
    })
    it('should trim whitespace', () => {
      expect(fixUrl('  example.com  ')).toBe('https://example.com')
    })
    // S1：危险 scheme 一律返回空串，杜绝 javascript:alert(1) 等跨用户 XSS
    it('should reject javascript: scheme (S1)', () => {
      expect(fixUrl('javascript:alert(1)')).toBe('')
    })
    it('should reject data: scheme (S1)', () => {
      expect(fixUrl('data:text/html,<script>alert(1)</script>')).toBe('')
    })
    it('should reject vbscript: scheme (S1)', () => {
      expect(fixUrl('vbscript:msgbox(1)')).toBe('')
    })
    it('should reject mixed-case JAVASCRIPT: scheme (S1)', () => {
      expect(fixUrl('JaVaScRiPt:alert(1)')).toBe('')
    })
    it('should reject scheme with leading whitespace (S1)', () => {
      expect(fixUrl('  javascript:alert(1)  ')).toBe('')
    })
  })

  describe('safeAtob', () => {
    it('should decode base64', () => {
      expect(safeAtob(btoa('hello'))).toBe('hello')
    })
    it('should return original string for invalid base64', () => {
      expect(safeAtob('not-base64!@#')).toBe('not-base64!@#')
    })
  })

  describe('cleanZeroWidth', () => {
    it('should remove consecutive zero-width characters', () => {
      const input = 'hello\u200B\u200Bworld'
      const result = cleanZeroWidth(input)
      expect(result).toBe('hello\u200Bworld')
    })
    it('should not modify text without zero-width chars', () => {
      expect(cleanZeroWidth('hello world')).toBe('hello world')
    })
  })

  describe('favicon', () => {
    it('should return custom icon if provided', () => {
      expect(favicon('https://example.com', 'custom.png')).toBe('custom.png')
    })
    it('should return favicon URL for valid domain', () => {
      const result = favicon('https://example.com')
      expect(result).toContain('example.com')
    })
    it('should handle empty URL', () => {
      const result = favicon('')
      expect(result).toBe('')
    })
  })

  describe('gid', () => {
    it('should generate a string ID', () => {
      const id = gid()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })
    it('should generate unique IDs', () => {
      const id1 = gid()
      const id2 = gid()
      expect(id1).not.toBe(id2)
    })
  })

  describe('isMobile', () => {
    it('should return boolean', () => {
      const result = isMobile()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('copyToClipboard', () => {
    it('should call navigator.clipboard.writeText', () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
      })
      copyToClipboard('test text', 'Label')
      expect(writeText).toHaveBeenCalledWith('test text')
    })
  })

  describe('getTagNames', () => {
    const attrs = [
      { id: 't1', name: '标签一', type: 'boolean' as const },
      { id: 't2', name: '标签二', type: 'boolean' as const },
      { id: 'is-group', name: '内置组', type: 'boolean' as const },
      { id: 't3', name: '已软删', type: 'boolean' as const, deletedAt: 1 },
    ]
    it('仅收集属性为 true 且非内置组、未软删的名字', () => {
      const item = { attributes: { t1: true, t2: false, 'is-group': true, t3: true } } as any
      expect(getTagNames(item, attrs as any)).toEqual(['标签一'])
    })
    it('无 attributes 返回空数组', () => {
      expect(getTagNames({ attributes: null } as any, attrs as any)).toEqual([])
    })
  })
})
