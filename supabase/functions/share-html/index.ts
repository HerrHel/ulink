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
 * 架构要点（迁移友好）：渲染核心（esc/fixUrl/domainOf/stripTags/buildHead/buildBody/
 * renderSharePage）均为纯函数，不触碰 Deno 特有 API（serve/Deno.env）；未来迁到
 * Netlify/Vercel/Cloudflare Pages 的 edge function 时只替换外层薄薄一层胶水。
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

/** 剥离 HTML 标签得纯文本（组 notes 是 TipTap HTML，服务端不做 DOM 清洗、只降级为文本）。 */
function stripTags(html: string): string {
  return (html || "").replace(/<[^>]+>/g, "").trim()
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

/** 组 notes 纯文本描述：前 120 字，空则回退「N 个链接」。 */
function descriptionOf(group: PublicGroup, n: number): string {
  const plain = stripTags(group.notes || "")
  return (plain && plain.slice(0, 120)) || `${n} 个链接 · 由 LinkVault 公开分享`
}

/** 构建 <head>：title / description / og:* / twitter:* / canonical。 */
function buildHead(
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  shareUrl: string,
): string {
  const title = `${group.name || "分享组"} - LinkVault 分享`
  const desc = descriptionOf(group, bookmarks.length)
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
    `<meta property="og:site_name" content="LinkVault">`,
    `<meta property="og:title" content="${escTitle}">`,
    `<meta property="og:description" content="${escDesc}">`,
    `<meta property="og:url" content="${escUrl}">`,
    `<meta property="og:image" content="${esc(OG_IMAGE)}">`,
    `<meta property="og:locale" content="zh_CN">`,
    // Twitter
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escTitle}">`,
    `<meta name="twitter:description" content="${escDesc}">`,
    `<meta name="twitter:image" content="${esc(OG_IMAGE)}">`,
  ].join("\n")
}

/** 书签列表项：首字母占位 + 标题 + 域名，纯静态 <a>，无需 JS。 */
function buildBookmarkItem(b: PublicBookmark): string {
  const safe = fixUrl(b.url)
  const href = safe ? esc(safe) : "#"
  const rel = safe ? ' rel="noopener nofollow"' : ""
  const target = safe ? ' target="_blank"' : ""
  const ch = ((b.title || "").trim().charAt(0) || "?").toUpperCase()
  const dm = safe ? esc(domainOf(safe) || "") : ""
  const notes = (b.notes || "").trim()
  const notesHtml = notes ? `<span class="bm-note">${esc(notes)}</span>` : ""
  return [
    `<a class="bm" href="${href}"${target}${rel}>`,
    `<span class="bm-icon">${esc(ch)}</span>`,
    `<span class="bm-info">`,
    `<span class="bm-title">${esc(b.title || "")}</span>`,
    dm ? `<span class="bm-url">${dm}</span>` : "",
    notesHtml,
    `</span>`,
    `</a>`,
  ].join("")
}

/** 构建 <body>：组聚焦风格（accent 竖条 + 组头 icon + 书签列表 + 底部 CTA）。 */
function buildBody(
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  appOrigin: string,
  gid: string,
): string {
  const name = esc(group.name || "分享组")
  const initial = esc((group.name || "?").trim().charAt(0) || "?").toUpperCase()
  const notesPlain = stripTags(group.notes || "")
  const notesHtml = notesPlain ? `<div class="group-notes-preview">${esc(notesPlain)}</div>` : ""
  const count = bookmarks.length
  const list = count
    ? bookmarks.map(buildBookmarkItem).join("\n")
    : `<div class="empty">这个分享组还没有书签</div>`
  const appUrl = `${appOrigin}/s/${esc(gid)}`
  return [
    `<div class="page">`,
    `<header class="head">`,
    `<a class="logo" href="${esc(appOrigin)}/"><span class="logo-mark">&#128279;</span>LinkVault</a>`,
    `<span class="head-sub">公开分享</span>`,
    `</header>`,
    `<main class="main">`,
    `<div class="focus-card">`,
    `<span class="focus-accent"></span>`,
    `<div class="focus-head">`,
    `<span class="focus-icon">${initial}</span>`,
    `<div class="focus-titlewrap">`,
    `<h1 class="focus-name">${name}</h1>`,
    `<span class="focus-meta">${count} 个链接</span>`,
    `</div>`,
    `</div>`,
    notesHtml,
    `<div class="list">${list}</div>`,
    `<div class="focus-foot">`,
    `<a class="cta" href="${appUrl}">在 LinkVault 中打开 · 复制到我的库</a>`,
    `</div>`,
    `</div>`,
    `</main>`,
    `</div>`,
  ].join("\n")
}

