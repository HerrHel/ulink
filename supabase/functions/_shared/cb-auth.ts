/**
 * CloudBase 访问令牌校验（云函数侧换取 uid）的唯一真源
 *
 * 背景：HTTP 访问服务触发的云函数**没有调用上下文**，`@cloudbase/node-sdk` 的
 * getUserInfo() 在 HTTP 触发下拿不到用户身份 —— 这就是 7 个云函数此前一律只做
 * IP 哈希限流、user_id 只能落 NULL 的根因。收费（按人计量）必须先解决它。
 *
 * 本模块用 CloudBase 网关的 OIDC 端点自行验签，不依赖 SDK 上下文：
 *   issuer          https://<env>.api.tcloudbasegateway.com
 *   jwks_uri        /auth/v1/certs          （RS256 公钥集，公开可读，已实测）
 *   userinfo        /auth/v1/user/me        （在线兜底，已实测）
 *   id_token 签名    RS256                  （openid-configuration 声明）
 *
 * 双模式设计（重要）：
 *   1. offline  —— 本地用 JWKS 公钥验 RS256 签名，零网络开销。access_token 若为
 *                  JWT 走这条路，这是绝大多数情况。
 *   2. userinfo —— 若令牌不是可验签的 JWT（opaque token、或 kid 轮换未命中），
 *                  回落官方 userinfo 端点换取 uid。**不猜格式，只认结果**。
 * 两种模式任一成功即认证通过；都失败则 fail-closed 拒绝（对齐 consume_rate_limit 的哲学）。
 *
 * 零第三方依赖（只用 node:crypto + 全局 fetch），可被 vitest 直测；
 * 派生到云函数目录时由 esbuild --bundle 打成 CJS。
 */

import { createPublicKey, createVerify } from 'node:crypto'

export interface CbJwk {
  kid: string
  kty: string
  alg?: string
  n: string
  e: string
}

/** JWT 载荷里本项目关心的字段（CloudBase 的 sub 即 auth.uid() 返回值） */
export interface CbClaims {
  sub?: string
  exp?: number
  iat?: number
  iss?: string
  aud?: string
  email?: string
  [key: string]: unknown
}

export type VerifyFailReason =
  | 'missing'
  | 'malformed'
  | 'bad_alg'
  | 'bad_signature'
  | 'expired'
  | 'unknown_kid'
  | 'no_sub'
  | 'rejected'

export interface VerifyOk {
  ok: true
  uid: string
  claims: CbClaims
  mode: 'offline' | 'userinfo'
}

export interface VerifyFail {
  ok: false
  reason: VerifyFailReason
  detail?: string
}

export type VerifyResult = VerifyOk | VerifyFail

export interface VerifyOptions {
  /** CloudBase 环境 id（envId），用于拼 OIDC 端点 */
  envId: string
  /** 注入当前时间（ms），便于测试；默认 Date.now() */
  now?: number
  /** 时钟容差（秒），默认 60 —— 云函数与网关有轻微偏差属正常 */
  clockToleranceSec?: number
  /** 注入公钥加载（测试用）；默认走 fetchJwks */
  jwksLoader?: () => Promise<CbJwk[]>
  /** 注入 userinfo 校验（测试用）；默认走官方端点 */
  userinfoFetcher?: (token: string) => Promise<{ uid: string; claims: CbClaims } | null>
  /** 是否启用 userinfo 兜底，默认 true */
  allowUserinfoFallback?: boolean
}

// ── base64url / JWT 解析 ──────────────────────────────────────────────

/** 从 Authorization 头取 Bearer 令牌；大小写不敏感，容忍多余空格 */
export function extractBearer(headerValue: string | null | undefined): string | null {
  if (!headerValue || typeof headerValue !== 'string') return null
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(headerValue)
  return m ? m[1] : null
}

export interface ParsedJwt {
  header: Record<string, unknown>
  payload: CbClaims
  /** `${header}.${payload}`，验签时参与哈希的原文 */
  signingInput: string
  signature: Buffer
}

