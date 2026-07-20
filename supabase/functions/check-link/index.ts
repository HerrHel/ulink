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

/** HEAD 常被 CDN/WAF 拒或假报；这些状态应再试 GET */
function shouldRetryAsGet(code: number): boolean {
  // 404：不少站 HEAD 直接 404、GET 正常；401/403：反爬对 HEAD 更严
  return [400, 401, 403, 404, 405, 501].includes(code)
}

/** 手动 redirect 链的结构化结果：finalUrl 为最后一次请求 URL（每跳已 SSRF 校验）；
 *  methodUsed 为终 hop 实际 method（链中可能已从 HEAD 升 GET）。 */
type FetchGuardResult = {
  response: Response
  finalUrl: URL
  methodUsed: 'HEAD' | 'GET'
}

function isAbortError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null
  return e?.name === 'AbortError' || !!e?.message?.includes('abort')
}

/** SSRF 策略拒绝的两种来源，拆开以分别映射 fetch_outcome：
 *  - 私网拒绝（原始 URL 或 DNS 解析到内网）→ ssrf_reject
 *  - 重定向目标不被允许 → redirect_denied
 *  保持与 ssrf-guard.ts 语义一致。 */
function isPrivateReject(error: unknown): boolean {
  const msg = (error as { message?: string } | null)?.message || ''
  return msg.includes('内网') || msg === '不允许访问内网地址' || msg === '目标 DNS 解析到内网地址'
}

function isRedirectDenied(error: unknown): boolean {
  return (error as { message?: string } | null)?.message === '重定向目标不被允许'
}

/** DNS 校验：解析 hostname 的 A/AAAA，任一记录落入私有段即拒。
 *  H6：解析失败 / resolveDns 不可用时改为拒绝（fail-closed），不再 best-effort 放行。
 *  避免解析能力受限时跳过私网校验、以及 DNS 重绑定窗口下「校验失败仍 fetch」的放大。
 *  域名解析到 0 条 A/AAAA 也拒（无公网目标可连）。
 *  IP 字面量不查 DNS（已由 validateUrlShape 覆盖）。 */
async function _dnsLookupSafe(hostname: string): Promise<boolean> {
  if (hostname === 'localhost') return false
  // 非域名（IP 字面量等）已由 validateUrlShape 校验
  if (!hostname.includes('.')) return true
  try {
    const [records, records6] = await Promise.all([
      Deno.resolveDns(hostname, 'A').catch(() => [] as string[]),
      Deno.resolveDns(hostname, 'AAAA').catch(() => [] as string[]),
    ])
    const all = [...records, ...records6]
    if (all.length === 0) return false  // 无解析结果 → 拒
    return isTargetDnsSafeSyncResults(hostname, all)
  } catch {
    return false  // H6：解析异常 → 拒，不再 fail-open
  }
}

/** 完整 URL 校验：形状 + DNS 重绑定。返回解析后的 URL；违规抛 Error。 */
async function _validateUrl(raw: string): Promise<URL> {
  const parsed = validateUrlShape(raw)
  const dnsSafe = await _dnsLookupSafe(parsed.hostname)
  if (!dnsSafe) throw new Error('目标 DNS 解析到内网地址')
  return parsed
}

const BROWSER_UA =
  'Mozilla/5.0 (compatible; LinkVaultCheck/1.1; +https://github.com/HerrHel/HerrHel.github.io)'

/** 手动逐跳 fetch：redirect:manual，每跳对 Location 重新走完整 _validateUrl，
 *  命中内网/协议/端口违规或超 MAX_REDIRECTS 即终止。
 *  返回 finalUrl/methodUsed，供 HEAD 降级 GET 时从已到达终 URL 单趟重试，避免双全链。 */
