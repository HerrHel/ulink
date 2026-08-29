import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

/**
 * send-feedback — 应用内反馈表单 → 企业邮箱。
 *
 * 背景：原先「反馈 / 建议」只展示邮箱地址并唤起 `mailto:`，依赖访客本机装有邮件
 * 客户端，桌面端大量用户点了没反应。改为表单提交：前端 POST 到本函数，本函数落库
 * 后经腾讯企业邮 SMTP 投递到 support@ulink.ren。
 *
 * 为什么走 SMTP 而不是 DNS：邮件由本函数**主动**连 smtp.exmail.qq.com 提交，属于
 * 同服务商内部投递，不查询 ulink.ren 的 MX。因此根域 CNAME 遮蔽 MX 的问题（见
 * 2026-08-29 记录）不影响本链路——即使 DNS 未修，反馈邮件照样能到。
 *
 * 防护（接口公网可达，任何人都能 POST）：
 * 1) honeypot 隐藏字段：机器人填了就静默返回成功，不给它反馈信号。
 * 2) Turnstile 人机校验：仅当配置 TURNSTILE_SECRET 时启用（前端需同步放开 CSP）。
 * 3) 按 IP 哈希限流：1 小时 5 条，超限返回 429。
 * 4) 落库优先：即使 SMTP 未配置或发信失败，反馈内容也已存进 feedback_messages，
 *    事后可在 Dashboard 查看或补发，不会丢。
 */

// ── 环境变量（Supabase 自动注入前三个，其余用 `supabase secrets set` 设置）──
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const SMTP_HOST = Deno.env.get("SMTP_HOST") || "smtp.exmail.qq.com"
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465")
const SMTP_USER = Deno.env.get("SMTP_USER") || ""
const SMTP_PASS = Deno.env.get("SMTP_PASS") || ""
/** 收件人（企业邮箱地址）。 */
const FEEDBACK_TO = Deno.env.get("FEEDBACK_TO") || "support@ulink.ren"
/** 发件人：多数 SMTP 要求与登录账号一致，故默认取 SMTP_USER。 */
const FEEDBACK_FROM = Deno.env.get("FEEDBACK_FROM") || SMTP_USER
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET") || ""
/** IP 哈希用的盐，避免哈希值被彩虹表反推。 */
const IP_HASH_SALT = Deno.env.get("IP_HASH_SALT") || "ulink-feedback"
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") || "https://ulink.ren").replace(/\/+$/, "")

const MAX_MESSAGE = 4000
const MAX_CONTACT = 200
const MIN_MESSAGE = 5
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60 * 60 * 1000
/** SMTP 整体超时（连接 + 会话），避免函数挂住。 */
const SMTP_TIMEOUT_MS = 20_000

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

// ── 零依赖 SMTP 客户端（465 隐式 TLS）──
// 不引第三方库：Edge Runtime 的第三方模块版本漂移更难排查，而 SMTP 会话本身很短，
// 只需 EHLO → AUTH → MAIL FROM → RCPT TO → DATA → QUIT 六步。
class SmtpError extends Error {}

