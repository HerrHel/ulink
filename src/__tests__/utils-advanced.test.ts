import { describe, it, expect } from 'vitest'
import { fixUrl, domain, sanitizeHTML, createCategory, swapOrder } from '../utils.js'

describe('sanitizeHTML', () => {
  it('should allow safe HTML tags', () => {
    const result = sanitizeHTML('<p>Hello <strong>world</strong></p>')
    expect(result).toContain('<p>')
    expect(result).toContain('<strong>')
  })

  it('should remove script tags', () => {
    const result = sanitizeHTML('<p>Test</p><script>alert(1)</script>')
    expect(result).not.toContain('<script>')
    expect(result).toContain('<p>Test</p>')
  })

  it('should remove iframe tags', () => {
    const result = sanitizeHTML('<iframe src="evil.com"></iframe>')
    expect(result).not.toContain('<iframe>')
  })

  it('should allow details/summary tags', () => {
    const result = sanitizeHTML('<details><summary>Click</summary><p>Content</p></details>')
    expect(result).toContain('<details>')
    expect(result).toContain('<summary>')
  })

  it('should allow contenteditable and draggable attrs', () => {
    const result = sanitizeHTML('<span contenteditable="false" draggable="true">Test</span>')
    expect(result).toContain('contenteditable')
    expect(result).toContain('draggable')
  })

  it('should remove onerror handler', () => {
    const result = sanitizeHTML('<img src="x" onerror="alert(1)">')
    expect(result).not.toContain('onerror')
  })
})

describe('createCategory', () => {
  it('should create category with valid id and name', () => {
    const cat = createCategory('My Category')
    expect(cat.name).toBe('My Category')
    expect(cat.id).toBeDefined()
    expect(cat.icon).toBe('star')
    expect(cat.color).toBeDefined()
  })

  it('should generate unique ids', () => {
    const cat1 = createCategory('A')
    const cat2 = createCategory('B')
    expect(cat1.id).not.toBe(cat2.id)
  })
})

describe('swapOrder', () => {
  it('should swap order values', () => {
    const a = { order: 1 }
    const b = { order: 5 }
    swapOrder(a, b)
    expect(a.order).toBe(5)
    expect(b.order).toBe(1)
  })

  it('should increment b.order when equal', () => {
    const a = { order: 3 }
    const b = { order: 3 }
    swapOrder(a, b)
    expect(a.order).toBe(4)
    expect(b.order).toBe(3)
  })
})

describe('domain edge cases', () => {
  it('should strip www prefix', () => {
    expect(domain('https://www.example.com')).toBe('example.com')
  })

  it('should handle subdomains', () => {
    expect(domain('https://api.example.com')).toBe('api.example.com')
  })

  it('should handle URLs with ports', () => {
    expect(domain('https://localhost:3000/path')).toBe('localhost')
  })

  it('should return original string for invalid URLs', () => {
    expect(domain('not-a-url')).toBe('not-a-url')
  })
})

describe('fixUrl edge cases', () => {
  it('should add https to domain-only input', () => {
    expect(fixUrl('example.com')).toBe('https://example.com')
  })

  it('should preserve http://', () => {
    expect(fixUrl('http://example.com')).toBe('http://example.com')
  })

  it('should handle empty string', () => {
    expect(fixUrl('')).toBe('')
  })

  it('should trim whitespace', () => {
    expect(fixUrl('  example.com  ')).toBe('https://example.com')
  })

  it('should handle URLs with paths', () => {
    expect(fixUrl('example.com/path?q=1')).toBe('https://example.com/path?q=1')
  })
})
