import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

/**
 * share-html — 公开分享页服务端渲染（SSR / 元数据注入）。
 *
 * 背景：GitHub Pages 纯静态托管无法在 `/s/<gid>` 请求上按 User-Agent 分支返回，
 * 社交爬虫（微信 / WhatsApp / Facebook / Twitter）不执行 JS，读不到前端动态注入的
 * og:* 元数据，导致分享预览卡一直显示 index.html 静态默认值。本函数把「取数 + 渲染
 * 完整 HTML（head 元数据 + 书签列表）」搬到服务端，爬虫与人类拿到同一份预渲染页面。
 *
 * 数据来源复用现有公开读 RPC `get_public_group`（SECURITY DEFINER，列级隔离，
 * 已排除 username/password/user_id），以 anon key 调用即可——最小权限、零额外授权。
 *
 * 架构要点（迁移友好）：渲染核心（esc/fixUrl/domainOf/stripTags/sanitizeNotesHtml/
 * buildHead/buildBody/renderSharePage）均为纯函数，不触碰 Deno 特有 API（serve/Deno.env）；
 * 未来迁到 Netlify/Vercel/Cloudflare Pages 的 edge function 时只替换外层薄薄一层胶水。
 * 渲染核与 functions/_lib/share-render.ts 保持同步（同样的 T 字典 + HTML/CSS 结构）。
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
// 静态站基址（不含尾斜杠），用于 og:image 与「复制到我的库」跳转地址。
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") || "https://ulink.ren").replace(/\/+$/, "")
// og:image 静态品牌图路径（public/share-cover.png 构建后随站部署）。
const OG_IMAGE = `${APP_ORIGIN}/share-cover.png`
// 本函数对外 https 完整 URL（canonical / og:url 用）。勿用 req.url 推导——Supabase 内部
// 代理转发给函数的是 http 且去掉了 /functions/v1/ 前缀，直接拼会得到错误协议与残缺路径。
const SHARE_FN_URL = `${SUPABASE_URL}/functions/v1/share-html`

/** favicon 提供方（与 src/config/urls.ts 的 FAVICON_PROVIDER_URL 一致，国内可访问）。 */
const FAVICON_PROVIDER_URL = "https://api.xinac.net/icon/?url="

// ── 双语文案字典（与 functions/_lib/share-render.ts 的 T 保持一致）──
type ShareLocale = "zh-CN" | "en-US"
const T = {
  "zh-CN": {
    lang: "zh-CN",
    ogLocale: "zh_CN",
    siteName: "ulink",
    defaultGroupName: "分享组",
    notFoundTitle: "分享不存在 - 与链",
    notFoundHeading: "该分享不存在",
    notFoundBody: "私有链接可能已失效，或分享者已停止分享",
    backHome: "返回与链首页",
    logoText: "与链",
    headSub: "私有链接分享",
    desc: "{n} 个链接 · 凭专属私有链接访问",
    empty: "这个分享组还没有书签",
    count: "{n} 个链接",
    updatedAt: "更新于 {d}",
    cta: "保存至我的库",
    tocTitle: "目录",
    bookmarksTitle: "收录的书签",
    searchBookmarks: "搜索书签...",
    jumpToNotes: "导读笔记",
    jumpToBookmarks: "收录书签",
    noBookmarksMatch: "未找到匹配的书签",
    footerBrand: "与链 · ulink",
    footerSlogan: "收藏 · 整理 · 分享",
    themeToggle: "切换深浅色主题",
  },
  "en-US": {
    lang: "en-US",
    ogLocale: "en_US",
    siteName: "ulink",
    defaultGroupName: "Shared group",
    notFoundTitle: "Share not found - ulink",
    notFoundHeading: "This share no longer exists",
    notFoundBody: "The link may have expired, or the owner stopped sharing it",
    backHome: "Back to ulink",
    logoText: "ulink",
    headSub: "Private share",
    desc: "{n} links · shared via private link",
    desc_one: "{n} link · shared via private link",
    empty: "This shared group has no bookmarks yet",
    count: "{n} links",
    count_one: "{n} link",
    updatedAt: "Updated {d}",
    cta: "Save to my library",
    tocTitle: "Contents",
    bookmarksTitle: "Bookmarks in this group",
    searchBookmarks: "Search bookmarks...",
    jumpToNotes: "Notes",
    jumpToBookmarks: "Bookmarks",
    noBookmarksMatch: "No matching bookmarks found",
    footerBrand: "ulink",
    footerSlogan: "Collect · Organize · Share",
    themeToggle: "Toggle light/dark theme",
  },
} as const

/** 解析渲染语言：显式 ?lang= 优先，其次 Accept-Language 头，兜底 zh-CN。 */
function resolveLocale(url: URL, acceptLanguage: string): ShareLocale {
  const explicit = url.searchParams.get("lang")
  if (explicit === "zh-CN" || explicit === "en-US") return explicit
  const al = (acceptLanguage || "").toLowerCase()
  if (al.startsWith("zh")) return "zh-CN"
  return "en-US"
}

function fill(s: string, params: Record<string, string | number>): string {
  let out = s
  for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v))
  return out
}

function pick(dict: (typeof T)["zh-CN"], key: string, n: number): string {
  const d = dict as unknown as Record<string, string>
  const one = d[`${key}_one`]
  if (one != null && n === 1) return one
  return d[key] ?? key
}

// ── 纯函数：安全工具（语义与 src/utils.ts 对齐，改动请保持两端一致）──

