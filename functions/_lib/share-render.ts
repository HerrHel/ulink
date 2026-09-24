/**
 * share-render — 分享页渲染核（可移植纯函数，零运行时依赖）。
 *
 * 与 `supabase/functions/share-html/index.ts` 中的渲染部分保持同步（该文件为 Deno
 * Edge Function 版，本文件为 Cloudflare Pages Functions 版；两处均为「取数 + 渲染」
 * 结构，渲染核不触碰任何平台特有 API，切换平台只需替换外层薄薄一层胶水）。
 *
 * 品牌：中文「与链」，英文「ulink」。支持中英双语：renderSharePage 传 locale
 * （'zh-CN' | 'en-US'），渲染文案随之切换（og:locale / lang / 全部 UI 文案）。
 *
 * 设计（2026-08-25 改版 v4，对齐 App 组聚焦/列表模式/编辑器语义）：
 * - 白色聚焦卡片包裹内容区（与组聚焦一致：surface 底 + 边框 + accent 竖条 + 光晕），
 *   CTA 在卡片头部右上；书签列表移到卡片外右侧垂直排列（窄屏回退单列）
 * - 组 notes 渲染富文本：白名单 sanitize（对齐 App sanitizeReadonlyHTML）+ 放行
 *   style 中 color 子集（编辑过的文字颜色分享页保留）+ 内联书签转可点击小卡片
 *   （data-bm-id → 组书签 URL，点击跳转）+ taskItem 未完成项可点击勾选（纯前端视觉）
 * - 书签行 favicon/首字母用 :has() 方案共存（App cards.css 同款，杜绝重叠）
 *
 * 使用：Cloudflare Pages Function `functions/s/[gid].ts` 取数后调用
 * `renderSharePage(group, bookmarks, shareUrl, appOrigin, locale)` 生成完整 HTML。
 */

export type ShareLocale = 'zh-CN' | 'en-US'

/** 渲染文案字典（无第三方依赖，保持纯函数可移植性）。品牌词：zh 与链 / en ulink。 */
const T = {
  'zh-CN': {
    lang: 'zh-CN',
    ogLocale: 'zh_CN',
    siteName: 'ulink',
    defaultGroupName: '分享组',
    defaultCategoryName: '分享分类',
    notFoundTitle: '分享不存在 - 与链',
    notFoundHeading: '该分享不存在',
    notFoundBody: '私有链接可能已失效，或分享者已停止分享',
    unavailableTitle: '分享暂时无法访问 - 与链',
    unavailableHeading: '分享暂时无法访问',
    unavailableBody: '服务暂时不可用，请稍后重试；分享内容并未失效',
    backHome: '返回与链首页',
    logoText: '与链',
    headSub: '私有链接分享',
    desc: '{n} 个链接 · 凭专属私有链接访问',
    empty: '这个分享组还没有书签',
    emptyCategory: '这个分享分类还没有书签',
    count: '{n} 个链接',
    categoryMeta: '{n} 个书签 · {m} 个组',
    // ── 分类页（v2 卡片网格）──
    catDesc: '{n} 个书签 · {m} 个组 · 凭专属私有链接访问',
    catBookmarks: '{n} 个书签',
    catGroups: '{m} 个组',
    catExpand: '展开 / 收起组内书签',
    catGroupEmpty: '这个组还没有书签',
    catNoNotes: '暂无笔记',
    subBookmark: '子书签',
    catChildren: '{n} 个子书签',
    catHide: '收起',
    cipherPlaceholder: '（内容已加密）',
    gridView: '宫格视图',
    listView: '列表视图',
    miniGridView: '小宫格视图',
    updatedAt: '更新于 {d}',
    cta: '保存至我的库',
    tocTitle: '目录',
    footerBrand: '与链 · ulink',
    footerSlogan: '收藏 · 整理 · 分享',
  },
  'en-US': {
    lang: 'en-US',
    ogLocale: 'en_US',
    siteName: 'ulink',
    defaultGroupName: 'Shared group',
    defaultCategoryName: 'Shared category',
    notFoundTitle: 'Share not found - ulink',
    notFoundHeading: 'This share no longer exists',
    notFoundBody: 'The link may have expired, or the owner stopped sharing it',
    unavailableTitle: 'Share temporarily unavailable - ulink',
    unavailableHeading: 'Share temporarily unavailable',
    unavailableBody: 'The service is temporarily unavailable. Please try again later — the share itself is fine',
    backHome: 'Back to ulink',
    logoText: 'ulink',
    headSub: 'Private share',
    desc: '{n} links · shared via private link',
    desc_one: '{n} link · shared via private link',
    empty: 'This shared group has no bookmarks yet',
    emptyCategory: 'This shared category has no bookmarks yet',
    count: '{n} links',
    count_one: '{n} link',
    categoryMeta: '{n} bookmarks · {m} groups',
    categoryMeta_one: '{n} bookmark · {m} groups',
    // ── category page (v2 card grid) ──
    catDesc: '{n} bookmarks · {m} groups · shared via private link',
    catDesc_one: '{n} bookmark · {m} groups · shared via private link',
    catBookmarks: '{n} bookmarks',
    catBookmarks_one: '{n} bookmark',
    catGroups: '{m} groups',
    catGroups_one: '{m} group',
    catExpand: 'Show / hide bookmarks in this group',
    catGroupEmpty: 'No bookmarks in this group yet',
    catNoNotes: 'No notes yet',
    subBookmark: 'Sub-item',
    catChildren: '{n} sub-items',
    catHide: 'Collapse',
    cipherPlaceholder: '(encrypted content)',
    gridView: 'Grid view',
    listView: 'List view',
    miniGridView: 'Mini grid view',
    updatedAt: 'Updated {d}',
    cta: 'Save to my library',
    tocTitle: 'Contents',
    footerBrand: 'ulink',
    footerSlogan: 'Collect · Organize · Share',
  },
} as const

/** favicon 提供方（与 src/config/urls.ts 的 FAVICON_PROVIDER_URL 一致，国内可访问）。 */
const FAVICON_PROVIDER_URL = 'https://api.xinac.net/icon/?url='

export interface PublicGroup {
  id: string
  name: string
  notes: string
  [k: string]: unknown
}
export interface PublicBookmark {
  id: string
  title: string
  url: string
  notes: string
  [k: string]: unknown
}

/** HTML 转义：& < > " '，使结果在「属性值（双引号）」与「文本节点」两种上下文都安全。 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// ── E2E 历史密文识别（与 src/crypto.ts 的 isThreePartCipher 语义一致，零依赖）──
// 旧版 E2E 曾加密 bookmarks 的 title/url/notes 与 group 的 name/notes；当前版本不再加密，
// 但云端仍存有历史密文（salt.iv.data 三段）。分享 RPC 直读云端 → 分享页无 key 无法解密，
// 直接渲染会把密文显示成乱码（且密文串外泄是信息泄露面）。分享页遇到密文字段一律
// 降级为占位提示，绝不渲染原文。
const B64_SEG_RE = /^[A-Za-z0-9+/]+={0,2}$/

function isCipherText(s: unknown): boolean {
  if (typeof s !== "string" || !s) return false
  const parts = s.split(".")
  if (parts.length !== 3) return false
  const [salt, iv, data] = parts
  if (!salt || !iv || !data) return false
  if (salt.length !== 44 || iv.length !== 16 || data.length < 24) return false
  return B64_SEG_RE.test(salt) && B64_SEG_RE.test(iv) && B64_SEG_RE.test(data)
}

/** 分享页文本降级：E2E 历史密文 → 占位提示（对齐 App 未解锁时 UI 显空不显乱码的语义）。 */
function deCipherText(dict: typeof T['zh-CN'] | typeof T['en-US'], v: unknown): string {
  const s = typeof v === "string" ? v : ""
  return isCipherText(s) ? dict.cipherPlaceholder : s
}

/** 协议白名单：仅放行 http/https，其余可导航 scheme（javascript:/data:/vbscript: 等）返空串。 */
function fixUrl(u: string): string {
  const t = (u || "").trim()
  if (!t) return ""
  if (/^https?:\/\//i.test(t)) return t
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/i.test(t)) return ""
  return "https://" + t
}

/** 展示域名：合法 URL 取 hostname 去 www.，解析失败返空串（不吐乱码）。 */
function domainOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/** 由安全书签 URL 派生 favicon 地址（M5：图标只由 URL 派生，不接受跨用户 b.icon）。 */
function faviconOf(u: string): string {
  const dm = domainOf(u)
  return dm ? FAVICON_PROVIDER_URL + encodeURIComponent(dm) : ""
}

/**
 * 毫秒时间戳 → YYYY-MM-DD（UTC，保证边缘节点时区一致、输出稳定）。
 * ts 非正（无时间）返回空串，调用方据此隐藏「更新于」徽章。
 */
