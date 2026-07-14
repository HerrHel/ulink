import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * 单文件镜像说明（重要）：
 * 本文件是「部署镜像」——SSRF/CORS 纯逻辑在此内联自包含，便于在 Supabase
 * Dashboard Edge Function 在线编辑器中单文件粘贴部署（该编辑器对同目录多文件
 * import 的支持不确定，且本地 CLI 在当前环境安装受限）。
 * 纯逻辑的唯一真源为同目录 ssrf-guard.ts，经 src/__tests__/ssrf-guard.test.ts
 * 覆盖 53 个单测。如修改 SSRF/CORS 逻辑，请同时改两处并保持一致——
 * 单测会守护 ssrf-guard.ts 侧的正确性。
 *
 * S7：SSRF 三层防御 + S9：CORS fail-closed + S11：错误信息规范化。
 */

/** 允许的来源：优先取环境变量，缺省仅同源；S9 未配置则 fail-closed 拒绝跨域 */
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').filter(Boolean)

// ── 镜像自 ssrf-guard.ts（纯逻辑，请与该文件保持一致）──
const PRIVATE_LITERAL_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  'metadata.google.internal', 'metadata',
])
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const ALLOWED_PORTS = new Set(['', '80', '443'])

function isPrivateIPv4(octets: number[]): boolean {
  if (octets.length !== 4 || octets.some(o => o < 0 || o > 255)) return false
  const [a, b] = octets
  if (a === 127) return true
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 0) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

function isPrivateIPv6(hextets: number[]): boolean {
  if (hextets.length !== 8) return false
  const a = hextets[0]
  if (hextets.slice(0, 7).every(h => h === 0) && hextets[7] === 1) return true
  if (hextets.every(h => h === 0)) return true
  if ((a & 0xfe00) === 0xfc00) return true
  if ((a & 0xffc0) === 0xfe80) return true
  if (a === 0x2001 && hextets[1] === 0x0db8) return true
  if (hextets.slice(0, 5).every(h => h === 0) && hextets[5] === 0xffff) {
    const ipv4 = [(hextets[6] >> 8) & 0xff, hextets[6] & 0xff, (hextets[7] >> 8) & 0xff, hextets[7] & 0xff]
    return isPrivateIPv4(ipv4)
  }
  if (hextets.slice(0, 5).every(h => h === 0) && hextets[5] === 0) {
    const ipv4 = [(hextets[6] >> 8) & 0xff, hextets[6] & 0xff, (hextets[7] >> 8) & 0xff, hextets[7] & 0xff]
    return isPrivateIPv4(ipv4)
  }
  return false
}

function parseIPv4Hostname(hostname: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (m) {
    const octets = m.slice(1).map(Number)
    if (octets.some(o => Number.isNaN(o) || o > 255)) return null
    return octets
  }
  const mm = /^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.exec(hostname)
  if (mm) {
    const isHex = /^0x/i.test(hostname)
    const isOct = /^0[0-7]+$/i.test(hostname)
    const n = parseInt(hostname, isHex ? 16 : isOct ? 8 : 10)
    if (Number.isNaN(n) || n < 0 || n > 0xffffffff) return null
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
  }
  return null
}

function parseIPv6Hostname(hostname: string): number[] | null {
  let h = hostname.toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (!h.includes(':')) return null
  const parts = h.split('::')
  if (parts.length > 2) return null
  function expandDotted(segs: string[]): string[] | null {
    if (segs.length === 0) return segs
    const last = segs[segs.length - 1]
    if (last.includes('.')) {
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(last)
      if (!m) return null
      const o = m.slice(1).map(Number)
      if (o.some(n => Number.isNaN(n) || n > 255)) return null
      return [...segs.slice(0, -1), ((o[0] << 8) | o[1]).toString(16), ((o[2] << 8) | o[3]).toString(16)]
    }
    return segs
  }
  if (parts.length === 2) {
    let left = parts[0] ? parts[0].split(':') : []
    let right = parts[1] ? parts[1].split(':') : []
    left = expandDotted(left)
    right = expandDotted(right)
    if (left === null || right === null) return null
    const fill = 8 - left.length - right.length
    if (fill < 1) return null
    h = [...left, ...Array(fill).fill('0'), ...right].join(':')
  } else {
    const segs = expandDotted(parts[0].split(':'))
    if (segs === null) return null
    h = segs.join(':')
  }
  const segs = h.split(':')
  if (segs.length !== 8) return null
  const hextets = segs.map(s => {
    const v = parseInt(s, 16)
    return Number.isNaN(v) || v < 0 || v > 0xffff ? null : v
  })
  if (hextets.some(x => x === null)) return null
  return hextets as number[]
}

