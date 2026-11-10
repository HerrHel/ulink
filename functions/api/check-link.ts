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
// SSRF 纯逻辑真源（与 CloudBase check-link 同一份）
import {
  isPrivateHost as isPrivateIpOrHost,
  parseIPv4Hostname,
  parseIPv6Hostname,
} from '../../supabase/functions/check-link/ssrf-guard.js'

interface Env {}

/** 回环/本机字面量（IPv6 去方括号后比对：URL.hostname 对 IPv6 会带 []）。 */
const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '::'])

/** 去方括号归一化 IPv6 字面量：new URL('http://[::1]/').hostname === '[::1]'。 */
function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
}

/** 私网 / 回环 / 链路本地 / .local / .internal 拒绝（每跳重定向都要重跑，防 302 打到内网 SSRF）。
 *  字面量判断复用 ssrf-guard 真源：公网 IPv6 不再被误杀，私有 IPv6 / IPv4 映射仍全拦。 */
function isPrivateHost(hostname: string): boolean {
  const host = normalizeHost(hostname)
  if (PRIVATE_HOSTS.has(host)) return true
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  return isPrivateIpOrHost(host)
}

/**
 * DNS 层 SSRF 校验（CF 边缘无 node:dns，改用 DoH）：
 * 攻击者可用 localtest.me 等域名指向 127.0.0.1 / 169.254.0.23，
 * 仅校验字面量挡不住。A/AAAA 任一记录落入私有段即拒；解析失败 fail-closed。
 */
async function dohAnswer(host: string, type: 'A' | 'AAAA'): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
      { headers: { accept: 'application/dns-json' }, signal: controller.signal },
    )
    if (!res.ok) return []
    const data = (await res.json()) as { Answer?: Array<{ type?: number; data?: string }> }
    return (data.Answer || [])
      .filter((a) => (a.type === 1 || a.type === 28) && typeof a.data === 'string')
      .map((a) => String(a.data))
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

async function isHostDnsSafe(hostname: string): Promise<boolean> {
  const host = normalizeHost(hostname)
  if (isPrivateHost(host)) return false
  // 公网 IP 字面量：isPrivateHost 已判过私有段，无需再查 DoH
  if (parseIPv4Hostname(host) || parseIPv6Hostname(host)) return true
  const [v4, v6] = await Promise.all([dohAnswer(host, 'A'), dohAnswer(host, 'AAAA')])
  const all = [...v4, ...v6]
  if (all.length === 0) return false
  return all.every((ip) => !isPrivateHost(ip))
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

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return jsonResponse({ error: 'private_ip_forbidden', outcome: 'error', status: 0 }, 400)
  }
  // 字面量 + DNS 双重校验：域名解析到内网同样拒绝
  if (!(await isHostDnsSafe(targetUrl.hostname))) {
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
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        throw new Error('unsafe_redirect')
      }
      // 每跳都做 DNS 校验：302 到「解析为内网 IP 的域名」同样拦截
      if (!(await isHostDnsSafe(current.hostname))) {
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