function fmtDate(ts: number): string {
  if (!ts || ts <= 0 || !Number.isFinite(ts)) return ""
  const d = new Date(ts)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** 带内容的危险容器：整块剥离（含其文本），防脚本内容泄漏为可见文本（如 SEO 描述）。 */
const NOTES_BLOCKLIST = ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript', 'template']

/**
 * 剥离 HTML 标签得纯文本（组 notes 是 TipTap HTML，用于 SEO 描述等纯文本场景）。
 * 先删危险容器块（script/style 等连同内容），再剥标签——否则 <script>alert(1)</script>
 * 剥标签后剩 alert(1) 文本泄漏进 meta description（内容污染，非 XSS）。
 */
function stripTags(html: string): string {
  let out = (html || "").replace(/<!--[\s\S]*?-->/g, "")
  for (const t of NOTES_BLOCKLIST) {
    out = out
      .replace(new RegExp(`<\\s*${t}[\\s\\S]*?<\\s*/\\s*${t}\\s*>`, "gi"), "")
      .replace(new RegExp(`<\\s*/?\\s*${t}[\\s\\S]*?>`, "gi"), "")
  }
  return out.replace(/<[^>]+>/g, "").trim()
}

/** 简单插值：替换 {n} 等占位。 */
function fill(s: string, params: Record<string, string | number>): string {
  let out = s
  for (const [k, v] of Object.entries(params)) {
    out = out.split(`{${k}}`).join(String(v))
  }
  return out
}

/** 英文单复数：选 *_one / 基础键（en 复数规则仅 one/other，0 与 >1 用基础键）。 */
function pick(dict: typeof T['zh-CN'] | typeof T['en-US'], key: string, n: number): string {
  const d = dict as unknown as Record<string, string>
  const one = d[`${key}_one`]
  if (one != null && n === 1) return one
  return d[key] ?? key
}

/** 组 notes 纯文本描述：前 120 字，空则回退「N 个链接 · 由与链公开分享」。
 *  E2E 历史密文整段剥掉（回退默认描述），否则密文串会进 meta description/og:*。 */
function descriptionOf(dict: typeof T['zh-CN'] | typeof T['en-US'], group: PublicGroup, n: number): string {
  const raw = (group.notes || "").trim()
  if (!raw || isCipherText(raw)) return fill(pick(dict, 'desc', n), { n })
  const plain = stripTags(raw)
  return (plain && plain.slice(0, 120)) || fill(pick(dict, 'desc', n), { n })
}

// ── 富文本 notes 白名单清洗（语义对齐 App sanitizeReadonlyHTML，零依赖纯函数）──

/** 允许的标签（与 App _purifyReadonlyConfig.ALLOWED_TAGS 一致 + mark 高亮）。 */
const NOTES_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3',
  'blockquote', 'a', 'code', 'pre', 'hr', 'span', 'img', 'mark',
])
/** 允许的属性（与 App ALLOWED_ATTR 一致 + style 白名单子集；data-* 整族放行）。 */
const NOTES_ATTRS = new Set(['class', 'href', 'target', 'rel', 'src', 'alt', 'style'])
/** class 白名单（其余 class 剥离；data-* 无事件无协议，放行无注入面）。
 *  对齐组内 inlineCardHTML/groupRefCardHTML（useInlineCard.ts）：名称/域名/计数保留样式；
 *  gic-btn（详）/gic-remove 保留 class 由 CSS display:none 隐藏（剥 class 会导致「详」字裸奔） */
const NOTES_CLASSES = new Set(['group-inline-card', 'group-ref-card', 'gic-name', 'gic-domain', 'gic-count', 'gic-btn', 'gic-remove', 'is-deleted'])

/** 书签 id → url 映射（用于把内联书签 data-bm-id 转成可跳转 <a>）。 */
export interface NotesBmMap { [id: string]: { url?: string } }

/**
 * 颜色值校验（白名单，杜绝 CSS 注入）：仅放行 hex / rgb() / rgba() / hsl() / hsla()
 * （数值域限定 [\d\s.,%] 无字母，无法构造 url()/var()/expression 等）/ 纯字母命名色。
 */
function safeColorValue(c: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c
  if (/^rgba?\([\d\s.,%]+\)$/i.test(c)) return c
  if (/^hsla?\([\d\s.,%]+\)$/i.test(c)) return c
  if (/^[a-zA-Z]{3,20}$/.test(c)) return c
  return ""
}

/**
 * style 值白名单清洗（对齐组内 TipTap 渲染的样式子集）：
 * - color / background-color（文字色 + 高亮底色）
 * - font-size（字号：数值+px/em/rem/% 或 inherit）
 * - text-align（对齐：left/center/right/justify）
 * 其余声明（url()、background 简写等）整体剥除，杜绝 CSS 注入。
 */
function safeStyleValue(v: string): string {
  const out: string[] = []
  const decls = (v || "").split(";")
  for (const d of decls) {
    const m = d.match(/^\s*([a-zA-Z-]+)\s*:\s*(.*?)\s*$/)
    if (!m) continue
    const prop = m[1].toLowerCase()
    const val = m[2].trim()
    if (prop === "color" || prop === "background-color") {
      const c = safeColorValue(val)
      if (c) out.push(`${prop}: ${c}`)
    } else if (prop === "font-size") {
      if (/^\d+(\.\d+)?(px|em|rem|%)$/.test(val) || val === "inherit") out.push(`font-size: ${val}`)
    } else if (prop === "text-align") {
      if (/^(left|center|right|justify)$/.test(val)) out.push(`text-align: ${val}`)
    }
  }
  return out.join("; ")
}

/**
 * 白名单清洗组 notes（TipTap HTML）→ 安全富文本。
 * - 剥危险标签/事件/协议；<a> 强制 target=_blank + rel=noopener noreferrer nofollow
 * - style 仅保留 color 声明（编辑过的文字颜色分享页保留，其余 style 剥除）
 * - 内联书签（.group-inline-card，data-bm-id）转 <a>：bmMap 命中且 URL 安全 → 可点击跳转
 * - taskItem 结构：input/label/div 剥除，data-checked 保留（前端 JS 可点击切换）
 */
