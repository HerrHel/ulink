/**
 * functions/api/check-link.ts — Pages Functions 薄壳（海外探针的入口）
 *
 * 探测逻辑抽在 `functions/_lib/probe-core.ts`，本文件负责把它包成 Pages 的
 * handler 形态，并被 `scripts/build-probe-pages.mjs` 打包成
 * `probe-pages/functions/api/check-link.js` 部署到 Pages 项目 `ulink-probe`
 * （生产端点 `https://ulink-probe.pages.dev/api/check-link`）。
 *
 * Worker 形态（`probe-worker/`）当前不用：`*.workers.dev` 国内直连超时。
 * 两者共用同一份 probe-core，切换只改薄壳。
 */

import { handleProbe } from '../_lib/probe-core.js'
import { cfPreflightResponse } from '../_lib/cf-guard.js'

/** CORS 预检：合法 Origin → 204 + 白名单头，非法 → 403，无 Origin → 放行。 */
export function onRequestOptions(context: { request: Request }): Response {
  return cfPreflightResponse(context.request)
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  return handleProbe(context.request, {
    // 探针只服务浏览器（前端跨站 fetch 必带 Origin）。拒绝无 Origin 的脚本直连，
    // 避免这个无鉴权端点被当成免费开放代理刷。Origin 可伪造、限流是单 isolate
    // 软闸，属纵深防御而非硬边界（见 cf-guard 注释）。
    requireOrigin: true,
    // 客户端 probeOverseas 在 4500ms 自行 abort（useDeadLinkChecker.ts）。
    // 服务端必须更早收口，否则客户端放弃后 Worker 还在跑，白耗一次出网探测。
    // 与 probe-worker 的取值保持一致，避免两个形态行为漂移。
    timeoutMs: 3500,
  })
}
