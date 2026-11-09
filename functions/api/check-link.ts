/**
 * functions/api/check-link.ts — Cloudflare Pages 边缘轻量探活端点（海外自由视角）
 *
 * 路线 A 核心探针：用于在客户端国内探测（CloudBase 上海机房）超时或连接失败时，
 * 从 Cloudflare 全球自由互联网节点发起一次轻量二次探活，100% 精确区分：
 * - 海外正常 (2xx/3xx) + 国内不通 = 确认为「被墙 (gfw)」
 * - 海外亦返回 404/410/DNS不存在 = 确认为「死链 (dead)」
 * - 其它状态码（403/5xx 等）一律 outcome:'error'，不再误判成站点存活
 */

import { cfCorsHeaders, guardCfRequest, cfPreflightResponse } from '../_lib/cf-guard.js'

interface Env {}

/** 回环/本机字面量（IPv6 去方括号后比对：URL.hostname 对 IPv6 会带 []）。 */
const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '::'])

/** 去方括号归一化 IPv6 字面量：new URL('http://[::1]/').hostname === '[::1]'。 */
function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
}

/** 私网 / 回环 / 链路本地 / .local / .internal 拒绝（每跳重定向都要重跑，防 302 打到内网 SSRF）。 */
function isPrivateHost(hostname: string): boolean {
  const host = normalizeHost(hostname)
  if (PRIVATE_HOSTS.has(host)) return true
  // 内网命名域后缀（check-link 补齐 .local / .internal）
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  // IPv6 字面量（去方括号后仍含 ':'）一律拒绝：覆盖 ::1 / 0:0:...:1 / fc00::/7 /
  // fe80::/10 / ::ffff: 映射等全部私网与链路本地形态，与 CloudBase validateInputUrl 同口径
  if (host.includes(':')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (m.slice(1).some((o) => Number(o) > 255)) return true // 非法 IP 字面量也拒绝
    if (a === 127 || a === 10 || a === 0 || a >= 224) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
  }
  return false
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** CORS 预检：合法 Origin → 204 + 白名单头，非法 → 403，无 Origin → 放行。 */
export function onRequestOptions(context: { request: Request }): Response {
  return cfPreflightResponse(context.request)
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request } = context

  if (request.method === 'OPTIONS') {
    return onRequestOptions(context)
  }

  // 统一防线：死链探测对未登录用户仍可用，故 requireAuth:false；
  // guard 内置的「单 isolate 软限流」是本端点主要的滥用闸门（无鉴权兜底）。
  const guard = await guardCfRequest(request, { requireAuth: false })
  if (guard) return guard

  const cors = cfCorsHeaders(request) ?? {}
  const jsonResponse = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...cors,
      },
    })

  let rawUrl = ''
  if (request.method === 'POST') {
    try {
      const body = (await request.json()) as { url?: string }
      rawUrl = body.url || ''
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400)
    }
  } else {
    const parsed = new URL(request.url)
    rawUrl = parsed.searchParams.get('url') || ''
  }

  if (!rawUrl || !rawUrl.startsWith('http')) {
    return jsonResponse({ error: 'invalid_url', outcome: 'dead', status: 0 }, 400)
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(rawUrl)
  } catch {
    return jsonResponse({ error: 'invalid_url_format', outcome: 'dead', status: 0 }, 400)
  }

  if ((targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') || isPrivateHost(targetUrl.hostname)) {
    return jsonResponse({ error: 'private_ip_forbidden', outcome: 'error', status: 0 }, 400)
  }

  const timeoutMs = 5000
  const MAX_REDIRECTS = 3
  const REDIRECT_CODES = [301, 302, 303, 307, 308]

  /**
   * 手动跟随重定向（最多 3 跳），每跳重新校验协议/主机：
   * `redirect:'follow'` 只校验初始 hostname，302 到内网即可 SSRF。
   */
  const fetchGuarded = async (start: URL, method: 'HEAD' | 'GET', signal: AbortSignal): Promise<Response> => {
    let current = start
    for (let hop = 0; ; hop++) {
      if ((current.protocol !== 'http:' && current.protocol !== 'https:') || isPrivateHost(current.hostname)) {
        throw new Error('unsafe_redirect')
      }
      const res = await fetch(current.href, {
        method,
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': BROWSER_UA },
      })
      const loc = REDIRECT_CODES.includes(res.status) ? res.headers.get('Location') : null
      if (loc && hop < MAX_REDIRECTS) {
        let next: URL
        try {
          next = new URL(loc, current.href)
        } catch {
          return res
        }
        current = next
        continue
      }
      return res
    }
  }

  let controller = new AbortController()
  let timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let response: Response | null = null

    // 优先 HEAD 请求降低流量
    try {
      response = await fetchGuarded(targetUrl, 'HEAD', controller.signal)
    } catch (headErr) {
      if ((headErr as Error)?.name === 'AbortError') {
        return jsonResponse({ ok: false, outcome: 'timeout', status: 0 })
      }
      // HEAD 失败（含 unsafe_redirect / 网络异常）→ 降级 GET，GET 会重新逐跳校验
    }

    // 若 HEAD 不支持（400/403/405 等）或失败，降级为 GET
    if (!response || [400, 401, 403, 404, 405, 501].includes(response.status)) {
      clearTimeout(timer)
      controller = new AbortController()
      timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        response = await fetchGuarded(targetUrl, 'GET', controller.signal)
      } catch (getErr) {
        clearTimeout(timer)
        if ((getErr as Error)?.name === 'AbortError') {
          return jsonResponse({ ok: false, outcome: 'timeout', status: 0 })
        }
        // DNS 解析失败或网络断开
        const msg = String((getErr as Error)?.message || '')
        if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo') || msg.includes('dns')) {
          return jsonResponse({ ok: false, outcome: 'dead', status: 0 })
        }
        return jsonResponse({ ok: false, outcome: 'error', status: 0 })
      }
    }

    clearTimeout(timer)

    const status = response.status
    // 只有 2xx/3xx 判 alive；404/410 判 dead；其余一律 error。
    // 403/503 等不再被误判成站点存活，避免海外探针把风控页/故障页当活站。
    if (status >= 200 && status < 400) {
      return jsonResponse({ ok: true, outcome: 'alive', status })
    }
    if ([404, 410].includes(status)) {
      return jsonResponse({ ok: false, outcome: 'dead', status })
    }
    return jsonResponse({ ok: false, outcome: 'error', status })
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error)?.name === 'AbortError') {
      return jsonResponse({ ok: false, outcome: 'timeout', status: 0 })
    }
    return jsonResponse({ ok: false, outcome: 'error', status: 0 })
  }
}
