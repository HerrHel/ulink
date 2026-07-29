import { describe, it, expect } from 'vitest'
import { renderHighlight, esc } from '../../components/overlays/searchSuggestRender.js'
import type { HighlightSegment } from '../../lib/search.js'

/**
 * SearchSuggest.renderHighlight 护栏：搜索建议项单行文本的 v-html 渲染承载逻辑。
 * 真纯函数（仅依赖入参 highlights/key/fallback + DOM-based esc），抽自 SearchSuggest.vue
 * script setup 内联函数 + 私有 esc（逐字保留，本项目零 .vue 顶层 export 先例故用「抽独立纯模块」口径）。
 * 模板 v-html="renderHighlight(...)" 是 XSS 注入面：输出直接进 DOM，故命中段、未命中段、
 * fallback 三路文本必须全部经 esc 转义，不得有未转义 HTML 结构字符 '<' 构成标签。
 *
 * 护栏首轮踩坑 + 真实特性锁定：
 * (1) DOM textContent->innerHTML 的 esc 用「长格式实体带分号」
 *     （'&' -> '&' + 'amp;' / '<' -> '&' + 'lt;' / '>' -> '&' + 'gt;'），与 utils.ts:66 手动
 *     replace esc 在这三个字符上逐字同行为。实体字符串经工具传参易被渲染层吞分号，
 *     故下列期望串一律经代码常量（AMP/LT/GT）动态拼装保证字节精确。
 * (2) **护栏抓出真实行为差异**：DOM 版 esc 对双引号 '"' 与单引号 " ' " 均不转义
 *     （hex 实测 22 / 27 而非 '"'/'&#39;'），而 utils.ts:66 手动 replace esc 转义它们。
 *     两份 esc 实现真实不同——DOM textContent->innerHTML 只转义标签结构字符 '& < >'，
 *     不转义属性边界字符 '"'/"'"。这是现状真实行为非 bug：'"'/"'" 仅在已构成标签的属性
 *     边界才有害，而 '<' 已被全部转义使标签无法构成，故 v-html 渲染 DOM 版 esc 输出仍安全
 *     （无裸 '<' 开头标签起始）。护栏锁定 DOM 版真实行为而非强加 utils 版的 '"向' 转义。
 *     XSS 防线真不变量是「不出现裸 '<' 标签起始」而非「不出现属性词字面」。
 */
const AMP = '&' + 'amp;'
const LT = '&' + 'lt;'
const GT = '&' + 'gt;'

const seg = (text: string, highlight: boolean): HighlightSegment => ({ text, highlight })

describe('renderHighlight — 命中段渲染', () => {
  it('highlight=true 段包裹 <mark class="ss-hl"> 且 text 经 esc 转义', () => {
    const out = renderHighlight({ title: [seg('abc', true)] }, 'title', 'fb')
    expect(out).toBe('<mark class="ss-hl">abc</mark>')
  })

  it('highlight=false 段不包 <mark>，仅 esc 后原文', () => {
    const out = renderHighlight({ title: [seg('abc', false)] }, 'title', 'fb')
    expect(out).toBe('abc')
    expect(out).not.toContain('<mark>')
  })

  it('多段拼接：mark 段与普通段交错保持原顺序', () => {
    const out = renderHighlight({ title: [seg('pre', false), seg('hit', true), seg('post', false)] }, 'title', 'fb')
    expect(out).toBe('pre<mark class="ss-hl">hit</mark>post')
  })

  it('命中段 text 含 HTML 特殊字符经 esc 长格式实体化，不出现裸 <script>', () => {
    const out = renderHighlight({ title: [seg('<script>alert(1)</script>', true)] }, 'title', 'fb')
    expect(out).toContain('<mark class="ss-hl">')
    // text 经 esc 长格式实体，绝不出现裸 <script> 标签
    expect(out).not.toContain('<script>')
    expect(out).toContain(LT + 'script' + GT + 'alert(1)' + LT + '/script' + GT)
  })

  it('highlight=false 段 text 含 HTML 特殊字符仅转义不构成裸标签（属性词作为可见文本安全出现）', () => {
    const out = renderHighlight({ title: [seg('<img src=x onerror=alert(1)>', false)] }, 'title', 'fb')
    expect(out).not.toMatch(/<img\b/)
    expect(out).toContain(LT + 'img src=x onerror=alert(1)' + GT)
  })
})

