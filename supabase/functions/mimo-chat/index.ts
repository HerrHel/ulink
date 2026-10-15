import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  validateChatBody,
  isOriginAllowed,
  buildCorsHeaders,
} from './mimo-guard.ts'

/**
 * mimo-chat — 小米 MiMo 大模型的服务端安全转发（密钥永不出后端）
 *
 * 职责：
 * 1. 代理 /chat/completions（SSE 流式透传），客户端不再接触 MIMO_API_KEY；
 * 2. CORS fail-closed（对齐 check-link/ssrf-guard 的 S9 策略）；
 * 3. Supabase 鉴权 + 每用户限流（复用 034 consume_rate_limit），限流故障 fail-closed；
 * 4. 请求体校验/预算/白名单走 mimo-guard.ts 纯逻辑（可单测），上游 fetch 带超时，
 *    客户端断连/函数终止即取消上游，避免断连后继续烧配额。
 *
 * secrets（supabase secrets set）：
 *   MIMO_API_KEY（必填）/ MIMO_BASE_URL（默认 https://api.xiaomimimo.com/v1）
 *   MIMO_MODEL（默认 mimo-v2.6-flash）/ MIMO_ALLOWED_MODELS（逗号分隔可选白名单）
 *   ALLOWED_ORIGINS / MIMO_CHAT_RATE_LIMIT_PER_MIN / MIMO_CHAT_TIMEOUT_MS
 */

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').filter(Boolean)
const MIMO_API_KEY = Deno.env.get('MIMO_API_KEY') || ''
const MIMO_BASE_URL = (Deno.env.get('MIMO_BASE_URL') || 'https://api.xiaomimimo.com/v1').replace(/\/+$/, '')
const MIMO_MODEL = Deno.env.get('MIMO_MODEL') || 'mimo-v2.6-flash'
const ALLOWED_MODELS = (Deno.env.get('MIMO_ALLOWED_MODELS') || '').split(',').map(s => s.trim()).filter(Boolean)
/** 每用户限流（次/分钟），默认 30：AI 对话是低频重操作，更高频视为滥用 */
const RATE_LIMIT_PER_MIN = parseInt(Deno.env.get('MIMO_CHAT_RATE_LIMIT_PER_MIN') || '30', 10)
/** 上游首响应超时（ms）；流式输出可超过此值，仅约束等待首字节 */
const UPSTREAM_TIMEOUT_MS = parseInt(Deno.env.get('MIMO_CHAT_TIMEOUT_MS') || '60000', 10)

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = buildCorsHeaders(origin, ALLOWED_ORIGINS)
  const jsonHeaders = { ...cors, 'Content-Type': 'application/json' }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: isOriginAllowed(origin, ALLOWED_ORIGINS) ? 200 : 403, headers: cors })
  }

  // 上游取消链路：客户端断连 / 函数终止 → abort 上游 fetch，不再空耗配额
  const upstreamAbort = new AbortController()
  const onClientAbort = () => upstreamAbort.abort()
  req.signal.addEventListener('abort', onClientAbort)
  Deno.addSignalListener?.('SIGTERM', onClientAbort)

  try {
    if (!MIMO_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI 服务未配置（服务端缺少 MIMO_API_KEY）' }),
        { status: 503, headers: jsonHeaders }
      )
    }

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

    // 每用户限流；RPC 故障 fail-closed——转发计费通道宁可暂时不可用，也不无限放行
    const { data: rlAllowed, error: rlError } = await supabase.rpc('consume_rate_limit', {
      p_key: `mimo-chat:${user.id}`,
      p_limit: RATE_LIMIT_PER_MIN,
      p_window_secs: 60,
    })
    if (rlError) {
      console.error('[mimo-chat] rate limit rpc failed (fail-closed):', rlError)
      return new Response(
        JSON.stringify({ error: 'AI 服务暂时不可用，请稍后再试' }),
        { status: 503, headers: jsonHeaders }
      )
    }
    if (rlAllowed === false) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded' }),
        { status: 429, headers: { ...jsonHeaders, 'Retry-After': '60' } }
      )
    }

    // 请求体校验 + token 预算 + model 真白名单（纯逻辑见 mimo-guard.ts）
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders })
    }
    const guard = validateChatBody(body, {
      defaultModel: MIMO_MODEL,
      allowedModels: ALLOWED_MODELS,
    })
    if (!guard.ok) {
      return new Response(JSON.stringify({ error: guard.error }), { status: guard.status, headers: jsonHeaders })
    }

    const upstream = await fetch(`${MIMO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MIMO_API_KEY}`,
      },
      body: JSON.stringify(guard.value),
      signal: AbortSignal.any([upstreamAbort.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '')
      // S11：不透传上游原始错误体（可能含 key 片段），只回状态码
      console.error('[mimo-chat] upstream failed:', upstream.status, errText.slice(0, 200))
      return new Response(
        JSON.stringify({ error: `AI 服务请求失败 (${upstream.status})` }),
        { status: 502, headers: jsonHeaders }
      )
    }

    // SSE 流式透传（含 text/event-stream 头），前端解析逻辑零改动
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('[mimo-chat] internal error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: jsonHeaders }
    )
  } finally {
    req.signal.removeEventListener('abort', onClientAbort)
  }
})
