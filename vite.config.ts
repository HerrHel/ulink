import { defineConfig, Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { PurgeCSS } from 'purgecss';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pkg from './package.json';
/**
 * marked 延迟加载。
 *
 * **必须动态 import**：CI 上 Vite 8 用 rolldown 打包 vite.config.ts，
 * 对 npm 包的静态 import 也可能解析失败（`[UNRESOLVED_IMPORT] Could not resolve 'marked'`
 * → 被标为 external → 运行时 `ERR_MODULE_NOT_FOUND` → e2e 的 webServer 起不来 →
 * deploy job 被 skipped）。动态 import 不参与 config 的静态打包，由 Node 在运行时解析。
 */
type MarkedLike = { parse: (src: string, opts?: Record<string, unknown>) => string | Promise<string> }
let _markedLib: MarkedLike | null = null
async function ensureMarked(): Promise<void> {
  if (_markedLib) return
  const mod = (await import('marked')) as unknown as { marked: MarkedLike }
  _markedLib = mod.marked
}
function md(): MarkedLike {
  if (!_markedLib) throw new Error('marked 未初始化：调用渲染前需先 await ensureMarked()')
  return _markedLib
}

/** 以本配置文件为基准解析项目内路径（ESM 无 __dirname） */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/* ── 安全 & 缓存 HTTP 响应头 ── */
const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  // S4 短期项：生产 script-src 移除 'unsafe-inline'。
  // 前提已核实：构建产物内无可执行内联 <script>、无原生内联事件（index.html 的
  // 字体 preload onload= 与 main.ts 白屏兜底 onclick= 已改造为非内联形式），
  // PWA SW 注册走外部 /registerSW.js。style-src 仍保留 'unsafe-inline'（Vue 运行
  // 时注入的组件样式 + TipTap 编辑器内联 style 依赖，移除需更大改造，列入中期）。
  //
  // SEC-05 / connect-src 权衡（有意放宽，勿在未改死链策略前收窄）：
  // - 生产 `connect-src 'self' https: wss://*.supabase.co` 允许任意 https fetch。
  // - 原因：客户端死链检查 `checkDirect` 用 no-cors 直连用户书签 URL（任意域名），
  //   以及 favicon/部分外部资源；若改为仅 Edge Function 代检，才可把 connect-src
  //   收到 self + supabase 主机。当前产品选择：弱外泄纵深换本地可达性探测。
  // - XSS 主防线是 script-src 'self'（无 unsafe-inline）；connect 宽只在脚本已失陷时
  //   放大数据外泄面。收紧前先统一死链走 Edge、去掉浏览器直连任意 URL。
  // L1：已记录架构取舍，死链改走 Edge 后收窄 connect-src（去掉 https: 通配）。
  // 勿在未改 checkDirect 前私自收紧，否则死链检测失效。
  // worker-src 'self' blob:：Vite dev/preview client 断线重连时用 blob Worker 做
  // 心跳 ping（waitForSuccessfulPing），未显式声明 worker-src 时回退 script-src
  // （无 blob:）会拦截 → HMR 无法自动恢复。blob worker 脚本源自页面自身同源 JS，
  // 风险可控。生产部署（GitHub Pages 不带 CSP 头）不受影响。
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https: wss://*.supabase.co",
    "font-src 'self' https://fonts.gstatic.com",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join('; '),
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** Vite 插件：为 dev / preview 服务器注入安全 & 缓存头 */
function headersPlugin(): Plugin {
  return {
    name: 'custom-headers',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        // Dev 环境下放宽 script-src 以支持 HMR
        const devCSP = [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "frame-src 'self'",
          // HMR 断线重连的 blob Worker 心跳（waitForSuccessfulPing）必须放行 blob:
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "img-src 'self' data: https:",
          "connect-src 'self' ws: wss: https:",
          "font-src 'self' data: https://fonts.gstatic.com",
          "frame-ancestors 'self'",
          "form-action 'self'",
          "base-uri 'self'",
        ].join('; ')
        res.setHeader('Content-Security-Policy', devCSP)
        Object.entries(securityHeaders).forEach(([k, v]) => {
          if (k !== 'Content-Security-Policy') res.setHeader(k, v)
        })
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        Object.entries(securityHeaders).forEach(([k, v]) => res.setHeader(k, v));
        if (/\.html?$/.test(req.url!) || req.url === '/') {
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (/\.(js|css|svg|woff2|png|jpg|ico)$/.test(req.url!)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        next();
      });
    },
  };
}

