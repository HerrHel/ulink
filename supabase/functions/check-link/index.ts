import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
/**
 * SSRF 校验纯逻辑（无 Deno 依赖，可被 vitest 单测）。
 * 同目录相对 import，Edge Function 部署整目录上传即可生效。
 */
import {
  isPrivateHost,
  isTargetDnsSafeSyncResults,
  validateUrlShape,
  isOriginAllowed,
  buildCorsHeaders,
} from './ssrf-guard.ts'

/**
 * S7：SSRF 防护重构。
 *
 * 三条历史漏洞：
 *  1) _isPrivateHost 只做字面/点分十进制匹配 → 漏 IPv6 私有段、IPv4-mapped IPv6、
 *     十进制整数 IP（2130706433 ≡ 127.0.0.1）。
 *  2) 仅校验首跳 host → redirect:'follow' 跟随跳转，首跳合法、后续 302 跳到
 *     169.254.169.254（云元数据）/内网即可打穿。
 *  3) DNS 重绑定：合法域名解析落到 127.0.0.1 等内网 IP，字面校验拦不住。
 *
 * 本实现三层防御：
 *  一、validateUrlShape 全量 host 校验——点分十进制 / 十进制整数 / IPv6（含映射）全覆盖。
 *  二、重定向逐跳校验——fetch 每跳对 Location 重新走完整 validateUrl，
 *      命中内网地址或超 5 跳即终止，杜绝「首跳合法后续跳内网」。
 *  三、DNS 增强校验（best-effort）——Deno.resolveDns 解析 A/AAAA，逐条复用
 *      isPrivateHost 判定；resolveDns 不可用则降级，不阻断核心防护。
 */

/**
 * S9：CORS 缺省 fail-closed 收紧。
 * 历史 fail-open：ALLOWED_ORIGINS 为空时回退 origin || '*'，任意 Origin 被放通，
 * 受认证保护的端点可被任意站点跨域调用（配合 S4 令牌泄露链式利用）。
 * 现策略：缺省拒绝跨域——仅配置白名单且 origin 命中才放通，否则不带
 * Access-Control-Allow-Origin 头（浏览器据此阻断跨域）。
 * 判定与头构造逻辑抽到 ssrf-guard.ts（buildCorsHeaders / isOriginAllowed），可单测。
 */
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').filter(Boolean)

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
      const attrs: Record<string, unknown> = {}
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
