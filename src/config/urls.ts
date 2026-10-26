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
 * 路线 A：海外轻量探活端点（Cloudflare Pages 边缘服务）。
 * 用于国内（CloudBase 上海）探测无法定性（inconclusive）时，提供自由公网的客观第二视角。
 */
export const OVERSEAS_PROBE_URL =
  (import.meta.env.VITE_OVERSEAS_PROBE_URL as string | undefined) || 'https://ulink.pages.dev/api/check-link'

/**
 * Cloudflare Pages Functions 基址（「出海跳板」）。
 *
 * 为什么必须用绝对地址：`/api/ai-candidates`、`/api/extract-metadata`、`/api/check-link`
 * 这三条能力都要访问境外网络（网页抓取、海外探活），而 CloudBase 云函数在国内机房，
 * 目标站点常不可达（`r.jina.ai` 即不通）——只有 Cloudflare 边缘能提供这个出口。
 *
 * 相对路径 `fetch('/api/...')` 会打到**当前站点域名**，而主站部署在 CloudBase 静态托管
 * （没有 Functions）→ 实测全部 404，用户拿到的是本地兜底结果而非真模型输出。
 * 详见 docs/AI_BACKEND_SPLIT.md。
 */
export const CF_FN_BASE =
  ((import.meta.env.VITE_CF_FN_BASE as string | undefined) || 'https://ulink.pages.dev').replace(/\/+$/, '')

/**
 * 生成 CF Functions 端点地址。
 *
 * dev 环境保留相对路径 —— Vite 中间件已模拟这两个端点（vite.config.ts 里
 * `/api/ai-candidates` 与 `/api/extract-metadata`），既保证离线可开发，
 * 也避免开发时消耗生产侧配额。
 */
export function cfApiUrl(path: string): string {
  if (import.meta.env.DEV) return path
  return `${CF_FN_BASE}${path}`
}

