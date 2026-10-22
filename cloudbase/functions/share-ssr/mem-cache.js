/**
 * mem-cache — 分享页进程内缓存（share-cache.ts 的 Node 版）。
 *
 * 语义对齐 CF 版：成功响应双写「300s 新鲜 + 24h 故障兜底」；上游故障时回兜底副本
 * （x-share-cache: STALE），无兜底才 503。CF 版走 Cache API（边缘多节点共享），
 * 云函数版为实例内存 Map——多实例各自缓存，命中率略低但语义一致，且不引入外部依赖。
 * Map 保持插入序做简易 LRU，超上限淘汰最老条目，防长期内存膨胀。
 */

const FRESH_TTL_MS = 300 * 1000
const STALE_TTL_MS = 86400 * 1000
const MAX_ENTRIES = 300

const fresh = new Map()
const stale = new Map()

function put(map, key, html, ttlMs) {
  map.delete(key)
  map.set(key, { html, expireAt: Date.now() + ttlMs })
  while (map.size > MAX_ENTRIES) {
    map.delete(map.keys().next().value)
  }
}

function get(map, key) {
  const e = map.get(key)
  if (!e) return null
  if (Date.now() > e.expireAt) {
    map.delete(key)
    return null
  }
  return e.html
}

/** 成功响应写入：新鲜键 + 24h 兜底键 */
function putShare(key, html) {
  put(fresh, key, html, FRESH_TTL_MS)
  put(stale, key, html, STALE_TTL_MS)
}

module.exports = {
  getFresh: (key) => get(fresh, key),
  getStale: (key) => get(stale, key),
  putShare,
}
