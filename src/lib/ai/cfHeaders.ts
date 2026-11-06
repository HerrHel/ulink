/**
 * cfHeaders.ts — 构造调用 Cloudflare Pages /api/* 「出海跳板」端点的请求头。
 *
 * 三个端点现要求 Bearer token（ai-candidates / extract-metadata）并统一带链路追踪 ID；
 * 这里集中收口，避免在 cloudCandidates / smartIntake / useDeadLinkChecker 里各写一套。
 *
 * 关键约定：拿不到 token 绝不硬失败——不带 Authorization 即可，服务端会在无 token 时
 * 返回 401，前端沿用既有 catch 静默降级到本地兜底。
 *
 * ⚠️ 必须走 authDriver.getApiToken()：CloudBase 后端下 supabase.auth.getSession()
 * 恒为空（见 authDriver.ts:390-398 的事故说明），直接用它会导致生产环境 CF 鉴权
 * 全量 401、AI 候选与元数据提取静默降级。
 */

import { getApiToken } from '../authDriver.js'

/** crypto.randomUUID 不可用时的降级 ID：仅用于链路追踪，非安全用途。 */
function fallbackTraceId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 返回调用 CF /api/* 端点的请求头：
 *  - Content-Type: application/json
 *  - Authorization: Bearer <token>（authDriver.getApiToken()；失败 / 无 token 时不带）
 *  - X-Ulink-Trace-Id: crypto.randomUUID()（不存在时降级）
 */
export async function buildCfHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // 取会话失败 / 未登录 → 不带 Authorization，绝不让前端因此硬失败
  try {
    const token = await getApiToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  } catch {
    // 静默：无 token，服务端会 401，前端走既有兜底
  }

  // 链路追踪 ID：randomUUID 不可用或抛错时降级
  let traceId = ''
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      traceId = crypto.randomUUID()
    }
  } catch {
    // 忽略，走降级
  }
  headers['X-Ulink-Trace-Id'] = traceId || fallbackTraceId()

  return headers
}
