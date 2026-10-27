/**
 * 法律文档渲染器（构建期）
 *
 * 背景：`docs/legal/*.md` 是协议/隐私/退款政策的**单一真源**，此前由
 * `legalDocsPlugin` 原样以 `text/markdown` 抛出，用户点开看到的是 `## 一、…`
 * 这样未渲染的裸 Markdown（截图实证），既不可读也显得不专业。
 *
 * 本模块把 Markdown 渲染成一份自包含的静态 HTML 页面（内联 CSS，无 JS、无外链），
 * 因此在任何静态托管上都能直接用，且不受 CSP `script-src 'self'` 影响。
 *
 * 关键约定：
 * 1. **内部批注不进正文**：三份文档末尾都有「> **发布前检查（非…正文）**」引用块，
 *    属于内部待办，绝不能出现在对外页面（见 stripInternalSections）。
 * 2. **不改动正文语义**：只做「标题锚点 / 表格包裹 / 段落归类 / 外链属性」四类
 *    DOM 增强，不重写任何条款文字，法律文本必须与 .md 逐字一致。
 * 3. 纯函数、无 IO，便于单测（src/__tests__/legal/renderLegalDoc.test.ts）。
 */

import { marked } from 'marked'

/** 三份对外法律文档的展示顺序与短标签（长标题取自各文件 h1） */
export const LEGAL_DOC_SEQUENCE = ['terms-of-service', 'privacy-policy', 'refund-policy'] as const

const DOC_SHORT_LABEL: Record<string, string> = {
  'terms-of-service': '用户协议',
  'privacy-policy': '隐私政策',
  'refund-policy': '退款政策',
}

const SITE_NAME = '与链 ulink'
const SITE_ORIGIN = 'https://ulink.ren'

/** 站点运营主体（与 docs/legal/*.md 一致，仅供页脚展示） */
const OPERATOR = '武汉市武汉开发区（汉南区）赫尔网络工作室'
const CONTACT_EMAIL = 'herr@ulink.ren'

export interface LegalDocInfo {
  slug: string
  /** 页内 h1 原文，如「与链（ulink）用户服务协议」 */
  title: string
  /** 顶部导航用的短标签 */
  shortLabel: string
  /** 生效日期原文（未找到则空串） */
  effectiveDate: string
  /** 列表摘要（取自正文首段） */
  summary: string
}

export interface ParsedLegalDoc extends LegalDocInfo {
  /** 正文 HTML（已移除 h1，h1 单独渲染在页头） */
  bodyHtml: string
  /** 目录项（h2 / h3） */
  toc: { id: string; text: string; level: 2 | 3 }[]
}

/** `terms-of-service.md` → `terms-of-service` */
export function slugFromFileName(fileName: string): string {
  return fileName.replace(/\.md$/i, '')
}

