import { describe, it, expect, vi } from 'vitest'
import { esc, domain, fixUrl, cleanZeroWidth, isMobile, favicon, gid, copyToClipboard } from '../utils.js'
import { safeAtob } from '../crypto.js'

describe('utils', () => {
  describe('esc', () => {
    it('should escape HTML entities', () => {
      expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;')
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
    it('should escape quotes', () => {
      expect(esc('"hello"')).toBe('"hello"')
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
})
