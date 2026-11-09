/**
 * /s/c/[sid] — 历史 CF 版分类分享页同域 SSR（已退役，仅保留重定向）。
 *
 * 退役收口：生产主站已迁国内 CloudBase，ulink.pages.dev 不再是本站端点，
 * CF Functions 不承载生产流量。本函数历史上完全没有 get_share_secret / 票据 /
 * get_public_group_verified 密码判定，且 24h stale 缓存在取数前命中——一旦 CF Pages
 * 被重新部署，就会复活成「绕过主站验密的第二入口」。
 *
 * 因此这里不做任何缓存读取、不取数、不渲染 HTML：在任何缓存/取数之前直接 302 到
 * https://ulink.ren/s/c/<sid>，把验密交给 CloudBase 网关。旧 Supabase RPC 与边缘缓存
 * 代码路径已整体删除，仅保留 onRequestGet 导出名以维持路由契约。
 */

interface ShareContext {
  params: { sid?: string }
  request: Request
}

/** 校验分享 id：与组分享同口径（字母数字 _ -，2-64 位）。 */
function isValidShareId(sid: string): boolean {
  return /^[a-zA-Z0-9_-]{2,64}$/.test(sid)
}

export async function onRequestGet(context: ShareContext): Promise<Response> {
  // 退役收口：不读边缘缓存、不打 Supabase 旧库，直接交给主站验密网关接管
  const noStoreHeaders = {
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  }

  const sid = String(context.params.sid || "").trim()
  if (!isValidShareId(sid)) {
    return new Response("bad request", { status: 400, headers: noStoreHeaders })
  }

  const url = new URL(context.request.url)
  // 保留 query（如 ?lang=zh-CN），目标路径与本站同构，由 CloudBase 验密网关处理
  const target = `https://ulink.ren/s/c/${encodeURIComponent(sid)}${url.search}`
  return new Response(null, {
    status: 302,
    headers: { location: target, ...noStoreHeaders },
  })
}