/** 解析 JWT 三段结构；任一段非法返回 null（不抛错，调用方按 fail-closed 处理） */
export function parseJwt(token: string): ParsedJwt | null {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  let header: unknown
  let payload: unknown
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) return null
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  // 第三段允许空串（alg=none 形态）：交给 alg 白名单拒绝，而不是在这里当成 malformed
  const signature = parts[2] ? Buffer.from(parts[2], 'base64url') : Buffer.alloc(0)
  return {
    header: header as Record<string, unknown>,
    payload: payload as CbClaims,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature,
  }
}

// ── 离线验签 ──────────────────────────────────────────────────────────

/**
 * 用给定公钥集校验令牌。纯函数（时间由参数注入），可完全离线测试。
 *
 * 只接受 RS256：网关 id_token 声明的唯一算法，也挡住 alg=none 与 HS256
 * 混淆攻击（把公钥当 HMAC 密钥用的经典漏洞）。
 */
export function verifyJwtWithJwks(
  token: string,
  jwks: CbJwk[],
  opts: { now?: number; clockToleranceSec?: number } = {},
): VerifyResult {
  const now = opts.now ?? Date.now()
  const tol = (opts.clockToleranceSec ?? 60) * 1000

  const parsed = parseJwt(token)
  if (!parsed) return { ok: false, reason: 'malformed' }

  if (parsed.header.alg !== 'RS256') {
    return { ok: false, reason: 'bad_alg', detail: String(parsed.header.alg ?? 'none') }
  }

  const exp = parsed.payload.exp
  if (typeof exp === 'number' && exp * 1000 + tol < now) {
    return { ok: false, reason: 'expired' }
  }
  // nbf 若存在也要卡（统一按秒比较）
  const nbf = (parsed.payload as { nbf?: unknown }).nbf
  if (typeof nbf === 'number' && nbf * 1000 - tol > now) {
    return { ok: false, reason: 'rejected', detail: 'nbf in future' }
  }

  const kid = typeof parsed.header.kid === 'string' ? parsed.header.kid : ''
  const jwk = kid
    ? jwks.find((k) => k.kid === kid)
    : // 无 kid 时，仅当公钥集只有一把时才敢用（避免多密钥下猜错）
      jwks.length === 1
      ? jwks[0]
      : undefined
  if (!jwk) return { ok: false, reason: 'unknown_kid', detail: kid || '(no kid)' }

  let verified = false
  try {
    // CloudBase 的 JWKS 是标准 RSA 公钥（kty=RSA, n, e，base64url）
    const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })
    const verifier = createVerify('RSA-SHA256')
    verifier.update(parsed.signingInput)
    verifier.end()
    verified = verifier.verify(key, parsed.signature)
  } catch (e) {
    return { ok: false, reason: 'bad_signature', detail: (e as Error).message }
  }
  if (!verified) return { ok: false, reason: 'bad_signature' }

  const sub = parsed.payload.sub
  if (typeof sub !== 'string' || sub.trim() === '') {
    return { ok: false, reason: 'no_sub' }
  }
  return { ok: true, uid: sub, claims: parsed.payload, mode: 'offline' }
}

// ── 公钥集拉取（模块级缓存）──────────────────────────────────────────

interface JwksCacheEntry {
  keys: CbJwk[]
  expiresAt: number
}

/** 进程内缓存：云函数实例复用，避免每个请求都打网关 */
const JWKS_CACHE = new Map<string, JwksCacheEntry>()
/** 公钥有效期：密钥轮换不会比这更频繁；命中失败时会强制刷新一次 */
const JWKS_TTL_MS = 60 * 60 * 1000

export function clearJwksCache(envIdPrefix?: string): void {
  if (!envIdPrefix) JWKS_CACHE.clear()
  else {
    for (const k of JWKS_CACHE.keys()) {
      if (k.startsWith(envIdPrefix)) JWKS_CACHE.delete(k)
    }
  }
}

export function jwksUrl(envId: string): string {
  return `https://${envId}.api.tcloudbasegateway.com/auth/v1/certs`
}

export function userinfoUrl(envId: string): string {
  return `https://${envId}.api.tcloudbasegateway.com/auth/v1/user/me`
}