function isPrivateHost(hostname: string): boolean {
  let lower = hostname.toLowerCase()
  if (lower.startsWith('[') && lower.endsWith(']')) lower = lower.slice(1, -1)
  if (PRIVATE_LITERAL_HOSTS.has(lower)) return true
  const ipv4 = parseIPv4Hostname(lower)
  if (ipv4) return isPrivateIPv4(ipv4)
  const ipv6 = parseIPv6Hostname(lower)
  if (ipv6) return isPrivateIPv6(ipv6)
  return false
}

function isTargetDnsSafeSyncResults(_hostname: string, records: string[]): boolean {
  for (const r of records) {
    if (isPrivateHost(r)) return false
  }
  return true
}

function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin || allowed.length === 0) return false
  return allowed.includes(origin)
}

function buildCorsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = { 'Vary': 'Origin' }
  if (isOriginAllowed(origin, allowed)) {
    headers['Access-Control-Allow-Origin'] = origin!
    headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type'
  }
  return headers
}

function validateUrlShape(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('URL 必须以 http:// 或 https:// 开头')
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) throw new Error('URL 必须以 http:// 或 https:// 开头')
  if (parsed.username || parsed.password) throw new Error('URL 不得包含认证信息')
  if (!ALLOWED_PORTS.has(parsed.port)) throw new Error('仅允许 80/443 端口')
  if (isPrivateHost(parsed.hostname)) throw new Error('不允许访问内网地址')
  return parsed
}
// ── 镜像结束 ──

/** 默认超时 ms（可由环境变量覆盖） */
const DEFAULT_TIMEOUT_MS = parseInt(Deno.env.get('CHECK_LINK_TIMEOUT_MS') || '10000', 10)
/** 重定向最大跳数 */
const MAX_REDIRECTS = 5

/** best-effort DNS 校验：解析 hostname 的 A/AAAA，任一记录落入私有段即拒。
 *  IP 字面量或非域名直接返 true（不查 DNS，已被 validateUrlShape 覆盖）。
 *  resolveDns 不可用或解析失败时返 true（降级，不阻断主路径）。 */
async function _dnsLookupSafe(hostname: string): Promise<boolean> {
  if (hostname === 'localhost') return false
  if (!hostname.includes('.')) return true  // 不是域名
  try {
    const records = await Deno.resolveDns(hostname, 'A').catch(() => [] as string[])
    const records6 = await Deno.resolveDns(hostname, 'AAAA').catch(() => [] as string[])
    return isTargetDnsSafeSyncResults(hostname, [...records, ...records6])
  } catch {
    return true
  }
}

/** 完整 URL 校验：形状 + DNS 重绑定。返回解析后的 URL；违规抛 Error。 */
async function _validateUrl(raw: string): Promise<URL> {
  const parsed = validateUrlShape(raw)
  const dnsSafe = await _dnsLookupSafe(parsed.hostname)
  if (!dnsSafe) throw new Error('目标 DNS 解析到内网地址')
  return parsed
}

/** 手动逐跳 fetch：每跳对 Location 重新走完整 _validateUrl，
 *  命中内网/协议/端口违规或超 MAX_REDIRECTS 即终止。 */
