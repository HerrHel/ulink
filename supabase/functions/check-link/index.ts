import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/** 允许的来源：优先取环境变量，缺省仅同源 */
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').filter(Boolean)

const corsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.length
    ? (origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0])
    : (origin || '*'),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
})

/** 默认超时 ms（可由环境变量覆盖） */
const DEFAULT_TIMEOUT_MS = parseInt(Deno.env.get('CHECK_LINK_TIMEOUT_MS') || '10000', 10)

/** 私有/保留 IP 前缀（IPv4） */
function _isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  const privateLiterals = new Set([
    'localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0',
    'metadata.google.internal', 'metadata',
  ])
  if (privateLiterals.has(lower)) return true

  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number)
    if (octets.some(o => Number.isNaN(o) || o > 255)) return true
    // 127.0.0.0/8   — loopback
    if (octets[0] === 127) return true
    // 10.0.0.0/8    — RFC 1918
    if (octets[0] === 10) return true
    // 172.16.0.0/12 — RFC 1918
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
    // 192.168.0.0/16 — RFC 1918
    if (octets[0] === 192 && octets[1] === 168) return true
    // 169.254.0.0/16 — link-local
    if (octets[0] === 169 && octets[1] === 254) return true
  }
  return false
}

/** 校验并解析目标 URL，抛异常则无效 */
function _validateUrl(raw: string): URL {
  if (typeof raw !== 'string' || !raw.startsWith('http://') && !raw.startsWith('https://')) {
    throw new Error('URL 必须以 http:// 或 https:// 开头')
  }
  const parsed = new URL(raw)
  // 禁止带认证信息（user:password@host）
  if (parsed.username || parsed.password) throw new Error('URL 不得包含认证信息')
  // 禁止私有/保留地址
  if (_isPrivateHost(parsed.hostname)) throw new Error('不允许访问内网地址')
  // 禁止非标准端口（仅允许 80 / 443）
  if (parsed.port && !['80', '443', ''].includes(parsed.port)) throw new Error('仅允许 80/443 端口')
  return parsed
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
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

    // SSRF 防护：严格校验 URL
    let parsedUrl: URL
    try {
      parsedUrl = _validateUrl(url || '')
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
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

      let response = await fetch(parsedUrl.href, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'LinkVault/1.0 CheckLink (+https://github.com/h2629/myWeb)'
        }
      })

      // HEAD 被拒时降级为 GET（部分 CDN/服务器不支持 HEAD）
      if (response.status === 405) {
        response = await fetch(parsedUrl.href, {
          method: 'GET',
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'LinkVault/1.0 CheckLink (+https://github.com/h2629/myWeb)'
          }
        })
      }

      clearTimeout(timeout)
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
      } else {
        status = 'dead'
      }

      details = {
        response_time: responseTime,
        error: error.message || 'unknown error'
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
