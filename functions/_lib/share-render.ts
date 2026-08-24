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
 * 设计（2026-08-24 改版，对齐 App 组聚焦 + 列表模式）：
 * - 白色聚焦卡片包裹（与组聚焦后的内容区域一致：surface 底 + 边框 + accent 竖条 + 光晕）
 * - 组 notes 渲染富文本（白名单 sanitizeNotesHtml，语义对齐 App sanitizeReadonlyHTML）
 * - 「在与链中打开」CTA 移到卡片右侧顶部；其下紧跟等高书签列表（参考 App 列表模式）
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
    notFoundTitle: '分享不存在 - 与链',
    notFoundHeading: '该分享不存在',
    notFoundBody: '链接可能已失效，或分享者取消了公开',
    backHome: '返回与链首页',
    logoText: '与链',
    headSub: '公开分享',
    desc: '{n} 个链接 · 由与链公开分享',
    empty: '这个分享组还没有书签',
    count: '{n} 个链接',
    updatedAt: '更新于 {d}',
    cta: '在与链中打开 · 复制到我的库',
    footerBrand: '与链 · ulink',
    footerSlogan: '收藏 · 整理 · 分享',
  },
  'en-US': {
    lang: 'en-US',
    ogLocale: 'en_US',
    siteName: 'ulink',
    defaultGroupName: 'Shared group',
    notFoundTitle: 'Share not found - ulink',
    notFoundHeading: 'This share no longer exists',
    notFoundBody: 'The link may have expired, or the owner stopped sharing it publicly',
    backHome: 'Back to ulink',
    logoText: 'ulink',
    headSub: 'Public share',
    desc: '{n} links · publicly shared via ulink',
    desc_one: '{n} link · publicly shared via ulink',
    empty: 'This shared group has no bookmarks yet',
    count: '{n} links',
    count_one: '{n} link',
    updatedAt: 'Updated {d}',
    cta: 'Open in ulink · Copy to my library',
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

/** 组 notes 纯文本描述：前 120 字，空则回退「N 个链接 · 由与链公开分享」。 */
function descriptionOf(dict: typeof T['zh-CN'] | typeof T['en-US'], group: PublicGroup, n: number): string {
  const plain = stripTags(group.notes || "")
  return (plain && plain.slice(0, 120)) || fill(pick(dict, 'desc', n), { n })
}

// ── 富文本 notes 白名单清洗（语义对齐 App sanitizeReadonlyHTML，零依赖纯函数）──

/** 允许的标签（与 App _purifyReadonlyConfig.ALLOWED_TAGS 一致）。 */
const NOTES_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3',
  'blockquote', 'a', 'code', 'pre', 'hr', 'span', 'img',
])
/** 允许的属性（与 App ALLOWED_ATTR 一致；data-* 整族放行，语义同 App 注释）。 */
const NOTES_ATTRS = new Set(['class', 'href', 'target', 'rel', 'src', 'alt'])
/** class 白名单（其余 class 剥离；data-* 无事件无协议，放行无注入面）。 */
const NOTES_CLASSES = new Set(['group-inline-card', 'group-ref-card', 'gic-name', 'is-deleted'])

/**
 * 白名单清洗组 notes（TipTap HTML）→ 安全富文本。剥危险标签/事件/协议，
 * <a> 强制 target=_blank + rel=noopener noreferrer nofollow，href/src 仅放 http(s)。
 */