function purgeCssPlugin(): Plugin {
  return {
    name: 'vite-plugin-purgecss',
    async generateBundle(_, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith('.css')) {
          const chunk = bundle[fileName];
          if (chunk.type === 'asset' && typeof chunk.source === 'string') {
            const raw = chunk.source as string

            // PurgeCSS 8.x 无法正确解析 Vue scoped CSS 的 [data-v-xxxxx]
            // 属性选择器——会将 .foo[data-v-abc] 视为整体而找不到类名 .foo，
            // 导致全部 scoped 样式被误删（issue 复现：AuthModal/SetupGuide 等
            // 异步组件的 CSS 文件被清空为 0 字节）。
            // 解法：剥离 data-v-* hash → PurgeCSS → 恢复 hash 到类/ID 选择器。
            const scopeHashes = new Set<string>()
            const stripped = raw.replace(/\[data-v-[a-f0-9]+\]/g, (m) => {
              scopeHashes.add(m)
              return ''
            })

            const result = await new PurgeCSS().purge({
              content: [
                './index.html',
                './app.html',
                './src/**/*.vue',
                './src/**/*.js',
                './src/**/*.ts'
              ],
              css: [{ raw: stripped }],
              safelist: {
                standard: [
                  'open', 'show', 'active', 'visible', 'dragging',
                  'card-expanded', 'group-expanded', 'card-selected',
                  'list-item', 'resize-handle', 'no-drag', 'confirm-foot',
                  'cat-sort-list', 'cat-placeholder', 'cat-dragging', 'drag-handle',
                  'resizeLeft', 'resizeRight',
                  'dead-link-badge', 'gfw-blocked-badge',
                  // TipTap / ProseMirror 运行时注入的 class
                  'is-editor-empty', 'ProseMirror-selectednode',
                  /^modal-/, /^sp-/, /^settings-/, /^ctx-/, /^as-/, /^mfb-/,
                  /^vs-/, /^bmp-/, /^attr-/, /^batch-/, /^search-/,
                  /^detail-/, /^rail-/, /^card-/, /^group-/,
                  /^ft-/, /^btn-/, /^form-/, /^check-/,
                  /^toast-/, /^confirm-/, /^dp-/, /^overlay/,
                  /^icon-/, /^flex-/, /^mb-/, /^mt-/, /^pt-/, /^text-/,
                  /^cmd-/, /^ssp-/, /^code-/,
                  // Vue Transition 动态生成的 class（name="cpalette"/"drawer"）
                  /^cpalette-/, /^drawer-/,
                  // HistoryPanel diff-* 动态拼接 class
                  /^diff-/,
                  /^brand-logo-/,
                  /^share-/,
                  /^bm/,
                ],
                deep: [/expanded/, /active/, /open/, /show/, /visible/, /view-transition/, /theme-transition/],
                variables: [/^--brand-logo-/]
              },
              variables: true
            })

            if (result[0] && result[0].css) {
              let purged = result[0].css
              // 恢复 data-v-* hash：加回到每个 class / ID 选择器后面
              for (const hash of scopeHashes) {
                purged = purged.replace(
                  /(?<=[}\s,{;]|^)([.#][a-zA-Z_-][\w-]*)/g,
                  `$1${hash}`
                )
              }
              const originalSize = raw.length
              const newSize = purged.length
              if (newSize < originalSize) {
                chunk.source = purged
                console.log(`[PurgeCSS] ${fileName}: ${(originalSize/1024).toFixed(1)}KB → ${(newSize/1024).toFixed(1)}KB (${Math.round((1 - newSize/originalSize) * 100)}% reduced)`);
              }
            }
          }
        }
      }
    }
  };
}

/**
 * 2026-08-23 移除：原 spa404Plugin（GitHub Pages SPA fallback，把 index.html 复制为
 * dist/404.html）。托管已迁 Cloudflare Pages——它检测到顶层 404.html 会判定为
 * 非 SPA，导致未知路径返回 404（原生 SPA 支持被关闭）。移除后 dist 无 404.html，
 * Cloudflare 原生 SPA：未知路径自动匹配根 /（200 index.html）。
 * GitHub Pages 已停用（ulink.ren 由 Cloudflare Pages 同域托管），不再需要该插件。
 */

/**
 * 双入口 MPA 路径别名：把 `/app` 重写到 `app.html`，对齐 Cloudflare Pages 的
 * Pretty URL 行为（/app → app.html），dev / preview / e2e 与生产保持同一 URL。
 * dev 下 `/s/*` 无 SSR Function（生产走 Pages Function），同样重写到 app.html，
 * 模拟生产「SSR 壳内接管 SPA」的分享路由环境，e2e 分享用例行为不变。
 * 落地页（index.html）自身位于 /，无需别名。
 */
