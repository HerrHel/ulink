import { describe, it, expect } from 'vitest'
import { inlineCardHTML, groupRefCardHTML } from '../composables/useInlineCard.js'

describe('inlineCardHTML', () => {
  it('should generate correct HTML for a bookmark', () => {
    const bm = { id: 'b1', title: 'GitHub', url: 'https://github.com', icon: '' } as any
    const html = inlineCardHTML(bm)
    expect(html).toContain('group-inline-card')
    expect(html).toContain('data-bm-id="b1"')
    expect(html).toContain('GitHub')
    expect(html).toContain('github.com')
    expect(html).toContain('contenteditable="false"')
    expect(html).toContain('draggable="true"')
  })

  it('should use custom icon when provided', () => {
    const bm = { id: 'b1', title: 'Test', url: 'https://test.com', icon: 'https://custom.icon/test.png' } as any
    const html = inlineCardHTML(bm)
    expect(html).toContain('https://custom.icon/test.png')
  })

  it('should escape HTML in title', () => {
    const bm = { id: 'b1', title: '<script>alert(1)</script>', url: 'https://test.com', icon: '' } as any
    const html = inlineCardHTML(bm)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('groupRefCardHTML', () => {
  it('should generate correct HTML for a group reference', () => {
    const g = { id: 'g1', name: 'AI Tools', icon: '', bookmarkIds: ['b1', 'b2'] } as any
    const html = groupRefCardHTML(g)
    expect(html).toContain('group-ref-card')
    expect(html).toContain('data-bm-id="ref:g1"')
    expect(html).toContain('AI Tools')
    expect(html).toContain('2个')
  })

  it('should use group icon when provided', () => {
    const g = { id: 'g1', name: 'Test', icon: 'https://icon.png', bookmarkIds: [] } as any
    const html = groupRefCardHTML(g)
    expect(html).toContain('https://icon.png')
  })

  it('should show note SVG icon when no icon provided', () => {
    const g = { id: 'g1', name: 'Test', icon: '', bookmarkIds: [] } as any
    const html = groupRefCardHTML(g)
    expect(html).toContain('svg')
  })
})
