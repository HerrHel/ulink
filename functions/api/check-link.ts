/**
 * functions/api/check-link.ts — Cloudflare Pages 边缘轻量探活端点（海外自由视角）
 *
 * 路线 A 核心探针：用于在客户端国内探测（CloudBase 上海机房）超时或连接失败时，
 * 从 Cloudflare 全球自由互联网节点发起一次轻量二次探活，100% 精确区分：
 * - 海外正常 (200/3xx/403/500) + 国内不通 = 确认为「被墙 (gfw)」
 * - 海外亦返回 404/410/DNS不存在 = 确认为「死链 (dead)」
 */

interface Env {}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  })
}

const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

function isPrivateIp(hostname: string): boolean {
  if (PRIVATE_HOSTS.has(hostname.toLowerCase())) return true
  // 简要私有 IPv4 段过滤，防 SSRF 探测
  if (/^10\./.test(hostname)) return true
  if (/^192\.168\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return true
  if (/^169\.254\./.test(hostname)) return true
  return false
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request } = context

  if (request.method === 'OPTIONS') {
    return onRequestOptions()
  }

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

  if (isPrivateIp(targetUrl.hostname)) {
    return jsonResponse({ error: 'private_ip_forbidden', outcome: 'error', status: 0 }, 400)
  }

  const timeoutMs = 5000
  let controller = new AbortController()
  let timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let response: Response | null = null

    // 优先 HEAD 请求降低流量
    try {
      response = await fetch(targetUrl.href, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': BROWSER_UA },
      })
    } catch (headErr) {
      if ((headErr as Error)?.name === 'AbortError') {
        return jsonResponse({ ok: false, outcome: 'timeout', status: 0 })
      }
      // HEAD 失败尝试 GET
    }

    // 若 HEAD 不支持（400/403/405 等）或失败，降级为 GET
    if (!response || [400, 401, 403, 404, 405, 501].includes(response.status)) {
      clearTimeout(timer)
      controller = new AbortController()
      timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        response = await fetch(targetUrl.href, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'User-Agent': BROWSER_UA },
        })
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
    if (status >= 200 && status < 400) {
      return jsonResponse({ ok: true, outcome: 'alive', status })
    }
    // 软存活状态码（鉴权/限流/临时网关）视为网站存活
    if ([401, 402, 403, 405, 408, 418, 425, 429, 500, 502, 503, 504].includes(status)) {
      return jsonResponse({ ok: true, outcome: 'alive', status })
    }
    if ([404, 410].includes(status)) {
      return jsonResponse({ ok: false, outcome: 'dead', status })
    }

    return jsonResponse({ ok: true, outcome: 'alive', status })
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error)?.name === 'AbortError') {
      return jsonResponse({ ok: false, outcome: 'timeout', status: 0 })
    }
    return jsonResponse({ ok: false, outcome: 'error', status: 0 })
  }
}