function indexOfCRLF(b: Uint8Array): number {
  for (let i = 0; i < b.length - 1; i++) if (b[i] === 13 && b[i + 1] === 10) return i
  return -1
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** 按 CRLF 切行的缓冲读取器：SMTP 应答是多行的（250- 开头表示还有后续行）。 */
class LineReader {
  private buf = new Uint8Array(0)
  private dec = new TextDecoder()
  constructor(private conn: Deno.TlsConn) {}
  private async fill(): Promise<boolean> {
    const chunk = new Uint8Array(4096)
    const n = await this.conn.read(chunk)
    if (n === null) return false
    const next = new Uint8Array(this.buf.length + n)
    next.set(this.buf, 0)
    next.set(chunk.subarray(0, n), this.buf.length)
    this.buf = next
    return true
  }
  async line(): Promise<string> {
    for (;;) {
      const i = indexOfCRLF(this.buf)
      if (i >= 0) {
        const s = this.dec.decode(this.buf.subarray(0, i))
        this.buf = this.buf.subarray(i + 2)
        return s
      }
      if (!(await this.fill())) {
        const rest = this.dec.decode(this.buf)
        this.buf = new Uint8Array(0)
        if (!rest) throw new SmtpError("SMTP connection closed")
        return rest
      }
    }
  }
}

class SmtpSession {
  private conn!: Deno.TlsConn
  private reader!: LineReader
  private enc = new TextEncoder()

  async connect(): Promise<void> {
    this.conn = await Deno.connectTls({ hostname: SMTP_HOST, port: SMTP_PORT })
    this.reader = new LineReader(this.conn)
    await this.readReply() // 220 服务就绪问候语
    await this.cmd("EHLO ulink.ren", [250])
    await this.auth()
  }

  private async readReply(): Promise<{ code: number; text: string }> {
    const lines: string[] = []
    let line = await this.reader.line()
    lines.push(line)
    while (/^\d{3}-/.test(line)) {
      line = await this.reader.line()
      lines.push(line)
    }
    return { code: Number(line.slice(0, 3)), text: lines.join(" ") }
  }

  private async send(raw: string): Promise<void> {
    await this.conn.write(this.enc.encode(raw))
  }

  private async cmd(raw: string, ok: number[]): Promise<string> {
    await this.send(raw + "\r\n")
    const r = await this.readReply()
    if (!ok.includes(r.code)) throw new SmtpError(`${raw.slice(0, 30)} → ${r.code} ${r.text}`)
    return r.text
  }

  /** 先试 AUTH PLAIN，不被接受则回退 AUTH LOGIN（各家服务端支持面不同）。 */
  private async auth(): Promise<void> {
    await this.send(`AUTH PLAIN ${b64(`\u0000${SMTP_USER}\u0000${SMTP_PASS}`)}\r\n`)
    const r = await this.readReply()
    if (r.code === 235) return
    await this.cmd("AUTH LOGIN", [334])
    await this.cmd(b64(SMTP_USER), [334])
    await this.cmd(b64(SMTP_PASS), [235])
  }

  async sendMail(from: string, to: string, replyTo: string, mime: string): Promise<void> {
    await this.cmd(`MAIL FROM:<${from}>`, [250])
    await this.cmd(`RCPT TO:<${to}>`, [250, 251])
    await this.cmd("DATA", [354])
    // SMTP 以「行首一个点」表示正文结束，正文里的行首点必须转义成两个点
    await this.send(mime.replace(/\r\n\./g, "\r\n..") + "\r\n.\r\n")
    const done = await this.readReply()
    if (done.code !== 250) throw new SmtpError(`DATA → ${done.code} ${done.text}`)
  }

  async quit(): Promise<void> {
    try {
      await this.cmd("QUIT", [221])
    } catch {
      /* 退出失败不影响投递结果 */
    }
  }
  close(): void {
    try {
      this.conn?.close()
    } catch {
      /* 已关闭 */
    }
  }
}

function wrapBase64(s: string): string {
  return (s.match(/.{1,76}/g) || []).join("\r\n")
}

/** 组装邮件报文：UTF-8 主题用 RFC 2047 编码，正文用 base64 传输编码。 */
function buildMime(subject: string, body: string, from: string, to: string, replyTo: string): string {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@ulink.ren>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ]
  if (replyTo) headers.push(`Reply-To: ${replyTo}`)
  return headers.join("\r\n") + "\r\n\r\n" + wrapBase64(b64(body)) + "\r\n"
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new SmtpError(`${label} timeout after ${ms}ms`)), ms)),
  ])
}

// ── 辅助 ──
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

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (!token) return false
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: ip }),
    })
    const data = (await res.json().catch(() => ({}))) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200
}

