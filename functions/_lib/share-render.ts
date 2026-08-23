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
 * 设计（2026-08-23 改版，借鉴 Raindrop / Are.na / Notion / 语雀公开页）：
 * - 开放布局：去掉整页大卡片包裹，hero（组名 + 标签式 meta）+ hairline 分隔线列表
 * - 列表行：favicon（由书签 URL 派生，api.xinac.net，M5 安全语义）+ 域名 + 箭头微交互
 * - 标签式 meta：「N 个链接 · 更新于 2026-08-20」（借鉴 Are.na 的 "N blocks / updated"）
 * - 页脚品牌露出（Raindrop 缺页脚是槽点，此处补上）
 * - 渐进增强：内联小脚本仅做 favicon 加载失败降级（无 JS 时页面完整可用）
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

/** 剥离 HTML 标签得纯文本（组 notes 是 TipTap HTML，服务端不做 DOM 清洗、只降级为文本）。 */
function stripTags(html: string): string {
  return (html || "").replace(/<[^>]+>/g, "").trim()
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
 * 首字母占位图标（本地降级）。favicon / 组 icon 加载失败或为空时兜底显示，
 * 零网络请求、无破图。grid 同格（grid-area:1/1）让 img 加载成功时盖住字母。
 */
function fallbackChip(ch: string, cls: string): string {
  return `<span class="${cls}-fb">${esc(ch)}</span>`
}

/**
 * 图标位渲染：优先 favicon/URL 图标（带 onerror 降级），否则首字母占位。
 * img 与字母同格（grid），加载成功自然盖住字母；失败由内联脚本 + onerror 隐藏 img。
 */
function iconMarkup(imgSrc: string, letter: string, cls: string): string {
  const img = imgSrc
    ? `<img src="${esc(imgSrc)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fb onerror="this.style.display='none'">`
    : ""
  return img + fallbackChip(letter, cls)
}

/** 品牌链接图标（与 App 端 ShareView logo 同一枚 SVG，stroke 继承 currentColor）。 */
const LOGO_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`

/** 外链箭头（书签行 hover 时滑入，与 App 分享页 external 图标同语义）。 */
const ARROW_SVG =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12L12 4"/><path d="M5.5 4H12v6.5"/></svg>`

/**
 * 书签列表项：favicon/首字母 + 标题 + 域名 + 备注 + 箭头。
 * 标题为空时回退展示域名（Raindrop 式，避免空标题行）。纯静态 <a>，无需 JS。
 */
function buildBookmarkItem(b: PublicBookmark): string {
  const safe = fixUrl(b.url)
  const href = safe ? esc(safe) : "#"
  const rel = safe ? ' rel="noopener nofollow"' : ""
  const target = safe ? ' target="_blank"' : ""
  const dm = safe ? domainOf(safe) : ""
  const title = (b.title || "").trim() || dm || "?"
  const ch = title.charAt(0).toUpperCase()
  const notes = (b.notes || "").trim()
  const notesHtml = notes ? `<span class="bm-note">${esc(notes)}</span>` : ""
  return [
    `<a class="bm" href="${href}"${target}${rel}>`,
    `<span class="bm-icon">${iconMarkup(safe ? faviconOf(safe) : "", ch, "bm")}</span>`,
    `<span class="bm-info">`,
    `<span class="bm-title">${esc(title)}</span>`,
    dm ? `<span class="bm-url">${esc(dm)}</span>` : "",
    notesHtml,
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
  const img = imgSrc
    ? `<img src="${esc(imgSrc)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fb onerror="this.style.display='none'">`
    : ""
  return img + fallbackChip(letter, "hero")
}

/** 构建 <body>：开放布局（hero + hairline 列表 + 居中 CTA + 品牌页脚）。 */
function buildBody(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  appOrigin: string,
): string {
  const name = esc(group.name || dict.defaultGroupName)
  const initial = esc((group.name || "?").trim().charAt(0) || "?").toUpperCase()
  const notesPlain = stripTags(group.notes || "")
  const notesHtml = notesPlain ? `<p class="hero-notes">${esc(notesPlain)}</p>` : ""
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
    `<section class="hero">`,
    `<div class="hero-row">`,
    `<span class="hero-icon">${groupIconMarkup(group, initial)}</span>`,
    `<div class="hero-title">`,
    `<h1 class="hero-name">${name}</h1>`,
    `<div class="hero-meta">${countTag}${updatedTag}</div>`,
    `</div>`,
    `</div>`,
    notesHtml,
    `</section>`,
    `<div class="list">${list}</div>`,
    `<div class="list-foot">`,
    `<a class="cta" href="${appUrl}">${esc(dict.cta)}</a>`,
    `</div>`,
    `</main>`,
    `<footer class="foot">`,
    `<span class="foot-brand">${esc(dict.footerBrand)}</span>`,
    `<span class="foot-slogan">${esc(dict.footerSlogan)}</span>`,
    `<span class="foot-copy">© ${year} ${esc(appOrigin.replace(/^https?:\/\//, ""))}</span>`,
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
 * favicon 降级脚本（渐进增强）：img[data-fb] 加载失败（含「缓存中已失败但未触发
 * error 事件」的 complete && naturalWidth===0 场景）时隐藏自身，露出同格首字母。
 * 无 JS 时页面仍完整可用（仅破图图标无法优雅降级，不影响布局与内容）。
 */
const FALLBACK_JS = `(function(){var a=document.querySelectorAll('img[data-fb]');function h(e){e.style.display='none'}for(var i=0;i<a.length;i++){(function(im){im.addEventListener('error',function(){h(im)});if(im.complete&&im.naturalWidth===0){h(im)}})(a[i])}})()`

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:#F5EFEA;color:#2C2824;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.page{max-width:720px;margin:0 auto;padding:0 20px 56px}
/* ── header ── */
.head{display:flex;align-items:center;gap:12px;padding:20px 0;border-bottom:1px solid #E5DDD3}
.logo{display:flex;align-items:center;gap:9px;font-weight:700;font-size:16px;color:#2C2824;text-decoration:none;letter-spacing:-.3px}
.logo svg{width:22px;height:22px;color:#122E8A;flex-shrink:0}
.head-sub{font-size:12px;font-weight:600;color:#6A6660;background:#EDE4DA;padding:3px 12px;border-radius:999px;margin-left:auto;letter-spacing:.2px}
/* ── hero：组名 + 标签式 meta + 描述（开放布局，借鉴 Are.na 标签元信息 / Notion 居中阅读） ── */
.hero{padding:38px 0 26px;display:flex;flex-direction:column;gap:16px}
.hero-row{display:flex;align-items:center;gap:16px}
.hero-icon{width:56px;height:56px;flex-shrink:0;display:grid;place-items:center;background:linear-gradient(135deg,#EDE4DA,#E1D5C6);border:1px solid #E5DDD3;border-radius:16px;font-size:22px;font-weight:700;color:#122E8A;text-transform:uppercase;overflow:hidden}
.hero-icon img{grid-area:1/1;width:28px;height:28px;object-fit:contain;display:block}
.hero-fb{grid-area:1/1;line-height:1}
.hero-title{flex:1;min-width:0}
.hero-name{font-size:28px;font-weight:800;color:#2C2824;letter-spacing:-.6px;line-height:1.25;overflow-wrap:anywhere}
.hero-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.meta-tag{display:inline-flex;align-items:center;font-size:12px;font-weight:600;color:#6A6660;background:#F7F2EC;border:1px solid #E5DDD3;padding:3px 11px;border-radius:999px;white-space:nowrap}
.hero-notes{font-size:14px;line-height:1.75;color:#5E5852;word-break:break-word;max-width:640px;padding:0 2px}
/* ── 列表：hairline 分隔行（借鉴 Are.na 克制线框 / Raindrop 单列密度），hover 高亮 + 箭头 ── */
.list{display:flex;flex-direction:column;border-top:1px solid #E5DDD3}
.bm{display:flex;align-items:center;gap:14px;padding:14px 12px;border-radius:12px;text-decoration:none;color:inherit;transition:background .15s ease}
.bm + .bm{border-top:1px solid #EFE8DF}
.bm:hover{background:#F7F2EC}
.bm-icon{width:38px;height:38px;flex-shrink:0;display:grid;place-items:center;background:#FDFBF9;border:1px solid #E5DDD3;border-radius:11px;font-size:14px;font-weight:700;color:#122E8A;text-transform:uppercase;overflow:hidden;transition:border-color .18s ease,transform .18s ease}
.bm:hover .bm-icon{border-color:#122E8A;transform:scale(1.04)}
.bm-icon img{grid-area:1/1;width:20px;height:20px;object-fit:contain;display:block}
.bm-fb{grid-area:1/1;line-height:1}
.bm-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.bm-title{display:block;font-weight:600;font-size:14.5px;color:#2C2824;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .15s ease}
.bm:hover .bm-title{color:#122E8A}
.bm-url{display:block;font-size:12px;color:#8A847C;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bm-note{font-size:12.5px;color:#6A6660;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.5}
.bm-arrow{flex-shrink:0;color:#B8B1A8;opacity:0;transform:translateX(-4px);transition:opacity .18s ease,transform .18s ease,color .18s ease}
.bm:hover .bm-arrow{opacity:1;transform:translateX(0);color:#122E8A}
.bm-arrow svg{width:15px;height:15px;display:block}
.empty{text-align:center;color:#6A6660;font-size:13px;padding:34px 0;margin-top:14px;background:#F7F2EC;border:1px dashed #D5CBBE;border-radius:14px}
/* ── CTA ── */
.list-foot{display:flex;justify-content:center;padding:28px 0 8px;border-top:1px solid #EFE8DF;margin-top:10px}
.cta{display:inline-flex;align-items:center;gap:8px;padding:11px 22px;border-radius:10px;background:linear-gradient(135deg,#122E8A 0%,#1E40AF 100%);color:#fff;font-size:14px;font-weight:600;text-decoration:none;box-shadow:0 2px 10px rgba(18,46,138,0.25);transition:box-shadow .2s ease,transform .2s ease}
.cta:hover{box-shadow:0 4px 18px rgba(18,46,138,0.35);transform:translateY(-1px)}
/* ── footer：品牌页脚（Raindrop 缺页脚是槽点，此处补齐品牌露出） ── */
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
@media(max-width:520px){
  .page{padding:0 14px 40px}
  .hero{padding:30px 0 22px}
  .hero-name{font-size:23px}
  .hero-icon{width:48px;height:48px;border-radius:14px;font-size:19px}
  .bm{padding:12px 8px;gap:12px}
  .bm-title{font-size:14px}
  .cta{width:100%;justify-content:center}
}
`
