/**
 * functions/api/check-link.ts — Pages Functions 薄壳（历史形态，已无生产流量）
 *
 * 探测逻辑已抽到 `functions/_lib/probe-core.ts`，与 `probe-worker/src/index.ts`
 * 共用同一份实现（2026-11-13）。本文件只保留 Pages 的 handler 签名，方便：
 *   - 本地/历史调用方仍能按 onRequest 方式使用；
 *   - 若日后重新启用 CF Pages，无需再搬一遍逻辑。
 *
 * 说明：`ulink.pages.dev` 自 2026-11-09 起已不承载本站，实际生产探针请用
 * `probe-worker/`（见该目录 README）。
 */

import { handleProbe } from '../_lib/probe-core.js'
import { cfPreflightResponse } from '../_lib/cf-guard.js'

/** CORS 预检：合法 Origin → 204 + 白名单头，非法 → 403，无 Origin → 放行。 */
export function onRequestOptions(context: { request: Request }): Response {
  return cfPreflightResponse(context.request)
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  // requireOrigin：探针只服务浏览器（前端跨站 fetch 必带 Origin）。
  // 拒绝无 Origin 的脚本直连，避免这个无鉴权端点被当成免费开放代理刷。
  // Origin 可伪造、限流是单 isolate 软闸，属纵深防御而非硬边界（见 cf-guard 注释）。
  return handleProbe(context.request, { requireOrigin: true })
}