function sanitizeNotesHtml(html: string, bmMap?: NotesBmMap): string {
  let out = (html || "").replace(/<!--[\s\S]*?-->/g, "")
  for (const t of NOTES_BLOCKLIST) {
    out = out
      .replace(new RegExp(`<\\s*${t}[\\s\\S]*?<\\s*/\\s*${t}\\s*>`, "gi"), "")
      .replace(new RegExp(`<\\s*/?\\s*${t}[\\s\\S]*?>`, "gi"), "")
  }
  // 内联书签包裹深度：>0 表示当前在 .group-inline-card 内部（内部嵌套 gic-name 等 span）
  let icDepth = 0
  return out
    .replace(/<[^>]*>/g, (raw) => {
      const m = raw.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/)
      if (!m) return ""
      const close = !!m[1]
      const tag = m[2].toLowerCase()
      if (close) {
        // 内联书签内部：嵌套 span 的闭标签 → </span>；最外层闭标签 → </a>
        if (tag === 'span' && icDepth > 0) {
          icDepth--
          return icDepth === 0 ? '</a>' : '</span>'
        }
        return NOTES_TAGS.has(tag) ? `</${tag}>` : ""
      }
      if (!NOTES_TAGS.has(tag)) return ""
      const attrs: string[] = []
      const attrRe = /([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g
      let am: RegExpExecArray | null
      while ((am = attrRe.exec(raw)) !== null) {
        const name = am[1].toLowerCase()
        if (name.startsWith("on")) continue
        if (!NOTES_ATTRS.has(name) && !name.startsWith("data-")) continue
        const unq = am[2].replace(/^["']|["']$/g, "")
        if (name === "href" || name === "src") {
          if (!/^https?:\/\//i.test(unq)) continue // 协议白名单
        }
        if (name === "class") {
          const cls = unq.split(/\s+/).filter((c) => NOTES_CLASSES.has(c)).join(" ")
          if (!cls) continue
          attrs.push(`class="${cls}"`)
        } else if (name === "style") {
          const st = safeStyleValue(unq)
          if (!st) continue
          attrs.push(`style="${st}"`)
        } else if (name === "href") {
          attrs.push(`href="${unq.replace(/"/g, "&quot;")}"`, 'target="_blank"', 'rel="noopener noreferrer nofollow"')
        } else {
          attrs.push(`${name}="${unq.replace(/"/g, "&quot;")}"`)
        }
      }
      // 内联书签：转可点击 <a>（data-bm-id → 组书签 URL）；内部嵌套 span 深度计数
      if (tag === 'span') {
        const cls = (attrs.find((a) => a.startsWith("class=")) || "").slice(7).replace(/"/g, "")
        const bmId = (attrs.find((a) => a.startsWith("data-bm-id=")) || "").slice(11).replace(/"/g, "")
        const isInlineCard = cls.split(/\s+/).includes('group-inline-card')
        if (isInlineCard) {
          icDepth++
          const url = bmId && bmMap?.[bmId]?.url ? fixUrl(bmMap[bmId].url as string) : ""
          if (url) {
            attrs.push(`href="${esc(url)}"`, 'target="_blank"', 'rel="noopener nofollow"')
            return attrs.length ? `<a ${attrs.join(" ")}>` : `<a>`
          }
          return attrs.length ? `<span ${attrs.join(" ")}>` : `<span>`
        }
        // inline-card 内部的嵌套 span（gic-name/gic-domain/gic-count/gic-note-icon）也要计数，
        // 否则其 </span> 会提前输出为 </a>，导致 gic-domain 等跑到卡片外
        if (icDepth > 0) icDepth++
      }
      return attrs.length ? `<${tag} ${attrs.join(" ")}>` : `<${tag}>`
    })
}

// ── 渲染 ──

/** 构建 <head>：title / description / og:* / twitter:* / canonical。 */
function buildHead(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  shareUrl: string,
  ogImage: string,
): string {
  const title = `${group.name || dict.defaultGroupName} - ${dict.siteName}`
  const desc = descriptionOf(dict, group, bookmarks.length)
  const escTitle = esc(title)
  const escDesc = esc(desc)
  const escUrl = esc(shareUrl)
  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`,
    `<title>${escTitle}</title>`,
    `<meta name="description" content="${escDesc}">`,
    `<link rel="canonical" href="${escUrl}">`,
    // Open Graph
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="${dict.siteName}">`,
    `<meta property="og:title" content="${escTitle}">`,
    `<meta property="og:description" content="${escDesc}">`,
    `<meta property="og:url" content="${escUrl}">`,
    `<meta property="og:image" content="${esc(ogImage)}">`,
    `<meta property="og:locale" content="${dict.ogLocale}">`,
    // Twitter
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escTitle}">`,
    `<meta name="twitter:description" content="${escDesc}">`,
    `<meta name="twitter:image" content="${esc(ogImage)}">`,
  ].join("\n")
}

/**
 * 图标位：favicon/URL 图标 + 首字母占位共存（App cards.css 同款 :has() 方案，杜绝重叠）：
 *  - img 加载成功（非 .img-err）→ :has() 匹配，隐藏首字母；
 *  - img 加载失败（onerror/FALLBACK_JS 加 .img-err）→ 隐藏 img，露出首字母。
 */
function iconMarkup(imgSrc: string, letter: string, cls: string): string {
  const img = imgSrc
    ? `<img src="${esc(imgSrc)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fb onerror="this.classList.add('${cls}-img-err')">`
    : ""
  return `<span class="${cls}-fb">${esc(letter)}</span>${img}`
}

/** 品牌链接图标（与 App 端 ShareView logo 同一枚 SVG）。 */
const LOGO_SVG =
  `<svg viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><style>.s-b{stroke:#122E8A}.s-g{stroke:#10B981}@media(prefers-color-scheme:dark){.s-b{stroke:#4F6BFF}.s-g{stroke:#34D399}}</style><defs><mask id="s-mb"><rect width="240" height="240" fill="white"/><line x1="173" y1="144" x2="211" y2="144" stroke="black" stroke-width="38" stroke-linecap="round"/></mask><mask id="s-mg"><rect width="240" height="240" fill="white"/><line x1="29" y1="96" x2="67" y2="96" stroke="black" stroke-width="38" stroke-linecap="round"/></mask></defs><path class="s-b" d="M 24 96 L 120 96 C 176 96 192 104 192 144 C 192 184 176 192 120 192 L 48 192" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" mask="url(#s-mb)"/><path class="s-g" d="M 216 144 L 120 144 C 64 144 48 136 48 96 C 48 56 64 48 120 48 L 192 48" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" mask="url(#s-mg)"/></svg>`

/** 外链箭头（书签行 hover 时滑入）。 */
const ARROW_SVG =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12L12 4"/><path d="M5.5 4H12v6.5"/></svg>`

/** 组卡展开箭头（收起态朝下，展开态旋转 180°）。 */
const CHEVRON_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`

/** 布局切换图标（与 src/config/icons.ts 同款：宫格 / 列表 / 小宫格）。 */
const GRID_SVG =
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`
const LIST_SVG =
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 6L21 6.00078M8 12L21 12.0008M8 18L21 18.0007M3 6.5H4V5.5H3V6.5ZM3 12.5H4V11.5H3V12.5ZM3 18.5H4V17.5H3V18.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const MINIGRID_SVG =
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5.25" cy="5.25" r="1.8"/><circle cx="12" cy="5.25" r="1.8"/><circle cx="18.75" cy="5.25" r="1.8"/><circle cx="5.25" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.75" cy="12" r="1.8"/><circle cx="5.25" cy="18.75" r="1.8"/><circle cx="12" cy="18.75" r="1.8"/><circle cx="18.75" cy="18.75" r="1.8"/></svg>`

/**
 * 书签列表项（App 列表模式排版）：等高行（icon + 标题 + 域名，无 notes，行高统一）。
 * 标题为空时回退展示域名。纯静态 <a>，无需 JS。
 */
function buildBookmarkItem(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  b: PublicBookmark,
  child = false,
): string {
  // E2E 历史密文 URL 不派生链接（不跳转乱码地址、不派生图标）
  const urlCipher = isCipherText(b.url)
  const safe = urlCipher ? "" : fixUrl(b.url)
  const href = safe ? esc(safe) : "#"
  const rel = safe ? ' rel="noopener nofollow"' : ""
  const target = safe ? ' target="_blank"' : ""
  const dm = safe ? domainOf(safe) : ""
  const title = deCipherText(dict, b.title).trim() || dm || "?"
  const ch = title.charAt(0).toUpperCase()
  const rawNotes = typeof b.notes === 'string' ? deCipherText(dict, b.notes).trim() : ''
  const notes = rawNotes ? stripTags(rawNotes).slice(0, 120) : ''
  return [
    `<a class="bm${child ? " is-child" : ""}" href="${href}"${target}${rel}>`,
    `<div class="bm-main">`,
    `<span class="bm-icon">${iconMarkup(safe ? faviconOf(safe) : "", ch, "bm")}</span>`,
    `<div class="bm-info">`,
    `<span class="bm-title">${esc(title)}</span>`,
    dm ? `<span class="bm-url">${esc(dm)}</span>` : `<span class="bm-url">&nbsp;</span>`,
    `</div>`,
    `<span class="bm-arrow" aria-hidden="true">${ARROW_SVG}</span>`,
    `</div>`,
    notes ? `<p class="bm-notes">${esc(notes)}</p>` : '',
    `</a>`,
  ].join("")
}

/**
 * 组/分类图标位：icon 仅当为 http(s) URL 时渲染 <img>（跨用户数据不可信，
 * 非 URL 一律回退首字母，不把任意字符串当图标键使用）。参数为带 index signature
 * 的宽对象，组与分类分享共用（分类 icon 为图标键，非 URL → 一律回退首字母）。
 */
function groupIconMarkup(group: Record<string, unknown>, letter: string): string {
  const icon = typeof group.icon === "string" ? group.icon.trim() : ""
  const imgSrc = /^https?:\/\//i.test(icon) ? icon : ""
  return iconMarkup(imgSrc, letter, "hero")
}

/** notes 渲染结果：html（清洗后的富文本）+ toc（左侧标题导航，无数标题为空串）。 */
interface NotesResult {
  html: string
  toc: string
}

/** 组 notes 富文本渲染：白名单清洗 + 内联书签转链接 + 标题提取（TOC 锚点）。空则返回空。 */
function notesHtml(dict: typeof T['zh-CN'] | typeof T['en-US'], group: PublicGroup, bmMap?: NotesBmMap): NotesResult {
  const raw = (group.notes || "").trim()
  // E2E 历史密文笔记：整体是 salt.iv.data 三段串，无 key 不可解 → 不渲染（调用方回退「暂无笔记」）
  if (!raw || isCipherText(raw)) return { html: "", toc: "" }
  let cleaned = sanitizeNotesHtml(raw, bmMap).trim()
  if (!cleaned) return { html: "", toc: "" }
  // 提取 h1/h2/h3 标题并注入锚点 id（toc-N），文档级滚动定位（纯锚点 + scroll-behavior:smooth）
  let n = 0
  const headings: { level: number; text: string }[] = []
  cleaned = cleaned.replace(/<h([1-3])([^>]*)>([\s\S]*?)<\/h\1>/g, (all, level, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, "").trim()
    if (!text) return all
    const id = `toc-${n++}`
    headings.push({ level: Number(level), text })
    return `<h${level} id="${id}"${attrs}>${inner}</h${level}>`
  })
  const toc = headings.length
    ? `<nav class="toc" aria-label="${esc(dict.tocTitle)}"><div class="toc-title">${esc(dict.tocTitle)}</div>` +
      headings.map((h, i) => `<a class="toc-item toc-l${h.level}" href="#toc-${i}" title="${esc(h.text)}">${esc(h.text)}</a>`).join("") +
      `</nav>`
    : ""
  return { html: `<div class="focus-notes">${cleaned}</div>`, toc }
}

/**
 * 专栏画卷外壳：吸顶毛玻璃顶栏 + 居中自适应专栏容器 + 品牌传播尾部。
 * 去除原后台侧边栏，以内容为绝对主角，SPA 接管前/后体验统一。
 */
function buildAppShell(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  appOrigin: string,
  opts: { hdrMeta: string; ctaUrl: string; inner: string },
): string {
  const year = new Date().getUTCFullYear()
  const isZh = dict.lang === 'zh-CN'
  const slogan = isZh ? '个人书签与知识库 · 随时随地整理分享' : 'Personal bookmarks & knowledge vault'
  const ctaFoot = isZh ? '免费体验与链 ulink →' : 'Try ulink for free →'
  return [
    `<div class="share-app">`,
    `<header class="share-bar">`,
    `<div class="share-bar-wrap">`,
    `<a class="share-brand" href="${esc(appOrigin)}/" title="${esc(dict.backHome)}">`,
    `<span class="share-logo">${LOGO_SVG}</span>`,
    `<span class="share-brand-title">${esc(dict.logoText)}</span>`,
    `</a>`,
    `<span class="share-badge">${esc(dict.headSub)}</span>`,
    `<div class="share-actions">`,
    opts.hdrMeta,
    `<a class="cta" href="${esc(opts.ctaUrl)}">${esc(dict.cta)}</a>`,
    `</div>`,
    `</div>`,
    `</header>`,
    `<main class="share-container">`,
    opts.inner,
    `</main>`,
    `<footer class="share-footer">`,
    `<div class="share-footer-inner">`,
    `<div class="share-footer-brand">`,
    `<span class="footer-logo">${LOGO_SVG}</span>`,
    `<span class="footer-name">${esc(dict.footerBrand)}</span>`,
    `</div>`,
    `<p class="share-footer-slogan">${slogan}</p>`,
    `<a class="share-footer-cta" href="${esc(appOrigin)}/">${ctaFoot}</a>`,
    `<span class="share-footer-copy">© ${year} ulink · ${esc(appOrigin.replace(/^https?:\/\//, ""))}</span>`,
    `</div>`,
    `</footer>`,
    `</div>`,
  ].join("\n")
}

/** 构建 <body>（组分享）：Hero 卡片（大图标+标题+元信息）+ 笔记排版 + 收录书签完整卡片网格。 */
function buildBody(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  appOrigin: string,
): string {
  const name = esc(deCipherText(dict, group.name) || dict.defaultGroupName)
  const initial = esc((group.name || "?").trim().charAt(0) || "?").toUpperCase()
  const count = bookmarks.length
  const countTag = `<span class="meta-tag">${esc(fill(pick(dict, 'count', count), { n: count }))}</span>`
  const updated = fmtDate(typeof group.updated_at_num === "number" ? group.updated_at_num : 0)
  const updatedTag = updated ? `<span class="meta-tag">${esc(fill(dict.updatedAt, { d: updated }))}</span>` : ""
  // data-bm-id → 书签 URL 映射（内联书签转可点击 <a>）
  const bmMap: NotesBmMap = {}
  for (const b of bookmarks) bmMap[b.id] = { url: b.url }
  const notes = notesHtml(dict, group, bmMap)
  // CTA 跳 App 的 hash 路由（/app#share/<gid>），直达应用主体完成保存
  const appUrl = `${appOrigin}/app#share/${esc(group.id)}`

  const isZh = dict.lang === 'zh-CN'
  const bmSectionTitle = isZh ? '收录的书签' : 'Bookmarks in this group'

  const bookmarksHtml = count
    ? [
        `<section class="group-bookmarks-section">`,
        `<div class="section-header">`,
        `<h2 class="section-title">${bmSectionTitle}</h2>`,
        `<span class="section-count">${count}</span>`,
        `</div>`,
        `<div class="bm-grid">`,
        bookmarks.map((b) => buildBookmarkItem(dict, b, !!b.parent_id)).join("\n"),
        `</div>`,
        `</section>`,
      ].join("\n")
    : `<div class="empty">${esc(dict.empty)}</div>`

  const inner = [
    `<header class="group-hero">`,
    `<span class="group-hero-accent" aria-hidden="true"></span>`,
    `<span class="group-hero-icon">${groupIconMarkup(group, initial)}</span>`,
    `<div class="group-hero-info">`,
    `<h1 class="group-hero-title">${name}</h1>`,
    `<div class="group-hero-meta">${countTag}${updatedTag}</div>`,
    `</div>`,
    `</header>`,
    notes.html ? `<section class="group-notes-card">${notes.html}</section>` : '',
    bookmarksHtml,
  ].filter(Boolean).join("\n")

  return buildAppShell(dict, appOrigin, { hdrMeta: "", ctaUrl: appUrl, inner })
}

/**
 * 从主应用 index.html 提取 SPA 资源标签（主 CSS + modulepreload + module script）。
 * 分享页 SSR 注入后，SPA bundle 在同域 /s/<gid> 下启动，detectShareRoute 识别 path
 * 路由自动接管为只读态（不再需要用户手动点击 CTA）。纯函数，供 CF Functions 用
 * env.ASSETS 读 index.html 后调用（Deno 保底版无此能力，跳过注入）。
 */
export function extractAppAssets(indexHtml: string): string {
  const out: string[] = []
  const pushAll = (re: RegExp, wrap: (href: string) => string) => {
    const re2 = new RegExp(re.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re2.exec(indexHtml))) {
      const href = m[1]
      if (!href || /^https?:\/\//i.test(href)) continue
      out.push(wrap(href))
    }
  }
  pushAll(/<link\s[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/i, (h) => `<link rel="stylesheet" href="${h}">`)
  pushAll(/<link\s[^>]*rel="modulepreload"[^>]*href="([^"]+)"[^>]*>/i, (h) => `<link rel="modulepreload" crossorigin href="${h}">`)
  pushAll(/<script\s[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/i, (h) => `<script type="module" crossorigin src="${h}"></script>`)
  return out.join("\n")
}

/** 安全序列化 JSON 到 <script> 中（转义 < 和 \u2028/\u2029，防 XSS 与闭合标签） */
export function serializeScriptData(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** 组装完整 HTML 文档。og:image 从 appOrigin 推导（静态品牌图，随站部署于根路径）。
 *  appAssets：主应用 SPA 的资源标签（stylesheet/modulepreload/module script，由函数层
 *  用 env.ASSETS 读 index.html 经 extractAppAssets 提取）。注入后 SPA 启动即识别
 *  /s/<gid> path 路由（detectShareRoute）自动接管为只读态；body 内 <div id="app">
 *  为 Vue mount 挂载点，接管时整段骨架被主应用重建。 */
export function renderSharePage(
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  shareUrl: string,
  appOrigin: string,
  locale: ShareLocale = 'zh-CN',
  appAssets = '',
): string {
  const dict = T[locale]
  const ogImage = `${appOrigin}/share-cover.png`
  const head = buildHead(dict, group, bookmarks, shareUrl, ogImage)
  const body = buildBody(dict, group, bookmarks, appOrigin)
  const initDataScript = `<script id="__SHARE_DATA__">window.__INITIAL_SHARE_DATA__=${serializeScriptData({
    type: 'group',
    id: group.id,
    data: { group, bookmarks },
  })};</script>`
  return [
    `<!DOCTYPE html>`,
    `<html lang="${dict.lang}">`,
    `<head>${head}${initDataScript}${appAssets}</head>`,
    `<style>${CSS}</style>`,
    `<body><div id="app">${body}</div><script>${FALLBACK_JS}</script></body>`,
    `</html>`,
  ].join("\n")
}

/** 分类分享数据结构（RPC get_public_category 的 category 节点） */
export interface PublicCategory {
  id: string
  name: string
  icon: string
  color: string
  [k: string]: unknown
}

/** 散落卡片下的子书签（含层级，depth 从 1 起 = 直接子级） */
interface CategoryLooseChild {
  bookmark: PublicBookmark
  depth: number
}

/** 散落书签卡：顶层书签 + 其子孙（DFS 扁平化，depth 表示缩进层级） */
interface CategoryLooseCard {
  bookmark: PublicBookmark
  children: CategoryLooseChild[]
}

/**
 * 分类分享：把书签按归属切成「组内书签」与「散落书签」两套视图模型（对齐 App 分类视图的
 * 混排逻辑：组卡在前，散落书签卡在后，一张书签只出现一次）。
 * - 组内书签按 group.bookmark_ids 顺序取（与 App 组内顺序一致），**子书签也保留**，
 *   由渲染层按 parent_id 缩进体现层级
 * - 散落书签 = 不属于任何组的书签；**子书签不丢弃**：父也在散落集合里的挂到父卡片的
 *   children（支持多层级，depth 表示缩进深度），父在组内/不在本分类的孤儿则独立成卡
 *   （渲染层据 parent_id 打「子书签」标记，说明父级不在当前展示范围）
 * - 同一书签被多组引用时以首个组为准（used 去重，避免重复成卡）
 */
interface CategoryItems {
  groupCards: { group: PublicGroup; items: PublicBookmark[] }[]
  loose: CategoryLooseCard[]
}

function splitCategoryItems(groups: PublicGroup[], bookmarks: PublicBookmark[]): CategoryItems {
  const byId: { [id: string]: PublicBookmark } = {}
  for (const b of bookmarks || []) {
    if (b && b.id) byId[String(b.id)] = b
  }
  const used = new Set<string>()
  const groupCards = (groups || []).map((g) => {
    const ids = Array.isArray(g.bookmark_ids) ? (g.bookmark_ids as unknown[]) : []
    const items: PublicBookmark[] = []
    for (const raw of ids) {
      const id = String(raw ?? "")
      const b = byId[id]
      if (!b || used.has(id)) continue
      used.add(id)
      items.push(b)
    }
    return { group: g, items }
  })
  // 未被任何组包含的书签（子书签在内，随后按 parent_id 归位到父卡片）
  const rest: PublicBookmark[] = (bookmarks || []).filter((b) => {
    if (!b || !b.id) return false
    return !used.has(String(b.id))
  })
  const restIds = new Set(rest.map((b) => String(b.id)))
  // 父 id → 直接子书签（保持原顺序）
  const kidsOf: { [pid: string]: PublicBookmark[] } = {}
  for (const b of rest) {
    const pid = typeof b.parent_id === "string" ? b.parent_id.trim() : ""
    if (!pid || !restIds.has(pid)) continue
    ;(kidsOf[pid] = kidsOf[pid] || []).push(b)
  }
  // DFS 收集全部后代（支持孙级），扁平化后由 depth 表达缩进
  const collect = (pid: string, depth: number, out: CategoryLooseChild[]): void => {
    for (const kid of kidsOf[pid] || []) {
      out.push({ bookmark: kid, depth })
      collect(String(kid.id), depth + 1, out)
    }
  }
  const loose: CategoryLooseCard[] = []
  for (const b of rest) {
    const pid = typeof b.parent_id === "string" ? b.parent_id.trim() : ""
    // 父也在散落集合 → 该书签作为父卡片的子项出现（由父那轮 DFS 收集），此处不重复成卡
    if (pid && restIds.has(pid)) continue
    const children: CategoryLooseChild[] = []
    collect(String(b.id), 1, children)
    loose.push({ bookmark: b, children })
  }
  return { groupCards, loose }
}

/**
 * 分类分享·组卡片（对齐 App GroupCard 宫格态）：图标 + 组名 + 书签计数 + 笔记富文本；
 * 点卡片用 hidden checkbox + label 展开组内书签列表（无 JS 可用，:has() 控制跨列展开）。
 * notes 走与组分享一致的 sanitize + 内联书签转链接。
 */
function buildGroupCard(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  entry: { group: PublicGroup; items: PublicBookmark[] },
  idx: number,
  bmMap: NotesBmMap,
): string {
  const g = entry.group
  const name = esc(deCipherText(dict, g.name).trim() || "?")
  const initial = esc(((g.name || "?").trim().charAt(0) || "?").toUpperCase())
  const notes = notesHtml(dict, g, bmMap).html
  const body = notes || `<div class="focus-notes gcard-nonotes">${esc(dict.catNoNotes)}</div>`
  const n = entry.items.length
  const itemsHtml = n
    ? entry.items.map((b) => buildBookmarkItem(dict, b, !!b.parent_id)).join("")
    : `<div class="gcard-empty">${esc(dict.catGroupEmpty)}</div>`
  const toggleId = `gcat-${idx}`
  return [
    `<article class="gcard">`,
    `<input type="checkbox" class="gcard-toggle" id="${toggleId}" aria-label="${esc(dict.catExpand)}">`,
    `<label class="gcard-head" for="${toggleId}" title="${esc(dict.catExpand)}">`,
    `<span class="gcard-icon">${groupIconMarkup(g, initial)}</span>`,
    `<span class="gcard-title">${name}</span>`,
    `<span class="gcard-count">${esc(fill(pick(dict, 'catBookmarks', n), { n }))}</span>`,
    `<span class="gcard-chev">${CHEVRON_SVG}</span>`,
    `</label>`,
    body,
    `<div class="gcard-items">${itemsHtml}</div>`,
    `</article>`,
  ].join("")
}

/** 子书签行（挂在散落父卡内，depth 决定缩进量）：图标 + 标题 + 域名 + 笔记，属性全保留。 */
function buildLooseChildItem(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  child: CategoryLooseChild,
): string {
  const b = child.bookmark
  const urlCipher = isCipherText(b.url)
  const safe = urlCipher ? "" : fixUrl(b.url)
  const href = safe ? esc(safe) : "#"
  const rel = safe ? ' rel="noopener nofollow"' : ""
  const target = safe ? ' target="_blank"' : ""
  const dm = safe ? domainOf(safe) : ""
  const title = deCipherText(dict, b.title).trim() || dm || "?"
  const ch = title.charAt(0).toUpperCase()
  const notes = deCipherText(dict, b.notes).trim()
  const pad = 10 + (child.depth - 1) * 14
  return [
    `<a class="bmcard-child" style="padding-left:${pad}px" href="${href}"${target}${rel}>`,
    `<span class="bmcard-child-ic">${iconMarkup(safe ? faviconOf(safe) : "", ch, "bmc")}</span>`,
    `<span class="bmcard-child-text">`,
    `<span class="bmcard-child-title">${esc(title)}</span>`,
    dm ? `<span class="bmcard-child-url">${esc(dm)}</span>` : "",
    notes ? `<p class="bmcard-child-notes">${esc(notes)}</p>` : "",
    `</span>`,
    `</a>`,
  ].join("")
}

/**
 * 分类分享·散落书签卡（对齐 App BookmarkCard 宫格态）：图标 + 标题 + 域名 + 笔记（2 行截断）。
 * 卡片下挂子书签区：父卡与子项都是链接，故外层用 article（HTML 不允许 <a> 嵌套 <a>）。
 */
function buildLooseBookmarkCard(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  card: CategoryLooseCard,
): string {
  const b = card.bookmark
  const urlCipher = isCipherText(b.url)
  const safe = urlCipher ? "" : fixUrl(b.url)
  const href = safe ? esc(safe) : "#"
  const rel = safe ? ' rel="noopener nofollow"' : ""
  const target = safe ? ' target="_blank"' : ""
  const dm = safe ? domainOf(safe) : ""
  const title = deCipherText(dict, b.title).trim() || dm || "?"
  const ch = title.charAt(0).toUpperCase()
  const notes = deCipherText(dict, b.notes).trim()
  const isChild = !!(typeof b.parent_id === "string" && b.parent_id.trim())
  // 有子项：卡片底部「N 个子书签」展开条（hidden checkbox + label + :has()，
  // 无 JS 也可展开，与组卡同款；展开时跨行显示子项 → 折叠态所有卡等高 232px 与主站一致）
  const children = card.children.length
    ? [
        `<input type="checkbox" class="bmcard-toggle-input" id="bmc-${esc(String(b.id))}">`,
        `<label class="bmcard-toggle-label" for="bmc-${esc(String(b.id))}">`,
        `<span>${fill(pick(dict, "catChildren", card.children.length), { n: card.children.length })}</span>`,
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`,
        `</label>`,
        `<div class="bmcard-children">${card.children.map((c) => buildLooseChildItem(dict, c)).join("")}</div>`,
      ].join("")
    : ""
  return [
    `<article class="bmcard${children ? " has-children" : ""}">`,
    `<a class="bmcard-main" href="${href}"${target}${rel}>`,
    `<span class="bmcard-head">`,
    `<span class="bmcard-icon">${iconMarkup(safe ? faviconOf(safe) : "", ch, "bmcard")}</span>`,
    `<span class="bmcard-title">${esc(title)}</span>`,
    // 孤儿子书签：父在组内或不在本分类，标出来说明层级来源
    isChild ? `<span class="bmcard-badge">${esc(dict.subBookmark)}</span>` : "",
    `</span>`,
    dm ? `<span class="bmcard-url">${esc(dm)}</span>` : `<span class="bmcard-url">&nbsp;</span>`,
    notes ? `<p class="bmcard-notes">${esc(notes)}</p>` : "",
    `<span class="bmcard-arrow" aria-hidden="true">${ARROW_SVG}</span>`,
    `</a>`,
    children,
    `</article>`,
  ].join("")
}

/** 分类分享 <body>：分类 Hero（分类色 accent）+ 卡片网格（组卡在前 + 散落书签卡）。 */
/** 分类页布局（对齐主站 uiStore.layoutMode；移动端 CSS 隐藏宫格入口，只留列表/小宫格） */
export type CatLayout = 'grid' | 'list' | 'mini-grid'

/** 布局切换器：三个链接（?layout=xx），当前项高亮；无 JS 也能切换（整页重渲染）。 */
function buildLayoutSwitch(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  baseUrl: string,
  current: CatLayout,
): string {
  const btn = (mode: CatLayout, title: string, svg: string, mobileHidden = false): string => {
    const sep = baseUrl.includes("?") ? "&" : "?"
    const href = `${baseUrl}${sep}layout=${mode}`
    const cls = ["cat-layout-btn", current === mode ? "active" : "", mobileHidden ? "hide-mobile" : ""]
      .filter(Boolean)
      .join(" ")
    return `<a class="${cls}" href="${esc(href)}" title="${esc(title)}" rel="nofollow">${svg}</a>`
  }
  return [
    `<div class="cat-layout-switch" role="group" aria-label="${esc(dict.gridView)}">`,
    btn("grid", dict.gridView, GRID_SVG, true),
    btn("list", dict.listView, LIST_SVG),
    btn("mini-grid", dict.miniGridView, MINIGRID_SVG),
    `</div>`,
  ].join("")
}

/** 构建 <body>（分类分享）：主应用外壳 + 分类头（真实分类名/计数）+ 卡片网格（组卡在前 + 散落书签卡）。 */
function buildCategoryBody(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  category: PublicCategory,
  groups: PublicGroup[],
  bookmarks: PublicBookmark[],
  shareId: string,
  shareUrl: string,
  appOrigin: string,
  layout: CatLayout = 'grid',
): string {
  const name = esc(deCipherText(dict, category.name) || dict.defaultCategoryName)
  const initial = esc(((category.name || "?").trim().charAt(0) || "?").toUpperCase())
  const { groupCards, loose } = splitCategoryItems(groups, bookmarks)
  // data-bm-id → 书签 URL 映射（组 notes 内联书签转可点击 <a>）
  const bmMap: NotesBmMap = {}
  for (const b of bookmarks || []) {
    if (b && b.id) bmMap[b.id] = { url: b.url }
  }
  // 计数口径：与网格里实际渲染的书签数一致（组内 + 散落顶层 + 散落子书签，全部计入）
  const count =
    groupCards.reduce((s, e) => s + e.items.length, 0) +
    loose.reduce((s, c) => s + 1 + c.children.length, 0)
  const groupCount = groupCards.length
  const tags = [
    `<span class="meta-tag">${esc(fill(pick(dict, 'catBookmarks', count), { n: count }))}</span>`,
    groupCount
      ? `<span class="meta-tag">${esc(fill(pick(dict, 'catGroups', groupCount), { m: groupCount }))}</span>`
      : "",
  ].join("")
  const cards = [
    ...groupCards.map((e, i) => buildGroupCard(dict, e, i, bmMap)),
    ...loose.map((c) => buildLooseBookmarkCard(dict, c)),
  ]
  const layoutCls = layout !== 'grid' ? ` ${layout}-view` : ''
  const grid = cards.length
    ? `<div class="cat-grid${layoutCls}">${cards.join("\n")}</div>`
    : `<div class="empty">${esc(dict.emptyCategory)}</div>`
  // CTA 跳 App 的 hash 路由（/app#share/c/<share_id>），直达应用主体完成保存
  const appUrl = `${appOrigin}/app#share/c/${esc(shareId)}`
  // 分类色：白名单校验后作 CSS 变量注入（非法值回落默认 accent，杜绝 CSS 注入）
  const catColor = typeof category.color === "string" ? safeColorValue(category.color.trim()) : ""
  const accentStyle = catColor ? ` style="--cat: ${esc(catColor)}"` : ""
  const inner = [
    `<section class="cat-hero"${accentStyle}>`,
    `<span class="cat-hero-accent" aria-hidden="true"></span>`,
    `<span class="cat-hero-icon">${groupIconMarkup(category, initial)}</span>`,
    `<div class="cat-hero-text">`,
    `<h1 class="cat-hero-name">${name}</h1>`,
    `<div class="cat-hero-meta">${tags}</div>`,
    `</div>`,
    `<div class="cat-hero-actions">`,
    buildLayoutSwitch(dict, shareUrl, layout),
    `</div>`,
    `</section>`,
    grid,
  ].join("\n")
  return buildAppShell(dict, appOrigin, { hdrMeta: "", ctaUrl: appUrl, inner })
}

/** 分类分享 <head>：分类名进 title，描述用「N 个书签 · M 个组 · 由与链公开分享」。 */
function buildCategoryHead(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  category: PublicCategory,
  count: number,
  groupCount: number,
  shareUrl: string,
  ogImage: string,
): string {
  const title = `${category.name || dict.defaultCategoryName} - ${dict.siteName}`
  const escTitle = esc(title)
  const escDesc = esc(fill(pick(dict, 'catDesc', count), { n: count, m: groupCount }))
  const escUrl = esc(shareUrl)
  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`,
    `<title>${escTitle}</title>`,
    `<meta name="description" content="${escDesc}">`,
    `<link rel="canonical" href="${escUrl}">`,
    // Open Graph
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="${dict.siteName}">`,
    `<meta property="og:title" content="${escTitle}">`,
    `<meta property="og:description" content="${escDesc}">`,
    `<meta property="og:url" content="${escUrl}">`,
    `<meta property="og:image" content="${esc(ogImage)}">`,
    `<meta property="og:locale" content="${dict.ogLocale}">`,
    // Twitter
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escTitle}">`,
    `<meta name="twitter:description" content="${escDesc}">`,
    `<meta name="twitter:image" content="${esc(ogImage)}">`,
  ].join("\n")
}

/**
 * 分类分享完整 HTML 文档（/s/c/<share_id>，函数 functions/s/c/[sid].ts 取数后调用）。
 * 与 renderSharePage 同款样式；数据不含 username/password（RPC 列级隔离）。
 */
export function renderShareCategoryPage(
  category: PublicCategory,
  groups: PublicGroup[],
  bookmarks: PublicBookmark[],
  shareId: string,
  shareUrl: string,
  appOrigin: string,
  locale: ShareLocale = 'zh-CN',
  layout: CatLayout = 'grid',
  appAssets = '',
): string {
  const dict = T[locale]
  const ogImage = `${appOrigin}/share-cover.png`
  const { groupCards, loose } = splitCategoryItems(groups, bookmarks)
  const count =
    groupCards.reduce((s, e) => s + e.items.length, 0) +
    loose.reduce((s, c) => s + 1 + c.children.length, 0)
  const head = buildCategoryHead(dict, category, count, groupCards.length, shareUrl, ogImage)
  const body = buildCategoryBody(dict, category, groups, bookmarks, shareId, shareUrl, appOrigin, layout)
  const initDataScript = `<script id="__SHARE_DATA__">window.__INITIAL_SHARE_DATA__=${serializeScriptData({
    type: 'category',
    id: shareId,
    data: { category, groups, bookmarks },
  })};</script>`
  return [
    `<!DOCTYPE html>`,
    `<html lang="${dict.lang}">`,
    `<head>${head}${initDataScript}${appAssets}</head>`,
    `<style>${CSS}</style>`,
    `<body><div id="app">${body}</div><script>${FALLBACK_JS}</script></body>`,
    `</html>`,
  ].join("\n")
}

/** 404 兜底页（分享不存在 / 已取消公开），主应用外壳 + 同一视觉语言。 */
export function renderNotFoundPage(locale: ShareLocale = 'zh-CN'): string {
  const d = T[locale]
  const origin = 'https://ulink.ren'
  return [
    `<!DOCTYPE html>`,
    `<html lang="${d.lang}">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<title>${esc(d.notFoundTitle)}</title>`,
    `</head>`,
    `<style>${CSS}</style>`,
    `<body>`,
    buildAppShell(d, origin, {
      hdrMeta: "",
      ctaUrl: `${origin}/`,
      inner: [
        `<div class="nf">`,
        `<span class="nf-icon">${LOGO_SVG}</span>`,
        `<h1 class="nf-title">${esc(d.notFoundHeading)}</h1>`,
        `<p class="nf-body">${esc(d.notFoundBody)}</p>`,
        `</div>`,
      ].join("\n"),
    }),
    `</body>`,
    `</html>`,
  ].join("\n")
}

/**
 * 503 兜底页（上游 Supabase 不可达 / 5xx），与 404 同视觉骨架但语义不同：
 * 「暂时不可用，分享本身没失效」。调用方必须配 no-store（或不缓存），让恢复后
 * 的下一次请求立即拿到真数据，而不是把故障页缓存进边缘。
 */
export function renderUnavailablePage(locale: ShareLocale = 'zh-CN'): string {
  const d = T[locale]
  const origin = 'https://ulink.ren'
  return [
    `<!DOCTYPE html>`,
    `<html lang="${d.lang}">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<title>${esc(d.unavailableTitle)}</title>`,
    `</head>`,
    `<style>${CSS}</style>`,
    `<body>`,
    buildAppShell(d, origin, {
      hdrMeta: "",
      ctaUrl: `${origin}/`,
      inner: [
        `<div class="nf">`,
        `<span class="nf-icon">${LOGO_SVG}</span>`,
        `<h1 class="nf-title">${esc(d.unavailableHeading)}</h1>`,
        `<p class="nf-body">${esc(d.unavailableBody)}</p>`,
        `</div>`,
      ].join("\n"),
    }),
    `</body>`,
    `</html>`,
  ].join("\n")
}

/**
 * 渐进增强脚本（无 JS 时页面完整可用）：
 * 1) favicon 降级：img[data-fb] 加载失败加 .*-img-err → CSS 隐藏、:has() 露出首字母
 * 2) taskItem 未完成项可点击勾选（纯前端视觉，不持久化）：点击切换 data-checked
 * 3) TOC scrollspy：滚动时给当前可见标题对应的导航项加 .active（高亮）
 * 4) 内容不足以滚动（滚动距离 < 120px）时隐藏 TOC——没法"快速定位"，避免空导航占位
 */
const FALLBACK_JS = `(function(){var tc=document.querySelector(".toc"),mn=document.querySelector(".main"),ls=document.querySelector(".bm-list"),lay=document.querySelector(".layout");if(tc&&mn&&ls&&lay){lay.appendChild(ls);function dl(){var V=window.innerWidth,L=lay.offsetWidth||V,po=(V-L)/2,GP=24,cardW=Math.max(320,Math.min(660,Math.round(V*0.55))),half=(V-cardW-GP*2)/2,tcW=Math.min(200,Math.round(half*5/13)),lsW=Math.max(0,Math.round(half-GP)),sT=tcW>=120,sL=lsW>=200,canScroll=document.documentElement.scrollHeight-window.innerHeight>=120,showT=sT&&canScroll,ml=(V-cardW)/2-tcW-GP-po;mn.style.width=cardW+'px';tc.style.width=tcW+'px';tc.style.display=showT?'':'none';tc.style.marginLeft=showT?(ml+'px'):'';mn.style.marginLeft=showT?'0':(((V-cardW)/2-po)+'px');mn.style.marginRight=showT?'0':'auto';ls.style.width=lsW+'px';ls.style.display=sL?'':'none'}window.addEventListener('load',dl);window.addEventListener('resize',dl);dl()}var a=document.querySelectorAll('img[data-fb]');function err(e){e.classList.add('img-err');e.classList.add('bm-img-err');e.classList.add('hero-img-err')}for(var i=0;i<a.length;i++){(function(im){im.addEventListener('error',function(){err(im)});if(im.complete&&im.naturalWidth===0){err(im)}})(a[i])}var t=document.querySelectorAll('li[data-type="taskItem"]');for(var j=0;j<t.length;j++){(function(li){li.style.cursor='pointer';li.addEventListener('click',function(){li.setAttribute('data-checked',li.getAttribute('data-checked')==='true'?'false':'true')})})(t[j])}var l=document.querySelectorAll('.toc-item');if(l.length){var s=[];for(var k=0;k<l.length;k++){var el=document.getElementById(l[k].getAttribute('href').slice(1));if(el)s.push(el)}if(s.length){function onScroll(){var idx=0;for(var m=0;m<s.length;m++){if(s[m].getBoundingClientRect().top>=0){idx=m;break}}if(window.scrollY>=document.documentElement.scrollHeight-window.innerHeight-4){idx=s.length-1}for(var q=0;q<l.length;q++){l[q].classList.toggle('active',q===idx)}}window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll,{passive:true});onScroll()}}})()`

const CSS = `
/* ==================== DESIGN TOKENS (对齐主站 tokens.css) ==================== */
:root {
  color-scheme: light;
  --bg: #F5EFEA;
  --bg-alt: #EDE4DA;
  --surface: #FDFBF9;
  --surface-hover: #F7F2EC;
  --surface-active: #EFE8DF;
  --border: #E5DDD3;
  --border-light: #EFE8DF;
  --border-hover: #D5CBBE;
  --text: #2C2824;
  --text-secondary: #5E5852;
  --text-muted: #6A6660;
  --accent: #122E8A;
  --accent-light: rgba(18, 46, 138, 0.07);
  --accent-glow: rgba(18, 46, 138, 0.13);
  --accent-grad: linear-gradient(135deg, #122E8A 0%, #1E40AF 100%);
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.02);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  --shadow-md: 0 4px 14px rgba(0, 0, 0, 0.06), 0 2px 4px rgba(0, 0, 0, 0.02);
  --shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.07), 0 4px 8px rgba(0, 0, 0, 0.03);
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.02);
  --shadow-card-hover: 0 8px 28px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.03);
  --radius-sm: 6px;
  --radius-base: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 18px;
  --radius-full: 999px;
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --bar-bg: rgba(245, 239, 234, 0.85);
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #1A1A1D;
    --bg-alt: #202025;
    --surface: #25252B;
    --surface-hover: #2E2E35;
    --surface-active: #383842;
    --border: #2F2F36;
    --border-light: #28282F;
    --border-hover: #3D3D46;
    --text: #EEE9E2;
    --text-secondary: #B5AFA6;
    --text-muted: #9B968E;
    --accent: #F04A8A;
    --accent-light: rgba(240, 74, 138, 0.1);
    --accent-glow: rgba(240, 74, 138, 0.18);
    --accent-grad: linear-gradient(135deg, #E6397C 0%, #F43F5E 100%);
    --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.2);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.15);
    --shadow-md: 0 4px 14px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.15);
    --shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.35), 0 4px 8px rgba(0, 0, 0, 0.15);
    --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.04);
    --shadow-card-hover: 0 8px 28px rgba(0, 0, 0, 0.38), 0 2px 6px rgba(0, 0, 0, 0.2);
    --bar-bg: rgba(26, 26, 29, 0.85);
  }
}

/* ==================== BASE ==================== */
* { box-sizing: border-box; margin: 0; padding: 0 }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth }
body {
  background: radial-gradient(circle at 50% -20%, var(--accent-light) 0%, transparent 60%), var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
}

.share-app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* ==================== 顶栏 (对齐主站 AppHeader) ==================== */
.share-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  height: 54px;
  display: flex;
  align-items: center;
  background: var(--bar-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border-light);
  transition: background-color 0.2s ease, border-color 0.2s ease;
}
.share-bar-wrap {
  max-width: 1040px;
  width: 100%;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.share-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  text-decoration: none;
  color: var(--text);
  font-weight: 700;
  font-size: 16px;
  letter-spacing: -0.3px;
  transition: opacity 0.15s ease;
}
.share-brand:hover { opacity: 0.85 }
.share-logo {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.share-logo svg { width: 100%; height: 100% }
.share-brand-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
.share-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-alt);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  letter-spacing: 0.2px;
  white-space: nowrap;
}
.share-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
.cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 18px;
  border-radius: var(--radius-base);
  background: var(--accent-grad);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 0 2px 8px var(--accent-glow);
  transition: box-shadow 0.2s ease, transform 0.2s var(--ease-out);
  white-space: nowrap;
  flex-shrink: 0;
}
.cta:hover {
  box-shadow: 0 4px 16px var(--accent-glow);
  transform: translateY(-1px);
}
.cta:active {
  transform: translateY(0);
}

/* ==================== 主内容容器 ==================== */
.share-container {
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 24px 72px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ==================== 组聚焦 HERO 卡片 ==================== */
.group-hero {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 24px 28px;
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  gap: 20px;
  overflow: hidden;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.group-hero-accent {
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 4px;
  border-radius: 0 3px 3px 0;
  background: var(--accent-grad);
}
.group-hero-icon {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-lg);
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}
.group-hero-icon img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}
.group-hero-icon img.hero-img-err, .group-hero-icon img.img-err { display: none }
.group-hero-icon:has(img:not(.hero-img-err):not(.img-err)) .hero-fb { display: none }
.hero-fb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 20px;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  line-height: 1;
}
.group-hero-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group-hero-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.4px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.group-hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.meta-tag {
  display: inline-flex;
  align-items: center;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-alt);
  border: 1px solid var(--border);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}

/* ==================== 组富文本笔记卡片 ==================== */
.group-notes-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 24px 28px;
  box-shadow: var(--shadow-card);
}
.focus-notes {
  font-size: 14px;
  line-height: 1.75;
  color: var(--text);
  word-break: break-word;
}
.focus-notes p { margin: 0.3em 0 }
.focus-notes p:first-child { margin-top: 0 }
.focus-notes p:last-child { margin-bottom: 0 }
.focus-notes strong, .focus-notes b { font-weight: 700 }
.focus-notes mark { background-color: var(--accent-light); color: inherit; padding: 1px 4px; border-radius: 3px }
.focus-notes h1 {
  font-size: 1.35rem;
  font-weight: 700;
  margin: 0.7em 0 0.35em;
  border-left: 3px solid var(--accent);
  padding-left: 10px;
  color: var(--text);
}
.focus-notes h2 {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 0.5em 0 0.3em;
  color: var(--text);
}
.focus-notes h3 {
  font-size: 1.02rem;
  font-weight: 600;
  margin: 0.4em 0 0.2em;
  color: var(--text);
}
.focus-notes ul, .focus-notes ol {
  margin: 0.4em 0;
  padding-left: 1.6rem;
}
.focus-notes ol { list-style: decimal }
.focus-notes ul { list-style: disc }
.focus-notes li { margin: 0.18em 0 }
.focus-notes blockquote {
  border-left: 3px solid var(--border);
  padding-left: 12px;
  color: var(--text-secondary);
  margin: 0.5em 0;
}
.focus-notes code {
  background: var(--bg-alt);
  border-radius: 4px;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 0.88em;
  color: var(--text);
}
.focus-notes pre {
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-base);
  padding: 12px 14px;
  overflow-x: auto;
  margin: 0.5em 0;
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.focus-notes a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.focus-notes img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
}
.focus-notes hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 0.8em 0;
}

/* 内联书签卡片 (对齐主站 group-inline-card) */
.focus-notes a.group-inline-card,
.focus-notes span.group-inline-card,
.focus-notes .group-ref-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 8px;
  margin: 0 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-base);
  background: var(--surface);
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  vertical-align: middle;
  color: var(--text);
  text-decoration: none;
  box-shadow: var(--shadow-xs);
  transition: all 0.2s var(--ease-out);
}
.focus-notes a.group-inline-card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow), var(--shadow-sm);
  transform: translateY(-1px);
}
.focus-notes .group-inline-card img,
.focus-notes .group-inline-card svg,
.focus-notes .group-ref-card img,
.focus-notes .group-ref-card svg {
  width: 16px;
  height: 16px;
  max-width: 16px;
  max-height: 16px;
  border-radius: 2px;
  display: block;
  flex-shrink: 0;
}
.focus-notes .gic-name {
  color: var(--text);
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-notes .gic-domain {
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-notes .gic-count {
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
}
.focus-notes .gic-btn, .focus-notes .gic-remove { display: none }
.focus-notes .group-ref-card {
  background: var(--accent-light);
  border-color: var(--accent);
}

/* 待办任务清单 (taskList & taskItem) */
.focus-notes ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0;
  margin: 0.4em 0;
}
.focus-notes li[data-type="taskItem"] {
  list-style: none;
  position: relative;
  padding-left: 26px;
  margin: 3px 0;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
.focus-notes li[data-type="taskItem"]::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 2px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: 1.5px solid var(--border-hover);
  border-radius: 4px;
  background: var(--surface);
  transition: background 0.15s ease, border-color 0.15s ease;
}
.focus-notes li[data-type="taskItem"]::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 1px;
  width: 10px;
  height: 5px;
  box-sizing: border-box;
  border-left: 2px solid #fff;
  border-bottom: 2px solid #fff;
  transform: rotate(-45deg) scale(0);
  opacity: 0;
  transition: transform 0.15s var(--ease-out), opacity 0.15s ease;
}
.focus-notes li[data-type="taskItem"][data-checked="true"]::before {
  background: var(--accent);
  border-color: var(--accent);
}
.focus-notes li[data-type="taskItem"][data-checked="true"]::after {
  transform: rotate(-45deg) scale(1);
  opacity: 1;
}
.focus-notes li[data-type="taskItem"] p { margin: 0; line-height: 1.5 }
.focus-notes li[data-type="taskItem"][data-checked="true"] {
  text-decoration: line-through;
  color: var(--text-muted);
}

/* ==================== 收录书签网格 (对齐主站 CardGrid) ==================== */
.group-bookmarks-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 4px;
}
.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.section-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.2px;
}
.section-count {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-light);
  border: 1px solid var(--accent-glow);
  padding: 2px 9px;
  border-radius: var(--radius-full);
}
.bm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

/* 书签卡片本体 (对齐主站 .card) */
.bm {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 8px;
  padding: 14px 16px;
  min-height: 72px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.25s var(--ease-out);
  overflow: hidden;
}
.bm:hover {
  border-color: var(--border-hover);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-3px);
}
.bm:active {
  transform: translateY(0);
}
.bm-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
}
.bm-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
  position: relative;
}
.bm-icon img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}
.bm-icon img.bm-img-err, .bm-icon img.img-err { display: none }
.bm-icon:has(img:not(.bm-img-err):not(.img-err)) .bm-fb { display: none }
.bm-fb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  line-height: 1;
}
.bm-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bm-title {
  display: block;
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s ease;
}
.bm:hover .bm-title {
  color: var(--accent);
}
.bm-url {
  display: block;
  font-size: 11.5px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bm-notes {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.bm-arrow {
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0;
  transform: translate(-3px, 3px);
  transition: opacity 0.2s ease, transform 0.2s ease, color 0.2s ease;
  margin-left: auto;
  align-self: center;
}
.bm-arrow svg { width: 15px; height: 15px; display: block }
.bm:hover .bm-arrow {
  opacity: 1;
  transform: translate(0, 0);
  color: var(--accent);
}

/* 组内子书签树 */
.bm.is-child {
  margin-left: 16px;
  position: relative;
}
.bm.is-child::before {
  content: "";
  position: absolute;
  left: -10px;
  top: 50%;
  width: 8px;
  height: 1px;
  background: var(--border-hover);
}

.empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13.5px;
  padding: 36px 0;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
}

/* ==================== 分类分享页 (对齐主站 Category View) ==================== */
.cat-hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 22px 26px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.cat-hero-accent {
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 4px;
  border-radius: 0 3px 3px 0;
  background: var(--cat, var(--accent));
  opacity: 0.9;
}
.cat-hero-icon {
  width: 54px;
  height: 54px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  overflow: hidden;
  position: relative;
  color: var(--cat, var(--accent));
}
.cat-hero-icon img { width: 32px; height: 32px; object-fit: contain }
.cat-hero-icon img.hero-img-err { display: none }
.cat-hero-icon:has(img:not(.hero-img-err)) .hero-fb { display: none }
.cat-hero-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cat-hero-name {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.4px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.cat-hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cat-hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.cat-layout-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.cat-layout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}
.cat-layout-btn:hover { color: var(--text) }
.cat-layout-btn.active {
  background: var(--surface);
  color: var(--accent);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.cat-layout-btn svg { width: 15px; height: 15px; display: block }
@media (max-width: 768px) { .cat-layout-btn.hide-mobile { display: none } }

.cat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  align-items: start;
}
.gcard, .bmcard {
  position: relative;
  height: 232px;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.25s var(--ease-out);
}
.gcard:hover, .bmcard:hover {
  border-color: var(--border-hover);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-3px);
}
.gcard { padding: 16px 16px 10px }
.gcard::before {
  content: "";
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--cat, var(--accent));
  opacity: 0.6;
  transition: opacity 0.2s ease;
}
.gcard:hover::before { opacity: 1 }
.gcard-toggle { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none }
.gcard-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
.gcard-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
  position: relative;
}
.gcard-icon img { width: 28px; height: 28px; object-fit: contain }
.gcard-icon img.hero-img-err, .gcard-icon img.img-err { display: none }
.gcard-icon:has(img:not(.hero-img-err):not(.img-err)) .hero-fb { display: none }
.gcard-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 18px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gcard-count {
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-alt);
  border: 1px solid var(--border);
  padding: 2px 9px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}
.gcard-chev {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform 0.2s ease, color 0.2s ease;
}
.gcard-chev svg { width: 14px; height: 14px; display: block }
.gcard .focus-notes {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  margin: 0;
  padding: 0 2px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
  -webkit-mask-image: linear-gradient(180deg, #000 76%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 76%, transparent 100%);
}
.gcard-nonotes { color: var(--text-muted); font-size: 12.5px }
.gcard-items { display: none }
.gcard-empty {
  font-size: 12.5px;
  color: var(--text-muted);
  text-align: center;
  padding: 18px 0;
  background: var(--bg-alt);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
}
.gcard:has(.gcard-toggle:checked) {
  grid-column: 1 / -1;
  height: auto;
}
.gcard:has(.gcard-toggle:checked) .gcard-chev {
  transform: rotate(180deg);
  color: var(--cat, var(--accent));
}
.gcard:has(.gcard-toggle:checked) .focus-notes {
  overflow: visible;
  -webkit-mask-image: none;
  mask-image: none;
}
.gcard:has(.gcard-toggle:checked) .gcard-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}

/* 散落书签卡 (bmcard) */
.bmcard { padding: 0; text-decoration: none; color: inherit }
.bmcard.has-children { height: auto }
.bmcard-main {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 16px 16px 10px;
  text-decoration: none;
  color: inherit;
}
.bmcard-head { display: flex; align-items: center; gap: 10px }
.bmcard-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
  position: relative;
}
.bmcard-icon img { width: 22px; height: 22px; object-fit: contain }
.bmcard-icon img.hero-img-err, .bmcard-icon img.img-err { display: none }
.bmcard-icon:has(img:not(.hero-img-err):not(.img-err)) .hero-fb { display: none }
.bmcard-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 18px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s ease;
}
.bmcard:hover .bmcard-title { color: var(--cat, var(--accent)) }
.bmcard-url {
  display: block;
  font-size: 11.5px;
  line-height: 18px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bmcard-notes {
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.bmcard-arrow {
  position: absolute;
  right: 12px;
  bottom: 12px;
  color: var(--text-muted);
  opacity: 0;
  transform: translate(-2px, 2px);
  transition: all 0.2s ease;
}
.bmcard-arrow svg { width: 15px; height: 15px; display: block }
.bmcard:hover .bmcard-arrow {
  opacity: 1;
  transform: translate(0, 0);
  color: var(--cat, var(--accent));
}

/* ==================== 尾部 FOOTER ==================== */
.share-footer {
  margin-top: auto;
  border-top: 1px solid var(--border-light);
  padding: 48px 24px 36px;
  text-align: center;
}
.share-footer-inner {
  max-width: 600px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.share-footer-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 14px;
  color: var(--text);
}
.footer-logo {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
}
.footer-logo svg { width: 100%; height: 100% }
.share-footer-slogan {
  font-size: 12.5px;
  color: var(--text-muted);
}
.share-footer-cta {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
  margin-top: 2px;
  transition: opacity 0.15s ease;
}
.share-footer-cta:hover {
  opacity: 0.8;
  text-decoration: underline;
}
.share-footer-copy {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}

/* ==================== 404 / 503 兜底 ==================== */
.nf {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 72px 0 40px;
  text-align: center;
}
.nf-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.nf-icon svg { width: 30px; height: 30px }
.nf-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.4px;
}
.nf-body {
  font-size: 14px;
  color: var(--text-secondary);
  max-width: 420px;
}

/* ==================== 移动端适配 ==================== */
@media (max-width: 640px) {
  .share-bar-wrap { padding: 0 16px }
  .share-container { padding: 20px 16px 40px; gap: 18px }
  .group-hero { padding: 18px 16px; border-radius: var(--radius-lg); gap: 14px }
  .group-hero-icon { width: 44px; height: 44px; border-radius: var(--radius-md) }
  .group-hero-title { font-size: 20px }
  .group-notes-card { padding: 18px 18px; border-radius: var(--radius-lg) }
  .bm-grid { grid-template-columns: 1fr }
}
`
