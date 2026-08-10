import { describe, it, expect } from 'vitest'
import { sanitizeHTML, sanitizeReadonlyHTML, createCategory, swapOrder, CATEGORY_COLORS } from '../utils.js'

// domain / fixUrl 的逐分支镜像已由 utils.test.ts 覆盖(domain 三例 + fixUrl 含 S1 危险 scheme 真契约),
// 本文件不再重复——避免同类态两文件各立一套镜像,删后零回归增量。
// 留 sanitizeHTML / sanitizeReadonlyHTML 两白名单变体(DOMPurify 配置差异)+ createCategory 排序主键色集 +
// swapOrder equal 递增(各自有独立真实后果:XSS 注入面、分类排序塌陷)。

describe('sanitizeHTML', () => {
  it('放行安全 HTML 标签 + 保留 class（内联卡片/高亮依赖）', () => {
    const result = sanitizeHTML('<p>Hello <strong>world</strong></p>')
    expect(result).toContain('<p>')
    expect(result).toContain('<strong>')
    const hl = sanitizeHTML('<span class="card-hl">highlighted</span>')
    expect(hl).toContain('class="card-hl"')
    expect(hl).toContain('highlighted')
  })

  it('should remove script/iframe/style/details tags (S5: 白名单 FORBID_TAGS 杜绝 <details ontoggle>)', () => {
    // 同一 FORBID_TAGS 路径的对称拒绝合并:script/iframe/style/details 各一断言
    expect(sanitizeHTML('<p>Test</p><script>alert(1)</script>')).not.toContain('<script>')
    expect(sanitizeHTML('<iframe src="evil.com"></iframe>')).not.toContain('<iframe>')
    expect(sanitizeHTML('<style>body{background:url(javascript:alert(1))}</style><p>x</p>')).not.toContain('<style')
    const details = sanitizeHTML('<details ontoggle="alert(1)" open><summary>Click</summary><p>Content</p></details>')
    expect(details).not.toContain('<details')
    expect(details).not.toContain('<summary')
    expect(details).not.toContain('ontoggle')
    // 内层 p 仍保留
    expect(details).toContain('<p>Content</p>')
  })

  it('should strip contenteditable/draggable attrs (S5: 展示侧无需,防语义劫持)', () => {
    const result = sanitizeHTML('<span contenteditable="false" draggable="true">Test</span>')
    expect(result).not.toContain('contenteditable')
    expect(result).not.toContain('draggable')
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

  it('should remove <img> with event attrs (S5: 白名单不含 img,杜绝 onerror)', () => {
    const result = sanitizeHTML('<img src="x" onerror="alert(1)">')
    expect(result).not.toContain('<img')
    expect(result).not.toContain('onerror')
  })
})

// AUDIT-R34：sanitizeReadonlyHTML 只读展示变体白名单测试——放行 img + 已知 data-* 以保留
// inlineCard favicon / 只读点击 / taskList 语义,同时安全屏障(事件属性、协议、script/style)仍堵。
describe('sanitizeReadonlyHTML', () => {
  it('放行 <img> + https src 以保留 inlineCard favicon,剥事件/非 https 协议', () => {
    const result = sanitizeReadonlyHTML('<img src="https://example.com/fav.ico" alt="">')
    expect(result).toContain('<img')
    expect(result).toContain('src="https://example.com/fav.ico"')
    // 剥事件
    const withEvent = sanitizeReadonlyHTML('<img src="https://example.com/x.png" onerror="alert(1)">')
    expect(withEvent).not.toContain('onerror')
    expect(withEvent).toContain('src="https://example.com/x.png"')
    // 剥非 https 协议(data:/javascript:/blob:)
    expect(sanitizeReadonlyHTML('<img src="data:text/html,<script>alert(1)<\/script>">')).not.toContain('data:')
    expect(sanitizeReadonlyHTML('<img src="javascript:alert(1)">')).not.toContain('javascript:')
    expect(sanitizeReadonlyHTML('<img src="blob:https://x/y">')).not.toContain('blob:')
  })

  it('保留已知 data-* 属性（inlineCard data-bm-id / taskList data-type/data-checked）', () => {
    const result = sanitizeReadonlyHTML('<span class="group-inline-card" data-bm-id="bm123" draggable="true">详</span>')
    expect(result).toContain('data-bm-id="bm123"')
    expect(result).not.toContain('draggable')
    expect(result).not.toContain('contenteditable')
    const task = sanitizeReadonlyHTML('<ul data-type="taskList"><li data-type="taskItem" data-checked="true">done</li></ul>')
    expect(task).toContain('data-type="taskList"')
    expect(task).toContain('data-type="taskItem"')
    expect(task).toContain('data-checked="true"')
  })

  it('DOMPurify 对 data- 前缀整族放行（列任一 data-x 即放行所有 data-*）：安全依赖 FORBID_TAGS 堵 CSS 注入面', () => {
    // 注：DECLARE_R34 判定 data-* 整族放行在 style/script 被 FORBID_TAGS 堵死的前提下无可见注入面
    const result = sanitizeReadonlyHTML('<span data-evil="x" data-bm-id="ok">t</span>')
    expect(result).toContain('data-bm-id="ok"')
    expect(result).toContain('data-evil') // DOMPurify 整族放行行为;安全论证见 utils.ts _purifyReadonlyConfig 注释
  })

  it('data-* 上的事件属性（onerror/onclick 与 data-* 不同族）仍被 ALLOWED_ATTR 剥', () => {
    const result = sanitizeReadonlyHTML('<span data-bm-id="ok" onerror="alert(1)" onclick="alert(1)">t</span>')
    expect(result).not.toContain('onerror')
    expect(result).not.toContain('onclick')
    expect(result).toContain('data-bm-id="ok"')
  })

  it('仍剥除 script/style/iframe/input 等危险标签（共享 FORBID_TAGS）', () => {
    expect(sanitizeReadonlyHTML('<script>alert(1)</script>')).not.toContain('<script')
    expect(sanitizeReadonlyHTML('<style>body{x:1}</style>')).not.toContain('<style')
    expect(sanitizeReadonlyHTML('<iframe src="evil"></iframe>')).not.toContain('<iframe>')
    // AUDIT-R34 选择不加 input（taskList 勾选态用 CSS 呈现,避免表单控件加载面）
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
  it('基础:生成 id+name+icon=star,且每次调用 id 互异', () => {
    const cat = createCategory('My Category')
    expect(cat.name).toBe('My Category')
    expect(cat.id).toBeDefined()
    expect(cat.icon).toBe('star')
    const cat2 = createCategory('B')
    expect(cat.id).not.toBe(cat2.id)
  })

  // D1-48：order 字段此前零断言——它是分类排序主键,swapOrder (utils.ts:138 的 a.order === b.order)
  // 与 data.ts _sortItems 依赖稳定 number order；误删 order 字段会让新分类 order=undefined 致
  // NaN 比较塌陷排序。color 此前仅 toBeDefined 未锁属 CATEGORY_COLORS 集合——防未来误改 color 源
  // 为非集色值/单色硬编码污染主题色。
  // B-12：契约从「正数时间戳」改为「非负序号」——历史 bug createCategory 曾用 Date.now() 当 order
  // （毫秒戳 13 位 > 远端 categories.order INTEGER 上限 2147483647，同步必溢出失败）。序号可为 0
  // （第一个分类），且必须 < 2147483647 防回归成毫秒时间戳。
  it('should set order to a non-negative number (序号契约，防毫秒戳溢出远端 INTEGER order 列)', () => {
    const cat = createCategory('排序')
    expect(cat.order).toBeDefined()
    expect(typeof cat.order).toBe('number')
    expect(cat.order).toBeGreaterThanOrEqual(0)
    expect(cat.order).toBeLessThan(2147483647)
  })

  it('should pick color from CATEGORY_COLORS 集合 (主题色防污染)', () => {
    const cat = createCategory('主题')
    expect(CATEGORY_COLORS).toContain(cat.color)
    expect(CATEGORY_COLORS.length).toBeGreaterThanOrEqual(8)
    expect(new Set(CATEGORY_COLORS)).toContain(cat.color)
  })

  it('should return exactly the Category 字段集 (无多余键契约)', () => {
    const cat = createCategory('字段集')
    expect(Object.keys(cat).sort()).toEqual(['color', 'icon', 'id', 'name', 'order'])
    expect(cat.icon).toBe('star')
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
