/**
 * probe-core — 海外探针的核心处理逻辑（与部署形态无关）
 *
 * 历史：这段逻辑原本只存在于 `functions/api/check-link.ts`（Cloudflare Pages Functions）。
 * 2026-11-09 Cloudflare Pages 退役后，`ulink.pages.dev` 被无关项目占用（实测 /api/*
 * 全部返回同一个 1519B HTML，POST 405），探针端点随之消失，前端 `probeOverseas`
 * 因 `OVERSEAS_PROBE_URL` 为空而直接跳过。
 *
 * 2026-11-13：把纯逻辑抽到本文件，供两种形态复用（避免又出现「两份探测逻辑各自漂移」）：
 *   1. `functions/api/check-link.ts` —— Pages Functions 薄壳（历史兼容，已无生产流量）
 *   2. `probe-worker/src/index.ts`  —— 独立 Cloudflare Worker（恢复海外视角的实际部署单元）
 *
 * 判定口径（三态，刻意保守）：
 * - 2xx/3xx       → alive（海外可达；配合国内不可达 = 确认被墙）
 * - 404/410       → dead （站点内容确已消失）
 * - 其它 / 超时 / 异常 → error（403 反爬、5xx 故障都不能当「活着」或「死了」）
 */

import { cfCorsHeaders, guardCfRequest, cfPreflightResponse } from './cf-guard.js'
// SSRF 纯逻辑真源（与 CloudBase check-link 同一份）
import {
  isPrivateHost as isPrivateIpOrHost,
  parseIPv4Hostname,
  parseIPv6Hostname,
} from '../../supabase/functions/check-link/ssrf-guard.js'

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

/**
 * 主机安全性三态判定（区别于旧的布尔 isHostDnsSafe）：
 * - ok       公网可达（字面量已排除私有段，或 A/AAAA 全是公网）
 * - private  字面量/解析结果落在私有段 → SSRF，必须拒绝
 * - nxdomain 解析不出任何记录 → 域名不存在，这是「死链」信号，不是 SSRF
 *
 * 旧实现把两者合并返回 false，导致不存在域名被报成 `private_ip_forbidden`，
 * 前端拿到 400 → 一律当 error，白丢了「海外确认死链」的能力（2026-11-13 实测
 * `*.invalid` 返回 private_ip_forbidden 暴露此问题）。
 */
type HostSafety = 'ok' | 'private' | 'nxdomain'

async function checkHostSafety(hostname: string): Promise<HostSafety> {
  const host = normalizeHost(hostname)
  if (isPrivateHost(host)) return 'private'
  // 公网 IP 字面量：isPrivateHost 已判过私有段，无需再查 DoH
  if (parseIPv4Hostname(host) || parseIPv6Hostname(host)) return 'ok'
  const [v4, v6] = await Promise.all([dohAnswer(host, 'A'), dohAnswer(host, 'AAAA')])
  const all = [...v4, ...v6]
  if (all.length === 0) return 'nxdomain'
  return all.every((ip) => !isPrivateHost(ip)) ? 'ok' : 'private'
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface ProbeOptions {
  /**
   * 是否要求请求必须带 Origin（Worker 形态用）。
   * 浏览器跨站调用一定带 Origin；拒绝无 Origin 请求可抬高脚本滥用的门槛
   * （Origin 本身可伪造，真正的全局硬限流需 Durable Objects / KV，见 cf-guard 注释）。
   */
  requireOrigin?: boolean
  /** 探测目标的总超时（毫秒）。默认 5000；Worker 建议略小于客户端 4500ms 的
   *  abort 阈值，避免「客户端先断、服务端白跑」。 */
  timeoutMs?: number
}

function jsonResponse(
  data: unknown,
  status: number,
  cors: Record<string, string> | null,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(cors ?? {}),
    },
  })
}

/**
 * 处理一次探活请求。入参就是原始 Request，返回可直接下发的 Response；
 * 不依赖任何平台上下文（Pages 的 `context`、Worker 的 `env` 都不需要）。
 */
