/**
 * urls.ts — 外部服务 / 魔法字符串收口（TECH_DEBT C 类）
 *
 * 独立、无依赖模块：刻意不与 constants.ts 互相 import，
 * 否则 constants.ts（其 DEFAULTS 引用 welcome-data 的 WELCOME_NOTES）
 * 会与 welcome-data.ts（需引入本文件取 favicon 基址）形成循环依赖，
 * 导致 DEFAULTS 初始化时取到 undefined（见 welcome-data 单测历史血泪）。
 */

/**
 * favicon 图标源基地址。集中管理便于换供应商 / 合规审计。
 * 注意：每个书签域名都会发给该第三方，存在隐私泄露与单点故障风险；
 * 渲染层应通过 faviconInitials() 提供本地首字母降级（见 utils.ts），避免破图与强依赖。
 */
export const FAVICON_PROVIDER_URL = 'https://api.xinac.net/icon/?url='

/** 网络基线探活 URL 列表（死链检测用）。换环境 / 区域可在此统一调整，避免写死失效。 */
export const NETWORK_PROBE_URLS: readonly string[] = [
  'https://www.baidu.com/favicon.ico',
  'https://www.gstatic.com/generate_204',
  'https://cloudflare.com/favicon.ico',
]

/** 站点 canonical 基址。部署到别处时仅改此处，避免 SEO canonical 写死错误（TECH_DEBT C 类）。 */
export const APP_CANONICAL_BASE = 'https://ulink.ren/'

/**
 * 同域分享链接基址（终态）：`https://ulink.ren/s/<gid>`。
 * 由 Cloudflare Pages Function（functions/s/[gid].ts）在服务端渲染完整 HTML，
 * canonical / og:url / og:image 与站点同域，社交爬虫可直接读到结构化数据。
 * 与 APP_CANONICAL_BASE 同源收口，换域名只改一处。
 */
export const SHARE_BASE = `${APP_CANONICAL_BASE.replace(/\/+$/, '')}/s`

/**
 * 公开分享页 SSR 函数基址（Supabase Edge Function `share-html`，跨域止血方案）。
 * 分享链接由 `${SHARE_FUNCTION_BASE}?gid=<gid>` 生成，爬虫与人类都拿到预渲染 HTML。
 * 由 VITE_SUPABASE_URL 推导（`https://<ref>.supabase.co` + `/functions/v1/share-html`）。
 * 同域 SSR 上线后此函数保留作向后兼容兜底（旧链接仍可访问），不再用于新链接生成。
 */
export const SHARE_FUNCTION_BASE = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/share-html`

/**
 * 微软 Edge 官方扩展商店详情页链接。
 * 永久固定 ID：`epjlkfndeonlpjocdafoiaomdigopeeh`。
 */
export const EDGE_ADDON_URL = 'https://microsoftedge.microsoft.com/addons/detail/%E4%B8%8E%E9%93%BE/epjlkfndeonlpjocdafoiaomdigopeeh'

/**
 * 出海跳板（Cloudflare Pages Functions）基址。
 *
 * 2026-11-09：Cloudflare 部署已迁到国内 CloudBase，`ulink.pages.dev` 不再是本站端点
 * （线上实测该域返回无关静态页，/api/* 在 CloudBase 全部 404）。继续默认指向它，会让
 * 三条 /api/* 请求拿到 HTML 再 JSON.parse 抛错，白白浪费 18s 超时与用户流量。
 *
 * 因此改为「未配置即禁用」：CF_FN_BASE 为空时 cfApiUrl 返回空串、OVERSEAS_PROBE_URL
 * 为空，调用方在发请求前直接走本地兜底。若日后恢复出海跳板，只需在
 * .env.production 配 VITE_CF_FN_BASE=<可用域> 与 VITE_OVERSEAS_PROBE_URL。
 * dev 仍返回相对路径，由 Vite 中间件模拟，不消耗生产配额。
 */
export const CF_FN_BASE =
  ((import.meta.env.VITE_CF_FN_BASE as string | undefined) || '').replace(/\/+$/, '')

/** 海外探活端点；未配置出海跳板时为空，probeOverseas 会直接跳过 */
export const OVERSEAS_PROBE_URL =
  (import.meta.env.VITE_OVERSEAS_PROBE_URL as string | undefined) ||
  (CF_FN_BASE ? `${CF_FN_BASE}/api/check-link` : '')

/**
 * AI 端点（CloudBase 云函数 ai-api，2026-11-09 从 CF Pages 迁入）。
 *
 * dev 保留相对路径 —— vite 中间件已模拟 /api/ai-candidates 与 /api/extract-metadata，
 * 离线可开发且不消耗生产配额；生产走同域 `${VITE_CLOUDBASE_FN_BASE}/ai-api?action=...`。
 * 返回空串表示当前环境没有可用端点，调用方必须直接走本地兜底、不要发请求。
 */
export function aiApiUrl(action: 'candidates' | 'extract'): string {
  if (import.meta.env.DEV) {
    return action === 'candidates' ? '/api/ai-candidates' : '/api/extract-metadata'
  }
  const base = (import.meta.env.VITE_CLOUDBASE_FN_BASE as string | undefined) || ''
  return base ? `${base}/ai-api?action=${action}` : ''
}