function mpaAliasPlugin(): Plugin {
  const rewrite = (reqUrl: string | undefined): string | null => {
    if (!reqUrl) return null
    const q = reqUrl.indexOf('?')
    const path = q === -1 ? reqUrl : reqUrl.slice(0, q)
    const rest = q === -1 ? '' : reqUrl.slice(q)
    if (path === '/app' || path === '/app/') return '/app.html' + rest
    if (path.startsWith('/s/')) return '/app.html' + rest
    return null
  };
  const middleware = (req: { url?: string }, _res: unknown, next: () => void) => {
    const rewritten = rewrite(req.url)
    if (rewritten) req.url = rewritten
    next();
  };
  return {
    name: 'mpa-app-alias',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  };
}

/**
 * 法律文档供给：把 docs/legal/*.md 渲染成**带样式的静态页面**并发布
 *
 * 为什么需要：协议、隐私政策、退款政策必须能被用户**直接访问到完整正文**
 * （登录/注册页的入口通常只放链接，监管核查时要求可打开阅读）。
 *
 * 历史问题（2026-10-27 修复）：此前直接把 .md 以 `text/markdown` 抛出，
 * 用户点开看到的是 `## 一、…`、`|---|` 这样未渲染的裸 Markdown（截图实证），
 * 排版完全不可读。现在由 `src/lib/legal/renderLegalDoc.ts` 在构建期渲染为
 * 自包含 HTML（内联 CSS、零 JS），单一真源仍在 docs/legal/，本插件只做供给。
 *
 * 发布产物（多路径并存，保证任何静态托管的裸路径都能命中）：
 * - `legal/<slug>.html`   ← 站内链接使用（显式后缀，不依赖托管的 pretty URL）
 * - `legal/<slug>/index.html` ← `/legal/<slug>` 与 `/legal/<slug>/` 也能打开
 * - `legal/index.html`    ← 索引页
 * - `legal/<slug>.md`     ← 原始 Markdown 保留（便于归档/核查取证，不再对外链接）
 */
/* ══════════════════════════════════════════════════════════════════════
 * 法律文档渲染器（**内联副本**）
 *
 * 为什么内联而不是 import：CI 用 Vite 8 的 **rolldown** 打包 vite.config.ts，
 * 它不解析对项目源文件的 import —— 无扩展名 / .js / .ts 三种写法全部报
 * `[UNRESOLVED_IMPORT]`，导致 e2e 的 webServer 起不来、deploy 被跳过。
 * 而 Windows 本地因 fallback 到 esbuild 能过，所以本地验证不可信。
 *
 * ⚠️ 本段与 `src/lib/legal/renderLegalDoc.ts` 是**同一份实现**（唯一外部依赖是
 *    npm 包 marked，rolldown 可正常解析）。**改一处必须同步改另一处**，
 *    否则线上渲染与单测覆盖的行为会漂移。
 * ══════════════════════════════════════════════════════════════════════ */

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


/** 三份对外法律文档的展示顺序与短标签（长标题取自各文件 h1） */
const LEGAL_DOC_SEQUENCE = ['terms-of-service', 'privacy-policy', 'refund-policy'] as const

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