function sanitizeNotesHtml(html: string): string {
  let out = (html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
  // 危险容器连同内容整体删除（防 <script>alert(1)</script> 剥离后残留可见文本）
  for (const t of NOTES_BLOCKLIST) {
    out = out.replace(new RegExp(`<\\s*${t}[\\s\\S]*?<\\s*/\\s*${t}\\s*>`, "gi"), "")
      .replace(new RegExp(`<\\s*/?\\s*${t}[\\s\\S]*?>`, "gi"), "")
  }
  return out
    .replace(/<[^>]*>/g, (raw) => {
      const m = raw.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/)
      if (!m) return ""
      const close = !!m[1]
      const tag = m[2].toLowerCase()
      if (close) return NOTES_TAGS.has(tag) ? `</${tag}>` : ""
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
          // 协议白名单：仅 http(s)；data:/javascript:/blob: 等剥除
          if (!/^https?:\/\//i.test(unq)) continue
        }
        if (name === "class") {
          const cls = unq.split(/\s+/).filter((c) => NOTES_CLASSES.has(c)).join(" ")
          if (!cls) continue
          attrs.push(`class="${cls}"`)
        } else if (name === "href") {
          attrs.push(`href="${unq.replace(/"/g, "&quot;")}"`, 'target="_blank"', 'rel="noopener noreferrer nofollow"')
        } else {
          attrs.push(`${name}="${unq.replace(/"/g, "&quot;")}"`)
        }
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
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`

/** 外链箭头（书签行 hover 时滑入）。 */
const ARROW_SVG =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12L12 4"/><path d="M5.5 4H12v6.5"/></svg>`

/**
 * 书签列表项（App 列表模式排版）：等高行（icon + 标题 + 域名，无 notes，行高统一）。
 * 标题为空时回退展示域名。纯静态 <a>，无需 JS。
 */
function buildBookmarkItem(b: PublicBookmark): string {
  const safe = fixUrl(b.url)
  const href = safe ? esc(safe) : "#"
  const rel = safe ? ' rel="noopener nofollow"' : ""
  const target = safe ? ' target="_blank"' : ""
  const dm = safe ? domainOf(safe) : ""
  const title = (b.title || "").trim() || dm || "?"
  const ch = title.charAt(0).toUpperCase()
  return [
    `<a class="bm" href="${href}"${target}${rel}>`,
    `<span class="bm-icon">${iconMarkup(safe ? faviconOf(safe) : "", ch, "bm")}</span>`,
    `<span class="bm-info">`,
    `<span class="bm-title">${esc(title)}</span>`,
    dm ? `<span class="bm-url">${esc(dm)}</span>` : `<span class="bm-url">&nbsp;</span>`,
    `</span>`,
    `<span class="bm-arrow">${ARROW_SVG}</span>`,
    `</a>`,
  ].join("")
}

/**
 * 组图标位：group.icon 仅当为 http(s) URL 时渲染 <img>（跨用户数据不可信，
 * 非 URL 一律回退首字母，不把任意字符串当图标键使用）。
 */
function groupIconMarkup(group: PublicGroup, letter: string): string {
  const icon = typeof group.icon === "string" ? group.icon.trim() : ""
  const imgSrc = /^https?:\/\//i.test(icon) ? icon : ""
  return iconMarkup(imgSrc, letter, "hero")
}

/** 组 notes 富文本渲染（白名单清洗后直接输出；空则返回空串）。 */
function notesHtml(group: PublicGroup): string {
  const raw = (group.notes || "").trim()
  if (!raw) return ""
  const cleaned = sanitizeNotesHtml(raw).trim()
  return cleaned ? `<div class="focus-notes">${cleaned}</div>` : ""
}

/** 构建 <body>：白色聚焦卡片（组头 + CTA 右上 + 富文本 notes + 等高书签列表）。 */
function buildBody(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  appOrigin: string,
): string {
  const name = esc(group.name || dict.defaultGroupName)
  const initial = esc((group.name || "?").trim().charAt(0) || "?").toUpperCase()
  const count = bookmarks.length
  const countTag = `<span class="meta-tag">${esc(fill(pick(dict, 'count', count), { n: count }))}</span>`
  const updated = fmtDate(typeof group.updated_at_num === "number" ? group.updated_at_num : 0)
  const updatedTag = updated ? `<span class="meta-tag">${esc(fill(dict.updatedAt, { d: updated }))}</span>` : ""
  const list = count
    ? bookmarks.map(buildBookmarkItem).join("\n")
    : `<div class="empty">${esc(dict.empty)}</div>`
  // CTA 跳 App 的 hash 路由（#share/<gid>），让人类用户进入 SPA 登录后 Fork。
  const appUrl = `${appOrigin}/#share/${esc(group.id)}`
  const year = new Date().getUTCFullYear()
  return [
    `<div class="page">`,
    `<header class="head">`,
    `<a class="logo" href="${esc(appOrigin)}/">${LOGO_SVG}<span>${esc(dict.logoText)}</span></a>`,
    `<span class="head-sub">${esc(dict.headSub)}</span>`,
    `</header>`,
    `<main class="main">`,
    `<div class="focus-card">`,
    `<span class="focus-accent" aria-hidden="true"></span>`,
    `<div class="focus-head">`,
    `<span class="focus-icon">${groupIconMarkup(group, initial)}</span>`,
    `<div class="focus-titlewrap">`,
    `<h1 class="focus-name">${name}</h1>`,
    `<div class="focus-meta">${countTag}${updatedTag}</div>`,
    `</div>`,
    `<a class="cta" href="${appUrl}">${esc(dict.cta)}</a>`,
    `</div>`,
    notesHtml(group),
    `<div class="bm-list">${list}</div>`,
    `</div>`,
    `</main>`,
    `<footer class="foot">`,
    `<span class="foot-brand">${esc(dict.footerBrand)}</span>`,
    `<span class="foot-slogan">${esc(dict.footerSlogan)}</span>`,
    `<span class="foot-copy">© ${year} ulink · ${esc(appOrigin.replace(/^https?:\/\//, ""))}</span>`,
    `</footer>`,
    `</div>`,
  ].join("\n")
}

/** 组装完整 HTML 文档。og:image 从 appOrigin 推导（静态品牌图，随站部署于根路径）。 */
export function renderSharePage(
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  shareUrl: string,
  appOrigin: string,
  locale: ShareLocale = 'zh-CN',
): string {
  const dict = T[locale]
  const ogImage = `${appOrigin}/share-cover.png`
  const head = buildHead(dict, group, bookmarks, shareUrl, ogImage)
  const body = buildBody(dict, group, bookmarks, appOrigin)
  return [
    `<!DOCTYPE html>`,
    `<html lang="${dict.lang}">`,
    `<head>${head}</head>`,
    `<style>${CSS}</style>`,
    `<body>${body}</body>`,
    `<script>${FALLBACK_JS}</script>`,
    `</html>`,
  ].join("\n")
}

/** 404 兜底页（分享不存在 / 已取消公开），与主页面同一视觉语言。 */
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
    `<div class="page">`,
    `<header class="head">`,
    `<a class="logo" href="${origin}/">${LOGO_SVG}<span>${esc(d.logoText)}</span></a>`,
    `</header>`,
    `<main class="main">`,
    `<div class="nf">`,
    `<span class="nf-icon">${LOGO_SVG}</span>`,
    `<h1 class="nf-title">${esc(d.notFoundHeading)}</h1>`,
    `<p class="nf-body">${esc(d.notFoundBody)}</p>`,
    `<a class="cta" href="${origin}/">${esc(d.backHome)}</a>`,
    `</div>`,
    `</main>`,
    `</div>`,
    `</body>`,
    `</html>`,
  ].join("\n")
}

/**
 * favicon 降级脚本（渐进增强）：img[data-fb] 加载失败（含缓存中已失败未触发 error 的
 * complete && naturalWidth===0）时加 .*-img-err 类 → CSS 隐藏 img、:has() 露出首字母。
 * 无 JS 时 onerror 内联同样加类兜底；页面始终完整可用。
 */
const FALLBACK_JS = `(function(){var a=document.querySelectorAll('img[data-fb]');function err(e){e.classList.add('img-err')}for(var i=0;i<a.length;i++){(function(im){im.addEventListener('error',function(){err(im)});if(im.complete&&im.naturalWidth===0){err(im)}})(a[i])}})()`

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:#F5EFEA;color:#2C2824;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.page{max-width:760px;margin:0 auto;padding:0 20px 56px}
/* ── header ── */
.head{display:flex;align-items:center;gap:12px;padding:20px 0;border-bottom:1px solid #E5DDD3;margin-bottom:26px}
.logo{display:flex;align-items:center;gap:9px;font-weight:700;font-size:16px;color:#2C2824;text-decoration:none;letter-spacing:-.3px}
.logo svg{width:22px;height:22px;color:#122E8A;flex-shrink:0}
.head-sub{font-size:12px;font-weight:600;color:#6A6660;background:#EDE4DA;padding:3px 12px;border-radius:999px;margin-left:auto;letter-spacing:.2px}
/* ── 聚焦卡片：与 App 组聚焦一致（surface 底 + 边框 + accent 竖条 + 光晕）── */
.focus-card{position:relative;background:#FDFBF9;border:1px solid #E5DDD3;border-radius:16px;box-shadow:0 0 0 2px rgba(18,46,138,0.13),0 10px 30px rgba(0,0,0,0.07),0 2px 6px rgba(0,0,0,0.03);padding:20px 22px 18px;overflow:hidden}
.focus-accent{position:absolute;left:0;top:6px;bottom:6px;width:3px;background:linear-gradient(135deg,#122E8A 0%,#1E40AF 100%);border-radius:0 2px 2px 0;opacity:1}
.focus-head{display:flex;align-items:flex-start;gap:14px}
.focus-icon{width:48px;height:48px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#EDE4DA;border:1px solid #EFE8DF;border-radius:12px;overflow:hidden;position:relative}
.focus-icon img{width:28px;height:28px;object-fit:contain}
.focus-icon img.img-err{display:none}
.focus-icon:has(img:not(.img-err)) .hero-fb{display:none}
.hero-fb{display:flex;align-items:center;justify-content:center;width:28px;height:28px;font-size:17px;font-weight:700;color:#122E8A;text-transform:uppercase;line-height:1}
.focus-titlewrap{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;padding-top:1px}
.focus-name{font-size:22px;font-weight:800;color:#2C2824;letter-spacing:-.5px;line-height:1.3;overflow-wrap:anywhere}
.focus-meta{display:flex;flex-wrap:wrap;gap:8px}
.meta-tag{display:inline-flex;align-items:center;font-size:12px;font-weight:600;color:#6A6660;background:#F7F2EC;border:1px solid #E5DDD3;padding:3px 11px;border-radius:999px;white-space:nowrap}
/* CTA 右上（focus-head 内 margin-left:auto） */
.cta{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:10px;background:linear-gradient(135deg,#122E8A 0%,#1E40AF 100%);color:#fff;font-size:13px;font-weight:600;text-decoration:none;box-shadow:0 2px 10px rgba(18,46,138,0.25);flex-shrink:0;margin-left:auto;transition:box-shadow .2s ease,transform .2s ease}
.cta:hover{box-shadow:0 4px 18px rgba(18,46,138,0.35);transform:translateY(-1px)}
/* ── 富文本 notes（样式对齐 App .group-tiptap）── */
.focus-notes{font-size:13.5px;line-height:1.7;color:#2C2824;word-break:break-word;margin:16px 0 8px;padding:0 2px;max-height:320px;overflow:auto;scrollbar-width:thin}
.focus-notes p{margin:.2em 0}
.focus-notes p:first-child{margin-top:0}
.focus-notes p:last-child{margin-bottom:0}
.focus-notes strong,.focus-notes b{font-weight:700}
.focus-notes h1{font-size:1.4rem;font-weight:600;margin:.5em 0;border-left:3px solid #122E8A;padding-left:10px}
.focus-notes h2{font-size:1.15rem;font-weight:600;margin:.4em 0}
.focus-notes h3{font-size:1rem;font-weight:600;margin:.3em 0}
.focus-notes ul,.focus-notes ol{margin:.3em 0;padding-left:1.5rem}
.focus-notes ol{list-style:decimal}
.focus-notes ul{list-style:disc}
.focus-notes li{margin:.15em 0}
.focus-notes blockquote{border-left:3px solid #E5DDD3;padding-left:10px;color:#5E5852;margin:.4em 0}
.focus-notes code{background:#F7F2EC;border-radius:4px;padding:1px 5px;font-size:.9em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.focus-notes pre{background:#F7F2EC;border:1px solid #E5DDD3;border-radius:8px;padding:10px 12px;overflow-x:auto;margin:.4em 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.focus-notes a{color:#122E8A;text-decoration:underline}
.focus-notes img{max-width:100%;height:auto;border-radius:8px}
.focus-notes hr{border:none;border-top:1px solid #E5DDD3;margin:.6em 0}
/* 内联引用卡片：favicon 图标统一 16px（CSS 特异性陷阱，见项目笔记） */
.focus-notes .group-inline-card,.focus-notes .group-ref-card{display:inline-flex;align-items:center;gap:4px;vertical-align:middle;max-width:100%;opacity:.9}
.focus-notes .group-inline-card img,.focus-notes .group-inline-card svg,.focus-notes .group-ref-card img,.focus-notes .group-ref-card svg{width:16px;height:16px;max-width:16px;max-height:16px;border-radius:2px;display:block;flex-shrink:0}
.focus-notes .gic-btn,.focus-notes .gic-remove{display:none}
/* 任务清单（input 已被白名单剥除，用 ::before 呈现勾选框语义） */
.focus-notes li[data-type="taskItem"]{list-style:none;display:flex;gap:6px;align-items:flex-start;margin-left:-1.5rem}
.focus-notes li[data-type="taskItem"]::before{content:"☐";margin-right:4px;flex-shrink:0;color:#6A6660}
.focus-notes li[data-type="taskItem"][data-checked="true"]::before{content:"☑";color:#122E8A}
/* ── 书签列表（App 列表模式：等高独立圆角卡，icon + 标题/域名）── */
.bm-list{display:flex;flex-direction:column;gap:8px;margin-top:6px}
.bm{display:flex;align-items:center;gap:12px;min-height:58px;padding:8px 12px;border:1px solid #E5DDD3;border-radius:12px;background:#FDFBF9;box-shadow:0 1px 2px rgba(0,0,0,0.03);text-decoration:none;color:inherit;transition:border-color .2s ease,box-shadow .2s ease,transform .2s cubic-bezier(0.16,1,0.3,1)}
.bm:hover{border-color:#122E8A;box-shadow:0 0 0 2px rgba(18,46,138,0.13),0 4px 14px rgba(0,0,0,0.06);transform:translateY(-1px)}
.bm-icon{width:40px;height:40px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#EDE4DA;border:1px solid #EFE8DF;border-radius:10px;overflow:hidden;position:relative}
.bm-icon img{width:24px;height:24px;object-fit:contain}
.bm-icon img.img-err{display:none}
.bm-icon:has(img:not(.img-err)) .bm-fb{display:none}
.bm-fb{display:flex;align-items:center;justify-content:center;width:24px;height:24px;font-size:13px;font-weight:700;color:#122E8A;text-transform:uppercase;line-height:1}
.bm-info{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px;align-self:stretch}
.bm-title{display:block;font-weight:600;font-size:14px;color:#2C2824;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .15s ease}
.bm:hover .bm-title{color:#122E8A}
.bm-url{display:block;font-size:12px;color:#8A847C;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bm-arrow{flex-shrink:0;color:#B8B1A8;opacity:0;transform:translateX(-4px);transition:opacity .18s ease,transform .18s ease,color .18s ease}
.bm:hover .bm-arrow{opacity:1;transform:translateX(0);color:#122E8A}
.bm-arrow svg{width:15px;height:15px;display:block}
.empty{text-align:center;color:#6A6660;font-size:13px;padding:32px 0;background:#F7F2EC;border:1px dashed #D5CBBE;border-radius:14px}
/* ── footer ── */
.foot{display:flex;flex-direction:column;align-items:center;gap:5px;padding:36px 0 0;text-align:center}
.foot-brand{font-size:13px;font-weight:700;color:#2C2824;letter-spacing:-.2px}
.foot-slogan{font-size:12px;color:#8A847C}
.foot-copy{font-size:11px;color:#B0A9A0}
/* ── 404 ── */
.nf{display:flex;flex-direction:column;align-items:center;gap:14px;padding:72px 0 40px;text-align:center}
.nf-icon{width:64px;height:64px;display:flex;align-items:center;justify-content:center;background:#FDFBF9;border:1px solid #E5DDD3;border-radius:20px;color:#B8B1A8;margin-bottom:6px}
.nf-icon svg{width:30px;height:30px}
.nf-title{font-size:22px;font-weight:800;color:#2C2824;letter-spacing:-.4px}
.nf-body{font-size:14px;color:#6A6660;max-width:420px}
@media(max-width:560px){
  .page{padding:0 14px 40px}
  .head{margin-bottom:20px}
  .focus-card{padding:16px 14px 14px;border-radius:14px}
  .focus-head{flex-wrap:wrap}
  .focus-name{font-size:19px}
  .cta{width:100%;justify-content:center;margin-left:0}
  .focus-icon{width:44px;height:44px;border-radius:11px}
  .bm{min-height:54px;padding:7px 10px;gap:10px}
}
`