/** 组装完整 HTML 文档。 */
function renderSharePage(
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  shareUrl: string,
  appOrigin: string,
): string {
  const head = buildHead(group, bookmarks, shareUrl)
  const body = buildBody(group, bookmarks, appOrigin, group.id)
  return [
    `<!DOCTYPE html>`,
    `<html lang="zh-CN">`,
    `<head>${head}</head>`,
    `<style>${CSS}</style>`,
    `<body>${body}</body>`,
    `</html>`,
  ].join("\n")
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#F5EFEA;color:#2C2824;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
.page{max-width:760px;margin:0 auto;padding:0 20px 64px}
.head{display:flex;align-items:center;gap:12px;padding:18px 0;border-bottom:1px solid #E5DDD3;margin-bottom:28px}
.logo{display:flex;align-items:center;gap:8px;font-weight:600;font-size:16px;color:#2C2824;text-decoration:none}
.logo-mark{color:#122E8A}
.head-sub{font-size:12px;font-weight:500;color:#6A6660;background:#EDE4DA;padding:3px 10px;border-radius:999px;margin-left:auto}
.main{display:flex;flex-direction:column}
/* 组聚焦卡片：surface 底 + 深蓝 accent 竖条 + 聚焦光晕，与 App 聚焦态一致 */
.focus-card{position:relative;background:#FDFBF9;border:1px solid #E5DDD3;border-radius:14px;box-shadow:0 0 0 2px rgba(18,46,138,0.13),0 8px 28px rgba(0,0,0,0.08),0 2px 6px rgba(0,0,0,0.03);padding:24px 24px 20px;overflow:hidden}
.focus-accent{position:absolute;left:0;top:10px;bottom:10px;width:4px;background:linear-gradient(135deg,#122E8A 0%,#1E40AF 100%);border-radius:0 3px 3px 0}
.focus-head{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.focus-icon{width:46px;height:46px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#EDE4DA;border:1px solid #EFE8DF;border-radius:10px;font-size:18px;font-weight:700;color:#122E8A;text-transform:uppercase}
.focus-titlewrap{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.focus-name{font-size:22px;font-weight:700;color:#2C2824;letter-spacing:-.5px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.focus-meta{font-size:12px;font-weight:600;color:#6A6660;background:#F7F2EC;padding:3px 10px;border-radius:10px;align-self:flex-start}
.group-notes-preview{font-size:13px;line-height:1.7;color:#2C2824;word-break:break-word;margin:0 0 16px;padding:0 2px}
.list{display:flex;flex-direction:column;gap:8px;margin-bottom:18px}
.empty{text-align:center;color:#6A6660;font-size:13px;padding:30px 0;background:#F7F2EC;border:1px dashed #D5CBBE;border-radius:14px}
/* 书签行：与列表视图卡片一致（surface + radius-lg + shadow-card，hover 主色描边） */
.bm{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:14px;background:#FDFBF9;border:1px solid #E5DDD3;text-decoration:none;color:inherit;box-shadow:0 1px 2px rgba(0,0,0,0.03);transition:border-color .2s ease,box-shadow .2s ease,transform .2s cubic-bezier(0.16,1,0.3,1)}
.bm:hover{border-color:#122E8A;box-shadow:0 0 0 2px rgba(18,46,138,0.13),0 4px 14px rgba(0,0,0,0.06);transform:translateY(-1px)}
.bm-icon{width:36px;height:36px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#EDE4DA;border:1px solid #EFE8DF;font-size:13px;font-weight:700;color:#122E8A;text-transform:uppercase}
.bm-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.bm-title{display:block;font-weight:600;font-size:14px;color:#2C2824;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bm-url{display:block;font-size:12px;color:#6A6660;font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bm-note{font-size:12px;color:#5E5852;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.focus-foot{display:flex;align-items:center;justify-content:flex-end;padding-top:16px;border-top:1px solid #EFE8DF}
.cta{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;background:linear-gradient(135deg,#122E8A 0%,#1E40AF 100%);color:#fff;font-size:13px;font-weight:600;text-decoration:none;box-shadow:0 2px 10px rgba(18,46,138,0.25);transition:box-shadow .2s ease,transform .2s ease}
.cta:hover{box-shadow:0 4px 18px rgba(18,46,138,0.35);transform:translateY(-1px)}
@media(max-width:520px){.page{padding:0 14px 40px}.focus-card{padding:20px 16px 16px}.focus-name{font-size:19px}}
`

// ── 入口 ──

serve(async (req) => {
  const url = new URL(req.url)
  const gid = (url.searchParams.get("gid") || "").trim()
  if (!gid || !/^[a-zA-Z0-9_-]{2,64}$/.test(gid)) {
    return new Response("bad request", { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data, error } = await supabase.rpc("get_public_group", { p_gid: gid })

  if (error || !data || !data.group) {
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>分享不存在 - LinkVault</title></head><body style="font-family:system-ui,sans-serif;background:#F5EFEA;text-align:center;padding:80px 20px;color:#5E5852"><div style="font-size:34px;margin-bottom:14px">&#128279;</div><h1 style="font-size:20px;font-weight:700;color:#2C2824;margin-bottom:10px">该分享不存在</h1><p style="font-size:14px">链接可能已失效，或分享者取消了公开</p></body></html>`
    return new Response(html, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  const group = data.group as PublicGroup
  const bookmarks = (data.bookmarks || []) as PublicBookmark[]
  // canonical/og:url 用固定 https 函数 URL（仅保留 gid 参数）。
  const shareUrl = `${SHARE_FN_URL}?gid=${encodeURIComponent(gid)}`

  const html = renderSharePage(group, bookmarks, shareUrl, APP_ORIGIN)
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  })
})
