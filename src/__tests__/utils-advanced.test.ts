import { describe, it, expect } from 'vitest'
import { fixUrl, domain, sanitizeHTML, sanitizeReadonlyHTML, createCategory, swapOrder } from '../utils.js'

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

  it('should remove details/summary tags (S5: 白名单不含 details，杜绝 <details ontoggle>)', () => {
    const result = sanitizeHTML('<details ontoggle="alert(1)" open><summary>Click</summary><p>Content</p></details>')
    expect(result).not.toContain('<details')
    expect(result).not.toContain('<summary')
    expect(result).not.toContain('ontoggle')
    // 内层 p 仍保留
    expect(result).toContain('<p>Content</p>')
  })

  it('should strip contenteditable/draggable attrs (S5: 展示侧无需，且防止语义劫持)', () => {
    const result = sanitizeHTML('<span contenteditable="false" draggable="true">Test</span>')
    expect(result).not.toContain('contenteditable')
    expect(result).not.toContain('draggable')
    // span 本体与文本保留
    expect(result).toContain('Test')
  })

  it('should neutralize javascript: href on <a> (S5)', () => {
    const result = sanitizeHTML('<a href="javascript:alert(1)">click</a>')
    expect(result).not.toContain('javascript:')
    // 经 ALLOWED_URI_REGEXP 过滤后 href 被移除
    expect(result).not.toContain('href=')
  })

  it('should force rel="noopener noreferrer nofollow" and target="_blank" on <a> (S5)', () => {
    const result = sanitizeHTML('<a href="https://example.com">x</a>')
    expect(result).toContain('rel="noopener noreferrer nofollow"')
    expect(result).toContain('target="_blank"')
  })

  it('should strip data: URI in any allowed attribute (S5)', () => {
    const result = sanitizeHTML('<p><a href="data:text/html,<script>alert(1)</script>">x</a></p>')
    expect(result).not.toContain('data:')
    expect(result).not.toContain('<script')
  })

  it('should remove <img> with event attrs (S5: 白名单不含 img)', () => {
    const result = sanitizeHTML('<img src="x" onerror="alert(1)">')
    expect(result).not.toContain('<img')
    expect(result).not.toContain('onerror')
  })

  it('should remove nested <style> (S5)', () => {
    const result = sanitizeHTML('<style>body{background:url(javascript:alert(1))}</style><p>x</p>')
    expect(result).not.toContain('<style')
    expect(result).not.toContain('javascript:')
  })

  it('should keep class attr on span (S5: 内联卡片/高亮依赖)', () => {
    const result = sanitizeHTML('<span class="card-hl">highlighted</span>')
    expect(result).toContain('class="card-hl"')
    expect(result).toContain('highlighted')
  })

  it('should remove onerror handler', () => {
    const result = sanitizeHTML('<img src="x" onerror="alert(1)">')
    expect(result).not.toContain('onerror')
  })
})

// AUDIT-R34：sanitizeReadonlyHTML 只读展示变体白名单测试——放行 img + 已知 data-* 以保留
// inlineCard favicon / 只读点击 / taskList 语义，同时安全屏障（事件属性、协议、script/style）仍堵。
describe('sanitizeReadonlyHTML', () => {
  it('放行 <img> + https src 以保留 inlineCard favicon', () => {
    const result = sanitizeReadonlyHTML('<img src="https://example.com/fav.ico" alt="">')
    expect(result).toContain('<img')
    expect(result).toContain('src="https://example.com/fav.ico"')
  })

  it('剥除 img 事件属性（onerror 不在 ALLOWED_ATTR）', () => {
    const result = sanitizeReadonlyHTML('<img src="https://example.com/x.png" onerror="alert(1)">')
    expect(result).not.toContain('onerror')
    // https src 保留
    expect(result).toContain('src="https://example.com/x.png"')
  })

  it('剥除非 https 协议 src（data:/javascript:/blob:）', () => {
    expect(sanitizeReadonlyHTML('<img src="data:text/html,<script>alert(1)<\/script>">')).not.toContain('data:')
    expect(sanitizeReadonlyHTML('<img src="javascript:alert(1)">')).not.toContain('javascript:')
    expect(sanitizeReadonlyHTML('<img src="blob:https://x/y">')).not.toContain('blob:')
  })

  it('保留已知 data-* 属性（inlineCard data-bm-id / taskList data-type/data-checked）', () => {
    const result = sanitizeReadonlyHTML('<span class="group-inline-card" data-bm-id="bm123" draggable="true">详</span>')
    expect(result).toContain('data-bm-id="bm123"')
    // contenteditable/draggable 仍被剥（只读无需编辑/拖拽）
    expect(result).not.toContain('draggable')
    expect(result).not.toContain('contenteditable')
  })

  it('保留 taskList 的 data-type/data-checked 语义', () => {
    const result = sanitizeReadonlyHTML('<ul data-type="taskList"><li data-type="taskItem" data-checked="true">done</li></ul>')
    expect(result).toContain('data-type="taskList"')
    expect(result).toContain('data-type="taskItem"')
    expect(result).toContain('data-checked="true"')
  })

  it('DOMPurify 对 data- 前缀整族放行（列任一 data-x 即放行所有 data-*）：安全依赖 FORBID_TAGS 堵 CSS 注入面', () => {
    // 注：DECLARE_R34 判定 data-* 整族放行在 style/script 被 FORBID_TAGS 堵死的前提下无可见注入面
    // （data-* 无事件 handler 可挂、无协议可跳转，唯 CSS attribute selector exfiltration 面，已被 CSS 堵）。
    const result = sanitizeReadonlyHTML('<span data-evil="x" data-bm-id="ok">t</span>')
    // data-bm-id 保留
    expect(result).toContain('data-bm-id="ok"')
    // data-evil 亦保留（DOMPurify 整族放行行为）；安全论证见 utils.ts _purifyReadonlyConfig 注释
    expect(result).toContain('data-evil')
  })

  it('但 data-* 上的事件属性（如 data-onfoo 中的 on 其实是独立事件属性）仍被 ALLOWED_ATTR 剥', () => {
    // 真正的事件属性 onerror/onclick 与 data-* 不同族，不在白名单故被剥
    const result = sanitizeReadonlyHTML('<span data-bm-id="ok" onerror="alert(1)" onclick="alert(1)">t</span>')
    expect(result).not.toContain('onerror')
    expect(result).not.toContain('onclick')
    expect(result).toContain('data-bm-id="ok"')
  })

  it('仍剥除 script/style/iframe/input 等危险标签（共享 FORBID_TAGS）', () => {
    expect(sanitizeReadonlyHTML('<script>alert(1)</script>')).not.toContain('<script')
    expect(sanitizeReadonlyHTML('<style>body{x:1}</style>')).not.toContain('<style')
    expect(sanitizeReadonlyHTML('<iframe src="evil"></iframe>')).not.toContain('<iframe>')
    // AUDIT-R34 选择不加 input（taskList 勾选态用 CSS 呈现，避免表单控件加载面）
    expect(sanitizeReadonlyHTML('<input type="checkbox">')).not.toContain('<input')
  })

  it('仍对 <a> 强制安全 rel/target + 剥 javascript: href（复用 afterSanitizeAttributes 钩子）', () => {
    const safe = sanitizeReadonlyHTML('<a href="https://example.com">x</a>')
    expect(safe).toContain('rel="noopener noreferrer nofollow"')
    expect(safe).toContain('target="_blank"')
    const evil = sanitizeReadonlyHTML('<a href="javascript:alert(1)">x</a>')
    expect(evil).not.toContain('javascript:')
    expect(evil).not.toContain('href=')
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