interface LegalDocInfo {
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

interface ParsedLegalDoc extends LegalDocInfo {
  /** 正文 HTML（已移除 h1，h1 单独渲染在页头） */
  bodyHtml: string
  /** 目录项（h2 / h3） */
  toc: { id: string; text: string; level: 2 | 3 }[]
}

/** `terms-of-service.md` → `terms-of-service` */
function slugFromFileName(fileName: string): string {
  return fileName.replace(/\.md$/i, '')
}

function shortLabelOf(slug: string, fallback = ''): string {
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
function stripInternalSections(markdown: string): string {
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
function parseLegalDoc(markdown: string, slug: string): ParsedLegalDoc {
  const cleaned = stripInternalSections(markdown)
  const titleMatch = /^\s*#\s+(.+?)\s*$/m.exec(cleaned)
  const title = titleMatch ? stripTags(titleMatch[1]) : slug
  const bodyMd = titleMatch ? cleaned.replace(titleMatch[0], '') : cleaned

  // breaks: 法律文档里「运营主体／信用代码／邮箱」等多行信息靠单换行分行，
  // 默认（breaks:false）会被合并成一整段挤在一行。
  const html = md().parse(escapeRawHtml(autoLinkEmails(bodyMd)).trim(), { async: false, gfm: true, breaks: true }) as string
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
function renderLegalDocHtml(doc: ParsedLegalDoc): string {
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

interface LegalIndexEntry extends LegalDocInfo {}

/** 渲染 /legal/ 索引页 */
function renderLegalIndexHtml(docs: LegalIndexEntry[]): string {
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

function legalDocsPlugin(): Plugin {
  const dir = here('./docs/legal');

  const read = (name: string) => {
    const file = resolve(dir, name);
    // 目录穿越防护：只允许 docs/legal 下的 .md
    if (!file.startsWith(dir) || !name.endsWith('.md')) return null;
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };

  const list = () => {
    try {
      // PENDING.md 是内部待办清单（含统一社会信用代码、未填占位、功能缺口），
      // 属于内部管理文件，**不对外发布**。
      return readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'PENDING.md');
    } catch {
      return [] as string[];
    }
  };

  /** 全部对外文档，按 LEGAL_DOC_SEQUENCE 排序（其余文档排在后面按文件名） */
  const parseAll = () =>
    list()
      .map((f) => ({ file: f, md: read(f) }))
      .filter((x): x is { file: string; md: string } => x.md !== null)
      .map(({ file, md }) => parseLegalDoc(md, slugFromFileName(file)))
      .sort((a, b) => {
        const ia = LEGAL_DOC_SEQUENCE.indexOf(a.slug as (typeof LEGAL_DOC_SEQUENCE)[number]);
        const ib = LEGAL_DOC_SEQUENCE.indexOf(b.slug as (typeof LEGAL_DOC_SEQUENCE)[number]);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.slug.localeCompare(b.slug);
      });

  /** dev / preview 共用的路由：/legal/ 索引、/legal/<slug>[.html|/]、/legal/<name>.md 原文 */
  const middleware = (
    req: { url?: string },
    res: { setHeader: (k: string, v: string) => void; end: (b: string) => void },
    next: () => void,
  ) => {
    const path = (req.url || '').split('?')[0].split('#')[0];

    // 原始 Markdown（保留可取证入口，不对外链接）
    const mdMatch = /^\/legal\/([\w.-]+\.md)$/.exec(path);
    if (mdMatch) {
      const body = read(mdMatch[1]);
      if (body === null) return next();
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(body);
      return;
    }

    if (path === '/legal' || path === '/legal/' || path === '/legal/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(renderLegalIndexHtml(parseAll()));
      return;
    }

    // /legal/<slug> | /legal/<slug>/ | /legal/<slug>.html
    const pageMatch = /^\/legal\/([\w-]+?)(?:\.html)?\/?$/.exec(path);
    if (pageMatch) {
      const md = read(`${pageMatch[1]}.md`);
      if (md === null) return next();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(renderLegalDocHtml(parseLegalDoc(md, pageMatch[1])));
      return;
    }

    next();
  };

  return {
    name: 'ulink-legal-docs',
    async configureServer(server) {
      await ensureMarked();
      server.middlewares.use(middleware as never);
    },
    async configurePreviewServer(server) {
      await ensureMarked();
      server.middlewares.use(middleware as never);
    },
    async generateBundle() {
      await ensureMarked();
      const docs = parseAll();
      for (const doc of docs) {
        const html = renderLegalDocHtml(doc);
        const source = read(`${doc.slug}.md`);
        this.emitFile({ type: 'asset', fileName: `legal/${doc.slug}.html`, source: html });
        // 目录形态兜底：某些托管不做扩展名省略，直接按目录默认文档命中
        this.emitFile({ type: 'asset', fileName: `legal/${doc.slug}/index.html`, source: html });
        if (source !== null) {
          this.emitFile({ type: 'asset', fileName: `legal/${doc.slug}.md`, source });
        }
      }
      this.emitFile({ type: 'asset', fileName: 'legal/index.html', source: renderLegalIndexHtml(docs) });
    },
  };
}


/**
 * 本地开发与预览环境网页元数据提取中间件：
 * 突破浏览器跨域限制，在 Vite 服务端直接 fetch 目标网页并提取真实 Title / Description，
 * 保持 dev / preview 与 Cloudflare Pages 边缘端点（functions/api/extract-metadata.ts）一致。
 */
function metadataExtractorPlugin(): Plugin {
  const decodeHtml = (str: string) => {
    if (!str) return '';
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .trim();
  };

  const decodeHtmlBuffer = (buffer: ArrayBuffer, contentTypeHeader = ''): string => {
    const headerMatch = contentTypeHeader.match(/charset=([a-zA-Z0-9_-]+)/i);
    let charset = headerMatch ? headerMatch[1].toLowerCase() : '';

    const previewSlice = new Uint8Array(buffer.slice(0, 2048));
    let previewStr = '';
    for (let i = 0; i < previewSlice.length; i++) {
      const b = previewSlice[i];
      previewStr += b < 128 ? String.fromCharCode(b) : ' ';
    }

    if (!charset) {
      const metaCharsetMatch =
        previewStr.match(/<meta[^>]+charset=["']?([a-zA-Z0-9_-]+)/i) ||
        previewStr.match(/<meta[^>]+content=["'][^"']*charset=([a-zA-Z0-9_-]+)/i);
      if (metaCharsetMatch) {
        charset = metaCharsetMatch[1].toLowerCase();
      }
    }

    if (charset.includes('gb')) {
      charset = 'gbk';
    } else if (charset.includes('big5')) {
      charset = 'big5';
    } else if (charset.includes('utf-8') || charset.includes('utf8')) {
      charset = 'utf-8';
    }

    try {
      if (charset && charset !== 'utf-8') {
        return new TextDecoder(charset).decode(buffer);
      }
    } catch {}

    const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
    const utf8Str = utf8Decoder.decode(buffer);
    const errorCount = (utf8Str.match(/\uFFFD/g) || []).length;
    if (errorCount > 3) {
      try {
        const gbkStr = new TextDecoder('gbk').decode(buffer);
        if ((gbkStr.match(/\uFFFD/g) || []).length < errorCount) {
          return gbkStr;
        }
      } catch {}
    }
    return utf8Str;
  };

  const handler = async (req: any, res: any, next: any) => {
    const urlPath = (req.url || '').split('?')[0];

    if (urlPath === '/api/ai-candidates') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
      }

      let rawBody = '';
      req.on('data', (chunk: any) => { rawBody += chunk.toString(); });
      req.on('end', async () => {
        try {
          const body = JSON.parse(rawBody || '{}');
          const { type, query, targetUrl, targetTitle } = body;

          let mimoKey = process.env.MIMO_API_KEY || '';
          if (!mimoKey) {
            try {
              const rawEnv = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
              const m = rawEnv.match(/MIMO_API_KEY=([^\r\n]+)/);
              if (m) mimoKey = m[1].trim();
            } catch {}
          }

          if (!mimoKey) {
            res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ success: false, error: 'mimo_key_not_configured' }));
          }

          let prompt = '';
          if (type === 'similar') {
            const site = targetTitle ? `${targetTitle} (${targetUrl || ''})` : (targetUrl || '该网站');
            prompt = `你是一个资深互联网工具与高价值软件挖掘专家。\n用户正在寻找与网站【${site}】功能相近、定位相似的优秀同类平台、优质竞品或开源平替工具。\n\n请推荐 3-5 个真实存在、当前知名且正常运行的顶级公网网站。\n要求：\n1. 网站网址必须真实有效（如官方首页地址），严禁捏造或拼接不存在的网址。\n2. 包含高质量同类工具、开源平替、轻量级替代或国内直连产品。\n3. 严禁包含任何 Emoji 表情符号。\n4. 输出合法的 JSON 数组，格式如下：\n[\n  {\n    "title": "工具名称",\n    "url": "https://...",\n    "notes": "20-50字核心功能与特色说明",\n    "tag": "开源免费/轻量易用/专业首选/国内直连 等简短标签",\n    "highlight": "一句话推荐理由"\n  }\n]\n直接输出 JSON，不要任何 Markdown 标记或多余文字。`;
          } else {
            const q = (query || '').trim();
            if (!q) {
              res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              return res.end(JSON.stringify({ success: false, error: 'empty_query' }));
            }
            prompt = `你是一个资深互联网工具与高价值软件挖掘专家。\n用户正在寻找满足特定需求的真实优质网站或在线工具。\n用户需求/意图："${q}"\n\n请推荐 3-5 个真实存在、当前知名且正常运行的顶级公网网站。\n要求：\n1. 网站网址必须真实有效（如官方首页地址），严禁捏造或胡乱拼接不存在的网址。\n2. 针对用户具体意图，精准给出具有代表性的实用工具。\n3. 严禁包含任何 Emoji 表情符号。\n4. 输出合法的 JSON 数组，格式如下：\n[\n  {\n    "title": "工具名称",\n    "url": "https://...",\n    "notes": "20-50字核心功能与特色说明",\n    "tag": "开源免费/轻量易用/专业首选/国内直连 等简短标签",\n    "highlight": "一句话推荐理由"\n  }\n]\n直接输出 JSON，不要任何 Markdown 标记或多余文字。`;
          }

          const mimoRes = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${mimoKey}`,
            },
            body: JSON.stringify({
              model: 'mimo-v2.6-flash',
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.2,
              max_tokens: 1000,
            }),
            signal: AbortSignal.timeout(15000),
          });

          if (!mimoRes.ok) {
            res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ success: false, error: 'upstream_failed' }));
          }

          const mData = await mimoRes.json() as any;
          const mRaw = mData.choices?.[0]?.message?.content?.trim() || '';
          const mJson = mRaw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
          const items = JSON.parse(mJson);

          if (Array.isArray(items) && items.length > 0) {
            const validItems = items.filter(
              (it: any) => it && typeof it.title === 'string' && typeof it.url === 'string' && it.url.startsWith('http')
            );
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ success: true, items: validItems }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ success: false, error: 'empty_result' }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ success: false, error: err?.message || 'internal_error' }));
        }
      });
      return;
    }

    if (urlPath !== '/api/extract-metadata') return next();

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    const onBodyReady = async (rawBody: string) => {
      let targetUrl = '';
      let availableAttributes: Array<{ id: string; name: string }> = [];
      let availableCategories: Array<{ id: string; name: string }> = [];
      try {
        if (req.method === 'POST') {
          const parsed = JSON.parse(rawBody || '{}');
          targetUrl = parsed.url || '';
          if (Array.isArray(parsed.availableAttributes)) {
            availableAttributes = parsed.availableAttributes;
          }
          if (Array.isArray(parsed.availableCategories)) {
            availableCategories = parsed.availableCategories;
          }
        } else {
          const u = new URL(req.url!, 'http://localhost');
          targetUrl = u.searchParams.get('url') || '';
        }
      } catch {
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'invalid_json' }));
        }
        return;
      }

      const clean = (targetUrl || '').trim();
      if (!clean || !/^https?:\/\//i.test(clean)) {
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'invalid_url' }));
        }
        return;
      }

      try {
        const u = new URL(clean);
        const h = u.hostname.toLowerCase();
        if (h === 'localhost' || h === '127.0.0.1' || /^192\.168\./.test(h) || /^10\./.test(h)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'private_ip_forbidden' }));
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'invalid_url_format' }));
      }

      let title = '';
      let description = '';
      let llmSuggestedCatId: string | undefined = undefined;
      let llmSuggestedAttrs: string[] = [];
      try {
        const tryFetch = async (target: string) => {
          return await fetch(target, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            signal: AbortSignal.timeout(4000),
            redirect: 'follow',
          });
        };

        let upstream: Response | null = null;
        try {
          upstream = await tryFetch(clean);
        } catch {
          try {
            const parsed = new URL(clean);
            if (!parsed.hostname.startsWith('www.') && parsed.hostname.split('.').length === 2) {
              parsed.hostname = 'www.' + parsed.hostname;
              upstream = await tryFetch(parsed.href);
            }
          } catch {}
        }

        try {
          const contentType = upstream ? upstream.headers.get('content-type') || '' : '';
          if (upstream && upstream.ok && (contentType.includes('text/html') || contentType.includes('application/xhtml+xml') || !contentType)) {
            const buf = await upstream.arrayBuffer();
            const html = decodeHtmlBuffer(buf, contentType);
            const headSlice = html.slice(0, 150000);

            const ogTitleMatch =
              headSlice.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
              headSlice.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
            const tagTitleMatch = headSlice.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (ogTitleMatch && ogTitleMatch[1].trim()) title = decodeHtml(ogTitleMatch[1]);
            else if (tagTitleMatch && tagTitleMatch[1].trim()) title = decodeHtml(tagTitleMatch[1]);

            const descMatch =
              headSlice.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
              headSlice.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i) ||
              headSlice.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
              headSlice.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
            if (descMatch && descMatch[1].trim()) description = decodeHtml(descMatch[1]);
          }
        } catch {}

        if (!title && upstream && upstream.ok) {
          const jinaTargets = [clean];
          try {
            const parsed = new URL(clean);
            if (!parsed.hostname.startsWith('www.') && parsed.hostname.split('.').length === 2) {
              jinaTargets.push(`https://www.${parsed.hostname}${parsed.pathname}${parsed.search}`);
            }
          } catch {}

          for (const jt of jinaTargets) {
            try {
              const jinaRes = await fetch(`https://r.jina.ai/${jt}`, {
                headers: { Accept: 'text/plain' },
                signal: AbortSignal.timeout(6000),
              });
              if (jinaRes.ok) {
                const text = await jinaRes.text();
                const tm = text.match(/^Title:\s*(.+)$/im);
                const dm = text.match(/^Description:\s*(.+)$/im);
                if (tm && tm[1].trim()) title = decodeHtml(tm[1].trim());
                if (dm && dm[1].trim()) description = decodeHtml(dm[1].trim());
                else if (!description) {
                  const bodyClean = text
                    .replace(/^Title:.*$/im, '')
                    .replace(/^URL Source:.*$/im, '')
                    .replace(/^Markdown Content:.*$/im, '')
                    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                    .replace(/[#*`_~>-]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                  if (bodyClean.length > 10) description = bodyClean.slice(0, 160);
                }
                if (title) break;
              }
            } catch {}
          }
        }

        
        // 3. 终极真智能提炼：调用大模型（LLM），将抓取到的原始网页标题与描述深度提炼为
        // 真正的「网站名称」与精炼「备注」（去除SEO关键词堆砌、口号与域名后缀，概括核心业务用途）
        let mimoKey = process.env.MIMO_API_KEY || '';
        if (!mimoKey) {
          try {
            const rawEnv = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
            const m = rawEnv.match(/MIMO_API_KEY=([^\r\n]+)/);
            if (m) mimoKey = m[1].trim();
          } catch {}
        }

        if (mimoKey) {
          try {
            const attrClause = availableAttributes.length > 0
              ? `\n可选属性标签（严格从以下标签中挑选0-3个最匹配的ID数组，没有则填[]）：\n${JSON.stringify(availableAttributes.map(a => ({ id: a.id, name: a.name })))}`
              : '';
            const catClause = availableCategories.length > 0
              ? `\n可选分类列表（严格从以下分类列表中挑选最匹配的一个分类ID，没有把握填null）：\n${JSON.stringify(availableCategories.map(c => ({ id: c.id, name: c.name })))}`
              : '';

            const llmPrompt = `你是一个专业的浏览器书签管理器 AI 整理助手。
用户正在收藏网页：${clean}
${title ? `从该网页抓取到的原始标题：${title}` : ''}
${description ? `从该网页抓取到的原始描述：${description}` : ''}
${attrClause}${catClause}

请根据网址及以上原始信息，为用户智能提炼最地道、规范的书签元数据：
1. "title": 真正的“网站名称”（简洁、地道、纯粹的品牌或产品名，如“4399小游戏”、“GitHub”、“哔哩哔哩”。绝对不要带SEO关键词堆砌、网站后缀、二级域名、营销口号或冗长描述，控制在2-15字内）
2. "description": 真正的“备注”（用一句话精炼概括该网站是什么、核心功能或用途，文雅通顺，20-60字。严禁堆砌游戏名、商品列表或SEO关键词，不要简单复读标题）
3. "suggestedCategoryId": 从可选分类列表中选中的最匹配分类ID（若无可填null）
4. "suggestedAttrIds": 从可选属性标签中挑选0-3个最匹配的ID数组
5. 严禁任何 Emoji 表情符号，输出典雅清晰的纯中文/英文文字。

直接输出合法的JSON，不要任何Markdown或多余文本：
{"title": "站点名称", "description": "一句话精炼简介", "suggestedCategoryId": "分类ID或null", "suggestedAttrIds": []}`;

            const mimoRes = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${mimoKey}`,
              },
              body: JSON.stringify({
                model: 'mimo-v2.6-flash',
                messages: [{ role: 'user', content: llmPrompt }],
                temperature: 0.1,
                max_tokens: 300,
              }),
              signal: AbortSignal.timeout(10000),
            });

            if (mimoRes.ok) {
              const mData = await mimoRes.json();
              const mRaw = mData.choices?.[0]?.message?.content?.trim() || '';
              const mJson = mRaw.replace(/^\`\`\`json\s*/i, '').replace(/^\`\`\`\s*/i, '').replace(/\`\`\`$/i, '').trim();
              const parsed = JSON.parse(mJson);
              if (parsed && parsed.title) {
                title = parsed.title;
                if (parsed.description) description = parsed.description;
                if (parsed.suggestedCategoryId && typeof parsed.suggestedCategoryId === 'string' && parsed.suggestedCategoryId !== 'null') {
                  llmSuggestedCatId = parsed.suggestedCategoryId;
                }
                if (Array.isArray(parsed.suggestedAttrIds)) {
                  llmSuggestedAttrs = parsed.suggestedAttrIds.filter((id: any) => typeof id === 'string');
                }
              }
            }
          } catch {}
        }

        const stripEmojis = (s: string) =>
          s.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '').trim();

        title = stripEmojis(title);
        description = stripEmojis(description);

        if (res.headersSent || res.writableEnded) return;
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(
          JSON.stringify({
            success: Boolean(title || description),
            title: title || undefined,
            description: description || undefined,
            categoryId: llmSuggestedCatId || undefined,
            suggestedAttrIds: llmSuggestedAttrs.length > 0 ? llmSuggestedAttrs : undefined,
            url: clean,
          }),
        );
      } catch (err: any) {
        console.error('[DEBUG metadataExtractor] processRequest error:', err);
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err?.message || 'fetch_error' }));
        }
      }
    };

    if (req.method === 'GET') {
      onBodyReady('');
    } else if (req.readableEnded) {
      onBodyReady('');
    } else {
      let body = '';
      req.on('data', (chunk: Buffer | string) => {
        body += chunk;
        if (body.length > 50000) req.destroy();
      });
      req.on('end', () => onBodyReady(body));
    }
  };

  return {
    name: 'ulink-metadata-extractor',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  define: {
    // 构建时注入版本信息：__BUILD_TIME__ 每次部署必变，设置面板显示以确认线上是否为最新构建
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    legalDocsPlugin(),
    metadataExtractorPlugin(),
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '与链',
        short_name: 'ulink',
        description: '与链（ulink）— 个人书签管理器，支持云同步与端到端加密',
        theme_color: '#122E8A',
        background_color: '#F5EFEA',
        display: 'standalone',
        // 应用主体在 /app（/ 是宣传落地页）：已装 PWA 启动直达应用，不经落地页
        scope: '/',
        start_url: '/app',
        icons: [{
          src: '/logo.svg',
          sizes: 'any',
          type: 'image/svg+xml'
        }],
        share_target: {
          action: '/app',
          method: 'GET',
          // GET 方法唯一合法的 enctype；显式声明可消除 Chromium 的
          // "Enctype should be set to..." manifest 警告
          enctype: 'application/x-www-form-urlencoded',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
          },
        },
      },
      workbox: {
        // HTML 不 precache：precache 旧 index.html 会让已装 PWA 的用户在部署后
        // 首刷命中旧版（autoUpdate 需等 SW 换代才切新）。改为导航请求 NetworkFirst
        // （网络优先，离线回退 pages-cache），部署后刷新即拿新 HTML —— 一次刷新即新。
        globPatterns: ['**/*.{js,css,svg,woff2}'],
        // 必须显式覆盖 VitePWA 默认 navigateFallback:"index.html"——HTML 已不 precache，
        // 默认值会让 workbox 生成指向不存在 precache 条目的 NavigationRoute（SW 顶层抛错失效）。
        // 置 undefined 后导航统一走下方 NetworkFirst（网络优先 + pages-cache 离线兜底）。
        navigateFallback: undefined,
        runtimeCaching: [{
          // 导航（页面跳转/刷新）网络优先：网络返回新 HTML 并更新 pages-cache；
          // 网络失败（离线）回退最近缓存的页面。10s 内网络无响应也回退缓存（慢网保护）。
          urlPattern: ({ request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'pages-cache',
            networkTimeoutSeconds: 10,
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 }
          }
        }, {
          urlPattern: /^https:\/\/api\.xinac\.net\/icon\//i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'favicon-cache',
            expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }
          }
        }, {
          urlPattern: /^https:\/\/(api\.fontshare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'font-cache',
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }
          }
        }]
      }
    }),
    purgeCssPlugin(),
    mpaAliasPlugin(),
    headersPlugin()],
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      // 双入口：/ = 宣传落地页（index.html），/app = 应用主体（app.html，
      // Cloudflare Pages Pretty URL 自动映射，dev/preview 由 mpaAliasPlugin 对齐）
      input: {
        landing: here('./index.html'),
        app: here('./app.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // TipTap 核心（必需）
            if (id.includes('node_modules/@tiptap/core') ||
                id.includes('node_modules/@tiptap/pm') ||
                id.includes('node_modules/@tiptap/starter-kit')) {
              return 'tiptap-core'
            }

            // TipTap 扩展（可延迟加载）
            if (id.includes('node_modules/@tiptap/extension-')) {
              return 'tiptap-extensions'
            }

            // ProseMirror（TipTap 底层依赖）
            if (id.includes('node_modules/prosemirror-')) {
              return 'prosemirror'
            }

            // Dexie IndexedDB 封装
            if (id.includes('node_modules/dexie/')) {
              return 'dexie'
            }

            // DOMPurify HTML 净化
            if (id.includes('node_modules/dompurify/')) {
              return 'dompurify'
            }

            // Supabase 客户端（独立 chunk，便于缓存）
            if (id.includes('node_modules/@supabase/')) {
              return 'supabase'
            }

            // fuse.js 模糊搜索（独立 chunk，按需加载）
            if (id.includes('node_modules/fuse.js/')) {
              return 'fuse'
            }

            // pinyin-pro 拼音匹配（独立 chunk，按需加载）
            if (id.includes('node_modules/pinyin-pro/')) {
              return 'pinyin-pro'
            }

            // Vue 核心
            if (id.includes('node_modules/vue/') ||
                id.includes('node_modules/@vue/') ||
                id.includes('node_modules/pinia/')) {
              return 'vue-vendor'
            }

            // 其他第三方库（nanoid 等）
            return 'vendor'
          }
        }
      }
    }
  },
  server: {
    open: true,
  },
  preview: {},
});