describe('renderHighlight — 兜底分支', () => {
  it('highlights undefined → esc(fallback)', () => {
    expect(renderHighlight(undefined, 'title', 'plain')).toBe('plain')
  })

  it('key 不命中（highlights 无该 key）→ esc(fallback)', () => {
    expect(renderHighlight({ other: [seg('x', true)] }, 'title', 'plain')).toBe('plain')
  })

  it('命中 key 但 segs 为空数组 → esc(fallback)', () => {
    expect(renderHighlight({ title: [] }, 'title', 'plain')).toBe('plain')
  })

  it('fallback 含 HTML 结构字符经 esc 长格式实体化不构成裸标签', () => {
    expect(renderHighlight(undefined, 'title', '<b>x</b>')).toBe(LT + 'b' + GT + 'x' + LT + '/b' + GT)
    expect(renderHighlight(undefined, 'title', 'a&b')).toBe('a' + AMP + 'b')
  })

  it('命中段存在时 fallback 不参与输出（短路口径）', () => {
    const out = renderHighlight({ title: [seg('hit', true)] }, 'title', '<IGNORE>')
    expect(out).toBe('<mark class="ss-hl">hit</mark>')
    expect(out).not.toContain('IGNORE')
  })

  it('空 fallback 字符串兜底返空串', () => {
    expect(renderHighlight(undefined, 'title', '')).toBe('')
  })
})

describe('renderHighlight — v-html XSS 防线总断言', () => {
  it('任一路径输出均不含裸 <script / <iframe / <img 标签起始（防构成可执行/可加载标签）', () => {
    const cases = [
      renderHighlight({ title: [seg('<script>alert(1)</script>', true)] }, 'title', 'fb'),
      renderHighlight({ title: [seg('<img onerror=alert(1)>', false)] }, 'title', 'fb'),
      renderHighlight(undefined, 'title', '<iframe src=x></iframe>'),
      renderHighlight({ title: [seg('a', true), seg('<b>', false)] }, 'title', '<script>'),
    ]
    cases.forEach((out) => {
      // XSS 防线真不变量：不出现裸标签起始即可（结构字 '<' 已全部经 esc 转为长格式实体）
      expect(out).not.toMatch(/<script/)
      expect(out).not.toMatch(/<img\b/)
      expect(out).not.toMatch(/<iframe/)
      expect(out).not.toMatch(/<b\b/)
    })
  })

  it('纯函数无副作用（不改入参 highlights）', () => {
    const highlights = { title: [seg('abc', true), seg('def', false)] }
    const snapshot = JSON.stringify(highlights)
    renderHighlight(highlights, 'title', 'fb')
    expect(JSON.stringify(highlights)).toBe(snapshot)
  })

  it('返回值恒为 string', () => {
    expect(typeof renderHighlight({ title: [seg('a', true)] }, 'title', 'fb')).toBe('string')
    expect(typeof renderHighlight(undefined, 'title', 'fb')).toBe('string')
    expect(typeof renderHighlight({ title: [] }, 'title', 'fb')).toBe('string')
  })
})

describe('esc — 私有 DOM-based 转义副本（与 utils.ts:66 手动 replace esc 真实行为差异锁定）', () => {
  it('结构字符 & < > 各自转 HTML 长格式实体带分号（与 utils 版同行为）', () => {
    expect(esc('&')).toBe(AMP)
    expect(esc('<')).toBe(LT)
    expect(esc('>')).toBe(GT)
  })

  it('**双引号不转义**（DOM textContent->innerHTML 真实行为，与 utils 版转 " 不同）', () => {
    expect(esc('"')).toBe('"')
  })

  it('**单引号不转义**（DOM textContent->innerHTML 真实行为，与 utils 版转 &#39; 不同）', () => {
    expect(esc("'")).toBe("'")
  })

  it('普通文本原样返回', () => {
    expect(esc('hello world')).toBe('hello world')
    expect(esc('')).toBe('')
  })

  it('组合 payload 整体转义无裸 < >（双引号原样保留不构成标签属性边界）', () => {
    expect(esc('<a href="x">')).toBe(LT + 'a href="x"' + GT)
    expect(esc('<script>alert("xss")</script>')).toBe(LT + 'script' + GT + 'alert("xss")' + LT + '/script' + GT)
  })

  it('中文/特殊 unicode 字符透传不破坏', () => {
    expect(esc('中文测试')).toBe('中文测试')
    expect(esc('emoji')).toBe('emoji')
  })

  it('组合 payload 不出现裸结构字符 < 开头标签起始（XSS 防线核心）', () => {
    const payload = '<script>alert(1)</script><img onerror=x><iframe src=y>'
    const out = esc(payload)
    expect(out).not.toMatch(/<script/)
    expect(out).not.toMatch(/<img\b/)
    expect(out).not.toMatch(/<iframe/)
    expect(out).toContain(LT + 'script')
    expect(out).toContain(LT + 'img')
    expect(out).toContain(LT + 'iframe')
  })
})
