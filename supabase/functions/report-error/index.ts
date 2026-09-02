import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

/**
 * report-error — 客户端运行时错误上报（error_logs 唯一写入通道）。
 *
 * 背景（docs/BACKEND_AUDIT.md P1-4 方案 B）：error_logs 原允许匿名直插表
 * （INSERT 策略 user_id IS NULL OR = auth.uid()），任何人可绕过客户端节流
 * 无限 POST /rest/v1/error_logs。028 加了 DB 层全局熔断（1min/200）止损，
 * 本函数是根治：匿名直插策略撤除后，错误上报统一走本函数，服务端按 IP
 * 哈希限流 + service_role 落库。
 *
 * 防护（函数公网可达，任何人都能 POST）：
 * 1) 按 IP 哈希限流：1 分钟 30 条（DB 计数，error_logs.ip_hash 列 + 索引，
 *    跨实例一致；计数查询失败 fail-closed 拒收），超限 429。
 *    DB 计数而非实例内存——Supabase Edge Function 多实例无粘性路由，
 *    内存 Map 粒度会随实例数放大（首版实测 35 连发全过，证实失效）。
 * 2) H9 含密兜底：message/stack 含 JWT/API key/password 等直接丢弃
 *    （前端 errorReporter 已做一层，此处服务端兜底，逻辑镜像自
 *    src/lib/errorReporter.ts 的 _SECRET_RE，请保持同步）。
 * 3) 字段裁剪：对齐 error_logs 表 016 的 CHECK 语义与前端 slice 上限。
 * 4) user_id 防伪造：忽略客户端传入的 user_id；仅当请求带有效
 *    Authorization 时才解析真实 uid，否则落 NULL。
 * 5) DB 层 028 全局熔断（1min/200，BEFORE INSERT 触发器对 service_role
 *    同样生效）作为最终兜底——即使限流被绕过也钉死在可控上限。
 *
 * 部署：supabase functions deploy report-error --project-ref <ref>
 * config.toml 已声明本函数 verify_jwt = false。
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
/** IP 哈希盐：独立于 send-feedback 的盐，防跨接口关联。 */
const IP_HASH_SALT = Deno.env.get("IP_HASH_SALT") || "ulink-report-error"

const RATE_PER_IP = 30
const RATE_WINDOW_MS = 60_000

// 字段上限（与 errorReporter.ts 的 slice 一致 + 表 016 CHECK 语义）
const LIMIT = { message: 1000, stack: 5000, component: 200, url: 2048, user_agent: 1024 }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  })
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || ""
  const first = xff.split(",")[0]?.trim()
  return first || req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "unknown"
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// ── H9 含密兜底：镜像自 src/lib/errorReporter.ts 的 _SECRET_RE，请保持同步 ──
const SECRET_RE = /(?:Bearer\s+[A-Za-z0-9\-._~+/]+=*|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|password\s*[:=]\s*\S+|apikey\s*[:=]\s*\S+)/i
function looksLikeSecret(text: string): boolean {
  return !!text && SECRET_RE.test(text)
}

const trunc = (s: string, n: number): string => (s || "").slice(0, n)

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  // 基本环境校验：缺 service role 属部署错误，fail-closed
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[report-error] missing env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    return json({ error: "not_configured" }, 500)
  }

  let payload: Record<string, unknown>
  try {
    payload = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: "invalid_json" }, 400)
  }

  const message = trunc(String(payload.message ?? "").trim(), LIMIT.message)
  const stack = trunc(String(payload.stack ?? ""), LIMIT.stack)
  const component = trunc(String(payload.component ?? ""), LIMIT.component)
  const url = trunc(String(payload.url ?? ""), LIMIT.url)
  const userAgent = trunc(String(payload.user_agent ?? "") || (req.headers.get("user-agent") || ""), LIMIT.user_agent)

  if (!message) return json({ error: "message_required" }, 400)

  // H9：含密丢弃（服务端兜底）
  if (looksLikeSecret(message) || looksLikeSecret(stack)) {
    return json({ ok: true, dropped: "secret_like" })
  }

  const ip = clientIp(req)
  const ipHash = await sha256Hex(`${ip}|${IP_HASH_SALT}`)

  // DB 计数限流（error_logs.ip_hash 由迁移 030 提供；计数失败 fail-closed）
  const adminRate = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
  const { count, error: countErr } = await adminRate
    .from("error_logs")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since)
  if (countErr) {
    console.error("[report-error] rate check failed:", countErr)
    return json({ error: "rate_check_failed" }, 500)
  }
  if ((count ?? 0) >= RATE_PER_IP) {
    return json({ error: "rate_limited", retry_after_s: RATE_WINDOW_MS / 1000 }, 429)
  }

  // user_id：仅信任有效 JWT 解析结果；客户端传入的 user_id 一律忽略（防伪造）
  let userId: string | null = null
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || ""
  if (authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7)
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: authHeader } },
      })
      const { data, error } = await userClient.auth.getUser(token)
      if (!error && data?.user?.id) userId = data.user.id
    } catch {
      userId = null // token 无效视为匿名
    }
  }

  const { error: insErr } = await adminRate.from("error_logs").insert({
    user_id: userId,
    message,
    stack: stack || null,
    component: component || null,
    url: url || null,
    user_agent: userAgent || null,
    ip_hash: ipHash,
  })

  if (insErr) {
    console.error("[report-error] insert failed:", insErr)
    return json({ error: "store_failed" }, 500)
  }
  return json({ ok: true })
})
