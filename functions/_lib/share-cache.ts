/**
 * share-cache — 分享页函数内边缘缓存（Cache API），`s/[gid].ts` 与 `s/c/[sid].ts` 共用。
 *
 * 为什么不用响应头 cache-control：实测 Cloudflare Pages 会把 Function 响应的
 * Cache-Control 覆写为 `public, max-age=0, must-revalidate`（旧版 60s 头从未生效），
 * 且 Functions 响应默认不进边缘缓存。caches.default 是官方可用的显式缓存通道，
 * 于函数内先行命中，匿名分享流量不再打 Supabase RPC（触顶防护：egress 解耦）。
 *
 * 缓存键 = origin + pathname + search（?lang= 参与键，避免语言变体串缓存）。
 * 成功响应双写：主键（300s 新鲜）+ stale-fallback 副本（24h）；上游故障时
 * 返回兜底副本（200 + x-share-cache: STALE），分享页在 Supabase 宕机期间仍可访问。
 */

/** 边缘缓存 TTL：新鲜 5 分钟；故障兜底副本 24 小时。 */
export const EDGE_TTL_S = 300
export const STALE_TTL_S = 86400

const edgeCache = (caches as unknown as { default: Cache }).default

export function shareCacheKey(origin: string, pathname: string, search: string): string {
  return `${origin}${pathname}${search}`
}

export function shareStaleKey(key: string): string {
  return `${key}${key.includes("?") ? "&" : "?"}stale-fallback=1`
}

export async function matchShareCache(key: string): Promise<Response | undefined> {
  return edgeCache.match(new Request(key, { method: "GET" }))
}

export async function putShareCache(
  waitUntil: (p: Promise<unknown>) => void,
  key: string,
  html: string,
  ttlS: number,
): Promise<void> {
  const res = new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=${ttlS}`,
    },
  })
  waitUntil(edgeCache.put(new Request(key, { method: "GET" }), res))
}
