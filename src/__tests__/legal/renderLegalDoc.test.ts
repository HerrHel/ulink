/**
 * 法律文档渲染器单测
 *
 * 关注点不是「CSS 好不好看」，而是**法律文本的完整性与可读性约定**：
 * 内部批注不得外泄、条款文字逐字保留、结构被正确识别（标题/目录/表格/条款编号）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LEGAL_DOC_SEQUENCE,
  parseLegalDoc,
  renderLegalDocHtml,
  renderLegalIndexHtml,
  slugFromFileName,
  stripInternalSections,
} from '../../lib/legal/renderLegalDoc'

// vitest 的 root 即仓库根（vitest.config.ts 位置），用 cwd 定位真实文档
const docPath = (name: string) => resolve(process.cwd(), 'docs/legal', name)
const readDoc = (name: string) => readFileSync(docPath(name), 'utf8')

describe('slugFromFileName', () => {
  it('去掉 .md 后缀', () => {
    expect(slugFromFileName('terms-of-service.md')).toBe('terms-of-service')
    expect(slugFromFileName('refund-policy.md')).toBe('refund-policy')
  })
})

describe('stripInternalSections：内部批注绝不外泄', () => {
  const md = `# 标题

正文一段。

---

> **发布前检查（非协议正文，正式发布时删除本段）**
>
> 1. 内部待办：统一社会信用代码待填
`

  it('截掉末尾「发布前检查」引用块及其前的分隔线', () => {
    const out = stripInternalSections(md)
    expect(out).not.toContain('发布前检查')
    expect(out).not.toContain('内部待办')
    expect(out).not.toContain('---')
    expect(out).toContain('正文一段。')
  })

  it('支持显式 internal 标记', () => {
    const withMarker = `# 标题\n\n正文。\n\n<!-- internal:start -->\n秘密\n<!-- internal:end -->\n`
    const out = stripInternalSections(withMarker)
    expect(out).not.toContain('秘密')
    expect(out).toContain('正文。')
  })

  it('普通引用块（法规引注）不受影响', () => {
    const withQuote = `# 标题\n\n> 依据《个人信息保护法》第十七条。\n\n正文。\n`
    expect(stripInternalSections(withQuote)).toContain('第十七条')
  })
})

describe('parseLegalDoc：结构识别', () => {
  const md = `# 与链（ulink）示例协议

**生效日期：2026 年 10 月 25 日**

**重要提示：请仔细阅读。免责条款已加粗提示。**

**运营主体：某某工作室**
**统一社会信用代码：92420113MAKNSDP56R**

---

## 一、适用范围

1.1 本协议适用于本产品。

1.2 联系邮箱：herr@ulink.ren

### 1.1 子节

| 术语 | 含义 |
|---|---|
| **本服务** | 与链及其网站 |

> 依据《民法典》第五百零六条。

**继续使用即表示您已阅读并同意本协议。**
`

  const doc = parseLegalDoc(md, 'demo-policy')

  it('抽出 h1 作为标题，正文不再含 h1', () => {
    expect(doc.title).toBe('与链（ulink）示例协议')
    expect(doc.bodyHtml).not.toMatch(/<h1/)
  })

  it('抽出生效日期', () => {
    expect(doc.effectiveDate).toContain('生效日期')
    expect(doc.effectiveDate).toContain('2026')
  })

  it('目录只含 h2/h3，锚点顺序编号且正文可对应', () => {
    expect(doc.toc.map((t) => t.level)).toEqual([2, 3])
    expect(doc.toc[0].text).toBe('一、适用范围')
    expect(doc.toc[1].text).toBe('1.1 子节')
    for (const item of doc.toc) expect(doc.bodyHtml).toContain(`id="${item.id}"`)
  })

  it('段落语义归类：日期 / 重要提示 / 主体信息 / 编号条款 / 结语', () => {
    expect(doc.bodyHtml).toContain('<p class="doc-dates">')
    expect(doc.bodyHtml).toContain('<p class="doc-warning">')
    expect(doc.bodyHtml).toContain('<p class="doc-meta-line">')
    expect(doc.bodyHtml).toContain('<p class="clause">1.1 本协议适用于本产品。')
    expect(doc.bodyHtml).toContain('<p class="doc-outro">')
  })

  it('表格被包进横向滚动容器', () => {
    expect(doc.bodyHtml).toContain('<div class="table-wrap"><table>')
    expect(doc.bodyHtml).toContain('</table></div>')
  })

  it('邮箱裸文本转 mailto，且不破坏已有链接', () => {
    expect(doc.bodyHtml).toContain('href="mailto:herr@ulink.ren"')
    expect(doc.bodyHtml).not.toContain('mailto:mailto:')
  })

  it('摘要取正文首段而非重要提示', () => {
    expect(doc.summary).not.toContain('重要提示')
    expect(doc.summary.length).toBeGreaterThan(0)
  })

  it('原文内的裸 HTML 被转义（不可注入脚本）', () => {
    const evil = parseLegalDoc('# T\n\n< script>alert(1)</ script>\n\n<img src=x onerror=alert(1)>\n', 'evil')
    expect(evil.bodyHtml.toLowerCase()).not.toContain('<script')
    expect(evil.bodyHtml).not.toContain('<img src=x')
  })
})

describe('renderLegalDocHtml：自包含页面', () => {
  const doc = parseLegalDoc(readDoc('privacy-policy.md'), 'privacy-policy')
  const html = renderLegalDocHtml(doc)

  it('含标题、canonical、内联样式，无外部 CSS/JS', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<title>与链（ulink）隐私政策 · 与链 ulink</title>')
    expect(html).toContain('rel="canonical" href="https://ulink.ren/legal/privacy-policy.html"')
    expect(html).toContain('<style>')
    // 无外部样式表、无脚本标签（法律页刻意零 JS，兼容 script-src 'self'）
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/)
    expect(html.toLowerCase()).not.toContain('<script')
  })

  it('三份文档切换与目录都在页面上', () => {
    expect(html).toContain('href="/legal/terms-of-service.html"')
    expect(html).toContain('href="/legal/refund-policy.html"')
    expect(html).toContain('本页目录')
    expect(html).toContain('aria-current="page"')
  })

  it('页脚披露运营主体与联系邮箱', () => {
    expect(html).toContain('92420113MAKNSDP56R')
    expect(html).toContain('herr@ulink.ren')
  })
})

describe('真实法律文档（docs/legal）', () => {
  const files = LEGAL_DOC_SEQUENCE.map((slug) => `${slug}.md`)

  it.each(files)('%s 渲染后不含内部批注、目录可导航', (file) => {
    const doc = parseLegalDoc(readDoc(file), slugFromFileName(file))
    const html = renderLegalDocHtml(doc)
    expect(html).not.toContain('发布前检查')
    expect(html).not.toContain('内部待办')
    expect(doc.title).toMatch(/与链（ulink）/)
    expect(doc.toc.length).toBeGreaterThanOrEqual(3)
    expect(doc.bodyHtml.length).toBeGreaterThan(1500)
  })

  it('索引页列出全部三份文档', () => {
    const docs = LEGAL_DOC_SEQUENCE.map((slug) => parseLegalDoc(readDoc(`${slug}.md`), slug))
    const html = renderLegalIndexHtml(docs)
    for (const slug of LEGAL_DOC_SEQUENCE) expect(html).toContain(`/legal/${slug}.html`)
    expect(html.match(/class="card"/g)?.length).toBe(3)
  })
})
