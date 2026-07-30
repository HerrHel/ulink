/**
 * 命令面板书签项 hostname 提示：把书签 url 解析成用于展示的 hostname
 * （去 `www.` 前缀），无 scheme 的 url 补 `https://` 前缀再解析，解析失败或空入参返回空串。
 *
 * 真纯函数：仅依赖入参，零 DOM / store / 响应式依赖（`new URL` 是 Web API 纯解析）。
 * 从 src/components/overlays/CommandPalette.vue 的 `filtered` computed 内 IIFE 抽出
 * （逻辑逐字保留，零行为变化），使命令面板书签项右侧灰字 hint 承载逻辑可被直接单测，
 * 锁定「无 scheme 补 https / 成功去 www / 失败或空入参返空串」契约防未来回归。
 *
 * 与 src/utils.ts 的 `domain()` 真实不同，不可互相替换：
 * - 纯无 `:` 域名（`example.com`、`localhost`）：domain 直接 new URL 抛错走 catch 返原串
 *   （`'example.com'`），本函数补 `https://` 后取 hostname（`'example.com'`）；看起来一致但
 *   domain 返的是失真原串，本函数返的是真 hostname。
 * - 带 `:` 看似 scheme 的串（`localhost:3000`）：WHATWG URL 把 `localhost` 当 scheme 解析成功
 *   hostname 空串，故 domain 返 `''`；本函数补 `https://` 后 `localhost` 当 host 取 hostname 返
 *   `'localhost'`——明显不同。
 * - hostname 严格不含端口（WHATWG URL 把端口放进 `.port` 而非 `.hostname`）。
 */
export function extractHostname(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
