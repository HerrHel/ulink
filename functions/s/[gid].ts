/**
 * /s/[gid] — 公开分享页同域 SSR（Cloudflare Pages Function）。
 *
 * 终态路线：分享链接从 `supabase.co/functions/v1/share-html?gid=...` 升级为
 * 同域 `https://ulink.ren/s/<gid>`。爬虫与人类请求此路径时由边缘函数渲染完整
 * HTML（head meta + 书签列表 + 组聚焦风格页面），canonical/og:url 与站点同域。
 *
 * 数据来源：复用 Supabase RPC `get_public_group`（SECURITY DEFINER，列级隔离，
 * 已排除 username/password/user_id），以 anon key 调用即可——最小权限。
 *
 * 环境变量（Cloudflare Pages → Settings → Environment variables）：
 *   SUPABASE_URL     例如 https://yqouglfopbmujkqmjgpu.supabase.co
 *   SUPABASE_ANON_KEY 项目的 anon key（同 .env 的 VITE_SUPABASE_ANON_KEY）
 *   APP_ORIGIN       例如 https://ulink.ren（og:image / CTA 跳转用）
 */
import { renderSharePage, renderNotFoundPage } from "../_lib/share-render.js"

interface ShareEnv {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  APP_ORIGIN?: string
}

/** 校验分享组 ID：与 App 端 generateId 格式对齐（字母数字 _ -，2-64 位）。 */
function isValidShareGroupId(gid: string): boolean {
  return /^[a-zA-Z0-9_-]{2,64}$/.test(gid)
}

export async function onRequestGet(context: {
  params: { gid?: string }
  env: ShareEnv
}): Promise<Response> {
  const gid = String(context.params.gid || "").trim()
  if (!isValidShareGroupId(gid)) {
    return new Response("bad request", { status: 400 })
  }

  const supabaseUrl = (context.env.SUPABASE_URL || "").replace(/\/+$/, "")
  const anonKey = context.env.SUPABASE_ANON_KEY || ""
  const appOrigin = (context.env.APP_ORIGIN || "https://ulink.ren").replace(/\/+$/, "")
  if (!supabaseUrl || !anonKey) {
    return new Response("server misconfigured", { status: 500 })
  }

  let data: { group?: unknown; bookmarks?: unknown } | null = null
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_public_group`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_gid: gid }),
    })
    if (res.ok) {
      data = (await res.json()) as { group?: unknown; bookmarks?: unknown }
    }
  } catch {
    data = null
  }

  if (!data || !data.group) {
    return new Response(renderNotFoundPage(), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  // 同域 canonical/og:url：直接用 /s/<gid> 完整 URL（终态同域，无函数前缀）。
  const shareUrl = `${appOrigin}/s/${encodeURIComponent(gid)}`
  const html = renderSharePage(
    data.group as Parameters<typeof renderSharePage>[0],
    (data.bookmarks || []) as Parameters<typeof renderSharePage>[1],
    shareUrl,
    appOrigin,
  )
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  })
}