export async function handleProbe(request: Request, opts: ProbeOptions = {}): Promise<Response> {
  const cors = cfCorsHeaders(request)

  if (request.method === 'OPTIONS') {
    return cfPreflightResponse(request)
  }

  // Worker 形态：只服务浏览器，无 Origin 一律拒绝（先于限流，省一次计数）
  if (opts.requireOrigin && !request.headers.get('Origin')) {
    return jsonResponse({ error: 'origin_required' }, 403, null)
  }

  // 统一防线：死链探测对未登录用户仍可用，故 requireAuth:false；
  // guard 内置的「单 isolate 软限流」是本端点主要的滥用闸门（无鉴权兜底）。
  const guard = await guardCfRequest(request, { requireAuth: false })
  if (guard) return guard

  let rawUrl = ''
  if (request.method === 'POST') {
    try {
      const body = (await request.json()) as { url?: string }
      rawUrl = body.url || ''
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400, cors)
    }
  } else {
    const parsed = new URL(request.url)
    rawUrl = parsed.searchParams.get('url') || ''
  }

  if (!rawUrl || !rawUrl.startsWith('http')) {
    return jsonResponse({ error: 'invalid_url', outcome: 'dead', status: 0 }, 400, cors)
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(rawUrl)
  } catch {
    return jsonResponse({ error: 'invalid_url_format', outcome: 'dead', status: 0 }, 400, cors)
  }

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return jsonResponse({ error: 'private_ip_forbidden', outcome: 'error', status: 0 }, 400, cors)
  }
  // 字面量 + DNS 双重校验：域名解析到内网同样拒绝；解析不出记录则判死链（200 + dead）
  const initialSafety = await checkHostSafety(targetUrl.hostname)
  if (initialSafety === 'private') {
    return jsonResponse({ error: 'private_ip_forbidden', outcome: 'error', status: 0 }, 400, cors)
  }
  if (initialSafety === 'nxdomain') {
    return jsonResponse({ ok: false, outcome: 'dead', status: 0, reason: 'dns_nxdomain' }, 200, cors)
  }

  const timeoutMs = opts.timeoutMs ?? 5000
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
      // 每跳都做 DNS 校验：302 到「解析为内网 IP 的域名」同样拦截；
      // 解析失败也按不安全处理（跳转目标都不存在，没必要继续跟）
      if ((await checkHostSafety(current.hostname)) !== 'ok') {
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
        return jsonResponse({ ok: false, outcome: 'timeout', status: 0 }, 200, cors)
      }
      // HEAD 失败（含 unsafe_redirect / 网络异常）→ 降级 GET，GET 会重新逐跳校验
    }

    // 若 HEAD 不支持（400/401/403/404/405/501 等）或失败，降级为 GET
    if (!response || [400, 401, 403, 404, 405, 501].includes(response.status)) {
      clearTimeout(timer)
      controller = new AbortController()
      timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        response = await fetchGuarded(targetUrl, 'GET', controller.signal)
      } catch (getErr) {
        clearTimeout(timer)
        if ((getErr as Error)?.name === 'AbortError') {
          return jsonResponse({ ok: false, outcome: 'timeout', status: 0 }, 200, cors)
        }
        // DNS 解析失败或网络断开
        const msg = String((getErr as Error)?.message || '')
        if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo') || msg.includes('dns')) {
          return jsonResponse({ ok: false, outcome: 'dead', status: 0 }, 200, cors)
        }
        return jsonResponse({ ok: false, outcome: 'error', status: 0 }, 200, cors)
      }
    }

    clearTimeout(timer)

    const status = response.status
    // 只有 2xx/3xx 判 alive；404/410 判 dead；其余一律 error。
    // 403/503 等不再被误判成站点存活，避免海外探针把风控页/故障页当活站。
    if (status >= 200 && status < 400) {
      return jsonResponse({ ok: true, outcome: 'alive', status }, 200, cors)
    }
    if ([404, 410].includes(status)) {
      return jsonResponse({ ok: false, outcome: 'dead', status }, 200, cors)
    }
    return jsonResponse({ ok: false, outcome: 'error', status }, 200, cors)
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error)?.name === 'AbortError') {
      return jsonResponse({ ok: false, outcome: 'timeout', status: 0 }, 200, cors)
    }
    return jsonResponse({ ok: false, outcome: 'error', status: 0 }, 200, cors)
  }
}