function buildBody(f: { id: string; at: string; contact: string; locale: string; appVersion: string; ipHash: string; ua: string; message: string }): string {
  return [
    "与链 · ulink 用户反馈",
    "",
    `时间：${f.at}`,
    `联系方式：${f.contact || "（未填写）"}`,
    `语言：${f.locale || "未知"}`,
    `版本：${f.appVersion || "未知"}`,
    `IP 哈希：${f.ipHash}`,
    `浏览器：${f.ua || "未知"}`,
    `记录 ID：${f.id}`,
    `站点：${APP_ORIGIN}`,
    "",
    "────── 反馈内容 ──────",
    f.message,
    "",
  ].join("\r\n")
}

// ── 主流程 ──
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  let payload: Record<string, unknown>
  try {
    payload = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: "invalid_json" }, 400)
  }

  const message = String(payload.message ?? "").trim()
  const contact = String(payload.contact ?? "").trim()
  const locale = String(payload.locale ?? "").slice(0, 20)
  const appVersion = String(payload.appVersion ?? "").slice(0, 40)
  const turnstileToken = String(payload.turnstileToken ?? "").trim()
  // honeypot：正常用户看不到这个字段，填了即为机器人
  const honeypot = String(payload.website ?? "").trim()

  if (honeypot) return json({ ok: true, skipped: true })
  if (message.length < MIN_MESSAGE) return json({ error: "message_too_short" }, 400)
  if (message.length > MAX_MESSAGE) return json({ error: "message_too_long" }, 400)
  if (contact.length > MAX_CONTACT) return json({ error: "contact_too_long" }, 400)

  const ip = clientIp(req)
  const ipHash = await sha256Hex(`${ip}|${IP_HASH_SALT}`)

  if (TURNSTILE_SECRET && !(await verifyTurnstile(turnstileToken, ip))) {
    return json({ error: "captcha_failed" }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // 限流：同 IP 一小时内的提交数
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
  const { count, error: countErr } = await admin
    .from("feedback_messages")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since)
  if (countErr) return json({ error: "rate_check_failed" }, 500)
  if ((count ?? 0) >= RATE_LIMIT) return json({ error: "rate_limited" }, 429)

  const { data: row, error: insErr } = await admin
    .from("feedback_messages")
    .insert({
      message,
      contact: contact || null,
      ip_hash: ipHash,
      user_agent: (req.headers.get("user-agent") || "").slice(0, 400) || null,
      locale: locale || null,
      app_version: appVersion || null,
    })
    .select("id")
    .single()
  if (insErr || !row) return json({ error: "store_failed" }, 500)

  // 发信：失败不影响已落库的反馈内容
  let mailSent = false
  let mailError: string | null = null
  if (SMTP_USER && SMTP_PASS && FEEDBACK_TO) {
    const session = new SmtpSession()
    try {
      const at = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
      const body = buildBody({
        id: String(row.id),
        at,
        contact,
        locale,
        appVersion,
        ipHash,
        ua: req.headers.get("user-agent") || "",
        message,
      })
      const mime = buildMime(
        `与链 ulink · 用户反馈${contact ? `（${contact}）` : ""}`,
        body,
        FEEDBACK_FROM,
        FEEDBACK_TO,
        looksLikeEmail(contact) ? contact : "",
      )
      await withTimeout(
        (async () => {
          await session.connect()
          await session.sendMail(FEEDBACK_FROM, FEEDBACK_TO, looksLikeEmail(contact) ? contact : "", mime)
          await session.quit()
        })(),
        SMTP_TIMEOUT_MS,
        "SMTP",
      )
      mailSent = true
    } catch (e) {
      mailError = String((e as Error)?.message ?? e).slice(0, 500)
    } finally {
      session.close()
    }
  } else {
    mailError = "smtp_not_configured"
  }

  await admin.from("feedback_messages").update({ mail_sent: mailSent, mail_error: mailError }).eq("id", row.id)

  return json({ ok: true, mailSent })
})