/** 拉取 JWKS；force 用于 kid 未命中时强刷（密钥轮换） */
export async function fetchJwks(envId: string, force = false): Promise<CbJwk[]> {
  const key = `jwks:${envId}`
  const now = Date.now()
  const hit = JWKS_CACHE.get(key)
  if (!force && hit && hit.expiresAt > now) return hit.keys

  const res = await fetch(jwksUrl(envId), {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`jwks http ${res.status}`)
  const body = (await res.json()) as { keys?: unknown }
  const raw = Array.isArray(body?.keys) ? (body.keys as Record<string, unknown>[]) : []
  const keys: CbJwk[] = raw
    .filter(
      (k) =>
        k &&
        k.kty === 'RSA' &&
        typeof k.n === 'string' &&
        typeof k.e === 'string' &&
        // 未标 use 的视为签名密钥（网关实际就是这么返回的）
        (k.use === undefined || k.use === 'sig'),
    )
    .map((k) => ({
      kid: typeof k.kid === 'string' ? k.kid : '',
      kty: 'RSA',
      alg: typeof k.alg === 'string' ? k.alg : undefined,
      n: k.n as string,
      e: k.e as string,
    }))

  if (keys.length === 0) throw new Error('jwks empty')
  JWKS_CACHE.set(key, { keys, expiresAt: now + JWKS_TTL_MS })
  return keys
}

/** 在线兜底：调官方 userinfo 端点。返回 null 表示令牌无效 */
export async function resolveViaUserinfo(
  token: string,
  envId: string,
): Promise<{ uid: string; claims: CbClaims } | null> {
  const res = await fetch(userinfoUrl(envId), {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  })
  if (!res.ok) return null
  const body = (await res.json()) as Record<string, unknown>
  // CloudBase 兼容 Supabase 形状：可能包在 { user: {...} } 或直接返回
  const user = (body.user && typeof body.user === 'object' ? body.user : body) as Record<
    string,
    unknown
  >
  // uid 优先 sub（OIDC 标准），其次 id / user_id
  const uid =
    (typeof user.sub === 'string' && user.sub) ||
    (typeof user.id === 'string' && user.id) ||
    (typeof user.user_id === 'string' && user.user_id) ||
    ''
  if (!uid) return null
  return { uid, claims: user as CbClaims }
}

// ── 主入口 ────────────────────────────────────────────────────────────

/**
 * 校验 Authorization 头并换取 uid。云函数里唯一该调用的鉴权函数。
 *
 * 失败语义统一为 fail-closed：任何异常、超时、解析失败都不放行。
 * 调用方拿 `ok:false` 应直接回 401，**不要**因为 reason 不同而放行。
 */
export async function verifyCbToken(
  authHeader: string | null | undefined,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const token = extractBearer(authHeader)
  if (!token) return { ok: false, reason: 'missing' }

  // 1) 离线验签
  let offline: VerifyResult | null = null
  if (parseJwt(token)) {
    const loadKeys = async (force: boolean): Promise<CbJwk[]> =>
      opts.jwksLoader ? opts.jwksLoader() : fetchJwks(opts.envId, force)
    let keys: CbJwk[] | null = null
    try {
      keys = await loadKeys(false)
    } catch (e) {
      // 拉不到公钥不等于令牌无效，留给 userinfo 兜底；离线结果记为失败
      offline = { ok: false, reason: 'unknown_kid', detail: `jwks fetch: ${(e as Error).message}` }
    }
    if (keys) {
      offline = verifyJwtWithJwks(token, keys, {
        now: opts.now,
        clockToleranceSec: opts.clockToleranceSec,
      })
      // kid 未命中 → 密钥可能已轮换，强刷一次再试
      if (!offline.ok && offline.reason === 'unknown_kid') {
        try {
          offline = verifyJwtWithJwks(token, await loadKeys(true), {
            now: opts.now,
            clockToleranceSec: opts.clockToleranceSec,
          })
        } catch {
          /* 保持首次失败结果 */
        }
      }
      if (offline.ok) return offline
    }
  }

  // 2) userinfo 兜底（opaque token / 无法验签的形态）
  if (opts.allowUserinfoFallback !== false) {
    try {
      const info = await (opts.userinfoFetcher
        ? opts.userinfoFetcher(token)
        : resolveViaUserinfo(token, opts.envId))
      if (info?.uid) {
        return { ok: true, uid: info.uid, claims: info.claims, mode: 'userinfo' }
      }
    } catch {
      /* 落到统一失败 */
    }
  }

  return offline ?? { ok: false, reason: 'malformed' }
}