export function shortLabelOf(slug: string, fallback = ''): string {
  return DOC_SHORT_LABEL[slug] || fallback || slug
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 移除内部批注段落。
 *
 * 两种识别方式（并存，便于日后新增）：
 * - 显式标记：`<!-- internal:start --> … <!-- internal:end -->`
 * - 历史约定：末尾以「> **发布前检查…」开头的引用块到文件结尾，全属内部内容。
 *   同时清掉紧接其前、为分隔而存在的 `---`。
 */
export function stripInternalSections(markdown: string): string {
  let text = markdown.replace(/<!--\s*internal:start\s*-->[\s\S]*?<!--\s*internal:end\s*-->/gi, '')

  const lines = text.split('\n')
  const cut = lines.findIndex((line) => /^>\s*\*\*\s*(发布前检查|发布前核对|内部说明|内部备注|内部待办)/.test(line.trim()))
  if (cut !== -1) {
    text = lines.slice(0, cut).join('\n')
    // 摘掉被留下的分隔线（可能带空行）
    text = text.replace(/(\s*\n\s*---\s*)+\s*$/, '\n')
  }

  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/** 正文里的邮箱裸文本转 mailto（已处于链接语法中的跳过） */
function autoLinkEmails(markdown: string): string {
  return markdown.replace(/(^|[^\w/[\]:(])([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi, (_m, lead: string, mail: string) => `${lead}[${mail}](mailto:${mail})`)
}

/**
 * 转义正文里的裸 `<`：法律文本不需要内联 HTML，转义后即可保证任何内容都不会变成可执行标记。
 * 只处理 `<`（`>` 在行首是引用块语法，不能动）。
 */
function escapeRawHtml(markdown: string): string {
  return markdown.replace(/</g, '&lt;')
}

/** 段落语义归类：日期行、主体信息行、重要提示、编号条款、结语 */
function classifyParagraph(plain: string, inner: string): string | null {
  if (/^(生效日期|更新日期|发布日期)/.test(plain)) return 'doc-dates'
  if (/^(重要提示|特别提示|请注意|重点提示)/.test(plain)) return 'doc-warning'
  if (/^(运营主体|统一社会信用代码|联系邮箱|退款受理邮箱|客服邮箱|通信地址)/.test(plain) && plain.length <= 120) {
    return 'doc-meta-line'
  }
  if (/^\d+(\.\d+)+/.test(plain)) return 'clause'
  // 结尾的单句强调（如「继续使用本产品即表示您已阅读并同意本隐私政策。」）
  if (/^<strong>[\s\S]*<\/strong>$/.test(inner.trim()) && plain.length <= 80) return 'doc-outro'
  return null
}

/** 只保留 h2/h3 的目录；锚点用稳定的顺序编号，避免中文 id 被 URL 编码成乱码 */
function buildTocAndAnchors(html: string): { html: string; toc: ParsedLegalDoc['toc'] } {
  const toc: ParsedLegalDoc['toc'] = []
  let index = 0
  const withIds = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, level: string, inner: string) => {
    index += 1
    const id = `sec-${index}`
    const text = stripTags(inner)
    toc.push({ id, text, level: level === '2' ? 2 : 3 })
    return `<h${level} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="本节永久链接" tabindex="-1">#</a></h${level}>`
  })
  return { html: withIds, toc }
}

function enhanceHtml(html: string): string {
  let out = html

  // 段落语义类名（只加 class，不改文字）
  out = out.replace(/<p>([\s\S]*?)<\/p>/g, (whole, inner: string) => {
    const cls = classifyParagraph(stripTags(inner), inner)
    return cls ? `<p class="${cls}">${inner}</p>` : whole
  })

  // 表格横向滚动容器（窄屏必备，否则整页被撑破）
  out = out.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>')

  // 外链新窗口 + noreferrer
  out = out.replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener noreferrer"')

  return out
}

/** 从正文里提取首段作为摘要（跳过纯加粗行、日期行、开头的重要提示） */
function extractSummary(bodyHtml: string, fallback: string): string {
  const paragraphs = bodyHtml.match(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g) || []
  for (const p of paragraphs) {
    const plain = stripTags(p)
    if (plain.length < 24) continue
    if (/^(生效日期|更新日期|重要提示|特别提示|请注意|重点提示)/.test(plain)) continue
    return plain.length > 90 ? `${plain.slice(0, 88)}…` : plain
  }
  return fallback
}

/** Markdown → 结构化文档（标题/正文/目录/日期/摘要） */
export function parseLegalDoc(markdown: string, slug: string): ParsedLegalDoc {
  const cleaned = stripInternalSections(markdown)
  const titleMatch = /^\s*#\s+(.+?)\s*$/m.exec(cleaned)
  const title = titleMatch ? stripTags(titleMatch[1]) : slug
  const bodyMd = titleMatch ? cleaned.replace(titleMatch[0], '') : cleaned

  // breaks: 法律文档里「运营主体／信用代码／邮箱」等多行信息靠单换行分行，
  // 默认（breaks:false）会被合并成一整段挤在一行。
  const html = marked.parse(escapeRawHtml(autoLinkEmails(bodyMd)).trim(), { async: false, gfm: true, breaks: true }) as string
  const { html: anchored, toc } = buildTocAndAnchors(html)
  const bodyHtml = enhanceHtml(anchored)

  const dateMatch = /\*\*(生效日期[^*]*)\*\*/.exec(cleaned)
  const effectiveDate = dateMatch ? stripTags(dateMatch[1]) : ''

  return {
    slug,
    title,
    shortLabel: shortLabelOf(slug, title),
    effectiveDate,
    summary: extractSummary(bodyHtml, ''),
    bodyHtml,
    toc,
  }
}

/* ------------------------------------------------------------------ *
 * 页面骨架与样式
 * ------------------------------------------------------------------ */

const BASE_CSS = String.raw`
*,*::before,*::after{box-sizing:border-box}
:root{
  color-scheme:light dark;
  --bg:#F5EFEA; --paper:#FDFBF9; --paper-2:#F7F2EC;
  --border:#E5DDD3; --border-strong:#D5CBBE;
  --ink:#2C2824; --ink-2:#4A443E; --muted:#6A6660;
  --brand:#122E8A; --brand-deep:#0E2270; --brand-soft:rgba(18,46,138,.07);
  --green:#0D7A6F; --green-soft:rgba(13,122,111,.08);
  --link:#122E8A;
  --warn-bg:#FDF4E8; --warn-border:#DFA457; --warn-ink:#7A4A14;
  --shadow:0 1px 2px rgba(44,40,36,.04),0 10px 30px -14px rgba(44,40,36,.18);
  --radius:14px;
  --maxw:1180px;
  --font:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Noto Sans SC','Microsoft YaHei',sans-serif;
  --mono:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#141416; --paper:#1D1D21; --paper-2:#242429;
    --border:#2C2C33; --border-strong:#3B3B44;
    --ink:#E9E4DD; --ink-2:#CDC7BF; --muted:#9B968E;
    --brand:#A9BAFF; --brand-deep:#C6D0FF; --brand-soft:rgba(169,186,255,.10);
    --green:#4FD1B5; --green-soft:rgba(79,209,181,.10);
    --link:#A9BAFF;
    --warn-bg:#2A2118; --warn-border:#7E5C30; --warn-ink:#E8C89B;
    --shadow:0 1px 2px rgba(0,0,0,.35),0 14px 34px -16px rgba(0,0,0,.6);
  }
}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{
  margin:0;background:var(--bg);color:var(--ink);
  font-family:var(--font);font-size:16px;line-height:1.85;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  background-image:radial-gradient(900px 460px at 78% -8%,var(--brand-soft),transparent 72%);
  background-repeat:no-repeat;
}
img{max-width:100%}
a{color:var(--link);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:color-mix(in srgb,var(--link) 38%,transparent)}
a:hover{color:var(--brand-deep);text-decoration-color:currentColor}
:focus-visible{outline:2px solid var(--brand);outline-offset:3px;border-radius:4px}
.skip{position:absolute;left:-9999px}
.skip:focus{left:16px;top:12px;z-index:99;background:var(--paper);color:var(--brand);padding:10px 16px;border-radius:10px;border:1px solid var(--border)}

/* 顶栏 */
.bar{position:sticky;top:0;z-index:20;border-bottom:1px solid var(--border);background:var(--bg);background:color-mix(in srgb,var(--bg) 84%,transparent);backdrop-filter:saturate(140%) blur(12px)}
.bar-in{max-width:var(--maxw);margin:0 auto;padding:12px clamp(16px,4vw,32px);display:flex;align-items:center;gap:clamp(12px,2vw,28px)}
.brand{display:inline-flex;align-items:center;gap:9px;text-decoration:none;color:var(--ink);font-weight:650;letter-spacing:.01em;flex:none}
.brand img{width:26px;height:26px;display:block;border-radius:7px}
.brand em{font-style:normal;font-weight:500;color:var(--muted);font-size:14px;letter-spacing:.02em}
.switch{display:flex;gap:2px;padding:3px;border:1px solid var(--border);border-radius:11px;background:var(--paper-2);overflow-x:auto;scrollbar-width:none}
.switch::-webkit-scrollbar{display:none}
.switch a{padding:6px 13px;border-radius:8px;font-size:13px;line-height:1.5;color:var(--ink-2);text-decoration:none;white-space:nowrap;flex:none}
.switch a:hover{color:var(--brand);background:var(--brand-soft)}
.switch a[aria-current=page]{background:var(--paper);color:var(--brand);font-weight:650;box-shadow:0 1px 2px rgba(44,40,36,.08)}
.bar-spacer{flex:1}
.bar-home{font-size:13.5px;color:var(--ink-2);text-decoration:none;white-space:nowrap;padding:6px 12px;border-radius:9px;border:1px solid var(--border);background:var(--paper)}
.bar-home:hover{color:var(--brand);border-color:var(--border-strong)}

/* 主栅格 */
.wrap{max-width:var(--maxw);margin:0 auto;padding:clamp(24px,4vw,44px) clamp(16px,4vw,32px) 8px;display:grid;grid-template-columns:236px minmax(0,1fr);gap:clamp(24px,3.4vw,52px);align-items:start}

/* 目录 */
.toc{position:sticky;top:84px;align-self:start;max-height:calc(100vh - 108px);overflow:auto;font-size:13.5px;scrollbar-width:thin}
.toc-t{font-size:11px;letter-spacing:.18em;color:var(--muted);font-weight:700;margin:0 0 10px;padding-left:12px}
.toc ul{list-style:none;margin:0;padding:0}
.toc a{display:block;padding:5px 12px;border-left:2px solid transparent;border-radius:0 8px 8px 0;color:var(--ink-2);text-decoration:none;line-height:1.6}
.toc a:hover{background:var(--brand-soft);color:var(--brand);border-left-color:var(--brand)}
.toc .lv3 a{padding-left:24px;font-size:12.6px;color:var(--muted)}
.toc .lv3 a:hover{color:var(--brand)}
.toc-mobile{display:none}

/* 文档纸面 */
.doc{
  background:var(--paper);border:1px solid var(--border);border-radius:var(--radius);
  box-shadow:var(--shadow);padding:clamp(22px,3.6vw,52px);min-width:0;
}
.doc-head{margin:0 0 clamp(18px,2.4vw,28px)}
.eyebrow{margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.2em;color:var(--green);text-transform:uppercase}
.doc-head h1{margin:0;font-size:clamp(24px,3.2vw,32px);line-height:1.36;font-weight:700;letter-spacing:-.005em}

/* 正文排版 */
.doc h2{position:relative;margin:2.5em 0 .9em;padding-bottom:.5em;border-bottom:1px solid var(--border);font-size:clamp(17px,1.6vw,19px);line-height:1.55;font-weight:700;scroll-margin-top:88px}
.doc h2::before{content:'';display:inline-block;width:4px;height:.92em;margin-right:10px;border-radius:2px;background:var(--green);vertical-align:-.06em}
.doc h3{margin:2em 0 .6em;font-size:16.5px;line-height:1.6;font-weight:650;color:var(--ink);scroll-margin-top:88px}
.doc h4{margin:1.6em 0 .5em;font-size:15.5px;font-weight:650}
.doc p{margin:.92em 0;color:var(--ink-2)}
.doc strong{color:var(--ink);font-weight:650}
.doc em{font-style:italic;color:var(--ink)}
.doc ul,.doc ol{margin:1em 0;padding-left:1.4em;color:var(--ink-2)}
.doc li{margin:.42em 0}
.doc li::marker{color:var(--green)}
.doc li>ul,.doc li>ol{margin:.4em 0}
.doc hr{height:1px;border:0;margin:2.4em 0;background:linear-gradient(90deg,var(--border-strong),transparent)}
.doc code{font-family:var(--mono);font-size:.86em;background:var(--paper-2);border:1px solid var(--border);border-radius:5px;padding:1px 5px;color:var(--ink)}
.doc del{color:var(--muted)}

/* 段落语义化样式 */
.doc .doc-dates{margin:.2em 0 1.4em;font-size:13.5px;color:var(--muted);letter-spacing:.01em}
.doc .doc-meta-line{margin:.1em 0;font-size:13.5px;color:var(--muted)}
.doc .doc-meta-line strong{color:var(--ink-2);font-weight:600}
.doc .doc-warning{
  margin:1.4em 0;padding:13px 16px;border-left:3px solid var(--warn-border);border-radius:0 10px 10px 0;
  background:var(--warn-bg);color:var(--warn-ink);font-size:14.5px;line-height:1.8;
}
.doc .doc-warning strong{color:inherit;font-weight:700}
.doc .clause{padding-left:2.7em;text-indent:-2.7em;font-variant-numeric:tabular-nums;margin:.85em 0}
.doc .doc-outro{margin:2.2em 0 0;padding-top:1.3em;border-top:1px solid var(--border);font-size:13.5px;color:var(--muted)}

/* 引用块（法律条款引注） */
.doc blockquote{
  margin:1.5em 0;padding:13px 18px;background:var(--green-soft);
  border-left:3px solid var(--green);border-radius:0 10px 10px 0;
  font-size:14.5px;color:var(--ink-2);
}
.doc blockquote>:first-child{margin-top:0}
.doc blockquote>:last-child{margin-bottom:0}
.doc blockquote p{margin:.4em 0}
.doc blockquote ol,.doc blockquote ul{margin:.5em 0;padding-left:1.3em;font-size:14px}

/* 表格 */
.doc .table-wrap{
  margin:1.6em 0;border:1px solid var(--border);border-radius:12px;background:var(--paper);
  overflow-x:auto;-webkit-overflow-scrolling:touch;
}
.doc table{width:100%;border-collapse:collapse;font-size:14.5px;min-width:540px}
.doc th,.doc td{padding:11px 14px;text-align:left;vertical-align:top;line-height:1.72;border-bottom:1px solid var(--border)}
.doc th{background:var(--paper-2);color:var(--ink);font-size:13px;font-weight:700;letter-spacing:.02em;white-space:nowrap}
.doc td{color:var(--ink-2)}
.doc tbody tr:last-child td{border-bottom:0}
.doc tbody tr:hover td{background:var(--paper-2)}
/* 首列是术语/字段名，多为短词：不换行可避免「本产品」被拆成两行 */
.doc td:first-child{white-space:nowrap}

/* 标题锚点 */
.doc .anchor{margin-left:.5em;font-size:.72em;font-weight:500;color:var(--border-strong);text-decoration:none;opacity:0;transition:opacity .15s}
.doc h2:hover .anchor,.doc h3:hover .anchor,.doc .anchor:focus-visible{opacity:1;color:var(--brand)}
.doc :target{color:var(--brand-deep)}

/* 页脚 */
.foot{max-width:var(--maxw);margin:0 auto;padding:30px clamp(16px,4vw,32px) 46px;border-top:1px solid var(--border);margin-top:52px;font-size:13px;color:var(--muted);line-height:1.9}
.foot-in{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:baseline}
.foot a{color:var(--ink-2);text-decoration:none}
.foot a:hover{color:var(--brand);text-decoration:underline}
.foot-links{display:flex;flex-wrap:wrap;gap:16px;margin:0 0 4px;padding:0;list-style:none}
.foot-meta{width:100%;margin-top:6px;font-size:12.5px}

/* 响应式 */
@media (max-width:900px){
  .wrap{display:block;padding-top:20px}
  .toc{display:none}
  .toc-mobile{
    display:block;margin:0 0 18px;border:1px solid var(--border);border-radius:12px;
    background:var(--paper);overflow:hidden;
  }
  .toc-mobile>summary{
    cursor:pointer;padding:13px 16px;font-size:13.5px;font-weight:650;color:var(--ink);
    list-style:none;display:flex;justify-content:space-between;align-items:center;gap:12px;
  }
  .toc-mobile>summary::-webkit-details-marker{display:none}
  .toc-mobile>summary::after{content:'展开';font-size:12px;font-weight:500;color:var(--muted)}
  .toc-mobile[open]>summary::after{content:'收起'}
  .toc-mobile[open]>summary{border-bottom:1px solid var(--border)}
  .toc-mobile ul{list-style:none;margin:0;padding:8px 10px 12px;font-size:13.5px}
  .toc-mobile a{display:block;padding:6px 8px;border-radius:7px;color:var(--ink-2);text-decoration:none}
  .toc-mobile a:hover{background:var(--brand-soft);color:var(--brand)}
  .toc-mobile .lv3 a{padding-left:22px;font-size:12.8px;color:var(--muted)}
  .doc{padding:20px 16px;border-radius:12px}
  .doc .clause{padding-left:0;text-indent:0}
  .doc .anchor{display:none}
  .bar-in{flex-wrap:wrap;gap:10px}
  .switch{order:3;width:100%}
  .bar-spacer{flex:1}
  .doc table{min-width:460px}
}
@media (max-width:420px){
  body{font-size:15.5px}
  .doc table{font-size:13.5px;min-width:400px}
  .doc th,.doc td{padding:9px 11px}
}

/* 打印：法律文件常被用户打印/存 PDF */
@media print{
  body{background:#fff;color:#000;font-size:11pt;background-image:none}
  .bar,.toc,.toc-mobile,.foot,.skip,.doc .anchor{display:none!important}
  .wrap{display:block;max-width:none;padding:0}
  .doc{background:#fff;border:0;box-shadow:none;border-radius:0;padding:0}
  .doc h2{border-bottom-color:#999;break-after:avoid}
  .doc h3{break-after:avoid}
  .doc .doc-warning{border:1px solid #999;background:#fff;color:#000}
  .doc blockquote{border-left:2px solid #999;background:#fff}
  .doc .table-wrap{border-color:#999;overflow:visible}
  .doc table{min-width:0}
  .doc th{background:#f2f2f2;white-space:normal}
  .doc a{color:#000;text-decoration:none}
  .doc a[href^="http"]::after{content:" (" attr(href) ")";font-size:9pt;color:#555}
  a[href^="mailto"]::after{content:""}
  .doc p,.doc li,.doc tr{break-inside:avoid}
}
`

function brandBarHtml(activeSlug: string): string {
  return `<a class="skip" href="#doc">跳到正文</a>
<header class="bar">
  <div class="bar-in">
    <a class="brand" href="/" aria-label="${SITE_NAME} 首页">
      <img src="/logo.svg" alt="" width="26" height="26">
      <span>与链 <em>ulink</em></span>
    </a>
    <nav class="switch" aria-label="法律文件切换">${switchHtml(activeSlug)}</nav>
    <span class="bar-spacer"></span>
    <a class="bar-home" href="/app">打开应用</a>
  </div>
</header>`
}

function switchHtml(activeSlug: string): string {
  return LEGAL_DOC_SEQUENCE.map((slug) => {
    const label = DOC_SHORT_LABEL[slug] || slug
    const current = slug === activeSlug ? ' aria-current="page"' : ''
    return `<a href="/legal/${slug}.html"${current}>${escapeHtml(label)}</a>`
  }).join('')
}

function footHtml(): string {
  return `<footer class="foot">
  <div class="foot-in">
    <ul class="foot-links">
      <li><a href="/legal/terms-of-service.html">用户服务协议</a></li>
      <li><a href="/legal/privacy-policy.html">隐私政策</a></li>
      <li><a href="/legal/refund-policy.html">退款政策</a></li>
      <li><a href="/legal/">全部法律文件</a></li>
      <li><a href="/">返回首页</a></li>
    </ul>
    <div class="foot-meta">
      运营主体：${OPERATOR}（个体工商户）· 统一社会信用代码 92420113MAKNSDP56R · 联系邮箱
      <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
    </div>
  </div>
</footer>`
}

function pageShell(opts: { title: string; description: string; canonicalPath: string; bodyClass?: string; content: string }): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}">
<link rel="canonical" href="${SITE_ORIGIN}${opts.canonicalPath}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escapeHtml(opts.title)}">
<meta property="og:description" content="${escapeHtml(opts.description)}">
<meta property="og:url" content="${SITE_ORIGIN}${opts.canonicalPath}">
<meta name="theme-color" content="#F5EFEA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141416" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${BASE_CSS}</style>
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ''}>
${opts.content}
</body>
</html>
`
}

function tocListHtml(toc: ParsedLegalDoc['toc']): string {
  const items = toc.map((t) => `<li class="lv${t.level}"><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`).join('\n')
  return `<ul>\n${items}\n</ul>`
}

/** 渲染单份法律文档的完整 HTML 页面 */
export function renderLegalDocHtml(doc: ParsedLegalDoc): string {
  const desc = doc.summary || `${doc.title} · ${SITE_NAME}`
  const toc = tocListHtml(doc.toc)

  return pageShell({
    title: `${doc.title} · ${SITE_NAME}`,
    description: desc,
    canonicalPath: `/legal/${doc.slug}.html`,
    content: `${brandBarHtml(doc.slug)}
<main class="wrap">
  <aside class="toc" aria-label="本页目录">
    <p class="toc-t">本页目录</p>
    ${toc}
  </aside>
  <article id="doc" class="doc">
    <details class="toc-mobile">
      <summary>本页目录（${doc.toc.length} 节）</summary>
      ${toc}
    </details>
    <header class="doc-head">
      <p class="eyebrow">法律文件</p>
      <h1>${escapeHtml(doc.title)}</h1>
    </header>
    ${doc.bodyHtml}
  </article>
</main>
${footHtml()}`,
  })
}

export interface LegalIndexEntry extends LegalDocInfo {}

/** 渲染 /legal/ 索引页 */
export function renderLegalIndexHtml(docs: LegalIndexEntry[]): string {
  const cards = docs
    .map((d) => {
      const date = d.effectiveDate ? `<p class="card-date">${escapeHtml(d.effectiveDate)}</p>` : ''
      const summary = d.summary ? `<p class="card-sum">${escapeHtml(d.summary)}</p>` : ''
      return `<li class="card">
        <a class="card-link" href="/legal/${d.slug}.html">
          <span class="card-badge">${escapeHtml(d.shortLabel)}</span>
          <h2>${escapeHtml(d.title)}</h2>
          ${summary}
          ${date}
          <span class="card-cta">阅读全文<span aria-hidden="true">→</span></span>
        </a>
      </li>`
    })
    .join('\n')

  const extraCss = String.raw`
.wrap-index{max-width:var(--maxw);margin:0 auto;padding:clamp(28px,5vw,56px) clamp(16px,4vw,32px) 0}
.page-head{margin:0 0 clamp(22px,3vw,34px)}
.page-head h1{margin:0 0 10px;font-size:clamp(26px,3.6vw,34px);line-height:1.3;font-weight:700}
.page-head p{margin:0;color:var(--muted);font-size:14.5px;max-width:62ch}
.cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:clamp(14px,2vw,20px)}
.card{margin:0;background:var(--paper);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);transition:border-color .18s,transform .18s}
.card:hover{border-color:var(--border-strong);transform:translateY(-2px)}
@media (prefers-reduced-motion:reduce){.card:hover{transform:none}}
.card-link{display:flex;flex-direction:column;gap:8px;height:100%;padding:22px 22px 20px;text-decoration:none;color:inherit}
.card-badge{align-self:flex-start;font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--green);background:var(--green-soft);border-radius:999px;padding:3px 10px}
.card h2{margin:6px 0 0;font-size:17.5px;line-height:1.5;font-weight:700;color:var(--ink)}
.card-sum{margin:0;font-size:13.5px;line-height:1.75;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-date{margin:2px 0 0;font-size:12.5px;color:var(--muted)}
.card-cta{margin-top:auto;padding-top:10px;font-size:13.5px;font-weight:650;color:var(--brand);display:inline-flex;gap:6px}
.card-link:hover .card-cta{color:var(--brand-deep)}
`

  return pageShell({
    title: `法律文件 · ${SITE_NAME}`,
    description: `${SITE_NAME}的用户服务协议、隐私政策与退款政策。`,
    canonicalPath: '/legal/',
    content: `${brandBarHtml('')}
<main class="wrap-index">
  <header class="page-head">
    <p class="eyebrow">法律文件</p>
    <h1>协议与政策</h1>
    <p>以下文件共同构成您与运营主体之间关于本服务的完整约定。我们承诺以「数据最小化」为原则处理您的信息，条款中的每一项保留期与删除方式均为实际执行的标准。</p>
  </header>
  <ul class="cards">
${cards}
  </ul>
</main>
${footHtml()}`,
  }).replace('</style>', `${extraCss}</style>`)
}
