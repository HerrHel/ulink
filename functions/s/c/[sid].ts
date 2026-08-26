/**
 * /s/c/[sid] — 分类分享同域 SSR（Cloudflare Pages Function）。
 *
 * 分类分享链接 `https://ulink.ren/s/c/<share_id>`（share_id 为 public_category_shares
 * 表主键，由 upsert_public_category_share RPC 幂等生成）。本函数服务端渲染完整 HTML，
 * 与组分享 /s/<gid> 同款 head/样式，社交爬虫可读 og:*（含分类名 + 书签/组计数）。
 *
 * 数据：复用 Supabase RPC `get_public_category`（SECURITY DEFINER，列级隔离，
 * 已排除 username/password/user_id），以 anon key 调用即可——最小权限。
 * 热更新：每次请求实时读库，分享者增删改分类下书签/组后分享页自动反映。
 *
 * 环境变量（同 /s/[gid].ts）：
 *   SUPABASE_URL / SUPABASE_ANON_KEY / APP_ORIGIN
 */
import { renderShareCategoryPage, renderNotFoundPage, type ShareLocale, type PublicGroup, type PublicBookmark } from "../../_lib/share-render.js"

interface ShareEnv {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  APP_ORIGIN?: string
}

/** 校验分享 id：与组分享同口径（字母数字 _ -，2-64 位）。 */
function isValidShareId(sid: string): boolean {
  return /^[a-zA-Z0-9_-]{2,64}$/.test(sid)
}

/** 解析渲染语言：显式 ?lang= 优先，其次 Accept-Language 头，兜底 zh-CN。 */
function resolveLocale(url: URL, acceptLanguage: string): ShareLocale {
  const explicit = url.searchParams.get("lang")
  if (explicit === "zh-CN" || explicit === "en-US") return explicit
  const al = (acceptLanguage || "").toLowerCase()
  if (al.startsWith("zh")) return "zh-CN"
  return "en-US"
}

export async function onRequestGet(context: {
  params: { sid?: string }
  env: ShareEnv
  request: Request
}): Promise<Response> {
  const sid = String(context.params.sid || "").trim()
  if (!isValidShareId(sid)) {
    return new Response("bad request", { status: 400 })
  }

  const url = new URL(context.request.url)
  const locale = resolveLocale(url, context.request.headers.get("accept-language") || "")

  const supabaseUrl = (context.env.SUPABASE_URL || "").replace(/\/+$/, "")
  const anonKey = context.env.SUPABASE_ANON_KEY || ""
  const appOrigin = (context.env.APP_ORIGIN || "https://ulink.ren").replace(/\/+$/, "")
  if (!supabaseUrl || !anonKey) {
    return new Response("server misconfigured", { status: 500 })
  }

  let data: { category?: unknown; groups?: unknown; bookmarks?: unknown } | null = null
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_public_category`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_share_id: sid }),
    })
    if (res.ok) {
      data = (await res.json()) as { category?: unknown; groups?: unknown; bookmarks?: unknown }
    }
  } catch {
    data = null
  }

  if (!data || !data.category) {
    return new Response(renderNotFoundPage(locale), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  // 同域 canonical/og:url：直接用 /s/c/<share_id> 完整 URL。
  const shareUrl = `${appOrigin}/s/c/${encodeURIComponent(sid)}`
  const html = renderShareCategoryPage(
    data.category as Parameters<typeof renderShareCategoryPage>[0],
    (data.groups || []) as PublicGroup[],
    (data.bookmarks || []) as PublicBookmark[],
    sid,
    shareUrl,
    appOrigin,
    locale,
  )
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  })
}
