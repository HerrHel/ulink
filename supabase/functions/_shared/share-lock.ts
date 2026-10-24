/**
 * 分享访问密码：哈希、校验、以及「已验密」票据的签名与验证
 *
 * 真源唯一，派生到 cloudbase/functions/share-ssr/share-lock.js（esbuild --bundle）。
 *
 * 安全设计：
 * 1) 密码用 **scrypt** 存摘要（内存硬，抗 GPU 爆破），格式 `scrypt$N$r$p$saltB64$hashB64`；
 * 2) 摘要**不等于**可用凭证——校验时必须提供明文密码，因此库被拖走也无法直接复用；
 * 3) 比对用 timingSafeEqual，避免按字节提前返回泄露信息；
 * 4) 「已验密」状态用 **HMAC 票据**（含 gid + 过期时间）存 cookie，密钥来自环境变量
 *    `SHARE_LOCK_SECRET`（每函数独立）。密钥缺失时 fail-closed：带密码的分享直接不可用，
 *    绝不降级为「无密码放行」；
 * 5) 票据绑定 gid：A 组的票据无法用于 B 组。
 *
 * 零第三方依赖（只用 node:crypto），可被 vitest 直测。
 */

import { randomBytes, scryptSync, timingSafeEqual, createHmac, createHash } from 'node:crypto'

/** scrypt 成本参数：N=2^14, r=8, p=1 → 单次约 16MB 内存，Node 默认 maxmem 内 */
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32
const SALT_LEN = 16
/** 票据有效期：24 小时（访客不必每次访问都重输） */
export const TICKET_TTL_SEC = 24 * 60 * 60

/** 密码策略：最短 4 位（分享场景，不追求强口令），最长 128 防滥用 */
export const PASSWORD_MIN_LEN = 4
export const PASSWORD_MAX_LEN = 128

export interface PasswordPolicyResult {
  ok: boolean
  reason?: 'too_short' | 'too_long' | 'not_string'
}

export function validatePasswordInput(pw: unknown): PasswordPolicyResult {
  if (typeof pw !== 'string') return { ok: false, reason: 'not_string' }
  if (pw.length < PASSWORD_MIN_LEN) return { ok: false, reason: 'too_short' }
  if (pw.length > PASSWORD_MAX_LEN) return { ok: false, reason: 'too_long' }
  return { ok: true }
}

/** 生成 scrypt 摘要。格式固定，便于将来换参时按前缀识别旧格式。 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN)
  const key = scryptSync(password.normalize('NFKC'), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`
}

/**
 * 校验密码。任何解析失败、格式不符一律返回 false（fail-closed）。
 * 用 timingSafeEqual 比较，长度不等时先做等长化再比，避免长度侧信道。
 */
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (typeof password !== 'string' || !stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false
  // 上限保护：防止被塞入超大参数导致 CPU 打满（拒绝服务）
  if (N > 1 << 20 || r > 32 || p > 16) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4], 'base64')
    expected = Buffer.from(parts[5], 'base64')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false

  let actual: Buffer
  try {
    actual = scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * 1024 * 1024,
    })
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

// ── 票据（cookie 值）───────────────────────────────────────────────────

/** 票据格式：`v1.<过期秒>.<hmac>`，hmac = HMAC-SHA256(secret, `v1|gid|exp`) */
export function makeTicket(gid: string, secret: string, nowMs?: number, ttlSec = TICKET_TTL_SEC): string {
  if (!secret) throw new Error('SHARE_LOCK_SECRET 未配置')
  const exp = Math.floor((nowMs ?? Date.now()) / 1000) + ttlSec
  const sig = createHmac('sha256', secret).update(`v1|${gid}|${exp}`).digest('base64url')
  return `v1.${exp}.${sig}`
}

/** 校验票据：签名必须匹配、必须未过期、必须属于同一 gid。任一不满足返回 false。 */
export function checkTicket(
  ticket: string | null | undefined,
  gid: string,
  secret: string,
  nowMs?: number,
): boolean {
  if (!ticket || !secret) return false
  const parts = ticket.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return false

  const exp = Number(parts[1])
  if (!Number.isFinite(exp)) return false
  // 过期判定留 30s 容差，避免实例间时钟微偏导致刚签发的票据被拒
  if (exp * 1000 + 30_000 < (nowMs ?? Date.now())) return false

  const expected = createHmac('sha256', secret).update(`v1|${gid}|${exp}`).digest('base64url')
  const a = Buffer.from(parts[2])
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * cookie 名：由 gid 派生固定短名，避免 gid 直接进 cookie 名（长度/字符集风险），
 * 同时让同一浏览器的多个分享互不干扰。
 */
export function ticketCookieName(gid: string): string {
  const h = createHash('sha256').update(String(gid)).digest('hex').slice(0, 12)
  return `ulp_${h}`
}

/** 解析 Cookie 头为 map（只取第一个同名项，容忍空格与空段） */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const seg of header.split(';')) {
    const idx = seg.indexOf('=')
    if (idx < 0) continue
    const k = seg.slice(0, idx).trim()
    const v = seg.slice(idx + 1).trim()
    if (!k || k in out) continue
    out[k] = decodeURIComponent(v)
  }
  return out
}

/** 构造 Set-Cookie 值：HttpOnly + Secure + SameSite=Lax + 指定 Path */
export function buildTicketCookie(gid: string, ticket: string, maxAgeSec = TICKET_TTL_SEC): string {
  return [
    `${ticketCookieName(gid)}=${encodeURIComponent(ticket)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ')
}

/** 清除票据用（Max-Age=0） */
export function clearTicketCookie(gid: string): string {
  return `${ticketCookieName(gid)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}
