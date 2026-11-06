/**
 * functions/_lib/cf-guard.ts — Cloudflare Pages /api/* 三个「出海跳板」边缘函数的公共防线
 *
 * 收口三件事，避免在 ai-candidates / extract-metadata / check-link 里各写一套：
 *  1. Origin 白名单 + 白名单 CORS 头回显（杜绝 `Access-Control-Allow-Origin: *`）；
 *  2. 可选鉴权：带 Bearer token 调 CloudBase OIDC userinfo 端点校验，fail-closed；
 *  3. 轻量进程内软限流（单 isolate 软闸，非全局硬闸）。
 *
 * 设计前提：生产主站在 CloudBase（https://ulink.ren），本函数部署在
 * https://ulink.pages.dev。浏览器跨站 fetch 一定带 Origin；无 Origin 的请求
 * 只可能是同源 / 本地开发 / 服务端直连，一律放行（见 guardCfRequest 注释）。
 */

/** 精确白名单（origin 归一化后比较，端口参与匹配）。 */
const ALLOWED_ORIGINS = new Set<string>([
  'https://ulink.ren',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'https://ulink.pages.dev',
])

/** Cloudflare Pages 预览子域后缀（配合 URL.hostname 解析，不对整条 Origin 做 includes）。 */
const PREVIEW_SUFFIX = '.ulink.pages.dev'

/** CloudBase OIDC userinfo 端点：带 Authorization: Bearer <token> 访问，成功即 200。 */
const OIDC_USERINFO_URL =
  'https://ulink-d1g5srvjo54b1886a.api.tcloudbasegateway.com/auth/v1/user/me'

/** 鉴权校验超时（毫秒）。 */
const AUTH_TIMEOUT_MS = 8000

/**
 * Origin 白名单判定：一律先经 URL 解析，再基于 hostname 判断，
 * 绝不对整条 Origin 做 `includes(...)`（否则 `https://evil.com/?x=ulink.pages.dev`
 * 之类会被误放行）。
 */
function isAllowedOrigin(origin: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    // 例如 `Origin: null`（沙箱 iframe / file://）或非法字符串 → 不放行
    return false
  }

  if (ALLOWED_ORIGINS.has(parsed.origin)) return true

  // *.ulink.pages.dev 预览子域：仅 https，且必须是 ulink.pages.dev 的子域
  // （apex 由上面的精确白名单处理，hostname 不带前导点，不会命中这里）。
  if (parsed.protocol === 'https:' && parsed.hostname.endsWith(PREVIEW_SUFFIX)) {
    const sub = parsed.hostname.slice(0, -PREVIEW_SUFFIX.length)
    // 只允许合法的 DNS 标签（可多级），排除空串与异常字符
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(sub)) return true
  }

  return false
}

/**
 * 生成白名单 CORS 响应头。
 * - Origin 在白名单：回显该 Origin（而非 `*`）+ Vary + Allow-Headers；
 * - 无 Origin 或不在白名单：返回 null（调用方据此放行 / 拒绝，绝不回显 ACAO）。
 */
export function cfCorsHeaders(request: Request): Record<string, string> | null {
  const origin = request.headers.get('Origin')
  if (!origin || !isAllowedOrigin(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Ulink-Trace-Id',
  }
}

/** 统一的错误响应：所有错误都带 Cache-Control: no-store。 */
function guardError(status: number, error: string, cors?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(cors ?? {}),
    },
  })
}

/**
 * CORS 预检（OPTIONS）专用：
 * - 合法 Origin → 204 + 白名单头（附 Allow-Methods，保证带自定义头的 POST 预检通过）；
 * - 非法 Origin → 403 JSON（no-store，不回显 ACAO）；
 * - 无 Origin → 204 放行（同源 / dev / 服务端直连，无需 CORS 头）。
 * 注意：预检请求不带 Authorization，因此这里绝不走鉴权。
 */
export function cfPreflightResponse(request: Request): Response {
  const origin = request.headers.get('Origin')
  const cors = cfCorsHeaders(request)
  if (origin && !cors) {
    return guardError(403, 'origin_forbidden')
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...(cors ?? {}),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  })
}

/* ------------------------------------------------------------------ *
 * 轻量进程内软限流
 * ------------------------------------------------------------------ */

