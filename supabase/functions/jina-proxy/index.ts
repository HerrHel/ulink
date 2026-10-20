import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateInputUrl, isUrlDnsSafe } from '../extract-video/video-adapters.ts'
import {
  isOriginAllowed,
  buildCorsHeaders,
} from '../check-link/ssrf-guard.ts'

/**
 * jina-proxy — 通用页面读取（r.jina.ai）服务端转发
 *
 * 背景：页面/视频读取的降级链路原先由前端直连 r.jina.ai，与「抓取必须经服务端转发、
 * 不得前端直连」的约束冲突（2026-10-20 决策：降级改为服务端转发，取消前端直连例外）。
 * 职责：把目标 URL 经本 Function 转发给 r.jina.ai 读取为 Markdown 文本，前端零直连第三方。
 *
 * 防护（对齐 extract-video / check-link 转发层口径）：
 * 1. 鉴权：Authorization 必带 + getUser 校验（config.toml verify_jwt = true 双保险）；
 * 2. 每用户限流（034 consume_rate_limit，fail-closed——转发层不做 fail-open）；
 * 3. SSRF：validateInputUrl（形状/协议/端口/字面私网）+ isUrlDnsSafe（DNS fail-closed），
 *    真源复用 extract-video/video-adapters.ts 与 check-link/ssrf-guard.ts；
 * 4. CORS fail-closed + 上游超时 + 客户端断连取消上游 + 读取长度上限。
 *
 * 能力边界：只读取公开可读页面文本，不做 ASR / OCR。
 * 隐私：目标 URL 会发送给第三方 r.jina.ai（前端每次触发前以 toast 向用户披露）。
 *
 * secrets（supabase secrets set）：
 *   ALLOWED_ORIGINS / JINA_PROXY_RATE_LIMIT_PER_MIN / JINA_PROXY_TIMEOUT_MS
 */

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').filter(Boolean)
/** 每用户限流（次/分钟），默认 60：页面读取是低频降级/补齐操作，更高频视为滥用 */
const RATE_LIMIT_PER_MIN = parseInt(Deno.env.get('JINA_PROXY_RATE_LIMIT_PER_MIN') || '60', 10)
/** 单次上游抓取超时（ms） */
const UPSTREAM_TIMEOUT_MS = parseInt(Deno.env.get('JINA_PROXY_TIMEOUT_MS') || '12000', 10)
/** 读取长度上限（字符）：与 extract-video 通用降级路径同口径，覆盖视频字幕/评论区深挖 */
const READ_MAX_CHARS = 30000

/** Deno DNS resolver 注入（isUrlDnsSafe 可测性：纯逻辑侧不直接依赖 Deno API） */
const denoDnsResolver = {
  resolve: (hostname: string, type: 'A' | 'AAAA') => Deno.resolveDns(hostname, type),
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = buildCorsHeaders(origin, ALLOWED_ORIGINS)
  const jsonHeaders = { ...cors, 'Content-Type': 'application/json' }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: isOriginAllowed(origin, ALLOWED_ORIGINS) ? 200 : 403, headers: cors })
  }

  // 客户端断连 / 函数终止 → 取消上游抓取
  const upstreamAbort = new AbortController()
  const onClientAbort = () => upstreamAbort.abort()
  req.signal.addEventListener('abort', onClientAbort)
  Deno.addSignalListener?.('SIGTERM', onClientAbort)

  try {
    // 鉴权（对齐 extract-video / check-link / mimo-chat）
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
    }

    // 限流 fail-closed：本 Function 会代用户发起出站请求，fail-open 会被滥用成
    // 无上限的外呼放大器，宁可暂时不可用也不无限放行（与 extract-video / mimo-chat 同口径）
    const { data: rlAllowed, error: rlError } = await supabase.rpc('consume_rate_limit', {
      p_key: `jina-proxy:${user.id}`,
      p_limit: RATE_LIMIT_PER_MIN,
      p_window_secs: 60,
    })
    if (rlError) {
      console.error('[jina-proxy] rate limit rpc failed (fail-closed):', rlError)
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable' }),
        { status: 503, headers: jsonHeaders }
      )
    }
    if (rlAllowed === false) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded' }),
        { status: 429, headers: { ...jsonHeaders, 'Retry-After': '60' } }
      )
    }

    let body: { url?: unknown }
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders })
    }
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''

    // SSRF 防护：形状/协议/端口/字面私网校验 + DNS 重绑定校验（fail-closed）
    let parsed: URL
    try {
      parsed = validateInputUrl(rawUrl)
    } catch (e) {
      return new Response(
        JSON.stringify({ error: (e as Error).message || 'Invalid URL' }),
        { status: 400, headers: jsonHeaders }
      )
    }
    if (!(await isUrlDnsSafe(parsed, denoDnsResolver))) {
      return new Response(
        JSON.stringify({ error: '不允许访问内网地址' }),
        { status: 400, headers: jsonHeaders }
      )
    }

    // 服务端转发 r.jina.ai 读取（前端零直连第三方）
    try {
      const res = await fetch(`https://r.jina.ai/${parsed.href}`, {
        headers: { 'Accept': 'text/markdown, text/plain, */*', 'X-No-Cache': 'true' },
        signal: AbortSignal.any([upstreamAbort.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      })
      if (res.ok) {
        const text = await res.text()
        if (text && text.trim()) {
          return new Response(
            JSON.stringify({ url: parsed.href, text: text.slice(0, READ_MAX_CHARS) }),
            { status: 200, headers: jsonHeaders }
          )
        }
      }
      // 空内容/非 2xx：如实回错误，交客户端诚实失败（不伪造内容）
      return new Response(
        JSON.stringify({ error: `页面读取失败 (HTTP ${res.status})` }),
        { status: 502, headers: jsonHeaders }
      )
    } catch {
      return new Response(
        JSON.stringify({ error: '页面读取超时或网络异常' }),
        { status: 502, headers: jsonHeaders }
      )
    }
  } catch (error) {
    console.error('[jina-proxy] internal error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: jsonHeaders })
  } finally {
    req.signal.removeEventListener('abort', onClientAbort)
  }
})