/** HTML 转义：& < > " '，使结果在「属性值（双引号）」与「文本节点」两种上下文都安全。 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
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

/** 毫秒时间戳 → YYYY-MM-DD（UTC，边缘节点时区一致）。ts 非正返回空串。 */
function fmtDate(ts: number): string {
  if (!ts || ts <= 0 || !Number.isFinite(ts)) return ""
  const d = new Date(ts)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** 带内容的危险容器：整块剥离（含其文本），防脚本内容泄漏为可见文本（如 SEO 描述）。 */
const NOTES_BLOCKLIST = ["script", "style", "iframe", "object", "embed", "svg", "math", "noscript", "template"]

/** 剥离 HTML 标签得纯文本（组 notes 是 TipTap HTML，用于 SEO 描述等纯文本场景）。
 *  先删危险容器块（script/style 等连同内容），再剥标签——防 <script>alert(1)</script>
 *  剥标签后剩 alert(1) 文本泄漏进 meta description（内容污染，非 XSS）。 */
function stripTags(html: string): string {
  let out = (html || "").replace(/<!--[\s\S]*?-->/g, "")
  for (const t of NOTES_BLOCKLIST) {
    out = out
      .replace(new RegExp(`<\\s*${t}[\\s\\S]*?<\\s*/\\s*${t}\\s*>`, "gi"), "")
      .replace(new RegExp(`<\\s*/?\\s*${t}[\\s\\S]*?>`, "gi"), "")
  }
  return out.replace(/<[^>]+>/g, "").trim()
}

// ── 富文本 notes 白名单清洗（语义对齐 App sanitizeReadonlyHTML，零依赖纯函数）──

const NOTES_TAGS = new Set([
  "p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "h1", "h2", "h3",
  "blockquote", "a", "code", "pre", "hr", "span", "img", "mark",
])
const NOTES_ATTRS = new Set(["class", "href", "target", "rel", "src", "alt", "style"])
const NOTES_CLASSES = new Set(["group-inline-card", "group-ref-card", "gic-name", "gic-domain", "gic-count", "gic-btn", "gic-remove", "is-deleted"])

/** 书签 id → url/title/icon 映射（用于把内联书签 data-bm-id 转成可跳转 <a> 与补全图标）。 */
interface NotesBmMap {
  [id: string]: {
    url?: string
    title?: string
    icon?: string
  }
}

/** 颜色值校验（白名单，杜绝 CSS 注入）：hex / rgb() / rgba() / hsl() / hsla() / 命名色。 */
function safeColorValue(c: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c
  if (/^rgba?\([\d\s.,%]+\)$/i.test(c)) return c
  if (/^hsla?\([\d\s.,%]+\)$/i.test(c)) return c
  if (/^[a-zA-Z]{3,20}$/.test(c)) return c
  return ""
}

/** style 值白名单清洗（对齐组内 TipTap 渲染样式子集）：
 *  color / background-color（文字色 + 高亮底色）、font-size（数值+px/em/rem/%）、
 *  text-align（left/center/right/justify）；其余声明整体剥除。 */
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

/** 白名单清洗组 notes（TipTap HTML）→ 安全富文本。剥危险标签/事件/协议；
 *  style 仅保留 color；内联书签 data-bm-id 命中 bmMap 且 URL 安全时转可点击 <a>。 */
function sanitizeNotesHtml(html: string, bmMap?: NotesBmMap): string {
  let out = (html || "").replace(/<!--[\s\S]*?-->/g, "")
  for (const t of NOTES_BLOCKLIST) {
    out = out
      .replace(new RegExp(`<\\s*${t}[\\s\\S]*?<\\s*/\\s*${t}\\s*>`, "gi"), "")
      .replace(new RegExp(`<\\s*/?\\s*${t}[\\s\\S]*?>`, "gi"), "")
  }
  let icDepth = 0
  let curCardBmId: string | null = null
  return out
    .replace(/<[^>]*>/g, (raw: string) => {
      const m = raw.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/)
      if (!m) return ""
      const close = !!m[1]
      const tag = m[2].toLowerCase()
      if (close) {
        if (tag === "span" && icDepth > 0) {
          icDepth--
          if (icDepth === 0) curCardBmId = null
          return icDepth === 0 ? "</a>" : "</span>"
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
          // 协议白名单：放行 http://、https:// 与站内绝对路径 /xxx（禁止 // 协议相对跨域与 javascript: 等危险协议）
          if (!/^(https?:\/\/|\/(?!\/))/i.test(unq)) continue
        }
        if (name === "class") {
          const cls = unq.split(/\s+/).filter((c: string) => NOTES_CLASSES.has(c)).join(" ")
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
      if (tag === "span") {
        const cls = (attrs.find((a) => a.startsWith("class=")) || "").slice(7).replace(/"/g, "")
        const bmId = (attrs.find((a) => a.startsWith("data-bm-id=")) || "").slice(11).replace(/"/g, "")
        const isInlineCard = cls.split(/\s+/).includes("group-inline-card")
        if (isInlineCard) {
          icDepth++
          curCardBmId = bmId || null
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
      // 内联卡片内的 img：若 src 缺失或被过滤，从 bmMap 补齐；并附加 onerror 错误降级隐藏类
      if (tag === "img" && icDepth > 0) {
        let hasSrc = attrs.some((a) => a.startsWith("src="))
        if (!hasSrc && curCardBmId && bmMap?.[curCardBmId]) {
          const info = bmMap[curCardBmId]
          const rawIcon = typeof info.icon === "string" ? info.icon.trim() : ""
          const fallbackSrc = rawIcon ? (fixUrl(rawIcon) || (/^\/(?!\/)/.test(rawIcon) ? rawIcon : "")) : (info.url ? faviconOf(info.url) : "")
          if (fallbackSrc) {
            attrs.push(`src="${esc(fallbackSrc)}"`)
            hasSrc = true
          }
        }
        if (hasSrc) {
          attrs.push("data-fb", 'onerror="this.classList.add(\'img-err\')"' )
        }
      }
      return attrs.length ? `<${tag} ${attrs.join(" ")}>` : `<${tag}>`
    })
}

// ── 纯函数：渲染核 ──

interface PublicGroup {
  id: string
  name: string
  notes: string
  [k: string]: unknown
}
interface PublicBookmark {
  id: string
  title: string
  url: string
  notes: string
  [k: string]: unknown
}

/** 组 notes 纯文本描述：前 120 字，空则回退「N 个链接 · 由与链公开分享」。 */
function descriptionOf(dict: (typeof T)["zh-CN"], group: PublicGroup, n: number): string {
  const plain = stripTags(group.notes || "")
  return (plain && plain.slice(0, 120)) || fill(pick(dict, "desc", n), { n })
}

/** 构建 <head>：title / description / og:* / twitter:* / canonical。 */
function buildHead(
  dict: (typeof T)["zh-CN"],
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  shareUrl: string,
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
    `<meta property="og:image" content="${esc(OG_IMAGE)}">`,
    `<meta property="og:locale" content="${dict.ogLocale}">`,
    // Twitter
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escTitle}">`,
    `<meta name="twitter:description" content="${escDesc}">`,
    `<meta name="twitter:image" content="${esc(OG_IMAGE)}">`,
  ].join("\n")
}

/** 图标位：favicon/URL 图标 + 首字母占位共存（:has() 方案，杜绝重叠，同 App cards.css）。 */
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

/** 浅色/深色主题切换图标（与 src/config/icons.ts 同款）。 */
const SUN_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
const MOON_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`

/** 侧栏书签小图标 */
const BOOKMARK_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`

/** 侧栏搜索小图标 */
const SEARCH_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`

/** 目录小图标 */
const TOC_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`

/** 首屏主题防闪烁脚本（FOUC Guard）：在任何样式与 DOM 渲染前立即注入 data-theme 与 color-scheme。 */
const THEME_SCRIPT = `<script>(function(){try{var t=localStorage.getItem("lv_theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=t;}}catch(e){}})();</script>`

/** 书签列表项：主站同款卡片（icon + 标题 + 域名 + 外链箭头 + 备注预览）。 */
function buildBookmarkItem(b: PublicBookmark): string {
  const safe = fixUrl(b.url)
  const href = safe ? esc(safe) : "#"
  const rel = safe ? ' rel="noopener nofollow"' : ""
  const target = safe ? ' target="_blank"' : ""
  const dm = safe ? domainOf(safe) : ""
  const title = (b.title || "").trim() || dm || "?"
  const ch = title.charAt(0).toUpperCase()
  const rawNotes = typeof b.notes === 'string' ? b.notes.trim() : ''
  const notes = rawNotes ? stripTags(rawNotes).slice(0, 120) : ''
  const searchStr = esc((title + ' ' + dm).toLowerCase())
  return [
    `<a class="bm" href="${href}"${target}${rel} data-search="${searchStr}">`,
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

/** 组图标位：group.icon 仅当为 http(s) URL 时渲染 <img>（跨用户数据不可信）。 */
function groupIconMarkup(group: PublicGroup, letter: string): string {
  const icon = typeof group.icon === "string" ? group.icon.trim() : ""
  const imgSrc = /^https?:\/\//i.test(icon) ? icon : ""
  return iconMarkup(imgSrc, letter, "hero")
}

/**
 * 组/分类头部自定义图标：仅当存在明确的 http(s) URL 时渲染图标徽标，
 * 无自定义图片时完全不渲染（方案 1：极简大标题顶格，杜绝占位方块、问号或单字冗余）。
 */
function heroCustomIconMarkup(entity: Record<string, unknown>, prefix: "group" | "cat"): string {
  const icon = typeof entity.icon === "string" ? entity.icon.trim() : ""
  if (/^https?:\/\//i.test(icon)) {
    return `<span class="${prefix}-hero-icon"><img src="${esc(icon)}" alt="" /></span>`
  }
  return ""
}

/** notes 渲染结果：html（清洗后的富文本）+ toc（左侧标题导航，无数标题为空串）。 */
interface NotesResult {
  html: string
  toc: string
}

/** 组 notes 富文本渲染：白名单清洗 + 内联书签转链接 + 标题提取（TOC 锚点）。空则返回空。 */
function notesHtml(dict: (typeof T)["zh-CN"], group: PublicGroup, bmMap?: NotesBmMap): NotesResult {
  const raw = (group.notes || "").trim()
  if (!raw) return { html: "", toc: "" }
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

/** 专栏画卷外壳：吸顶毛玻璃顶栏 + 居中自适应专栏容器 + 品牌传播尾部。
 * 去除原后台侧边栏，以内容为绝对主角。与 CF 版 functions/_lib/share-render.ts 保持同步。 */
function buildAppShell(
  dict: (typeof T)["zh-CN"],
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
    `<button class="share-theme-btn" id="themeToggle" type="button" aria-label="${esc(dict.themeToggle)}" title="${esc(dict.themeToggle)}">` +
      `<span class="theme-icon-sun">${SUN_SVG}</span>` +
      `<span class="theme-icon-moon">${MOON_SVG}</span>` +
    `</button>`,
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

/** 构建 <body>（组分享）：方案 B 策展级单体画卷（自上而下自然流式，上文下签，主角归位）。与 CF 版同步。 */
function buildBody(
  dict: (typeof T)["zh-CN"],
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  appOrigin: string,
  gid: string,
): string {
  const name = esc(group.name || dict.defaultGroupName)
  const initial = esc((group.name || "?").trim().charAt(0) || "?").toUpperCase()
  const count = bookmarks.length
  const countTag = `<span class="meta-tag">${esc(fill(pick(dict, "count", count), { n: count }))}</span>`
  const updated = fmtDate(typeof group.updated_at_num === "number" ? group.updated_at_num : 0)
  const updatedTag = updated ? `<span class="meta-tag">${esc(fill(dict.updatedAt, { d: updated }))}</span>` : ""
  // data-bm-id → 书签信息映射（内联书签转可点击 <a> 与补全图标）
  const bmMap: NotesBmMap = {}
  for (const b of bookmarks) {
    bmMap[b.id] = { url: b.url, title: b.title, icon: typeof b.icon === 'string' ? b.icon : '' }
  }
  const notes = notesHtml(dict, group, bmMap)
  // CTA 跳 App 的 hash 路由（/app#share/<gid>），直达应用主体完成保存。
  const appUrl = `${appOrigin}/app#share/${esc(gid)}`

  const hasNotes = Boolean(notes.html)
  const hasBookmarks = count > 0

  const sections: string[] = []

  if (hasNotes) {
    sections.push(
      `<section class="group-notes-section" id="section-notes">`,
      `<div class="group-notes-content">${notes.html}</div>`,
      `</section>`,
    )
  }

  if (hasNotes && hasBookmarks) {
    sections.push(`<div class="canvas-divider" aria-hidden="true"></div>`)
  }

  if (hasBookmarks) {
    const searchBar = count >= 6
      ? `<div class="bm-search-wrap"><input type="search" class="bm-search-input" id="bmSearchInput" placeholder="${esc(dict.searchBookmarks)}" autocomplete="off" aria-label="${esc(dict.searchBookmarks)}" /><span class="bm-search-icon">${SEARCH_SVG}</span></div>`
      : ''
    sections.push(
      `<section class="group-bookmarks-section" id="section-bookmarks">`,
      `<div class="section-header">`,
      `<div class="section-title-wrap">`,
      `<span class="section-title-icon">${BOOKMARK_SVG}</span>`,
      `<h2 class="section-title">${esc(dict.bookmarksTitle)}</h2>`,
      `<span class="section-count">${count}</span>`,
      `</div>`,
      searchBar,
      `</div>`,
      `<div class="bm-grid" id="bmList">`,
      bookmarks.map((b) => buildBookmarkItem(b)).join("\n"),
      `</div>`,
      `<div class="bm-empty-search" id="bmEmptySearch" style="display:none">${esc(dict.noBookmarksMatch)}</div>`,
      `</section>`,
    )
  }

  if (!hasNotes && !hasBookmarks) {
    sections.push(`<div class="empty">${esc(dict.empty)}</div>`)
  }

  const heroIcon = heroCustomIconMarkup(group, "group")

  const inner = [
    `<article class="group-canvas">`,
    `<header class="group-hero">`,
    heroIcon,
    `<div class="group-hero-info">`,
    `<h1 class="group-hero-title">${name}</h1>`,
    `<div class="group-hero-meta">${countTag}${updatedTag}</div>`,
    `</div>`,
    `</header>`,
    `<div class="group-canvas-body">`,
    sections.join("\n"),
    `</div>`,
    `</article>`,
  ].filter(Boolean).join("\n")

  return buildAppShell(dict, appOrigin, { hdrMeta: "", ctaUrl: appUrl, inner })
}

/** 组装完整 HTML 文档。body 外包 #app（与 CF 版结构一致；Deno 保底版不注入 SPA bundle，
 *  无 bundle 即不 mount，页面仍为纯静态 SSR）。 */
function serializeScriptData(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function renderSharePage(
  dict: (typeof T)["zh-CN"],
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  shareUrl: string,
  appOrigin: string,
): string {
  const head = buildHead(dict, group, bookmarks, shareUrl)
  const body = buildBody(dict, group, bookmarks, appOrigin, group.id)
  const initDataScript = `<script id="__SHARE_DATA__">window.__INITIAL_SHARE_DATA__=${serializeScriptData({
    type: 'group',
    id: group.id,
    data: { group, bookmarks },
  })};</script>`
  return [
    `<!DOCTYPE html>`,
    `<html lang="${dict.lang}">`,
    `<head>${THEME_SCRIPT}${head}${initDataScript}</head>`,
    `<style>${CSS}</style>`,
    `<body><div id="app">${body}</div><script>${FALLBACK_JS}</script></body>`,
    `</html>`,
  ].join("\n")
}

const CSS = `
/* ==================== DESIGN TOKENS (对齐主站 tokens.css) ==================== */
:root, [data-theme="light"] {
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
  --shadow-md: 0 4px 14px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.02);
  --shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.06), 0 4px 8px rgba(0, 0, 0, 0.02);
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(0, 0, 0, 0.03);
  --shadow-card-hover: 0 8px 24px rgba(18, 46, 138, 0.08), 0 2px 6px rgba(0, 0, 0, 0.03);
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

[data-theme="dark"] {
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
  --shadow-card-hover: 0 8px 28px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.2);
  --bar-bg: rgba(26, 26, 29, 0.85);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
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
    --shadow-card-hover: 0 8px 28px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.2);
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

body, .share-bar, .group-hero, .cat-hero, .group-notes-card, .bm, .gcard, .bmcard, .share-footer, .share-theme-btn {
  transition: background-color 0.25s ease, border-color 0.25s ease, color 0.25s ease, box-shadow 0.25s ease;
}

.share-app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* LOGO 颜色响应主题切换 */
.s-b { stroke: #122E8A; transition: stroke 0.25s ease; }
.s-g { stroke: #10B981; transition: stroke 0.25s ease; }
[data-theme="dark"] .s-b { stroke: #4F6BFF !important; }
[data-theme="dark"] .s-g { stroke: #34D399 !important; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .s-b { stroke: #4F6BFF !important; }
  :root:not([data-theme="light"]) .s-g { stroke: #34D399 !important; }
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
}
.share-bar-wrap {
  max-width: 960px;
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
  gap: 10px;
}
.share-theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-base);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  box-shadow: var(--shadow-xs);
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}
.share-theme-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
  border-color: var(--border-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.share-theme-btn:active {
  transform: translateY(0);
}
.share-theme-btn svg {
  width: 16px;
  height: 16px;
  display: block;
}
.theme-icon-sun { display: none }
.theme-icon-moon { display: flex; align-items: center; justify-content: center }

[data-theme="dark"] .theme-icon-sun { display: flex; align-items: center; justify-content: center }
[data-theme="dark"] .theme-icon-moon { display: none }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .theme-icon-sun { display: flex; align-items: center; justify-content: center }
  :root:not([data-theme="light"]) .theme-icon-moon { display: none }
}
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

/* ==================== 图标与首字母通用绝对居中（解决首字母与图标并排Bug） ==================== */
.bm-icon, .group-hero-icon, .cat-hero-icon, .gcard-icon, .bmcard-icon, .bmcard-child-ic {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}
.bm-fb, .hero-fb, .bmcard-fb, .bmc-fb {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  line-height: 1;
  background: var(--bg-alt);
  z-index: 1;
  user-select: none;
}
.bm-icon img, .group-hero-icon img, .cat-hero-icon img, .gcard-icon img, .bmcard-icon img, .bmcard-child-ic img {
  position: relative;
  z-index: 2;
  object-fit: contain;
  display: block;
}
/* 图片正常渲染时，纯兄弟选择器隐藏后面的首字母（无需 :has()，100% 浏览器兼容） */
.bm-icon img ~ .bm-fb,
.group-hero-icon img ~ .hero-fb,
.cat-hero-icon img ~ .hero-fb,
.gcard-icon img ~ .hero-fb,
.bmcard-icon img ~ .bmcard-fb,
.bmcard-child-ic img ~ .bmc-fb {
  display: none !important;
}
/* 图片加载失败时隐藏图片，显示首字母 */
img.img-err, img.bm-img-err, img.hero-img-err, img.bmcard-img-err, img.bmc-img-err {
  display: none !important;
}
.bm-icon img.img-err ~ .bm-fb,
.bm-icon img.bm-img-err ~ .bm-fb,
.group-hero-icon img.img-err ~ .hero-fb,
.group-hero-icon img.hero-img-err ~ .hero-fb,
.cat-hero-icon img.img-err ~ .hero-fb,
.cat-hero-icon img.hero-img-err ~ .hero-fb,
.gcard-icon img.img-err ~ .hero-fb,
.gcard-icon img.hero-img-err ~ .hero-fb,
.bmcard-icon img.img-err ~ .bmcard-fb,
.bmcard-icon img.bmcard-img-err ~ .bmcard-fb,
.bmcard-child-ic img.img-err ~ .bmc-fb,
.bmcard-child-ic img.bmc-img-err ~ .bmc-fb {
  display: flex !important;
}

/* ==================== 方案 B：策展级单体画卷 (Group Canvas) ==================== */
.group-canvas {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background-color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}

/* 一体化 Header */
.group-canvas .group-hero {
  position: relative;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-light);
  padding: 32px 36px 26px;
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
.group-hero-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
.group-hero-icon img {
  width: 36px;
  height: 36px;
}
.group-hero-icon .hero-fb {
  font-size: 22px;
  font-weight: 700;
  color: var(--accent);
  background: var(--bg-alt);
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
}
.group-hero-info {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group-hero-title {
  font-size: 26px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.5px;
  line-height: 1.25;
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
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  padding: 3px 11px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}

/* 一体化画卷主体 */
.group-canvas-body {
  padding: 32px 36px 40px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

/* 导读笔记区 */
.group-notes-section {
  width: 100%;
}
.group-notes-content {
  width: 100%;
}

/* 导读与书签之间的轻柔分隔线 */
.canvas-divider {
  width: 100%;
  height: 1px;
  background: var(--border-light);
  margin: 0;
}
.focus-notes {
  font-size: 14px;
  line-height: 1.75;
  color: var(--text);
  word-break: break-word;
}
.focus-notes p { margin: 0.4em 0 }
.focus-notes p:first-child { margin-top: 0 }
.focus-notes p:last-child { margin-bottom: 0 }
.focus-notes strong, .focus-notes b { font-weight: 700 }
.focus-notes mark { background-color: var(--accent-light); color: inherit; padding: 1px 4px; border-radius: 3px }
.focus-notes h1 {
  font-size: 1.45rem;
  font-weight: 700;
  margin: 0.7em 0 0.4em;
  color: var(--text);
  letter-spacing: -0.01em;
}
.focus-notes h2 {
  font-size: 1.22rem;
  font-weight: 650;
  margin: 0.6em 0 0.35em;
  color: var(--text);
}
.focus-notes h3 {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0.5em 0 0.3em;
  color: var(--text);
}
.focus-notes ul, .focus-notes ol {
  margin: 0.4em 0;
  padding-left: 1.6rem;
}
.focus-notes ol { list-style: decimal }
.focus-notes ul { list-style: disc }
.focus-notes li { margin: 0.2em 0 }
.focus-notes blockquote {
  border-left: 3px solid var(--border);
  padding: 4px 0 4px 14px;
  color: var(--text-secondary);
  margin: 0.6em 0;
  font-style: normal;
}
.focus-notes code {
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: 1.5px 5.5px;
  font-size: 0.88em;
  font-family: var(--font-mono);
  color: var(--text);
}
.focus-notes pre {
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  overflow-x: auto;
  margin: 0.6em 0;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
}
.focus-notes a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: opacity 0.15s ease;
}
.focus-notes a:hover { opacity: 0.8 }
.focus-notes img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
  margin: 0.4em 0;
}
.focus-notes hr {
  border: none;
  border-top: 1px solid var(--border-light);
  margin: 1.2em 0;
}

/* 笔记内联书签卡 (group-inline-card) */
.focus-notes a.group-inline-card,
.focus-notes span.group-inline-card,
.focus-notes .group-ref-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 2px 7px;
  margin: 0 3px;
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
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s var(--ease-out);
}
.focus-notes a.group-inline-card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow);
  transform: translateY(-1px);
}
.focus-notes .group-inline-card img,
.focus-notes .group-ref-card img,
.focus-notes .group-ref-card svg {
  width: 15px;
  height: 15px;
  border-radius: 3px;
  display: block;
  flex-shrink: 0;
  object-fit: contain;
}
.focus-notes .group-inline-card img.img-err,
.focus-notes .group-ref-card img.img-err {
  display: none !important;
}
.focus-notes .gic-name {
  color: var(--text);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-notes .gic-domain {
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
}
.focus-notes .gic-count {
  color: var(--text-muted);
  font-size: 11px;
}
.focus-notes .gic-btn, .focus-notes .gic-remove { display: none }

/* 笔记任务清单 (taskList) */
.focus-notes ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0;
  margin: 0.5em 0;
}
.focus-notes li[data-type="taskItem"] {
  list-style: none;
  position: relative;
  padding-left: 28px;
  margin: 4px 0;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
.focus-notes li[data-type="taskItem"]::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 4px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: 1.5px solid var(--border-hover);
  border-radius: var(--radius-sm);
  background: var(--surface);
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.focus-notes li[data-type="taskItem"]::after {
  content: "";
  position: absolute;
  left: 2px;
  top: 4px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5L6.5 11.5L12.5 4.5'/%3E%3C/svg%3E");
  background-position: center;
  background-repeat: no-repeat;
  background-size: 11px 11px;
  transform: scale(0);
  opacity: 0;
  transition: transform 0.15s var(--ease-out), opacity 0.15s ease;
  pointer-events: none;
}
.focus-notes li[data-type="taskItem"][data-checked="true"]::before {
  background: var(--accent);
  border-color: var(--accent);
}
.focus-notes li[data-type="taskItem"][data-checked="true"]::after {
  transform: scale(1);
  opacity: 1;
}
.focus-notes li[data-type="taskItem"] p { margin: 0; line-height: 1.6 }
.focus-notes li[data-type="taskItem"][data-checked="true"] {
  text-decoration: line-through;
  color: var(--text-muted);
}

/* ==================== 收录书签网格 (组分享) ==================== */
.group-bookmarks-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.section-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title-icon {
  width: 18px;
  height: 18px;
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.section-title-icon svg { width: 100%; height: 100% }
.section-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.2px;
}
.section-count {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-light);
  border: 1px solid var(--accent-glow);
  padding: 1.5px 8px;
  border-radius: var(--radius-full);
}

/* 搜索框 */
.bm-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  max-width: 240px;
  width: 100%;
  margin-left: auto;
}
.bm-search-input {
  width: 100%;
  height: 32px;
  padding: 0 30px 0 10px;
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 12.5px;
  color: var(--text);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  font-family: inherit;
}
.bm-search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow);
}
.bm-search-input::placeholder {
  color: var(--text-muted);
}
.bm-search-icon {
  position: absolute;
  right: 9px;
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bm-search-icon svg { width: 100%; height: 100% }

.bm-empty-search {
  text-align: center;
  padding: 24px;
  font-size: 13px;
  color: var(--text-muted);
  background: var(--bg-alt);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
}

.bm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
  width: 100%;
}

/* 单条书签行 (组内卡片) */
.bm {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  box-shadow: var(--shadow-card);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s var(--ease-out);
  position: relative;
  overflow: hidden;
}
.bm:hover {
  border-color: var(--border-hover);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-2px);
}
.bm:active { transform: translateY(0) }
.bm-main {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.bm-icon {
  width: 38px;
  height: 38px;
}
.bm-icon img {
  width: 24px;
  height: 24px;
}
.bm-fb {
  font-size: 14px;
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
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border-light);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.bm-arrow {
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.4;
  transform: translate(-2px, 2px);
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

/* ==================== 分类分享 HERO (杜绝杂色黄色，统一品牌深蓝质感) ==================== */
.cat-hero {
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
}
.cat-hero-accent {
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 4px;
  border-radius: 0 3px 3px 0;
  background: var(--accent-grad);
}
.cat-hero-icon {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-lg);
  color: var(--accent);
}
.cat-hero-icon img { width: 32px; height: 32px; object-fit: contain }
.cat-hero-icon .hero-fb { font-size: 20px }
.cat-hero-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cat-hero-name {
  font-size: 24px;
  font-weight: 750;
  color: var(--text);
  letter-spacing: -0.4px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.cat-hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.cat-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  display: inline-block;
  flex-shrink: 0;
  margin-right: 6px;
}
.cat-hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 布局切换器 (三布局按钮) */
.cat-layout-switch {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}
.cat-layout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.cat-layout-btn:hover { color: var(--text) }
.cat-layout-btn.active {
  background: var(--surface);
  color: var(--accent);
  box-shadow: var(--shadow-xs);
}
.cat-layout-btn svg { width: 16px; height: 16px; display: block }
@media (max-width: 768px) { .cat-layout-btn.hide-mobile { display: none } }

/* ==================== 分类卡片网格 (默认宫格态) ==================== */
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
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--accent-grad);
  opacity: 0.7;
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
}
.gcard-icon img { width: 26px; height: 26px; object-fit: contain }
.gcard-icon .hero-fb { font-size: 15px }
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
  border: 1px solid var(--border-light);
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
  color: var(--accent);
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
}
.bmcard-icon img { width: 22px; height: 22px; object-fit: contain }
.bmcard-icon .bmcard-fb { font-size: 14px }
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
.bmcard:hover .bmcard-title { color: var(--accent) }
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
  opacity: 0.4;
  transform: translate(-2px, 2px);
  transition: opacity 0.2s ease, transform 0.2s ease, color 0.2s ease;
}
.bmcard-arrow svg { width: 15px; height: 15px; display: block }
.bmcard:hover .bmcard-arrow {
  opacity: 1;
  transform: translate(0, 0);
  color: var(--accent);
}

/* 子书签展开与渲染 */
.bmcard-toggle-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none }
.bmcard-toggle-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  background: var(--bg-alt);
  border-top: 1px solid var(--border-light);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
.bmcard-toggle-label svg { width: 12px; height: 12px; transition: transform 0.2s ease }
.bmcard-toggle-input:checked + .bmcard-toggle-label svg { transform: rotate(180deg) }
.bmcard-children { display: none; flex-direction: column; gap: 4px; padding: 8px 12px; background: var(--bg-alt); border-top: 1px dashed var(--border) }
.bmcard-toggle-input:checked ~ .bmcard-children { display: flex }
.bmcard-child {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: inherit;
  font-size: 12.5px;
  transition: background 0.15s ease;
}
.bmcard-child:hover { background: var(--surface) }
.bmcard-child-ic { width: 22px; height: 22px }
.bmcard-child-ic img { width: 14px; height: 14px }
.bmcard-child-ic .bmc-fb { font-size: 10px }
.bmcard-child-text { flex: 1; min-width: 0 }
.bmcard-child-title { font-weight: 500; color: var(--text) }
.bmcard-child-url { font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono); margin-left: 6px }
.bmcard-badge {
  font-size: 10.5px;
  color: var(--text-muted);
  background: var(--bg-alt);
  padding: 1px 6px;
  border-radius: var(--radius-full);
}

/* ==================== 布局切换：列表视图 (List View) ==================== */
.cat-grid.list-view {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
}
.cat-grid.list-view .gcard,
.cat-grid.list-view .bmcard {
  height: auto !important;
  min-height: 56px !important;
  max-height: none !important;
  border-radius: var(--radius-md) !important;
  padding: 10px 16px !important;
  box-shadow: var(--shadow-card) !important;
}
.cat-grid.list-view .gcard:hover,
.cat-grid.list-view .bmcard:hover {
  transform: translateY(-1px) !important;
  box-shadow: var(--shadow-card-hover) !important;
}
.cat-grid.list-view .bmcard-main {
  padding: 0 !important;
  width: 100% !important;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 12px !important;
}
.cat-grid.list-view .bmcard-head {
  display: flex !important;
  align-items: center !important;
  gap: 12px !important;
  flex: 1 !important;
  min-width: 0 !important;
}
.cat-grid.list-view .bmcard-icon {
  width: 34px !important;
  height: 34px !important;
}
.cat-grid.list-view .bmcard-icon img {
  width: 20px !important;
  height: 20px !important;
}
.cat-grid.list-view .bmcard-title {
  font-size: 14px !important;
  font-weight: 600 !important;
}
.cat-grid.list-view .bmcard-url {
  font-size: 11.5px !important;
  font-family: var(--font-mono) !important;
  color: var(--text-muted) !important;
  margin-left: 8px !important;
}
.cat-grid.list-view .bmcard-notes {
  display: none !important;
}
.cat-grid.list-view .bmcard-arrow {
  position: static !important;
  opacity: 0.6 !important;
  transform: none !important;
  margin-left: auto !important;
  align-self: center !important;
}
.cat-grid.list-view .bmcard:hover .bmcard-arrow {
  opacity: 1 !important;
  color: var(--accent) !important;
  transform: translateX(2px) !important;
}
.cat-grid.list-view .gcard {
  display: flex !important;
  flex-direction: column !important;
}
.cat-grid.list-view .gcard-head {
  margin-bottom: 0 !important;
  width: 100% !important;
}
.cat-grid.list-view .gcard-icon {
  width: 34px !important;
  height: 34px !important;
}
.cat-grid.list-view .gcard-icon img {
  width: 20px !important;
  height: 20px !important;
}
.cat-grid.list-view .gcard .focus-notes {
  display: none !important;
}
.cat-grid.list-view .gcard:has(.gcard-toggle:checked) .focus-notes {
  display: block !important;
  margin-top: 10px !important;
  padding-top: 10px !important;
  border-top: 1px dashed var(--border) !important;
}

/* ==================== 布局切换：小宫格视图 (Mini-Grid View) ==================== */
.cat-grid.mini-grid-view {
  display: grid !important;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)) !important;
  gap: 8px !important;
}
.cat-grid.mini-grid-view .gcard,
.cat-grid.mini-grid-view .bmcard {
  height: 64px !important;
  min-height: 64px !important;
  max-height: 64px !important;
  padding: 8px 12px !important;
  border-radius: var(--radius-md) !important;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  box-shadow: var(--shadow-card) !important;
}
.cat-grid.mini-grid-view .bmcard-main {
  padding: 0 !important;
  width: 100% !important;
  height: 100% !important;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 10px !important;
}
.cat-grid.mini-grid-view .bmcard-head {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  flex: 1 !important;
  min-width: 0 !important;
}
.cat-grid.mini-grid-view .bmcard-icon,
.cat-grid.mini-grid-view .gcard-icon {
  width: 28px !important;
  height: 28px !important;
  border-radius: var(--radius-sm) !important;
  flex-shrink: 0 !important;
}
.cat-grid.mini-grid-view .bmcard-icon img,
.cat-grid.mini-grid-view .gcard-icon img {
  width: 18px !important;
  height: 18px !important;
}
.cat-grid.mini-grid-view .bmcard-title,
.cat-grid.mini-grid-view .gcard-title {
  font-size: 13px !important;
  line-height: 1.3 !important;
  font-weight: 600 !important;
  flex: 1 !important;
}
.cat-grid.mini-grid-view .bmcard-url {
  display: none !important;
}
.cat-grid.mini-grid-view .bmcard-notes,
.cat-grid.mini-grid-view .bmcard-arrow,
.cat-grid.mini-grid-view .focus-notes,
.cat-grid.mini-grid-view .gcard-count {
  display: none !important;
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

/* ==================== 响应式适配 ==================== */
@media (max-width: 768px) {
  .share-container {
    padding: 20px 16px 56px;
  }
  .group-canvas .group-hero {
    padding: 24px 22px 20px;
    gap: 16px;
  }
  .group-canvas-body {
    padding: 24px 22px 32px;
    gap: 26px;
  }
}

@media (max-width: 640px) {
  .share-bar-wrap { padding: 0 16px }
  .share-container { padding: 14px 10px 48px; }
  .group-canvas { border-radius: var(--radius-lg); }
  .group-canvas .group-hero { padding: 18px 16px; gap: 14px }
  .group-hero-icon { width: 48px; height: 48px; border-radius: var(--radius-md) }
  .group-hero-title { font-size: 21px }
  .group-canvas-body { padding: 18px 16px 24px; gap: 20px }
  .bm-grid { grid-template-columns: 1fr }
}
`

/** 渐进增强脚本（无 JS 时页面完整可用）：
 *  1) favicon 降级：img[data-fb] 加载失败加 .img-err → CSS 隐藏、:has() 露出首字母
 *  2) taskItem 未完成项可点击勾选（纯前端视觉）：点击切换 data-checked
 *  3) TOC scrollspy：滚动时给当前可见标题对应的导航项加 .active（高亮）
 *  4) 内容不足以滚动（滚动距离 < 120px）时隐藏 TOC——没法"快速定位"，避免空导航占位 */
const FALLBACK_JS = `(function(){var tb=document.getElementById('themeToggle');if(tb){tb.addEventListener('click',function(){var cur=document.documentElement.getAttribute('data-theme');if(!cur){cur=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}var next=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);document.documentElement.style.colorScheme=next;try{localStorage.setItem('lv_theme',next)}catch(e){}})}var a=document.querySelectorAll('img[data-fb]');function err(e){e.classList.add('img-err');e.classList.add('bm-img-err');e.classList.add('hero-img-err')}for(var i=0;i<a.length;i++){(function(im){im.addEventListener('error',function(){err(im)});if(im.complete&&im.naturalWidth===0){err(im)}})(a[i])}var t=document.querySelectorAll('li[data-type="taskItem"]');for(var j=0;j<t.length;j++){(function(li){li.style.cursor='pointer';li.addEventListener('click',function(){li.setAttribute('data-checked',li.getAttribute('data-checked')==='true'?'false':'true')})})(t[j])}var l=document.querySelectorAll('.toc-item');if(l.length){var s=[];for(var k=0;k<l.length;k++){var el=document.getElementById(l[k].getAttribute('href').slice(1));if(el)s.push(el)}if(s.length){function onScroll(){var idx=0;for(var m=0;m<s.length;m++){if(s[m].getBoundingClientRect().top>=0){idx=m;break}}if(window.scrollY>=document.documentElement.scrollHeight-window.innerHeight-4){idx=s.length-1}for(var q=0;q<l.length;q++){l[q].classList.toggle('active',q===idx)}}window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll,{passive:true});onScroll()}}var si=document.getElementById('bmSearchInput');if(si){si.addEventListener('input',function(){var q=si.value.trim().toLowerCase();var bms=document.querySelectorAll('#bmList .bm');var f=0;for(var n=0;n<bms.length;n++){var sc=bms[n].getAttribute('data-search')||'';var m=!q||sc.indexOf(q)!==-1;bms[n].style.display=m?'':'none';if(m)f++}var em=document.getElementById('bmEmptySearch');if(em){em.style.display=(f===0&&q)?'block':'none'}})}})()`

// ── 入口 ──

serve(async (req) => {
  const url = new URL(req.url)
  const gid = (url.searchParams.get("gid") || "").trim()
  if (!gid || !/^[a-zA-Z0-9_-]{2,64}$/.test(gid)) {
    return new Response("bad request", { status: 400 })
  }
  const locale = resolveLocale(url, req.headers.get("accept-language") || "")
  const dict = T[locale]

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data, error } = await supabase.rpc("get_public_group", { p_gid: gid })

  if (error || !data || !data.group) {
    const html = [
      `<!DOCTYPE html>`,
      `<html lang="${dict.lang}">`,
      `<head>`,
      THEME_SCRIPT,
      `<meta charset="utf-8">`,
      `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
      `<title>${esc(dict.notFoundTitle)}</title>`,
      `</head>`,
      `<style>${CSS}</style>`,
      `<body>`,
      buildAppShell(dict, APP_ORIGIN, {
        hdrMeta: "",
        ctaUrl: `${APP_ORIGIN}/`,
        inner: [
          `<div class="nf">`,
          `<span class="nf-icon">${LOGO_SVG}</span>`,
          `<h1 class="nf-title">${esc(dict.notFoundHeading)}</h1>`,
          `<p class="nf-body">${esc(dict.notFoundBody)}</p>`,
          `</div>`,
        ].join("\n"),
      }),
      `</body>`,
      `</html>`,
    ].join("\n")
    return new Response(html, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  const group = data.group as PublicGroup
  const bookmarks = (data.bookmarks || []) as PublicBookmark[]
  // canonical/og:url 用固定 https 函数 URL（仅保留 gid 参数）。
  const shareUrl = `${SHARE_FN_URL}?gid=${encodeURIComponent(gid)}`

  const html = renderSharePage(dict, group, bookmarks, shareUrl, APP_ORIGIN)
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  })
})