async function _fetchWithRedirectGuard(
  url: URL,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
): Promise<FetchGuardResult> {
  let current = url
  let currentMethod = method
  let lastResponse: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      lastResponse = await fetch(current.href, {
        method: currentMethod,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })
    } finally {
      clearTimeout(timeout)
    }

    if (lastResponse.status >= 300 && lastResponse.status < 400) {
      const loc = lastResponse.headers.get('Location')
      if (!loc || hop === MAX_REDIRECTS) {
        return { response: lastResponse, finalUrl: current, methodUsed: currentMethod }
      }
      const nextUrl = new URL(loc, current.href)
      let validated: URL
      try {
        validated = await _validateUrl(nextUrl.href)
      } catch {
        throw new Error('重定向目标不被允许')
      }
      // 303 必须改 GET；301/302 对 HEAD 多数站点期望 GET
      if ([301, 302, 303].includes(lastResponse.status) || currentMethod === 'HEAD') {
        currentMethod = 'GET'
      }
      current = validated
      continue
    }
    return { response: lastResponse, finalUrl: current, methodUsed: currentMethod }
  }
  return { response: lastResponse!, finalUrl: current, methodUsed: currentMethod }
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
    // evidence API：只回 fetch_outcome + http_status，不回产品 verdict。
    // history 只写 fetch_outcome（契约列）；HTTP 分类与属性写入均在客户端。
    let fetch_outcome: 'ok' | 'timeout' | 'connect_error' | 'ssrf_reject' | 'redirect_denied' = 'connect_error'
    let http_status = 0
    let details: Record<string, unknown> = {}

    try {
      let result: FetchGuardResult
      try {
        result = await _fetchWithRedirectGuard(parsedUrl, 'HEAD', DEFAULT_TIMEOUT_MS)
        // HEAD 终 hop 仍被 CDN/WAF/不支持时，从已校验的 finalUrl 单趟 GET（跳过中间 redirect）。
        // 若链中已升 GET（methodUsed==='GET'），不再从原 URL 双全链重跑。
        if (result.methodUsed === 'HEAD' && shouldRetryAsGet(result.response.status)) {
          result = await _fetchWithRedirectGuard(result.finalUrl, 'GET', DEFAULT_TIMEOUT_MS)
        }
      } catch (headErr) {
        // HEAD 网络层失败再试 GET（无 finalUrl，从原始 URL）；超时/SSRF 直接上抛
        if (isAbortError(headErr) || isPrivateReject(headErr) || isRedirectDenied(headErr)) throw headErr
        result = await _fetchWithRedirectGuard(parsedUrl, 'GET', DEFAULT_TIMEOUT_MS)
      }

      http_status = result.response.status
      fetch_outcome = 'ok'
      details = {
        response_time: Date.now() - startTime,
        // redirect:manual 时 response.url 常不可靠，用结构化 finalUrl
        final_url: result.finalUrl.href,
      }
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime

      if (isAbortError(error)) {
        // 超时：不暴露 verdict，仅回 timeout evidence
        fetch_outcome = 'timeout'
        details = { response_time: responseTime, error: '请求超时或被中断' }
      } else if (isRedirectDenied(error)) {
        // 重定向目标违规
        fetch_outcome = 'redirect_denied'
        return new Response(
          JSON.stringify({ fetch_outcome, http_status: 0, details: { response_time: responseTime, error: '目标地址被安全策略拒绝' } }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
        )
      } else if (isPrivateReject(error)) {
        // SSRF 私网拒绝
        fetch_outcome = 'ssrf_reject'
        return new Response(
          JSON.stringify({ fetch_outcome, http_status: 0, details: { response_time: responseTime, error: '目标地址被安全策略拒绝' } }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
        )
      } else {
        // DNS/TLS/连接失败 → connect_error（不再标 dead；客户端结合本机可达信号判定）
        fetch_outcome = 'connect_error'
        details = {
          response_time: responseTime,
          error: '请求失败',  // S11：不回传原始 error.message，避免泄露内部主机/路径
        }
      }
    }

    // fetch_outcome 为 history 唯一契约列；客户端独占属性写入。
    const { error: insertError } = await supabase
      .from('link_check_history')
      .insert({
        user_id: user.id,
        bookmark_id: bookmark_id || '',
        url: parsedUrl.href,
        fetch_outcome,
        http_status,
        response_time: details.response_time,
        details
      })

    if (insertError) {
      console.error('Failed to insert check history:', insertError)
    }

    return new Response(
      JSON.stringify({ fetch_outcome, http_status, details }),
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
