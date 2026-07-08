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
  it('should neutralize event-attribute injection in id/title/icon via esc (S1)', () => {
    // 攻击者把双引号塞进 id/title/icon，企图闭合属性后注入 onmouseover/onerror/onfocus
    const bm = {
      id: 'x" onmouseover="alert(1)',
      title: 'y" onfocus="alert(2)',
      url: 'https://test.com',
      icon: 'z" onerror="alert(3)',
    } as any
    const html = inlineCardHTML(bm)
    // 用真实 DOM 解析断言：转义后的引号无法闭合属性，事件处理器不会成为独立属性
    const el = document.createElement('div')
    el.innerHTML = html
    const card = el.firstElementChild as HTMLElement
    expect(card).not.toBeNull()
    // 关键：card 上不应出现任何事件处理器属性
    expect(card.getAttribute('onmouseover')).toBeNull()
    expect(card.getAttribute('onerror')).toBeNull()
    expect(card.getAttribute('onfocus')).toBeNull()
    // data-bm-id 里 "被反转义为文本，而不是边界
    expect(card.getAttribute('data-bm-id')).toBe('x" onmouseover="alert(1)')
    const img = card.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('onerror')).toBeNull()
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