interface RateBucket {
  count: number
  resetAt: number
}

/** 60s 固定窗口，默认每 key 60 次。 */
const RATE_WINDOW_MS = 60_000
const DEFAULT_RATE_LIMIT = 60

/**
 * ⚠️ 这是「单 isolate 软闸」，不是全局硬闸：
 *  - 计数只存在于当前 Worker isolate 的内存 Map，isolate 被回收 / 重启即清零；
 *  - Cloudflare 会把同一站点的请求分散到多个 isolate、多个边缘节点，各算各的，
 *    彼此不共享计数，无法跨节点汇总；
 *  - 因此它只能削平「单个 isolate 内的突发刷量」，挡不住分布式 / 跨节点持续滥用。
 * 真正的全局硬限流需要 Durable Objects / KV / Rate Limiting binding 等外部状态，
 * 本模块刻意保持零依赖、零绑定，仅作为纵深防御里的一层软闸。
 */
const rateBuckets = new Map<string, RateBucket>()

/** 分桶键：优先 Cloudflare 客户端 IP，其次 Origin，再退化为共享键；按路径再细分。 */
function rateLimitKey(request: Request): string {
  const ip = request.headers.get('CF-Connecting-IP') || ''
  const origin = request.headers.get('Origin') || ''
  let pathname = ''
  try {
    pathname = new URL(request.url).pathname
  } catch {
    pathname = ''
  }
  return `${ip || origin || 'anonymous'}|${pathname}`
}

function isRateLimited(key: string, limit: number): boolean {
  if (limit <= 0) return false
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    // 顺手清理过期桶，避免长生命周期 isolate 内 Map 无限增长
    if (rateBuckets.size > 1024) {
      for (const [k, v] of rateBuckets) {
        if (now >= v.resetAt) rateBuckets.delete(k)
      }
    }
    return false
  }
  bucket.count += 1
  return bucket.count > limit
}

export interface GuardOptions {
  /** 是否要求 Bearer token 鉴权（默认 false）。 */
  requireAuth?: boolean
  /** 60s 窗口内每 key 允许的请求数；<=0 关闭软限流（默认 60）。 */
  rateLimit?: number
}

/**
 * 统一入口：返回 `Response` 表示「已拦截，直接返回给客户端」；返回 `null` 表示放行，
 * 调用方继续执行正常业务逻辑。因鉴权需要异步 fetch，本函数为 async。
 */
export async function guardCfRequest(
  request: Request,
  opts: GuardOptions = {},
): Promise<Response | null> {
  const origin = request.headers.get('Origin')
  const cors = cfCorsHeaders(request)

  // 软限流对所有请求生效（含无 Origin 的脚本直连）
  if (isRateLimited(rateLimitKey(request), opts.rateLimit ?? DEFAULT_RATE_LIMIT)) {
    return guardError(429, 'rate_limited', cors ?? undefined)
  }

  // ⚠️ 鉴权必须先于「无 Origin 放行」，且对 requireAuth 端点无论有无 Origin 都强制校验。
  // 否则 curl 只要不发 Origin 头，就能同时绕过白名单、鉴权与 CORS，直接盗刷 MIMO_API_KEY。
  // 生产前端经 cfHeaders.buildCfHeaders() 一定带 Bearer；dev 走 vite 中间件，不经过本函数。
  if (opts.requireAuth === true) {
    const authHeader = request.headers.get('Authorization') || ''
    if (!/^Bearer\s+\S+/i.test(authHeader)) {
      return guardError(401, 'unauthorized', cors ?? undefined)
    }
    try {
      const verifyRes = await fetch(OIDC_USERINFO_URL, {
        method: 'GET',
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      })
      // 非 2xx → 401
      if (!verifyRes.ok) {
        return guardError(401, 'unauthorized', cors ?? undefined)
      }
    } catch {
      // 网络异常 / 超时一律 401（fail-closed），绝不因校验失败而放行
      return guardError(401, 'unauthorized', cors ?? undefined)
    }
  }

  // Origin 白名单只对「带了 Origin」的请求生效；无 Origin 的同源 / dev / 服务端直连放行，
  // 但这类请求若命中 requireAuth 端点，上面已经先验过 token。
  if (origin && !cors) return guardError(403, 'origin_forbidden')

  return null
}