async function _fetchWithRedirectGuard(
  url: URL,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
): Promise<Response> {
  let current = url
  let currentMethod = method
  let lastResponse: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      lastResponse = await fetch(current.href, {
        method: currentMethod,
        signal: controller.signal,
        headers: {
          'User-Agent': 'LinkVault/1.0 CheckLink (+https://github.com/h2629/myWeb)',
        },
      })
    } finally {
      clearTimeout(timeout)
    }

    if (lastResponse.status >= 300 && lastResponse.status < 400) {
      const loc = lastResponse.headers.get('Location')
      if (!loc || hop === MAX_REDIRECTS) return lastResponse
      const nextUrl = new URL(loc, current.href)
      let validated: URL
      try {
        validated = await _validateUrl(nextUrl.href)
      } catch {
        throw new Error('重定向目标不被允许')
      }
      if ([301, 302, 303].includes(lastResponse.status)) currentMethod = 'GET'
      current = validated
      continue
    }
    return lastResponse
  }
  return lastResponse!
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = buildCorsHeaders(origin, ALLOWED_ORIGINS)

  if (req.method === 'OPTIONS') {
    // S9：白名单未命中（或未配置）的预检直接拒，浏览器据此不再发实际请求
    return new Response('ok', { status: isOriginAllowed(origin, ALLOWED_ORIGINS) ? 200 : 403, headers: cors })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    const body: { url?: string; bookmark_id?: string } = await req.json()
    const { url, bookmark_id } = body

    // SSRF 防护：严格校验 URL（含 DNS 重绑定校验）
    let parsedUrl: URL
    try {
      parsedUrl = await _validateUrl(url || '')
    } catch (e: unknown) {
      return new Response(
        JSON.stringify({ error: (e as Error).message || 'Invalid URL' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    const startTime = Date.now()
    let status = 'unknown'
    let http_status = 0
    let details: Record<string, unknown> = {}

    try {
      let response = await _fetchWithRedirectGuard(parsedUrl, 'HEAD', DEFAULT_TIMEOUT_MS)

      // HEAD 被拒时降级为 GET（部分 CDN/服务器不支持 HEAD）
      if (response.status === 405) {
        response = await _fetchWithRedirectGuard(parsedUrl, 'GET', DEFAULT_TIMEOUT_MS)
      }

      http_status = response.status
      const responseTime = Date.now() - startTime

      if (response.status >= 200 && response.status < 400) {
        status = 'alive'
      } else if (response.status >= 400) {
        status = 'dead'
      }

      details = {
        response_time: responseTime,
        final_url: response.url,
      }
    } catch (error: any) {
      const responseTime = Date.now() - startTime

      if (error.name === 'AbortError' || error.message?.includes('abort')) {
        status = 'blocked'
        details = { response_time: responseTime, error: '请求超时或被中断' }
      } else if (error.message === '重定向目标不被允许' || error.message?.includes('内网')) {
        // SSRF 触发：不暴露内部细节，S11 顺手收敛
        status = 'blocked'
        return new Response(
          JSON.stringify({ status, http_status: 0, details: { response_time: responseTime, error: '目标地址被安全策略拒绝' } }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
        )
      } else {
        status = 'dead'
        details = {
          response_time: responseTime,
          error: '请求失败',  // S11：不回传原始 error.message，避免泄露内部主机/路径
        }
      }
    }

    const { error: insertError } = await supabase
      .from('link_check_history')
      .insert({
        user_id: user.id,
        bookmark_id: bookmark_id || '',
        url: parsedUrl.href,
        status,
        http_status,
        response_time: details.response_time,
        details
      })

    if (insertError) {
      console.error('Failed to insert check history:', insertError)
    }

    if (bookmark_id) {
      // SEC-04：先读现有 attributes 再 merge 死链标志，禁止整列覆盖抹掉用户自定义属性
      const { data: existing } = await supabase
        .from('bookmarks')
        .select('attributes')
        .eq('id', bookmark_id)
        .eq('user_id', user.id)
        .maybeSingle()

      const prev =
        existing?.attributes && typeof existing.attributes === 'object' && !Array.isArray(existing.attributes)
          ? (existing.attributes as Record<string, unknown>)
          : {}
      const attrs: Record<string, unknown> = { ...prev }
      if (status === 'dead') {
        attrs['dead-link'] = true
        attrs['gfw-blocked'] = false
      } else if (status === 'blocked') {
        attrs['dead-link'] = false
        attrs['gfw-blocked'] = true
      } else {
        attrs['dead-link'] = false
        attrs['gfw-blocked'] = false
      }

      await supabase
        .from('bookmarks')
        .update({ attributes: attrs })
        .eq('id', bookmark_id)
        .eq('user_id', user.id)
    }

    return new Response(
      JSON.stringify({ status, http_status, details }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('[check-link] internal error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  }
})
