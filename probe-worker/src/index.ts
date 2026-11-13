/**
 * ulink-probe — 海外探针 Worker（Cloudflare）
 *
 * 作用：给死链检测提供「海外视角」的二次探活。境内（CloudBase 上海）判定
 * inconclusive / connect_err / timeout 时，浏览器再问一次这里：
 *   海外 2xx/3xx + 国内不通 → 判定为「被墙」
 *   海外 404/410           → 判定为「死链」
 *
 * 与 `functions/api/check-link.ts`（Pages Functions 历史形态）共用
 * `functions/_lib/probe-core.ts`，SSRF 校验复用 ssrf-guard 真源，不另写一份。
 *
 * 部署：`npx wrangler deploy --config probe-worker/wrangler.toml`（详见同目录 README）。
 */

import { handleProbe } from '../../functions/_lib/probe-core'

export default {
  async fetch(request: Request): Promise<Response> {
    return handleProbe(request, {
      // 只服务浏览器：浏览器跨站 fetch 一定带 Origin，无 Origin 的脚本直连直接 403
      requireOrigin: true,
      // 客户端 probeOverseas 在 4500ms 自行 abort，服务端更早收口免得白跑
      timeoutMs: 3500,
    })
  },
}
