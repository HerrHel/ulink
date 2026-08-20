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
 * 公开分享页 SSR 函数基址（Supabase Edge Function `share-html`）。
 * 分享链接由 `${SHARE_FUNCTION_BASE}?gid=<gid>` 生成，爬虫与人类都拿到预渲染 HTML。
 * 由 VITE_SUPABASE_URL 推导（`https://<ref>.supabase.co` + `/functions/v1/share-html`）。
 * 未配置 Supabase 时为空串——但分享功能本身要求登录云同步，未配置时不会走到生成链接。
 */
export const SHARE_FUNCTION_BASE = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/share-html`
