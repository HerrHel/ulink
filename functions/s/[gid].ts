/**
 * /s/[gid] — 公开分享页同域 SSR（Cloudflare Pages Function）。
 *
 * 终态路线：分享链接从 `supabase.co/functions/v1/share-html?gid=...` 升级为
 * 同域 `https://ulink.ren/s/<gid>`。爬虫与人类请求此路径时由边缘函数渲染完整
 * HTML（head meta + 书签列表 + 组聚焦风格页面），canonical/og:url 与站点同域。
 *
 * 双语：?lang=zh-CN|en-US 显式指定；缺省按 Accept-Language 头推断（zh* → zh-CN，
 * 其余 en-US）。社交爬虫（Twitter/Facebook 等）通常带 Accept-Language，据此返回
 * 对应语言的 og:title / og:locale / 页面文案。
 *
 * 数据来源：复用 Supabase RPC `get_public_group`（SECURITY DEFINER，列级隔离，
 * 已排除 username/password/user_id），以 anon key 调用即可——最小权限。
 *
 * 环境变量（Cloudflare Pages → Settings → Environment variables）：
 *   SUPABASE_URL     例如 https://yqouglfopbmujkqmjgpu.supabase.co
 *   SUPABASE_ANON_KEY 项目的 anon key（同 .env 的 VITE_SUPABASE_ANON_KEY）
 *   APP_ORIGIN       例如 https://ulink.ren（og:image / CTA 跳转用）
 */
import { renderSharePage, renderNotFoundPage, renderUnavailablePage, type ShareLocale } from "../_lib/share-render.js"
import { getAppAssets, type AppAssetsEnv } from "../_lib/app-assets.js"
// 函数内边缘缓存（Cache API）：CF Pages 会覆写 Function 响应的 Cache-Control
// （实测恒为 max-age=0，旧 60s 头从未生效），必须走显式缓存通道，设计见 share-cache.ts
import {
  matchShareCache, putShareCache, shareCacheKey, shareStaleKey,
  EDGE_TTL_S, STALE_TTL_S,
} from "../_lib/share-cache.js"

interface ShareEnv extends AppAssetsEnv {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  APP_ORIGIN?: string
}

interface ShareContext {
  params: { gid?: string }
  env: ShareEnv
  request: Request
  /** Pages Functions 运行时提供；类型面手动声明（functions 不参与 tsc 门禁） */
  waitUntil: (p: Promise<unknown>) => void
}

/** 校验分享组 ID：与 App 端 generateId 格式对齐（字母数字 _ -，2-64 位）。 */
function isValidShareGroupId(gid: string): boolean {
  return /^[a-zA-Z0-9_-]{2,64}$/.test(gid)
}

/** 解析渲染语言：显式 ?lang= 优先，其次 Accept-Language 头，兜底 zh-CN。 */
function resolveLocale(url: URL, acceptLanguage: string): ShareLocale {
  const explicit = url.searchParams.get("lang")
  if (explicit === "zh-CN" || explicit === "en-US") return explicit
  const al = (acceptLanguage || "").toLowerCase()
  if (al.startsWith("zh")) return "zh-CN"
  return "en-US"
}

export async function onRequestGet(context: ShareContext): Promise<Response> {
  const gid = String(context.params.gid || "").trim()
  if (!isValidShareGroupId(gid)) {
    return new Response("bad request", { status: 400, headers: { "x-share-render": "v2" } })
  }

  const url = new URL(context.request.url)
  const locale = resolveLocale(url, context.request.headers.get("accept-language") || "")

  // 边缘新鲜命中：直接返回，不打 Supabase RPC
  const cacheKey = shareCacheKey(url.origin, url.pathname, url.search)
  const hit = await matchShareCache(cacheKey)
  if (hit) {
    const res = new Response(hit.body, hit)
    res.headers.set("x-share-cache", "HIT")
    res.headers.set("x-share-render", "v2")
    return res
  }

  const supabaseUrl = (context.env.SUPABASE_URL || "").replace(/\/+$/, "")
  const anonKey = context.env.SUPABASE_ANON_KEY || ""
  const appOrigin = (context.env.APP_ORIGIN || "https://ulink.ren").replace(/\/+$/, "")
  if (!supabaseUrl || !anonKey) {
    return new Response("server misconfigured", { status: 500, headers: { "x-share-render": "v2" } })
  }

  let data: { group?: unknown; bookmarks?: unknown } | null = null
  let upstreamFailed = false
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
    } else {
      upstreamFailed = true
    }
  } catch {
    upstreamFailed = true
  }

  // 上游不可达/5xx ≠ 分享不存在：404 语义保留给「组不存在或未公开」，否则
  // Supabase 宕机/触顶时所有正常分享链接都会对外表现为「链接失效」。
  // 先试 24h 故障兜底副本（200 + STALE，分享内容只是旧不是失效）；没有才 503
  // （no-store，恢复后的下一次请求立即拿到真数据）。
  if (upstreamFailed) {
    const stale = await matchShareCache(shareStaleKey(cacheKey))
    if (stale) {
      const res = new Response(stale.body, stale)
      res.headers.set("x-share-cache", "STALE")
      res.headers.set("x-share-render", "v2")
      res.headers.set("cache-control", "public, max-age=60")
      return res
    }
    return new Response(renderUnavailablePage(locale), {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-share-render": "v2",
      },
    })
  }

  if (!data || !data.group) {
    return new Response(renderNotFoundPage(locale), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "x-share-render": "v2" },
    })
  }

  // 同域 canonical/og:url：直接用 /s/<gid> 完整 URL（终态同域，无函数前缀）。
  const shareUrl = `${appOrigin}/s/${encodeURIComponent(gid)}`
  const html = renderSharePage(
    data.group as Parameters<typeof renderSharePage>[0],
    (data.bookmarks || []) as Parameters<typeof renderSharePage>[1],
    shareUrl,
    appOrigin,
    locale,
    await getAppAssets(context.env, context.request.url),
  )
  // 双写边缘缓存（waitUntil 异步，不阻塞响应）：主键 5 分钟新鲜 + 24h 故障兜底副本
  context.waitUntil((async () => {
    await putShareCache(context.waitUntil, cacheKey, html, EDGE_TTL_S)
    await putShareCache(context.waitUntil, shareStaleKey(cacheKey), html, STALE_TTL_S)
  })())
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-share-render": "v2",
      "x-share-cache": "MISS",
    },
  })
}
